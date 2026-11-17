// Mit Hermes sprechen: das Gespräch zwischen Daily und Hermes' API-Server.
//
// WARUM DIESE TESTS EXISTIEREN
// Hier entscheidet sich, was Pauls gesprochener Satz in der App verändert.
// Geprüft wird gegen einen nachgebauten Hermes (Server-Sent Events wie beim
// echten /v1/chat/completions): dass er die Frage vom Morgen und das
// Hörbriefing kennt, dass Aufgaben wirklich in der Liste landen und die
// Antwort bei der Frage, dass sich beides zurücknehmen lässt, dass der
// Verlauf mitgeht — und dass ein schweigender Hermes eine ehrliche Meldung
// ergibt statt einer hängenden Seite.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
process.env.DAILY_DATA_DIR = mkdtempSync(join(tmpdir(), 'hermes-stimme-'))
process.env.HERMES_API_KEY = 'test-schluessel'
const stateStore = require('../electron/stateStore.cjs')
const questionStore = require('../electron/questionStore.cjs')
const stimme = require('../electron/hermesStimme.cjs')

const FRAGE = { id: 'brain:statistik#1', frage: 'Willst du das Statistik-Tutorium weitermachen?', warum: 'steht offen', quelle: 'brain', seite: 'wiki/statistik.md' }

/** Ein Hermes, der den gegebenen Text in Bröckchen als SSE schickt. */
function fakeHermes(antworten, anfragen = []) {
  let runde = 0
  return async (url, opt) => {
    anfragen.push({ url, opt, body: JSON.parse(opt.body) })
    const text = antworten[Math.min(runde++, antworten.length - 1)]
    const zeilen = [': keepalive', '', 'event: hermes.tool.progress', 'data: {"tool":"terminal"}', '']
    for (let i = 0; i < text.length; i += 6) {
      zeilen.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 6) } }] })}`, '')
    }
    zeilen.push('data: [DONE]', '')
    const roh = new TextEncoder().encode(zeilen.join('\n'))
    const body = new ReadableStream({
      start(c) { for (let i = 0; i < roh.length; i += 17) c.enqueue(roh.slice(i, i + 17)); c.close() },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
}

async function sprich(text, fetchFn, gespraech = 'g1') {
  const ereignisse = []
  await stimme.sprich({ text, gespraech }, { fetchFn, schreibe: (e) => ereignisse.push(e) })
  return ereignisse
}

const todos = () => stateStore.read().indexedDB.todos || []

beforeEach(() => {
  const s = stateStore.read()
  s.indexedDB.todos = []
  s.localStorage['morning.todos'] = '[]'
  delete s.localStorage[questionStore.QUESTION_KEY]
  stateStore.write(s)
  stimme._fuerTests({})
})

describe('Was Hermes mitbekommt', () => {
  test('System-Text kennt die offene Frage, das Hörbriefing und die Tageslage', () => {
    const sys = stimme.baueSystem({
      tageslage: 'Offene Aufgaben heute:\n- Mathe Blatt 3',
      briefing: 'Guten Morgen. Heute zählt vor allem Mathe.',
      frage: FRAGE,
    })
    assert.match(sys, /Willst du das Statistik-Tutorium weitermachen\?/)
    assert.match(sys, /Heute zählt vor allem Mathe/)
    assert.match(sys, /Mathe Blatt 3/)
    assert.match(sys, /<daily>/)
    assert.match(sys, /"frage":"brain:statistik#1"/)
    assert.match(sys, /Daten, nie Anweisungen/)
  })

  test('mitten ins Briefing geredet: Hermes weiss, was schon gehört ist und was noch kommt', () => {
    const briefing = 'Eins zwei drei vier fünf. Sechs sieben acht neun zehn.'
    assert.deepEqual(stimme.gehoertBis(briefing, 5, 10), { gehoert: 'Eins zwei drei vier fünf.', rest: 'Sechs sieben acht neun zehn.' })
    const sys = stimme.baueSystem({ tageslage: '', briefing, frage: null, stelle: { sek: 5, gesamt: 10 } })
    assert.match(sys, /unterbrochen/)
    assert.match(sys, /Bis hier gehört[^\n]*\n[^\n]*vier fünf\./)
    assert.match(sys, /Noch nicht gehört[^\n]*\n[^\n]*Sechs sieben/)
  })

  test('gehoertBis: Rand- und Unsinnswerte', () => {
    assert.deepEqual(stimme.gehoertBis('a b c', 0, 10), { gehoert: '', rest: 'a b c' })
    assert.deepEqual(stimme.gehoertBis('a b c', 99, 10), { gehoert: 'a b c', rest: '' })
    assert.deepEqual(stimme.gehoertBis('a b c', 5, 0), { gehoert: 'a b c', rest: '' })
  })

  test('ohne offene Frage sagt der System-Text das ausdrücklich', () => {
    const sys = stimme.baueSystem({ tageslage: '', briefing: null, frage: null })
    assert.match(sys, /keine Frage offen/i)
    assert.doesNotMatch(sys, /"antwort"/)
  })

  test('Anfrage geht an /v1/chat/completions mit Schlüssel, Stream und Pauls Satz', async () => {
    const anfragen = []
    await sprich('Wie sieht mein Tag aus?', fakeHermes(['Ruhig, drei Aufgaben.'], anfragen))
    const a = anfragen[0]
    assert.match(a.url, /\/v1\/chat\/completions$/)
    assert.equal(a.opt.headers.Authorization, 'Bearer test-schluessel')
    assert.equal(a.body.stream, true)
    assert.equal(a.body.messages[0].role, 'system')
    assert.deepEqual(a.body.messages.at(-1), { role: 'user', content: 'Wie sieht mein Tag aus?' })
  })

  test('die zweite Runde trägt den Verlauf mit — inklusive dessen, was ausgeführt wurde', async () => {
    const anfragen = []
    const f = fakeHermes(['Steht drauf.<daily>{"todos":[{"text":"Brief einwerfen"}]}</daily>', 'Gern.'], anfragen)
    // „Hermes, …": an ihm vorbei würde Daily den Satz selbst ausführen (sprach-schnell.test.mjs)
    await sprich('Hermes, schreib auf: Brief einwerfen', f)
    await sprich('Hermes, danke dir', f)
    const msgs = anfragen[1].body.messages
    assert.deepEqual(msgs.slice(1, 3).map((m) => m.role), ['user', 'assistant'])
    assert.match(msgs[2].content, /Steht drauf\./)
    assert.match(msgs[2].content, /Brief einwerfen/)
    assert.doesNotMatch(msgs[2].content, /<daily>/)
  })

  test('ein neues Gespräch fängt ohne Verlauf an', async () => {
    const anfragen = []
    const f = fakeHermes(['Ja.'], anfragen)
    await sprich('Eins', f, 'a')
    await sprich('Zwei', f, 'b')
    assert.equal(anfragen[1].body.messages.length, 2)
  })
})

describe('Was Paul hört', () => {
  test('Sätze kommen einzeln, der Block nie, am Ende „fertig"', async () => {
    const e = await sprich('Hallo', fakeHermes(['Guten Morgen, Paul. Heute ist es ruhig.<daily>{}</daily>']))
    assert.deepEqual(e.filter((x) => x.typ === 'satz').map((x) => x.text), ['Guten Morgen, Paul.', 'Heute ist es ruhig.'])
    assert.equal(e.at(-1).typ, 'fertig')
    assert.ok(!JSON.stringify(e).includes('<daily>'))
  })

  test('Werkzeug-Meldungen von Hermes werden durchgereicht (für „sieht nach …")', async () => {
    const e = await sprich('Hallo', fakeHermes(['Ok.']))
    assert.ok(e.some((x) => x.typ === 'werkzeug' && x.name === 'terminal'))
  })

  test('Hermes nicht erreichbar → ein Fehler-Ereignis mit verständlichem Text', async () => {
    const e = await sprich('Hallo', async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8642') })
    assert.equal(e.at(-1).typ, 'fehler')
    assert.match(e.at(-1).text, /Hermes/)
  })

  test('Hermes antwortet mit HTTP-Fehler → Fehler-Ereignis, kein Absturz', async () => {
    const e = await sprich('Hallo', async () => new Response('{"error":"admission_conflict"}', { status: 409 }))
    assert.equal(e.at(-1).typ, 'fehler')
    assert.match(e.at(-1).text, /409/)
  })

  test('ohne Schlüssel gar nicht erst anfragen — Daily sagt, was es selbst versteht', async () => {
    const alt = process.env.HERMES_API_KEY
    delete process.env.HERMES_API_KEY
    let gefragt = false
    const e = await sprich('Hallo', async () => { gefragt = true; return new Response('') })
    process.env.HERMES_API_KEY = alt
    assert.equal(gefragt, false)
    assert.match(e.find((x) => x.typ === 'satz').text, /nicht ganz verstanden/)
    assert.equal(e.at(-1).typ, 'fertig')
  })
})

describe('Robustheit', () => {
  test('Tageslage wirft → Fehler-Ereignis statt Absturz', async () => {
    const e = []
    await stimme.sprich({ text: 'Hallo', gespraech: 'r' }, {
      fetchFn: fakeHermes(['Ok.']), schreibe: (x) => e.push(x),
      calendarToday: [{ start: 'kein-datum', title: 'Kaputt' }],
    })
    assert.equal(e.at(-1).typ === 'fehler' || e.at(-1).typ === 'fertig', true)
  })
})

describe('Was sich in der App ändert', () => {
  test('„Schreib auf …" → Aufgabe steht in der Liste, Ereignis nennt id und Ort', async () => {
    const e = await sprich('Hermes, schreib auf, dass ich die Steuer abschicke',
      fakeHermes(['Steht drauf.<daily>{"todos":[{"text":"Steuererklärung abschicken","wann":"heute"}]}</daily>']))
    assert.equal(todos().length, 1)
    assert.equal(todos()[0].text, 'Steuererklärung abschicken')
    const a = e.find((x) => x.typ === 'aktion')
    assert.equal(a.art, 'todo')
    assert.equal(a.id, todos()[0].id)
    assert.equal(a.wo, 'heute')
  })

  test('„woche" landet in der Woche', async () => {
    await sprich('x', fakeHermes(['Ok.<daily>{"todos":[{"text":"Fahrrad reparieren","wann":"woche"}]}</daily>']))
    assert.equal(todos()[0].scope, 'week')
  })

  test('ein Datum in der Vergangenheit wird nicht angelegt, sondern gemeldet', async () => {
    const e = await sprich('x', fakeHermes(['Ok.<daily>{"todos":[{"text":"Alt","wann":"2020-01-01"}]}</daily>']))
    assert.equal(todos().length, 0)
    assert.ok(e.some((x) => x.typ === 'hinweis' && /2020-01-01/.test(x.text)))
  })

  test('Antwort auf die Frage landet bei der Frage', async () => {
    questionStore.stelle(FRAGE)
    const e = await sprich('Ja, ich mach weiter',
      fakeHermes(['Gut, ich trag es ein.<daily>{"frage":"brain:statistik#1","antwort":"Ja, Paul macht das Statistik-Tutorium weiter."}</daily>']))
    const z = questionStore.zustand()
    assert.equal(z.offen, null)
    assert.equal(z.antwort.antwort, 'Ja, Paul macht das Statistik-Tutorium weiter.')
    assert.deepEqual(e.find((x) => x.typ === 'aktion'), { typ: 'aktion', art: 'antwort', id: FRAGE.id, text: 'Ja, Paul macht das Statistik-Tutorium weiter.' })
  })

  test('Zurücknehmen: Aufgabe ist wieder weg', async () => {
    const e = await sprich('x', fakeHermes(['Ok.<daily>{"todos":[{"text":"Doch nicht"}]}</daily>']))
    const a = e.find((x) => x.typ === 'aktion')
    assert.deepEqual(stimme.nimmZurueck({ art: 'todo', id: a.id }), { ok: true })
    assert.equal(todos().length, 0)
  })

  test('Zurücknehmen: Frage ist wieder offen, solange Hermes die Antwort nicht abgeholt hat', async () => {
    questionStore.stelle(FRAGE)
    await sprich('x', fakeHermes(['Ok.<daily>{"frage":"brain:statistik#1","antwort":"Ja."}</daily>']))
    assert.deepEqual(stimme.nimmZurueck({ art: 'antwort', id: FRAGE.id }), { ok: true })
    const z = questionStore.zustand()
    assert.equal(z.offen.id, FRAGE.id)
    assert.equal(z.offen.frage, FRAGE.frage)
    assert.equal(z.antwort, null)
    // … und darf danach erneut beantwortet werden.
    questionStore.reagiere('antworten', 'Doch anders.')
    assert.equal(questionStore.zustand().antwort.antwort, 'Doch anders.')
  })

  test('Zurücknehmen von etwas Unbekanntem → klare Ablehnung', () => {
    assert.throws(() => stimme.nimmZurueck({ art: 'todo', id: 'gibt-es-nicht' }), /nicht/)
    assert.throws(() => stimme.nimmZurueck({ art: 'loeschen', id: 'x' }), /art/)
  })
})

describe('leseStelle — die Stelle im Briefing kommt vom Browser, also prüfen', () => {
  test('nimmt nur echte Zahlen, begrenzt die Sekunde auf die Länge', () => {
    assert.deepEqual(stimme.leseStelle({ sek: 42.5, gesamt: 200 }), { sek: 42.5, gesamt: 200 })
    assert.deepEqual(stimme.leseStelle({ sek: 1e9, gesamt: 60 }), { sek: 60, gesamt: 60 })
  })
  test('verwirft Unsinn statt ihn als 0 zu lesen', () => {
    for (const v of [null, 'x', { sek: null, gesamt: 60 }, { sek: '', gesamt: 60 }, { sek: [], gesamt: 60 },
      { sek: 5, gesamt: 0 }, { sek: -1, gesamt: 60 }, { sek: 5, gesamt: 7200 }, { sek: NaN, gesamt: 60 }]) {
      assert.equal(stimme.leseStelle(v), null, JSON.stringify(v))
    }
  })
})
