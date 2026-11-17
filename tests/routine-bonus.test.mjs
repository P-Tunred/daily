#!/usr/bin/env node --test
// Routinen und Gym im Tagesscore — +2 je Haken, seit 2026-10-22.
//
// WARUM DIESE TESTS EXISTIEREN
// Paul trug fast täglich Routinen für gestern nach — und der Score blieb
// stehen, weil Routinen gar nicht zählten. Jetzt zählen sie. Drei Stellen
// könnten das still wieder kaputtmachen: die Zählung pro Tag (Gym steht nur
// als Wochensumme im Speicher), der Nachtrag für gestern, und der Verlauf,
// dessen Trend sonst zwei Formeln vergleicht.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeDayScore, ROUTINE_BONUS, TASKS_MAX, TIME_BASE } from '../src/lib/dayScore.ts'
import {
  emptyState, configure, periodFor, updateGoal, recordSuggestion, aenderungAm, routineHakenAm,
} from '../src/lib/bewusst.ts'
import { nachgerechneterTag, mitRoutineBonus } from '../src/lib/gestern.ts'
import { averageScore, scoreTrend, switchDate } from '../src/lib/scoreHistory.ts'

const ZIEL = 300
const alle = [{ id: 'a', text: 'a', done: true, priority: 'normal', createdAt: Date.now() }]

describe('Der Bonus im Tagesscore', () => {
  test('jeder Haken bringt ROUTINE_BONUS, oben drauf', () => {
    const ohne = computeDayScore(alle, 0, ZIEL).score
    assert.equal(computeDayScore(alle, 0, ZIEL, Date.now(), 3).score, ohne + 3 * ROUTINE_BONUS)
  })
  test('ohne Haken rechnet der Score exakt wie vorher', () => {
    assert.equal(computeDayScore(alle, ZIEL, ZIEL).score, TASKS_MAX + TIME_BASE)
    assert.equal(computeDayScore(alle, ZIEL, ZIEL, Date.now(), 0).routineBonus, 0)
  })
  test('gedeckelt wird nur bei 100', () => {
    assert.equal(computeDayScore(alle, 1.5 * ZIEL, ZIEL, Date.now(), 7).score, 100)
  })
  test('Unsinn als Hakenzahl bringt nichts', () => {
    for (const h of [-3, NaN, Infinity]) assert.equal(computeDayScore(alle, 0, ZIEL, Date.now(), h).routineBonus, 0)
  })
})

describe('Haken pro Tag', () => {
  const routinen = () => configure(emptyState(), 'day', ['stretch', 'journal'], '2026-10-01')
  const hake = (s, tag, id, heute = tag) => updateGoal(s, periodFor(s, 'day', tag), id, { value: 1 }, heute, tag)

  test('erledigte Routinen des Tages zählen', () => {
    const s = hake(hake(routinen(), '2026-10-20', 'stretch'), '2026-10-20', 'journal')
    assert.equal(routineHakenAm(s, '2026-10-20'), 2)
    assert.equal(routineHakenAm(s, '2026-10-19'), 0)
  })
  test('ein nachgetragener Haken trägt „(für Tag)" im Audit', () => {
    const s = hake(routinen(), '2026-10-21', 'stretch', '2026-10-22')
    assert.match(s.periods['day:2026-10-21'].audit.at(-1), /^2026-10-22: stretch — \{"value":1\} \(für 2026-10-21\)$/)
  })
  test('Gym zählt an dem Tag, an dem es eingetragen wurde', () => {
    const s = recordSuggestion(emptyState(), 'week', 'gym', { delta: 1 }, '2026-10-20')
    assert.equal(routineHakenAm(s, '2026-10-20'), 1)
    assert.equal(routineHakenAm(s, '2026-10-21'), 0)
  })
  test('Gym für gestern zählt gestern, nicht am Tag der Eingabe', () => {
    const s = recordSuggestion(emptyState(), 'week', 'gym', { delta: 1 }, '2026-10-22', '2026-10-21')
    assert.equal(routineHakenAm(s, '2026-10-21'), 1)
    assert.equal(routineHakenAm(s, '2026-10-22'), 0)
  })
  test('zweimal Gym an einem Tag zählt einmal', () => {
    let s = recordSuggestion(emptyState(), 'week', 'gym', { delta: 1 }, '2026-10-20')
    s = recordSuggestion(s, 'week', 'gym', { delta: 1 }, '2026-10-20')
    assert.equal(routineHakenAm(s, '2026-10-20'), 1)
  })
  test('hin und wieder zurück ist kein Gym', () => {
    // So steht es am 20.09. wirklich im Protokoll: dreimal +1, dreimal −1.
    let s = emptyState()
    for (const d of [1, 1, 1, -1, -1, -1]) s = recordSuggestion(s, 'week', 'gym', { delta: d }, '2026-09-20')
    assert.equal(aenderungAm(s.periods['week:2026-09-14'], 'gym', '2026-09-20'), 0)
    assert.equal(routineHakenAm(s, '2026-09-20'), 0)
  })
  test('das Nachspielen folgt dem Deckel von updateGoal', () => {
    let s = emptyState()
    for (const tag of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']) {
      s = recordSuggestion(s, 'week', 'gym', { delta: 1 }, tag)
    }
    // Ziel ist 3 — der vierte Besuch ist gedeckelt und zählt nicht mehr.
    assert.equal(s.periods['week:2026-10-19'].goals.find((g) => g.id === 'gym').value, 3)
    assert.equal(routineHakenAm(s, '2026-10-22'), 0)
  })
  test('Routinen und Gym zusammen', () => {
    let s = hake(routinen(), '2026-10-20', 'stretch')
    s = recordSuggestion(s, 'week', 'gym', { delta: 1 }, '2026-10-20')
    assert.equal(routineHakenAm(s, '2026-10-20'), 2)
  })
})

const tag = (extra = {}) => ({
  date: '2026-10-21', score: 40, tasks: 12, time: 26, drag: 0, studyMin: 150, goalMin: 300,
  tasksDone: 1, tasksTotal: 3, weightedDone: 1, weightedTotal: 3, dragRaw: 0, v: 2, routineHaken: 0, ...extra,
})
const nachtrag = (extra = {}) =>
  ({ date: '2026-10-21', studyMin: 150, goalMin: 300, erledigt: [], am: '2026-10-22T08:00:00Z', anlegen: true, ...extra })

describe('Gestern: ein Routine-Haken bewegt den Score', () => {
  test('fünf Haken für gestern bringen fünfmal den Bonus', () => {
    // Genau Pauls Fall vom 22.10.: fünf Routinen für gestern, Score stand still.
    // Verglichen wird gegen denselben Tag ohne Haken, nicht gegen die
    // gespeicherte Zahl: die Testdaten müssen nicht in sich aufgehen.
    const ohne = nachgerechneterTag(tag(), nachtrag({ studyMin: 151 }))
    const mit = nachgerechneterTag(tag(), nachtrag({ studyMin: 151, routineHaken: 5 }))
    assert.equal(mit.score - ohne.score, 5 * ROUTINE_BONUS)
    assert.equal(mit.routineBonus, 5 * ROUTINE_BONUS)
  })
  test('Öffnen ohne Eintrag ändert einen alten Tag nicht', () => {
    const alt = { ...tag(), v: undefined, routineHaken: undefined }
    assert.equal(nachgerechneterTag(alt, nachtrag({ routineHaken: 0 })), alt)
  })
  test('unbekannte Hakenzahl lässt den festgehaltenen Bonus stehen', () => {
    // Bewusst lädt noch — eine 0 hier hätte den Bonus von gestern gelöscht.
    const vorher = tag({ routineHaken: 3, routineBonus: 6, score: 46 })
    assert.equal(nachgerechneterTag(vorher, nachtrag({ routineHaken: undefined })), vorher)
  })
  test('nur Routinen, ohne Eintrag für gestern: der Tag entsteht', () => {
    const neu = nachgerechneterTag(undefined, nachtrag({ studyMin: 0, routineHaken: 2 }))
    assert.equal(neu.score, 2 * ROUTINE_BONUS)
  })
})

describe('Rückwirkend ab 13.10. neu rechnen', () => {
  test('ein Tag mit Gewichten wird exakt mit Bonus gerechnet', () => {
    const alt = { ...tag(), v: undefined, routineHaken: undefined }
    const neu = mitRoutineBonus(alt, 4)
    assert.equal(neu.score, Math.round(TASKS_MAX / 3 + TIME_BASE / 2 + 4 * ROUTINE_BONUS))
    assert.equal(neu.v, 2)
    assert.equal(neu.nachgetragen, undefined, 'Paul hat nichts nachgetragen — nur die Rechnung ist neu')
  })
  test('ein Tag ohne Gewichte bleibt bei der alten Formel', () => {
    assert.equal(mitRoutineBonus({ ...tag(), weightedDone: undefined }, 4), undefined)
  })
})

describe('Der Verlauf vergleicht nur gleiche Formeln', () => {
  const tage = (alt, neu) => Array.from({ length: alt + neu }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 1) + i * 86_400_000).toISOString().slice(0, 10),
    score: i < alt ? 40 : 60, ...(i < alt ? {} : { v: 2 }),
  }))
  test('der Schnitt mittelt nicht über die Umstellung hinweg', () => {
    assert.equal(averageScore(tage(5, 2), 7), 60)
  })
  test('ist die Vorwoche noch alte Formel, gibt es keinen Trend', () => {
    assert.equal(scoreTrend(tage(10, 3), 7), null)
  })
  test('der Umstellungstag ist benennbar', () => {
    assert.equal(switchDate(tage(3, 2)), '2026-10-04')
  })
})
