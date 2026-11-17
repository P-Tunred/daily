// Lerntempo: Faktor, Kapazität, Ziel-Quote, realistisches Tagesziel.
// Rechnung, die Paul direkt Zahlen nennt — ein Vorzeichenfehler hiesse
// „du bist schneller als geplant", wenn er langsamer ist.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { tempo, kapazitaet, zielQuote, realistisch, mitZiel } from '../src/lib/lernTempo.ts'

const HEUTE = '2026-10-31'

describe('Tempo', () => {
  test('zu wenig gemessen → kein Faktor', () => {
    assert.equal(tempo([{ aufwandStunden: 4, erledigt: 0.5, minuten: 150 }]).faktor, null)
    assert.equal(tempo([{ aufwandStunden: 4, erledigt: 0.1, minuten: 50 }, { aufwandStunden: 4, erledigt: 0.2, minuten: 60 }]).faktor, null)
  })
  test('langsamer als geplant → Faktor über 1, Schnitt pro Schwerpunkt hochgerechnet', () => {
    // 4 h geplant; nach 50 % schon 180 min → 360 min hochgerechnet = 1,5×
    const t = tempo([
      { aufwandStunden: 4, erledigt: 0.5, minuten: 180 },
      { aufwandStunden: 4, erledigt: 1, minuten: 360 },
    ])
    assert.equal(t.faktor, 1.5)
    assert.equal(t.schnittMinuten, 360)
    assert.equal(t.schnittGeplant, 240)
  })
  test('schneller als geplant → Faktor unter 1, aber nie unter 0,5', () => {
    assert.equal(tempo([{ aufwandStunden: 10, erledigt: 1, minuten: 60 }, { aufwandStunden: 10, erledigt: 1, minuten: 60 }]).faktor, 0.5)
  })
})

describe('Kapazität und Quote', () => {
  test('Schnitt über 14 Tage ohne heute; Lerntage getrennt', () => {
    const k = kapazitaet({ '2026-10-30': 120, '2026-10-29': 60, [HEUTE]: 500 }, HEUTE)
    assert.equal(k.schnitt, Math.round(180 / 14))
    assert.equal(k.schnittLerntage, 90)
    assert.equal(k.lerntage, 2)
  })
  test('Ziel erreicht ab 90 %, Tage ohne Ziel zählen nicht', () => {
    const q = zielQuote({ '2026-10-30': 90, '2026-10-29': 90, '2026-10-28': 0 }, { '2026-10-30': 85, '2026-10-29': 30 }, HEUTE)
    assert.deepEqual(q, { erreicht: 1, von: 2 })
  })
})

describe('Realistisch', () => {
  test('Tempo hebt das Ziel, Kapazität urteilt', () => {
    const r = realistisch({ restStunden: 10, tageUebrig: 10, minutenHeute: 0, faktor: 1.5, kapazitaet: 60 })
    assert.equal(r.ziel, 90)          // 10 h × 1,5 / 10 Tage
    assert.equal(r.urteil, 'knapp')   // 90 ≤ 60 × 1,5
    assert.equal(r.tageNoetig, 15)
  })
  test('andere Klausuren am selben Tag zählen mit', () => {
    const r = realistisch({ restStunden: 5, tageUebrig: 10, minutenHeute: 0, faktor: 1, kapazitaet: 60, bedarfAndere: 90 })
    assert.equal(r.urteil, 'zu-viel')
  })
  test('ohne Messung kein Urteil', () => {
    assert.equal(realistisch({ restStunden: 5, tageUebrig: 5, minutenHeute: 0, faktor: null, kapazitaet: 0 }).urteil, 'unbekannt')
  })
})

describe('Verlauf der Tagesziele', () => {
  test('das erste Ziel des Tages bleibt, alte Tage fallen raus', () => {
    let v = mitZiel({ '2026-08-01': { A: 30 } }, HEUTE, 'Statistik', 90)
    v = mitZiel(v, HEUTE, 'Statistik', 45)
    assert.deepEqual(v, { [HEUTE]: { Statistik: 90 } })
  })
})

describe('Restaufwand lernt je Untereinheit', async () => {
  const { restMinutenFokus, tagesziel, fachMinutenHeute } = await import('../src/lib/lernTempo.ts')
  test('geschätzt 30 min, nach der Hälfte schon 60 min gebraucht → Rest mit eigenem Tempo', () => {
    // 0,5 h geschätzt; bei 50 % sind 60 min weg → 120 min fürs Ganze → noch 60
    assert.equal(restMinutenFokus({ aufwandStunden: 0.5, erledigt: 0.5, minuten: 60, offeneFragen: 0 }, 1), 60)
  })
  test('wenig Fortschritt: Mischung aus Schätzung und Messung, keine wilde Hochrechnung', () => {
    // 20 %, 60 min → eigenes 300; Schätzung 120; w = 0,4 → 192 × 0,8 = 154
    assert.equal(restMinutenFokus({ aufwandStunden: 2, erledigt: 0.2, minuten: 60, offeneFragen: 0 }, 1), 154)
  })
  test('unangefangen: Schätzung × Tempo des Fachs, plus offene Fragen', () => {
    assert.equal(restMinutenFokus({ aufwandStunden: 2, erledigt: 0, minuten: 0, offeneFragen: 2 }, 1.5), 180 + 30)
  })
  test('fertig ist fertig', () => {
    assert.equal(restMinutenFokus({ aufwandStunden: 2, erledigt: 0.95, minuten: 200, offeneFragen: 0 }, 2), 0)
  })
  test('Tagesziel: Budget ist die Obergrenze, Bedarf das Ziel, eigenes gewinnt', () => {
    assert.deepEqual(tagesziel({ budget: 300, bedarfKlausuren: 110, fachMinuten: 0 }), { ziel: 120, budget: 300, bedarf: 120, angepasst: true, quelle: 'bedarf' })
    assert.equal(tagesziel({ budget: 120, bedarfKlausuren: 400, fachMinuten: 0 }).ziel, 120)
    assert.equal(tagesziel({ budget: 300, bedarfKlausuren: null, fachMinuten: 0 }).ziel, 300)
    assert.equal(tagesziel({ budget: 300, eigenes: 45, bedarfKlausuren: 110, fachMinuten: 0 }).ziel, 45)
    assert.equal(tagesziel({ budget: 300, bedarfKlausuren: null, fachMinuten: 60 }).ziel, 60)
  })
  test('feste Fachzeit verteilt sich auf die Tage mit Budget', () => {
    assert.equal(fachMinutenHeute(5, 5), 60)
    assert.equal(fachMinutenHeute(5, 0), 0)
  })
})
