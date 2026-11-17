// Mit Hermes sprechen: wie seine gestreamte Antwort in Sätze zerfällt und wie
// der Aktionsblock am Ende gelesen wird.
//
// WARUM DIESE TESTS EXISTIEREN
// Hermes' Text kommt in Bröckchen. Gesprochen wird Satz für Satz, sobald einer
// fertig ist — sonst wartet Paul auf die ganze Antwort. Zwei Fehler wären
// teuer: ein Satz, der mitten in „z. B." zerreisst, klingt kaputt; und ein
// Aktionsblock, der vorgelesen statt ausgeführt wird, liest Paul JSON vor.
// Der Block entscheidet ausserdem, was in die Liste kommt — seine Grenzen
// (Anzahl, Länge, Antwort nur bei offener Frage) sind die eigentliche Sicherung.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const p = require('../electron/stimmeProtokoll.cjs')

/** Text in beliebige Bröckchen schneiden, wie ein Stream sie liefert. */
function inBroeckchen(text, groesse) {
  const out = []
  for (let i = 0; i < text.length; i += groesse) out.push(text.slice(i, i + groesse))
  return out
}

function alles(text, groesse = 7) {
  const s = p.satzSammler()
  const saetze = []
  for (const b of inBroeckchen(text, groesse)) saetze.push(...s.dazu(b))
  const ende = s.ende()
  return { saetze: [...saetze, ...ende.saetze], block: ende.block }
}

describe('satzSammler', () => {
  test('gibt fertige Sätze heraus, sobald sie fertig sind', () => {
    const s = p.satzSammler()
    assert.deepEqual(s.dazu('Guten Morgen, Paul. Heute ist'), ['Guten Morgen, Paul.'])
    assert.deepEqual(s.dazu(' viel los, aber machbar! Und'), ['Heute ist viel los, aber machbar!'])
    assert.deepEqual(s.ende(), { saetze: ['Und'], block: null })
  })

  test('unabhängig davon, wie der Stream schneidet', () => {
    const text = 'Erledigt, steht auf der Liste. Willst du noch etwas für morgen?'
    for (const g of [1, 3, 11, 200]) {
      assert.deepEqual(alles(text, g).saetze, ['Erledigt, steht auf der Liste.', 'Willst du noch etwas für morgen?'])
    }
  })

  test('reisst nicht an Abkürzungen und Datumszahlen', () => {
    const { saetze } = alles('Die Klausur ist am 3. November, d. h. in zwei Wochen. Plan z. B. drei Blöcke ein.')
    assert.deepEqual(saetze, ['Die Klausur ist am 3. November, d. h. in zwei Wochen.', 'Plan z. B. drei Blöcke ein.'])
  })

  test('sehr kurze Sätze werden mit dem nächsten zusammen gesprochen', () => {
    const { saetze } = alles('Ja. Gemacht. Die Aufgabe steht jetzt für morgen drin.')
    assert.deepEqual(saetze, ['Ja. Gemacht. Die Aufgabe steht jetzt für morgen drin.'])
  })

  test('der Aktionsblock wird nie gesprochen, auch wenn er zerstückelt ankommt', () => {
    const text = 'Steht drauf. Viel Erfolg damit!<daily>{"todos":[{"text":"Steuer abschicken"}]}</daily>'
    for (const g of [1, 2, 5, 9]) {
      const r = alles(text, g)
      assert.deepEqual(r.saetze, ['Steht drauf. Viel Erfolg damit!'], `Bröckchen ${g}`)
      assert.equal(r.block, '{"todos":[{"text":"Steuer abschicken"}]}', `Bröckchen ${g}`)
    }
  })

  test('ein „<" im Text ohne Block geht nicht verloren', () => {
    const { saetze, block } = alles('Drei < fünf, das passt schon so.')
    assert.deepEqual(saetze, ['Drei < fünf, das passt schon so.'])
    assert.equal(block, null)
  })

  test('nicht geschlossener Block zählt trotzdem als Block', () => {
    const r = alles('Notiert.<daily>{"todos":[]}')
    assert.equal(r.block, '{"todos":[]}')
  })
})

describe('fuersOhr', () => {
  test('nimmt Markdown und Emoji weg', () => {
    assert.equal(p.fuersOhr('**Wichtig:** die `Liste` ✅ ist _fertig_.'), 'Wichtig: die Liste ist fertig.')
  })
  test('leer bleibt leer', () => {
    assert.equal(p.fuersOhr('  ** '), '')
  })
})

describe('leseAktionen', () => {
  const offen = { frageId: 'brain:x#1' }

  test('Aufgaben mit wann: heute, woche oder Datum', () => {
    const r = p.leseAktionen(JSON.stringify({ todos: [
      { text: 'Steuererklärung abschicken', wann: '2026-11-03' },
      { text: 'Fahrrad reparieren', wann: 'woche' },
      { text: 'Mama anrufen' },
    ] }), offen)
    assert.deepEqual(r.todos, [
      { text: 'Steuererklärung abschicken', wann: '2026-11-03' },
      { text: 'Fahrrad reparieren', wann: 'woche' },
      { text: 'Mama anrufen', wann: 'heute' },
    ])
    assert.equal(r.antwort, null)
    assert.deepEqual(r.fehler, [])
  })

  test('höchstens drei Aufgaben pro Runde — der Rest wird gemeldet, nicht still verworfen', () => {
    const todos = ['a1', 'b2', 'c3', 'd4'].map((t) => ({ text: `Aufgabe ${t}` }))
    const r = p.leseAktionen(JSON.stringify({ todos }), offen)
    assert.equal(r.todos.length, 3)
    assert.match(r.fehler.join(' '), /höchstens 3/)
  })

  test('ungültige Aufgaben fallen heraus, mit Grund', () => {
    const r = p.leseAktionen(JSON.stringify({ todos: [
      { text: '' }, { text: 'x'.repeat(201) }, { text: 'Gut', wann: 'irgendwann' }, 'kein Objekt',
    ] }), offen)
    assert.deepEqual(r.todos, [])
    assert.equal(r.fehler.length, 4)
  })

  test('Antwort auf die Frage nur, wenn eine Frage offen ist', () => {
    const block = JSON.stringify({ frage: 'brain:x#1', antwort: 'Ja, ich mache das Tutorium weiter.' })
    assert.equal(p.leseAktionen(block, offen).antwort, 'Ja, ich mache das Tutorium weiter.')
    const ohne = p.leseAktionen(block, { frageId: null })
    assert.equal(ohne.antwort, null)
    assert.match(ohne.fehler.join(' '), /keine Frage offen/)
  })

  test('Antwort nur auf genau die Frage, die Hermes gezeigt bekam', () => {
    const fremd = p.leseAktionen(JSON.stringify({ frage: 'brain:andere#2', antwort: 'Ja.' }), offen)
    assert.equal(fremd.antwort, null)
    assert.match(fremd.fehler.join(' '), /anderen Frage/)
    const ohneId = p.leseAktionen(JSON.stringify({ antwort: 'Ja.' }), offen)
    assert.equal(ohneId.antwort, null)
  })

  test('kaputtes JSON → nichts ausführen, Fehler nennen', () => {
    const r = p.leseAktionen('{todos: [', offen)
    assert.deepEqual(r.todos, [])
    assert.equal(r.antwort, null)
    assert.match(r.fehler[0], /JSON/)
  })

  test('kein Block → nichts', () => {
    assert.deepEqual(p.leseAktionen(null, offen), { todos: [], antwort: null, fehler: [] })
  })

  test('Leerraum in Texten wird geglättet', () => {
    const r = p.leseAktionen(JSON.stringify({ todos: [{ text: '  Brief \n einwerfen ' }], frage: 'brain:x#1', antwort: ' Ja,\n gern. ' }), offen)
    assert.equal(r.todos[0].text, 'Brief einwerfen')
    assert.equal(r.antwort, 'Ja, gern.')
  })
})
