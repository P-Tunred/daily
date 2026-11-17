// Die Verdrängungsregel — der Teil, der Termine löscht.
//
// Ein Fehler hier ist teuer in beide Richtungen: löscht sie zu früh, verschwindet
// eine Vorlesung, zu der Paul gegangen wäre. Löscht sie zu spät, zählt die
// Wochenauswertung Termine mit, die nie stattgefunden haben.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ueberschneidung, anteilVerdeckt, verdraengt, verdraengteTermine, VERDRAENGT_AB }
  from '../src/lib/studyOverlap.ts'

const z = (a, b) => ({ startMin: a, endMin: b })
const t = (id, a, b, titel = id) => ({ id, startMin: a, endMin: b, titel })

describe('Überschneidung', () => {
  test('zählt nur die gemeinsamen Minuten', () => {
    assert.equal(ueberschneidung(z(600, 720), z(660, 780)), 60)
  })
  test('ist 0 bei Berührung ohne Überlappung', () => {
    assert.equal(ueberschneidung(z(600, 660), z(660, 720)), 0)
  })
  test('ist 0 bei völliger Trennung', () => {
    assert.equal(ueberschneidung(z(600, 660), z(900, 960)), 0)
  })
})

describe('Verdrängung', () => {
  test('halbe Vorlesung verlernt zählt schon', () => {
    // Vorlesung 10:00–12:00, Lernblock 11:00–12:00 → genau die Hälfte
    assert.equal(anteilVerdeckt(z(660, 720), z(600, 720)), 0.5)
    assert.equal(verdraengt(z(660, 720), z(600, 720)), true)
  })
  test('Randberührung zählt NICHT', () => {
    // Vorlesung 10:00–12:00, Lernblock 11:30–12:30 → eine halbe Stunde von zwei
    assert.equal(verdraengt(z(690, 750), z(600, 720)), false)
  })
  test('vollständige Überdeckung zählt', () => {
    assert.equal(verdraengt(z(540, 780), z(600, 720)), true)
  })
  test('Schwelle liegt bei der Hälfte', () => {
    assert.equal(VERDRAENGT_AB, 0.5)
  })
})

describe('verdraengteTermine', () => {
  const termine = [
    t('vorlesung', 600, 720),   // 10–12
    t('mittag', 720, 780),      // 12–13
    t('uebung', 840, 960),      // 14–16
  ]
  test('findet genau die überdeckten', () => {
    const weg = verdraengteTermine(z(600, 780), termine).map((x) => x.id)
    assert.deepEqual(weg, ['vorlesung', 'mittag'])
  })
  test('ein Block ohne Dauer verdrängt nichts', () => {
    assert.deepEqual(verdraengteTermine(z(600, 600), termine), [])
  })
  test('ein Block daneben verdrängt nichts', () => {
    assert.deepEqual(verdraengteTermine(z(1080, 1200), termine), [])
  })
})
