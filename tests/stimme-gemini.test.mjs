#!/usr/bin/env node --test
// Die natürliche Stimme (Gemini) und ihre Reserve (Seraphina).
//
// WARUM DIESE TESTS EXISTIEREN
// Die Anfrage an Google ist neu und nach der Doku gebaut, nicht nach einem
// erprobten Beispiel. Getestet wird gegen ein nachgebautes Google: wohin der
// Text, die Stimme und die Sprechweise gehen, wie die Antwort gelesen wird,
// und dass ein Fehler den Schlüssel nie in eine Meldung trägt. Und: fällt
// Gemini aus, muss Seraphina einspringen — das Briefing darf nie fehlen.

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DIR = mkdtempSync(join(tmpdir(), 'stimme-'))
process.env.DAILY_DATA_DIR = DIR
const g = require('../electron/stimmeGemini.cjs')
const hb = require('../electron/hoerbriefing.cjs')

const pcm = (sek) => Buffer.alloc(Math.round(g.RATE * sek) * 2, 7)
// Nachgebaute Uhr: Warten rückt sie vor, statt wirklich zu warten.
let uhr = 1_000_000
let geschlafen = []
g._fuerTests({ uhr: () => uhr, schlaf: async (ms) => { geschlafen.push(ms); uhr += ms } })
const frisch = () => { geschlafen = []; g._fuerTests({}) }
const antwort = (buf) => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: buf.toString('base64') }] }] })
const fakeGoogle = (anfragen, { status = 200, fehler } = {}) => async (url, opt) => {
  anfragen.push({ url, opt, body: JSON.parse(opt.body) })
  if (status !== 200) return { ok: false, status, json: async () => ({ error: { message: fehler ?? 'quota' } }) }
  return { ok: true, status, json: async () => antwort(pcm(1)) }
}

describe('Die Anfrage an Gemini', () => {
  test('Text, Stimme und Sprechweise stehen dort, wo die Doku sie haben will', async () => {
    const a = []
    await g.geminiPcm('Guten Morgen.', { schluessel: 'GEHEIM', stil: 'ruhig', fetchFn: fakeGoogle(a) })
    const { url, opt, body } = a[0]
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
    assert.equal(opt.headers['x-goog-api-key'], 'GEHEIM')
    assert.ok(!url.includes('GEHEIM'), 'der Schlüssel gehört in den Kopf, nie in die Adresse')
    assert.equal(body.model, 'gemini-3.8-flash-tts')
    assert.equal(body.input[0].content[0].text, 'Guten Morgen.')
    assert.deepEqual(body.input[0].content[0].annotations, [{ type: 'speech_metadata', style: 'ruhig' }])
    assert.equal(body.generation_config.speech_config[0].voice, 'Sulafat')
    assert.equal(body.response_format.mime_type, 'audio/l16')
  })
  test('kurze Absätze gehen in EINE Anfrage — die Gratisstufe erlaubt nur 3 pro Minute', async () => {
    frisch()
    const a = []
    await g.geminiPcm('Erster Absatz.\n\nZweiter Absatz.\n\nDritter?', { schluessel: 'x', fetchFn: fakeGoogle(a) })
    assert.equal(a.length, 1)
    assert.equal(a[0].body.input[0].content[0].text, 'Erster Absatz.\n\nZweiter Absatz.\n\nDritter?')
  })
  test('ein 5-Minuten-Briefing braucht höchstens zwei Anfragen', () => {
    const absatz = 'Ein gewöhnlicher Satz über den Tag, mit Terminen und Aufgaben darin. '.repeat(11)
    const text = Array.from({ length: 7 }, () => absatz.trim()).join('\n\n') // ~5000 Zeichen
    assert.ok(text.length > 4800)
    assert.ok(g.stuecke(text).length <= 2, `${g.stuecke(text).length} Stücke`)
  })
  test('mehrere Stücke: mit Pause verbunden und mindestens 21 s Abstand zwischen den Anfragen', async () => {
    frisch()
    const a = []
    const lang = ('Satz. ').repeat(700) // > 3500 Zeichen → zwei Stücke
    const out = await g.geminiPcm(lang, { schluessel: 'x', fetchFn: fakeGoogle(a) })
    assert.equal(a.length, 2)
    assert.equal(out.length, 2 * pcm(1).length + Math.round(g.RATE * 0.45) * 2)
    assert.ok(geschlafen.some((ms) => ms >= 20_000), `gewartet: ${geschlafen.join(', ')}`)
  })
  test('ein zu langer Absatz wird an Satzgrenzen geteilt, nie mitten im Satz', () => {
    const satz = 'Das ist ein ganz gewöhnlicher Satz mit ein paar Wörtern. '
    const teile = g.stuecke(satz.repeat(60), 400)
    assert.ok(teile.length > 1)
    for (const t of teile) { assert.ok(t.length <= 400); assert.match(t, /\.$/) }
  })
  test('bei „zu viele Anfragen" wird so lange gewartet, wie Google sagt — dann klappt es', async () => {
    frisch()
    let n = 0
    const erstNein = async () => (++n === 1
      ? { ok: false, status: 429, headers: { get: () => null }, json: async () => [{ error: { message: 'Rate limit exceeded … Please retry in 11s or upgrade' } }] }
      : { ok: true, status: 200, json: async () => antwort(pcm(1)) })
    await g.geminiPcm('Text.', { schluessel: 'x', fetchFn: erstNein })
    assert.equal(n, 2)
    assert.ok(geschlafen.includes(12_500), `gewartet: ${geschlafen.join(', ')}`)
  })
  test('nach drei 429 wird aufgegeben — dann spricht die Reserve', async () => {
    frisch()
    let n = 0
    const immerNein = async () => { n++; return { ok: false, status: 429, headers: { get: () => '5' }, json: async () => ({}) } }
    await assert.rejects(g.geminiPcm('Text.', { schluessel: 'x', fetchFn: immerNein }), /429/)
    assert.equal(n, 3)
  })
  test('die Wartezeit ist gedeckelt', () => {
    assert.equal(g.warteZeitAus({ headers: { get: () => null } }, 'retry in 600s'), 65_000)
  })
  test('ein Fehler nennt Status und Grund — aber nie den Schlüssel', async () => {
    frisch()
    await assert.rejects(
      g.geminiPcm('Text.', { schluessel: 'GEHEIM', fetchFn: fakeGoogle([], { status: 429, fehler: 'Resource exhausted' }) }),
      (e) => /429/.test(e.message) && /Resource exhausted/.test(e.message) && !e.message.includes('GEHEIM'),
    )
  })
  test('Googles Fehler kommt als Liste — der Grund muss trotzdem in der Meldung stehen', async () => {
    const alsListe = async () => ({ ok: false, status: 400, json: async () => [{ error: { message: 'API key not valid. Please pass a valid API key.' } }] })
    await assert.rejects(g.geminiPcm('Text.', { schluessel: 'GEHEIM', fetchFn: alsListe }), /400: API key not valid/)
  })
  test('ohne Schlüssel gar nicht erst anfragen', async () => {
    const a = []
    await assert.rejects(g.geminiPcm('Text.', { schluessel: '', fetchFn: fakeGoogle(a) }), /GEMINI_API_KEY/)
    assert.equal(a.length, 0)
  })
  test('schickt Google doch WAV, wird der Kopf entfernt', () => {
    const kopf = Buffer.alloc(44); kopf.write('RIFF', 0); kopf.write('WAVE', 8); kopf.write('data', 36)
    assert.equal(g.nurPcm(Buffer.concat([kopf, pcm(0.1)])).length, pcm(0.1).length)
  })
  test('eine Antwort ohne Audio ist ein Fehler, kein leeres Briefing', () => {
    assert.equal(g.audioAusAntwort({ steps: [] }), null)
  })
})

describe('Reserve: fällt Gemini aus, spricht Seraphina', () => {
  const heute = hb.serverDate()
  const FRAGE = { id: 'brain:x#1', frage: 'Und?', warum: 'w', seite: 'wiki/x.md' }
  const text = `Ein ganz eigener Einstieg für diesen Test <short pause> mit Zeichen. ${'Noch ein Satz zum Tag. '.repeat(12)} Und, wie war es?`
  const fertig = async () => { for (let i = 0; i < 100; i++) { if (hb.lies(heute)?.status !== 'erzeuge') return; await new Promise((r) => setTimeout(r, 10)) } }
  before(() => hb._fuerTests({ warte: () => 0 }))

  test('Gemini scheitert zweimal → Seraphina, als Ersatz markiert, mit Grund', async () => {
    let geminiVersuche = 0
    hb._fuerTests({ stimmen: [
      { name: 'gemini:Sulafat', versuche: 2, sprich: async () => { geminiVersuche++; throw new Error('Gemini antwortete 429: quota') } },
      { name: 'edge:Seraphina', versuche: 3, sprich: async (t, ziel) => { writeFileSync(ziel, Buffer.alloc(30_000, 1)); return { dauerSek: 5 } } },
    ] })
    rmSync(join(DIR, 'state.json'), { force: true })
    hb.veroeffentliche({ datum: heute, text, frage: FRAGE })
    await fertig()
    const d = hb.lies(heute)
    assert.equal(d.status, 'fertig')
    assert.equal(d.stimme, 'edge:Seraphina')
    assert.equal(d.ersatz, true)
    assert.equal(geminiVersuche, 2)
    assert.match(d.gruende.join(' '), /429/)
  })
  test('klappt Gemini, ist es keine Ersatzstimme', async () => {
    hb._fuerTests({ stimmen: [
      { name: 'gemini:Sulafat', versuche: 2, sprich: async (t, ziel) => { writeFileSync(ziel, Buffer.alloc(40_000, 1)); return { dauerSek: 12 } } },
    ] })
    hb.veroeffentliche({ datum: heute, text, frage: FRAGE })
    await fertig()
    const d = hb.lies(heute)
    assert.equal(d.stimme, 'gemini:Sulafat')
    assert.equal(d.ersatz, false)
    assert.equal(d.dauerSek, 12)
  })
  test('die Sprechweise des Tages wird an die Stimme weitergereicht', async () => {
    let gesehen
    hb._fuerTests({ stimmen: [{ name: 'gemini', versuche: 1, sprich: async (t, ziel, o) => { gesehen = o.stil; writeFileSync(ziel, Buffer.alloc(9_000, 1)) } }] })
    hb.veroeffentliche({ datum: heute, text, frage: FRAGE, stil: 'heute etwas munterer' })
    await fertig()
    assert.equal(gesehen, 'heute etwas munterer')
  })
  test('Inline-Zeichen zählen nicht als Wörter', () => {
    const r = hb.veroeffentliche({ datum: heute, text, frage: FRAGE })
    assert.ok(!text.replace(/<[^>]+>/g, '').includes('<'))
    assert.equal(r.woerter, text.replace(/<[^>]+>/g, ' ').match(/\S+/g).length)
  })
})
