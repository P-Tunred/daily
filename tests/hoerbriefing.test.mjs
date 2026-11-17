#!/usr/bin/env node --test
// Das Hörbriefing — der Tag zum Anhören.
//
// WARUM DIESE TESTS EXISTIEREN
// Drei Versprechen an Paul (2026-10-22), die sonst nur gehofft würden:
// höchstens fünf Minuten, jeden Morgen anders, am Ende immer eine Frage fürs
// Second Brain. Und eins an alle: eine Aufnahme, die nicht entstand, sagt das
// laut — sie sieht nicht aus wie eine, die noch lädt.

import { test, describe, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Vor dem ersten require: hoerbriefing und questionStore laden den Speicher.
const DIR = mkdtempSync(join(tmpdir(), 'hoerbriefing-'))
process.env.DAILY_DATA_DIR = DIR
const hb = require('../electron/hoerbriefing.cjs')
const questionStore = require('../electron/questionStore.cjs')
const stateStore = require('../electron/stateStore.cjs')

const heute = hb.serverDate()
const satz = (n) => Array.from({ length: n }, (_, i) => `Satz ${i} über den Tag mit Termin und Aufgabe.`).join(' ')
const FRAGE = { id: 'brain:test#1', frage: 'Fährst du im November nach Karlstad?', warum: 'Steht offen im Brain.', seite: 'wiki/themen/reisen.md' }
const text = (einstieg = 'Donnerstag, und heute zählt vor allem die Übung.') =>
  `${einstieg} ${satz(20)} Zum Schluss eine Frage: Fährst du im November nach Karlstad?`
const briefing = (extra = {}) => ({ datum: heute, text: text(), frage: FRAGE, ...extra })

let gesprochen = []
before(() => {
  hb._fuerTests({
    sprecher: async (t, ziel) => { gesprochen.push(t); writeFileSync(ziel, Buffer.alloc(60_000, 1)) },
    warte: () => 0,
  })
})
beforeEach(() => {
  gesprochen = []
  rmSync(join(DIR, 'hoerbriefing'), { recursive: true, force: true })
  rmSync(join(DIR, 'state.json'), { force: true })
})
const fertig = async () => { for (let i = 0; i < 50; i++) { if (hb.lies(heute)?.status !== 'erzeuge') return; await new Promise((r) => setTimeout(r, 10)) } }

describe('Nur für heute, höchstens fünf Minuten', () => {
  test('ein anderes Datum wird abgelehnt', () => {
    assert.throws(() => hb.veroeffentliche(briefing({ datum: '2026-01-01' })), (e) => e.status === 400)
  })
  test('über fünf Minuten (740 Wörter) wird abgelehnt — kürzen, nicht schneller sprechen', () => {
    assert.throws(() => hb.veroeffentliche(briefing({ text: `Start. ${satz(100)} Frage?` })), /Wörter/)
  })
  test('kürzer ist ausdrücklich erlaubt', () => {
    assert.equal(hb.veroeffentliche(briefing()).ok, true)
  })
})

describe('Am Ende immer eine Frage fürs Second Brain', () => {
  test('ohne Frage am Schluss: abgelehnt', () => {
    assert.throws(() => hb.veroeffentliche(briefing({ text: `Start. ${satz(20)} Ende.` })), /Frage/)
  })
  test('ohne frage-Feld: abgelehnt', () => {
    assert.throws(() => hb.veroeffentliche(briefing({ frage: undefined })), /frage/)
  })
  test('die Frage wird zur offenen Brain-Frage — Antwort über die bekannte Karte', () => {
    hb.veroeffentliche(briefing())
    const z = questionStore.zustand()
    assert.equal(z.offen.id, FRAGE.id)
    assert.equal(z.offen.quelle, 'brain')
  })
  test('steht schon eine andere offen, gehört DIE ans Ende', () => {
    questionStore.stelle({ id: 'brain:anders#2', frage: 'Andere Frage?', warum: 'x', quelle: 'brain', seite: 'wiki/x.md' })
    assert.throws(() => hb.veroeffentliche(briefing()), (e) => e.status === 409 && e.steht?.id === 'brain:anders#2')
  })
  test('dieselbe offene Frage noch einmal ist in Ordnung', () => {
    questionStore.stelle({ ...FRAGE, quelle: 'brain' })
    assert.equal(hb.veroeffentliche(briefing()).ok, true)
  })
})

describe('Jeden Morgen anders', () => {
  const gestern = () => {
    const d = new Date(heute + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10)
  }
  const legeAn = (datum, einstieg) => {
    const { mkdirSync } = require('node:fs')
    mkdirSync(join(DIR, 'hoerbriefing'), { recursive: true })
    writeFileSync(join(DIR, 'hoerbriefing', `${datum}.json`), JSON.stringify({ datum, text: text(einstieg), status: 'fertig' }))
  }
  test('derselbe Einstieg wie gestern wird abgelehnt', () => {
    legeAn(gestern(), 'Donnerstag, und heute zählt vor allem die Übung.')
    assert.throws(() => hb.veroeffentliche(briefing()), (e) => e.status === 409 && e.gleichWie === gestern())
  })
  test('fast derselbe Einstieg auch', () => {
    legeAn(gestern(), 'Donnerstag — heute zählt vor allem die Übung!')
    assert.throws(() => hb.veroeffentliche(briefing()), (e) => e.status === 409)
  })
  test('ein anderer Einstieg geht durch', () => {
    legeAn(gestern(), 'Guten Morgen, ein ruhiger Freitag mit wenig Terminen.')
    assert.equal(hb.veroeffentliche(briefing()).ok, true)
  })
  test('ein zweiter Text am selben Tag ersetzt den ersten — kein Vergleich mit sich selbst', () => {
    hb.veroeffentliche(briefing())
    assert.equal(hb.veroeffentliche(briefing()).ok, true)
  })
  test('die Ähnlichkeit ist symmetrisch und 1 bei gleichem Text', () => {
    assert.equal(hb.aehnlichkeit('Heute zählt die Übung.', 'Heute zählt die Übung.'), 1)
    assert.equal(hb.aehnlichkeit('a b c', 'x y z'), 0)
  })
})

describe('Die Aufnahme', () => {
  test('wird erzeugt, und der Status sagt es', async () => {
    hb.veroeffentliche(briefing())
    await fertig()
    const d = hb.lies(heute)
    assert.equal(d.status, 'fertig')
    assert.equal(d.dauerSek, 10)
    assert.ok(hb.audioPfad(heute))
    assert.equal(gesprochen.length, 1)
  })
  test('schlägt die Stimme dreimal fehl, steht „fehler" mit Grund da — nicht ewig „erzeuge"', async () => {
    hb._fuerTests({ sprecher: async () => { throw new Error('Unexpected server response: 429') } })
    try {
      hb.veroeffentliche(briefing())
      await fertig()
      const d = hb.lies(heute)
      assert.equal(d.status, 'fehler')
      assert.match(d.fehler, /429/)
      assert.equal(hb.audioPfad(heute), null)
    } finally {
      hb._fuerTests({ sprecher: async (t, ziel) => { gesprochen.push(t); writeFileSync(ziel, Buffer.alloc(60_000, 1)) } })
    }
  })
  test('ein beim zweiten Versuch erfolgreicher Dienst reicht', async () => {
    let n = 0
    hb._fuerTests({ sprecher: async (t, ziel) => { if (++n === 1) throw new Error('429'); writeFileSync(ziel, Buffer.alloc(30_000, 1)) } })
    try {
      hb.veroeffentliche(briefing())
      await fertig()
      assert.equal(hb.lies(heute).status, 'fertig')
    } finally {
      hb._fuerTests({ sprecher: async (t, ziel) => { gesprochen.push(t); writeFileSync(ziel, Buffer.alloc(60_000, 1)) } })
    }
  })
  test('ein ungültiges Datum findet keine Datei — auch keinen Pfad ausserhalb', () => {
    assert.equal(hb.audioPfad('../../etc/passwd'), null)
    assert.equal(hb.audioPfad('2026-13-99'), null)
  })
  test('der Zustand von Daily bleibt unberührt bis auf die Frage', () => {
    hb.veroeffentliche(briefing())
    const s = stateStore.read()
    assert.ok(!Object.keys(s.localStorage).some((k) => k.includes('hoer')), 'Texte und Aufnahmen gehören nicht in state.json')
    assert.ok(existsSync(join(DIR, 'hoerbriefing', `${heute}.json`)))
  })
})
