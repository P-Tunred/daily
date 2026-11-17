// Prüfungen für „Dein Horizont" — die Verschmelzung von Kalender und wichtigen
// Terminen. Reines node:test, keine neue Abhängigkeit.
//
// Geprüft wird die Logik, nicht die Darstellung: Doppelte, Sortierung, leerer
// Horizont, Geburtstagsfenster und — am wichtigsten — dass VERSCHIEDENE
// Vorgänge NICHT zusammenfallen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// horizon.ts wird DIREKT geladen — Node 22 entfernt die Typen selbst
// (`--experimental-strip-types`, im npm-Skript gesetzt). Kein Compiler im Test,
// keine zweite Kopie der Logik, kein selbstgebautes Entschlacken: ein erster
// Versuch mit Regex ist prompt an den generischen Typen zerbrochen.
import {
  baueHorizont, normalisiereTitel, gcalKennung, tageBis, gruppe,
} from '../src/lib/horizon.ts'

const HEUTE = '2026-08-16'
const kal = (id, title, start, extra = {}) => ({ id, title, start, end: start, ...extra })
const wic = (id, kind, title, date, extra = {}) => ({ id, kind, title, date, ...extra })

describe('Doppelte', () => {
  test('gcal-Verknüpfung legt denselben Termin zusammen', () => {
    const r = baueHorizont(
      [kal('abc123', 'Klausur GRNVS', '2026-08-20T09:00:00Z')],
      [wic('gcal-abc123', 'exam', 'Klausur GRNVS', '2026-08-20')],
      { heute: HEUTE },
    )
    assert.equal(r.length, 1, 'derselbe Termin steht zweimal da')
    assert.equal(r[0].kind, 'exam', 'die Art muss vom wichtigen Termin kommen')
    assert.equal(r[0].source, 'beide')
    assert.ok(r[0].time, 'die Uhrzeit muss vom Kalender kommen')
  })

  test('gleicher Titel am gleichen Tag wird zusammengelegt', () => {
    const r = baueHorizont(
      [kal('x1', 'Zahnarzt!', '2026-08-18T10:30:00Z')],
      [wic('eigene-id', 'deadline', 'zahnarzt', '2026-08-18')],
      { heute: HEUTE },
    )
    assert.equal(r.length, 1)
    assert.equal(r[0].source, 'beide')
  })

  test('gleicher Titel an ANDEREM Tag bleibt getrennt', () => {
    const r = baueHorizont(
      [kal('x1', 'Zahnarzt', '2026-08-18T10:30:00Z')],
      [wic('e1', 'deadline', 'Zahnarzt', '2026-08-25')],
      { heute: HEUTE },
    )
    assert.equal(r.length, 2, 'zwei Termine an zwei Tagen sind zwei Termine')
  })

  test('verschiedene Handlungen desselben Vorhabens bleiben getrennt', () => {
    // Der Fall aus dem Auftrag: Aehnlichkeit allein darf NICHT verschmelzen.
    const r = baueHorizont(
      [kal('v1', 'Vertrag unterschreiben', '2026-08-19T09:00:00Z')],
      [wic('e1', 'deadline', 'Schlüsselübergabe klären', '2026-08-19')],
      { heute: HEUTE },
    )
    assert.equal(r.length, 2, 'zwei verschiedene Vorgaenge wurden zusammengeworfen')
  })
})

describe('Sortierung', () => {
  test('chronologisch, mit Uhrzeit vor ganztägig', () => {
    const r = baueHorizont(
      [
        kal('c', 'Später', '2026-08-25T08:00:00Z'),
        kal('b', 'Heute spät', '2026-08-16T17:00:00Z'),
        kal('a', 'Heute früh', '2026-08-16T08:00:00Z'),
        kal('g', 'Heute ganztägig', '2026-08-16T00:00:00Z', { allDay: true }),
      ],
      [],
      { heute: HEUTE },
    )
    assert.deepEqual(r.map((i) => i.title), ['Heute früh', 'Heute spät', 'Heute ganztägig', 'Später'])
  })

  test('alle heutigen bleiben, Zukunft wird begrenzt', () => {
    const heutige = Array.from({ length: 5 }, (_, i) =>
      kal(`h${i}`, `Heute ${i}`, `2026-08-16T0${i + 1}:00:00Z`))
    const kuenftige = Array.from({ length: 12 }, (_, i) =>
      kal(`k${i}`, `Kuenftig ${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T09:00:00Z`))
    const r = baueHorizont([...heutige, ...kuenftige], [], { heute: HEUTE, maxZukunft: 6 })
    assert.equal(r.filter((i) => i.date === HEUTE).length, 5, 'heutige duerfen nicht abgeschnitten werden')
    assert.equal(r.filter((i) => i.date > HEUTE).length, 6)
  })
})

describe('Zeitfenster und Randfaelle', () => {
  test('leerer Horizont ergibt eine leere Liste, keinen Fehler', () => {
    assert.deepEqual(baueHorizont([], [], { heute: HEUTE }), [])
  })

  test('Vergangenes erscheint nicht', () => {
    const r = baueHorizont(
      [kal('alt', 'Gestern', '2026-08-15T09:00:00Z')],
      [wic('e', 'deadline', 'Vorbei', '2026-08-01')],
      { heute: HEUTE },
    )
    assert.equal(r.length, 0, 'ein vergangener Termin beweist weder Teilnahme noch Erledigung')
  })

  test('Geburtstag ausserhalb des Fensters wird nicht gezeigt', () => {
    const nah = baueHorizont([], [wic('b1', 'birthday', 'Gaby', '2026-08-23', { recurringYearly: true })], { heute: HEUTE })
    const fern = baueHorizont([], [wic('b2', 'birthday', 'Otto', '2026-12-01', { recurringYearly: true })], { heute: HEUTE })
    assert.equal(nah.length, 1)
    assert.equal(fern.length, 0)
  })

  test('jährlicher Geburtstag rollt ins nächste Jahr', () => {
    // Der Tag ist dieses Jahr vorbei -> naechstes Jahr, damit ausserhalb des Fensters.
    const r = baueHorizont([], [wic('b', 'birthday', 'Alt', '2020-08-01', { recurringYearly: true })], { heute: HEUTE })
    assert.equal(r.length, 0)
  })

  test('abgehakte wichtige Termine erscheinen nicht', () => {
    const r = baueHorizont([], [wic('e', 'exam', 'Weg', '2026-08-20', { dismissed: true })], { heute: HEUTE })
    assert.equal(r.length, 0)
  })

  test('sehr langer Titel bleibt unveraendert — Kuerzen ist Sache der Anzeige', () => {
    const lang = 'Sehr langer Titel '.repeat(12).trim()
    const r = baueHorizont([kal('l', lang, '2026-08-18T09:00:00Z')], [], { heute: HEUTE })
    assert.equal(r[0].title, lang)
  })
})

describe('Hilfsfunktionen', () => {
  test('normalisiereTitel vereinheitlicht Umlaute und Satzzeichen', () => {
    assert.equal(normalisiereTitel('Klausur: GRNVS!'), normalisiereTitel('klausur grnvs'))
    assert.equal(normalisiereTitel('Übergabe'), 'uebergabe')
  })

  test('gcalKennung schaelt das Praefix ab', () => {
    assert.equal(gcalKennung('gcal-abc'), 'abc')
    assert.equal(gcalKennung('eigene'), null)
  })

  test('tageBis rechnet auf Kalendertagen', () => {
    assert.equal(tageBis('2026-08-16', '2026-08-17'), 1)
    assert.equal(tageBis('2026-08-16', '2026-08-16'), 0)
    assert.equal(tageBis('2026-08-16', '2026-08-15'), -1)
  })

  test('gruppe benennt die Naehe ruhig', () => {
    assert.equal(gruppe('2026-08-16', HEUTE), 'Heute')
    assert.equal(gruppe('2026-08-17', HEUTE), 'Morgen')
    assert.equal(gruppe('2026-09-30', HEUTE), 'Später')
    // 7 und 8 Tage gehoeren in DIESELBE Gruppe — sonst zerfaellt die Liste
    // in Ueberschriften mit je einer Zeile.
    assert.equal(gruppe('2026-08-23', HEUTE), gruppe('2026-08-24', HEUTE))
    assert.equal(gruppe('2026-08-23', HEUTE), 'Nächste Woche')
  })
})
