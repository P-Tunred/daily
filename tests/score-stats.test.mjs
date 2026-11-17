#!/usr/bin/env node --test
// Auswertungen für die Score-Seite im Stil G (Paul, 2026-11-03: „mehr Daten,
// die man sehen kann"). Reine Funktionen über den Score-Verlauf — Serie,
// Wochentage, Herkunft der Punkte, Ziel-Quote und der Kalender.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  mitHeute, serie, wochentagSchnitt, punkteHerkunft, zielQuote, kalenderWochen,
} from '../src/lib/scoreStats.ts'

const tag = (date, score, extra = {}) => ({
  date, score, tasks: 0, time: 0, drag: 0, studyMin: 0, goalMin: 0, tasksDone: 0, tasksTotal: 0, v: 2, ...extra,
})

describe('mitHeute', () => {
  test('ersetzt den gespeicherten Stand von heute durch den Live-Stand', () => {
    const r = mitHeute([tag('2026-11-02', 50), tag('2026-11-03', 10)], tag('2026-11-03', 40))
    assert.deepEqual(r.map(d => [d.date, d.score]), [['2026-11-02', 50], ['2026-11-03', 40]])
  })
  test('hängt heute an, wenn er noch fehlt, und verändert die Eingabe nicht', () => {
    const vorher = [tag('2026-11-02', 50)]
    const r = mitHeute(vorher, tag('2026-11-03', 40))
    assert.equal(r.length, 2)
    assert.equal(vorher.length, 1)
  })
})

describe('serie', () => {
  const verlauf = [tag('2026-10-30', 80), tag('2026-10-31', 72), tag('2026-11-01', 90), tag('2026-11-02', 75)]
  test('zählt starke Tage in Folge bis heute', () => {
    assert.equal(serie([...verlauf, tag('2026-11-03', 71)], '2026-11-03'), 5)
  })
  test('ein schwacher Tag heute beendet die Serie noch nicht', () => {
    assert.equal(serie([...verlauf, tag('2026-11-03', 20)], '2026-11-03'), 4)
  })
  test('ein fehlender Tag unterbricht', () => {
    assert.equal(serie([tag('2026-10-30', 80), tag('2026-11-01', 90), tag('2026-11-02', 75)], '2026-11-03'), 2)
  })
  test('ohne starke Tage 0', () => {
    assert.equal(serie([tag('2026-11-02', 40)], '2026-11-03'), 0)
  })
})

describe('wochentagSchnitt', () => {
  test('mittelt je Wochentag, Montag zuerst', () => {
    // 2026-11-02 ist ein Montag
    const r = wochentagSchnitt([tag('2026-10-26', 40), tag('2026-11-02', 60), tag('2026-11-03', 30)])
    assert.equal(r.length, 7)
    assert.deepEqual(r[0], { schnitt: 50, n: 2 })
    assert.deepEqual(r[1], { schnitt: 30, n: 1 })
    assert.deepEqual(r[6], { schnitt: null, n: 0 })
  })
  test('nimmt nur Tage der neuesten Formel', () => {
    const r = wochentagSchnitt([tag('2026-10-26', 90, { v: undefined }), tag('2026-11-02', 60)])
    assert.deepEqual(r[0], { schnitt: 60, n: 1 })
  })
})

describe('punkteHerkunft', () => {
  test('mittelt die Teile über die Tage', () => {
    const r = punkteHerkunft([
      tag('2026-11-02', 60, { time: 40, tasks: 20, routineBonus: 4, drag: -4 }),
      tag('2026-11-03', 40, { time: 20, tasks: 20, routineBonus: 0, drag: 0 }),
    ])
    assert.deepEqual(r, { tage: 2, time: 30, tasks: 20, routine: 2, drag: -2 })
  })
  test('ohne Tage null', () => {
    assert.equal(punkteHerkunft([]), null)
  })
})

describe('zielQuote', () => {
  test('zählt nur Tage mit Ziel', () => {
    const r = zielQuote([
      tag('2026-11-01', 0, { goalMin: 0, studyMin: 0 }),
      tag('2026-11-02', 0, { goalMin: 120, studyMin: 130 }),
      tag('2026-11-03', 0, { goalMin: 120, studyMin: 60 }),
    ])
    assert.deepEqual(r, { erreicht: 1, tage: 2, minuten: 190, schnittMin: 63 })
  })
})

describe('kalenderWochen', () => {
  test('liefert ganze Wochen ab Montag, Zukunft markiert', () => {
    const w = kalenderWochen([tag('2026-11-02', 55)], '2026-11-03', 2)
    assert.equal(w.length, 2)
    assert.equal(w[0][0].iso, '2026-10-26')
    assert.equal(w[1][0].iso, '2026-11-02')
    assert.equal(w[1][0].score, 55)
    assert.equal(w[1][1].score, null)
    assert.equal(w[1][1].zukunft, false)
    assert.equal(w[1][2].zukunft, true)
  })
})
