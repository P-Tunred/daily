#!/usr/bin/env node --test
// Der Score des Tages folgt der gemessenen Lernzeit — auch ohne offenes Dashboard.
//
// WARUM DIESE TESTS EXISTIEREN
// Bis 2026-10-27 hielt nur das Dashboard den Score fest. An 9 der letzten 40
// Tage stand im Verlauf zu wenig Lernzeit, am 26.10. 0 min bei 367 gelernten.
// Die Rechnung steckt jetzt in einer reinen Funktion (lib/scoreSnapshot.ts),
// die app-weit läuft; das Nachrechnen alter Tage darf nur nach oben korrigieren.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { tagesStand, mitGemessenerLernzeit } from '../src/lib/scoreSnapshot.ts'
import { computeDayScore } from '../src/lib/dayScore.ts'

const tag = '2026-10-26'
const jetzt = Date.parse('2026-10-26T20:00:00')
const todo = (id, done, extra = {}) => ({ id, text: id, done, priority: 'normal', createdAt: jetzt - 3_600_000, ...extra })
const sitzung = (date, durationMin) => ({ id: date + durationMin, subjectId: 'f', date, durationMin })

describe('tagesStand', () => {
  test('rechnet wie das Dashboard: Tagesaufgaben + Sitzungen des Tages', () => {
    const todos = [todo('a', true), todo('b', false), todo('w', false, { scope: 'week' })]
    const sessions = [sitzung(tag, 200), sitzung(tag, 167), sitzung('2026-10-25', 90)]
    const r = tagesStand(todos, sessions, tag, 300, jetzt, 2)
    const erwartet = computeDayScore([todos[0], todos[1]], 367, 300, jetzt, 2)
    assert.deepEqual(r.parts, erwartet)
    assert.equal(r.parts.studyMin, 367, 'Sitzungen anderer Tage zählen nicht')
    assert.equal(r.tasksDone, 1)
    assert.equal(r.tasksTotal, 2, 'Wochenaufgaben gehören nicht in den Tag')
  })

  test('kaputte Sitzungsdauer zählt als 0 statt NaN', () => {
    const r = tagesStand([], [sitzung(tag, 60), { ...sitzung(tag, 0), durationMin: 'x' }], tag, 300, jetzt, 0)
    assert.equal(r.parts.studyMin, 60)
  })
})

describe('mitGemessenerLernzeit', () => {
  const veraltet = { date: tag, score: 0, tasks: 0, time: 0, drag: -3, studyMin: 0, goalMin: 300, tasksDone: 0, tasksTotal: 2,
    weightedDone: 0, weightedTotal: 6, dragRaw: 2.6, routineHaken: 0, routineBonus: 0, v: 2 }

  test('veralteter Tag bekommt die gemessene Lernzeit und den passenden Score', () => {
    const neu = mitGemessenerLernzeit(veraltet, 367, 3)
    assert.equal(neu.studyMin, 367)
    assert.equal(neu.routineHaken, 3)
    assert.ok(neu.score > 50, `Score ${neu.score} sollte die Lernzeit widerspiegeln`)
    assert.equal(neu.tasksDone, 0, 'Aufgaben bleiben, wie sie festgehalten wurden')
    assert.equal(neu.nachgetragen, undefined, 'Paul hat nichts nachgetragen — nur die Messung war alt')
  })

  test('nie nach unten: mehr im Verlauf als gemessen bleibt unangetastet', () => {
    assert.equal(mitGemessenerLernzeit({ ...veraltet, studyMin: 439 }, 179, 0), undefined)
    assert.equal(mitGemessenerLernzeit({ ...veraltet, studyMin: 200 }, 200, 0), undefined)
  })

  test('ohne Gewichte (vor dem 13.10.) wird nichts geraten', () => {
    const alt = { ...veraltet }
    delete alt.weightedDone
    delete alt.weightedTotal
    assert.equal(mitGemessenerLernzeit(alt, 300, 0), undefined)
  })
})
