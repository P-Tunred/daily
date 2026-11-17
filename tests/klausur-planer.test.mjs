// Klausur-Planer: Tagesziel, Lage und was heute dran ist.
//
// WARUM ALS EIGENER TEST
// Der Planer soll sich anpassen: mehr geschafft → kleineres Ziel, Unverstandenes
// → mehr Zeit. Rechnet er falsch, steht jeden Tag eine Zahl da, die Paul nicht
// glauben kann — und dann ignoriert er sie. Die Fälle hier sind die, an denen
// man den Fehler sofort sähe.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { planeKlausur, restStunden, wochenbeginn, fachZurKlausur, tageZwischen, lernminuten } from '../src/lib/klausurPlaner.ts'

const fokus = (o = {}) => ({
  titel: 'Thema', gewicht: 'hoch', aufwandStunden: 6, fortschritt: 0, verstaendnis: null,
  erledigt: 0, offeneFragen: 0, minuten: 0, angefangen: false, ...o,
})
const klausur = (fokusse, o = {}) => ({ name: 'FODS Theorie', datum: '2026-12-09', stundenProWoche: 14, wiederholungAb: null, fokusse, ...o })
const plane = (k, heute = '2026-11-01', minutenHeute = 0, minutenWoche = 0) => planeKlausur({ klausur: k, heute, minutenHeute, minutenWoche })

describe('Restaufwand', () => {
  test('Aufwand mal offener Anteil, plus 15 min je offene Frage, höchstens 2 h', () => {
    assert.equal(restStunden(fokus({ erledigt: 0.5 })), 3)
    assert.equal(restStunden(fokus({ erledigt: 1, offeneFragen: 2 })), 0.5)
    assert.equal(restStunden(fokus({ erledigt: 1, offeneFragen: 20 })), 2)
    assert.equal(restStunden(fokus({ aufwandStunden: null })), 4, 'ohne Angabe 4 h')
  })
})

describe('Lernphase', () => {
  // 10 Schwerpunkte à 6 h = 60 h; Wiederholung ab 25.11. → 24 Lerntage ab 01.11.
  const zehn = Array.from({ length: 10 }, (_, i) => fokus({ titel: `T${i + 1}` }))

  test('verteilt den Rest auf die Lerntage bis zur Wiederholung', () => {
    const r = plane(klausur(zehn))
    assert.equal(r.phase, 'lernen')
    assert.equal(r.tageBisKlausur, 38)
    assert.equal(r.tageUebrig, 24)
    assert.equal(r.restStunden, 60)
    assert.equal(r.tagesziel, 150, '60 h / 24 Tage = 2 h 30')
    assert.equal(r.planProTag, 120)
    assert.equal(r.lage, 'knapp', '150 min statt geplanter 120 min')
  })

  test('was heute schon gelernt ist, senkt nur „heute noch“, nicht das Ziel', () => {
    const r = plane(klausur(zehn), '2026-11-01', 60)
    assert.equal(r.tagesziel, 165, '(3600 + 60) / 24 = 152,5 → auf 15 min aufgerundet')
    assert.equal(r.heuteNoch, 105)
  })

  test('mehr geschafft → kleineres Ziel am nächsten Tag', () => {
    const vorher = plane(klausur(zehn), '2026-11-02').tagesziel
    const halb = zehn.map((f, i) => (i < 5 ? { ...f, erledigt: 1, angefangen: true } : f))
    assert.ok(plane(klausur(halb), '2026-11-02').tagesziel < vorher)
  })

  test('angefangene, unfertige Schwerpunkte kommen zuerst, fertige gar nicht', () => {
    const fs = [
      fokus({ titel: 'Fertig', erledigt: 1, angefangen: true }),
      fokus({ titel: 'Neu' }),
      fokus({ titel: 'Halb', erledigt: 0.5, angefangen: true, offeneFragen: 3 }),
    ]
    const r = plane(klausur(fs), '2026-11-01', 0)
    assert.equal(r.heuteDran[0].titel, 'Halb')
    assert.ok(!r.heuteDran.some((h) => h.titel === 'Fertig'))
    assert.equal(r.heuteDran[0].wiederholen, true, 'drei offene Fragen → wiederholen')
    // Mit mehr Zeit kommt danach der neue Schwerpunkt dran.
    const breit = planeKlausur({ klausur: klausur(fs.map((f) => ({ ...f, aufwandStunden: 1 }))), heute: '2026-11-24', minutenHeute: 0, minutenWoche: 0 })
    assert.deepEqual(breit.heuteDran.map((h) => h.titel), ['Halb', 'Neu'])
  })

  test('höchstens drei Schwerpunkte, keine Blöcke unter 30 min', () => {
    const r = plane(klausur(zehn.map((f) => ({ ...f, aufwandStunden: 0.25 }))))
    assert.ok(r.heuteDran.length <= 3)
    assert.ok(r.heuteDran.every((h) => h.minuten >= 30))
  })

  test('Ziel erreicht → nichts mehr dran', () => {
    const r = plane(klausur(zehn), '2026-11-01', 300)
    assert.equal(r.heuteNoch, 0)
    assert.deepEqual(r.heuteDran, [])
  })

  test('weit hinter dem Plan → zu knapp', () => {
    assert.equal(plane(klausur(zehn), '2026-11-20').lage, 'zu-knapp')
  })
})

describe('Wiederholung und Ränder', () => {
  test('ab dem Wiederholungsdatum: geplantes Mass, Wackligstes zuerst', () => {
    const fs = [
      fokus({ titel: 'Sitzt', erledigt: 1, verstaendnis: 0.95 }),
      fokus({ titel: 'Wackelt', erledigt: 0.8, verstaendnis: 0.4, offeneFragen: 4 }),
    ]
    const r = plane(klausur(fs, { wiederholungAb: '2026-11-26' }), '2026-11-27')
    assert.equal(r.phase, 'wiederholung')
    assert.equal(r.tagesziel, 120)
    assert.equal(r.heuteDran[0].titel, 'Wackelt')
    assert.ok(r.heuteDran.every((h) => h.wiederholen))
  })

  test('ohne Datum oder nach der Klausur: kein Plan', () => {
    assert.equal(plane(klausur([fokus()], { datum: null })).phase, 'ohne-datum')
    assert.equal(plane(klausur([fokus()]), '2026-12-10').phase, 'vorbei')
  })

  test('Woche beginnt montags; Tage zählen über den Monatswechsel', () => {
    assert.equal(wochenbeginn('2026-11-01'), '2026-10-26', '01.11. ist ein Sonntag')
    assert.equal(wochenbeginn('2026-11-02'), '2026-11-02')
    assert.equal(tageZwischen('2026-10-31', '2026-11-01'), 1)
  })

  test('findet das Daily-Fach im Klausurnamen, nur als ganzes Wort', () => {
    const faecher = [{ name: 'KM' }, { name: 'FODS' }, { name: 'OR' }]
    assert.equal(fachZurKlausur(faecher, 'FODS Theorie')?.name, 'FODS')
    assert.equal(fachZurKlausur(faecher, 'Information Theory Exam'), null, '„or“ steckt in „Theory“, zählt aber nicht')
  })
})

describe('lernminuten: Timer und LearnHarness', () => {
  test('nimmt je Tag die größere Uhr, nie die Summe', () => {
    const timer = { '2026-10-30': 60, '2026-10-31': 20 }
    const harness = { '2026-10-31': 45, '2026-10-29': 30 }
    assert.deepEqual(lernminuten(timer, harness, '2026-10-31'), { heute: 45, woche: 30 + 60 + 45 })
  })

  test('zählt nur die laufende Woche bis heute', () => {
    const timer = { '2026-10-25': 99, '2026-11-01': 10 }
    assert.deepEqual(lernminuten(timer, {}, '2026-10-31'), { heute: 0, woche: 0 })
  })
})
