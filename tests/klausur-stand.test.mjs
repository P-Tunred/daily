// Klausur-Stand: Zeit übrig, Arbeit übrig, Puffer, Lage und was zu schieben ist.
//
// WARUM ALS EIGENER TEST
// Paul liest daraus, ob er für eine Klausur mehr tun muss (2026-11-13). Eine
// falsche Lage („vorne", obwohl die Zeit nicht reicht) wäre schlimmer als gar
// keine Anzeige.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { klausurStand, lageAus, grundFuer, dringendste, pufferText, standSatz, klausurHebel } from '../src/lib/klausurStand.ts'

const fokus = (o = {}) => ({
  titel: 'Thema', gewicht: 'mittel', aufwandStunden: 4, fortschritt: 0, verstaendnis: null,
  erledigt: 0, offeneFragen: 0, minuten: 0, angefangen: false, ...o,
})
const stand = (fokusse, o = {}) => klausurStand({
  klausur: 'FODS', phase: 'lernen', tageBisKlausur: 26, tageUebrig: 12, planProTag: 120,
  erledigt: 0, fokusse, faktor: null, ...o,
})

describe('Zeit, Rest, Puffer', () => {
  test('Zeit = Lerntage × Tagesmass, Rest bei Pauls Tempo, Puffer = Differenz', () => {
    const s = stand([fokus(), fokus()]) // 2 × 4 h = 480 min Rest, 12 × 120 = 1440 min Zeit
    assert.equal(s.zeitMin, 1440)
    assert.equal(s.restMin, 480)
    assert.equal(s.pufferMin, 960)
    assert.equal(s.lage, 'vorne')
    assert.equal(s.proTagNoetig, 40)
  })

  test('langsameres Tempo macht den Rest grösser — und die Lage schlechter', () => {
    const fokusse = Array.from({ length: 6 }, () => fokus())
    assert.equal(stand(fokusse).lage, 'im-plan') // 1440 Rest, 1440 Zeit
    assert.equal(stand(fokusse, { faktor: 1.2 }).lage, 'knapp')
    assert.equal(stand(fokusse, { faktor: 1.5 }).lage, 'hinten')
  })

  test('null Tage übrig zählt als ein Tag, nicht als Division durch null', () => {
    const s = stand([fokus()], { tageUebrig: 0 })
    assert.equal(s.zeitMin, 120)
    assert.equal(s.proTagNoetig, 240)
  })
})

describe('Lage', () => {
  test('nach rest ÷ zeit', () => {
    assert.equal(lageAus(0, 0), 'vorne', 'nichts mehr zu tun')
    assert.equal(lageAus(80, 100), 'vorne')
    assert.equal(lageAus(100, 100), 'im-plan')
    assert.equal(lageAus(120, 100), 'knapp')
    assert.equal(lageAus(130, 100), 'hinten')
    assert.equal(lageAus(10, 0), 'hinten', 'Arbeit, aber keine Zeit')
  })
})

describe('Mehr schieben', () => {
  test('höchstens drei, fertige nie, erst angefangene mit Lücken, dann der Lernpfad', () => {
    const s = stand([
      fokus({ titel: 'Fertig', erledigt: 0.95, fortschritt: 1, verstaendnis: 0.95, angefangen: true }),
      fokus({ titel: 'Neu niedrig', gewicht: 'niedrig' }),
      fokus({ titel: 'Neu hoch', gewicht: 'hoch' }),
      fokus({ titel: 'Halb', fortschritt: 0.5, erledigt: 0.4, verstaendnis: 0.8, angefangen: true, minuten: 90 }),
      fokus({ titel: 'Wacklig', fortschritt: 0.9, erledigt: 0.55, verstaendnis: 0.6, angefangen: true, minuten: 120 }),
    ])
    // Wacklig vor Halb: weniger Rest, aber schlecht verstanden zählt mehr.
    // Danach das nächste Neue in der Reihenfolge des Auftrags, nicht das schwerste.
    assert.deepEqual(s.schieben.map((x) => x.titel), ['Wacklig', 'Halb', 'Neu niedrig'])
  })

  test('jeder Eintrag hat einen Grund in Worten', () => {
    assert.match(grundFuer(fokus(), 240), /noch nicht angefangen · ~4 h/)
    assert.equal(grundFuer(fokus({ angefangen: true, fortschritt: 0.9, verstaendnis: 0.63 }), 60), 'erst 63 % verstanden')
    assert.equal(grundFuer(fokus({ angefangen: true, fortschritt: 0.43, verstaendnis: 0.83 }), 60), 'erst 43 % durchgearbeitet')
    assert.equal(grundFuer(fokus({ angefangen: true, fortschritt: 0.97, verstaendnis: 0.77, offeneFragen: 44 }), 60), '44 offene Fragen')
  })

  test('Wiederholung: das Wackligste zuerst, Sicheres gar nicht', () => {
    const s = stand([
      fokus({ titel: 'Sicher', gewicht: 'mittel', erledigt: 1, fortschritt: 1, verstaendnis: 0.95, angefangen: true }),
      fokus({ titel: 'Wacklig', erledigt: 0.6, fortschritt: 1, verstaendnis: 0.6, angefangen: true, offeneFragen: 5 }),
    ], { phase: 'wiederholung' })
    assert.deepEqual(s.schieben.map((x) => x.titel), ['Wacklig'])
  })
})

describe('Über mehrere Klausuren', () => {
  test('die dringendste: schlechteste Lage, dann der kleinste Puffer', () => {
    const a = { klausur: 'A', lage: 'im-plan', pufferMin: 60, zeitMin: 600 }
    const b = { klausur: 'B', lage: 'knapp', pufferMin: -60, zeitMin: 600 }
    const c = { klausur: 'C', lage: 'knapp', pufferMin: -200, zeitMin: 600 }
    assert.equal(dringendste([a, b, c]).klausur, 'C')
    assert.equal(dringendste([]), null)
  })

  test('Puffer in Worten', () => {
    assert.equal(pufferText(180), '3 h Puffer')
    assert.equal(pufferText(-390), '6,5 h zu wenig')
    assert.equal(pufferText(20), 'genau passend')
  })
})

describe('In Worten', () => {
  test('der Satz nennt Bedarf und Plan pro Tag', () => {
    const fokusse = Array.from({ length: 8 }, () => fokus()) // 1920 min Rest in 12 Tagen à 120
    assert.equal(standSatz(stand(fokusse)), 'Du brauchst 2 h 45 am Tag statt 2 h 00. So reicht die Zeit nicht.')
    assert.equal(standSatz(stand([fokus()])), 'Du brauchst 30 min am Tag, geplant sind 2 h 00. Luft da.')
  })

  test('der Hebel kommt nur, wenn eine Klausur eng wird — die engste zuerst', () => {
    const gut = stand([fokus()])
    assert.equal(klausurHebel([gut]), null)
    const eng = stand(Array.from({ length: 8 }, (_, i) => fokus({ titel: `T${i}` })), { klausur: 'INTSEC' })
    const h = klausurHebel([gut, eng])
    assert.equal(h.titel, 'INTSEC: 8 h zu wenig')
    assert.equal(h.warum, 'mehr schieben: T0, T1')
  })
})
