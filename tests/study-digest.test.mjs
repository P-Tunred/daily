// Der Lernbericht, den Hermes wöchentlich ins Second Brain trägt.
//
// WARUM ALS EIGENER TEST
// Ein falscher Bericht fällt niemandem auf: Hermes schreibt ihn gewissenhaft
// ins Wiki, und dort steht dann eben eine falsche Zahl — mit Quelle und Datum,
// also mit dem Anschein von Wahrheit. Deshalb stehen hier die Fälle, in denen
// eine Summe still zu klein oder ein Wochentag still verschoben würde.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildDigest, resolveRange, weekdayIndex } = require('../electron/studyDigest.cjs')

const ls = (subjects, sessions, history = {}) => ({
  'morning.tracker.subjects': JSON.stringify(subjects),
  'morning.tracker.sessions': JSON.stringify(sessions),
  'morning.scoreHistory': JSON.stringify(history),
})

const FAECHER = [
  { id: 's1', name: 'Statistik', color: '#f00' },
  { id: 's2', name: 'OR', color: '#0f0', archiviert: true },
]

describe('Zeitraum', () => {
  test('ohne Angabe: die sieben vollen Tage bis gestern', () => {
    assert.deepEqual(resolveRange({}, '2026-09-23'), { from: '2026-09-16', to: '2026-09-22', days: 7 })
  })
  test('ungültige Daten werden abgelehnt, nicht geraten', () => {
    assert.throws(() => resolveRange({ from: '2026-02-30', to: '2026-03-01' }), /gültige Daten/)
    assert.throws(() => resolveRange({ from: '2026-09-10', to: '2026-09-01' }), /nach to/)
  })
  test('zu lange Zeiträume werden abgelehnt', () => {
    assert.throws(() => resolveRange({ from: '2024-01-01', to: '2026-01-01' }), /Höchstens/)
  })
})

describe('Wochentage', () => {
  // Der Montag muss vorn stehen — und darf durch keine Zeitzone kippen.
  test('Montag ist 0, Sonntag 6', () => {
    assert.equal(weekdayIndex('2026-09-21'), 0) // Montag
    assert.equal(weekdayIndex('2026-09-27'), 6) // Sonntag
  })
})

describe('Summen', () => {
  const range = { from: '2026-09-21', to: '2026-09-27', days: 7 }
  const sessions = [
    { id: 'a', subjectId: 's1', date: '2026-09-21', durationMin: 60 },
    { id: 'b', subjectId: 's1', date: '2026-09-22', durationMin: 30 },
    { id: 'c', subjectId: 's2', date: '2026-09-22', durationMin: 45 },
    { id: 'd', subjectId: 'weg', date: '2026-09-23', durationMin: 20 }, // Fach gelöscht
    { id: 'e', subjectId: 's1', date: '2026-09-20', durationMin: 999 }, // vor dem Zeitraum
    { id: 'f', subjectId: 's1', date: '2026-09-28', durationMin: 999 }, // nach dem Zeitraum
  ]
  const d = buildDigest(ls(FAECHER, sessions), range)

  test('nur Sitzungen im Zeitraum zählen', () => {
    assert.equal(d.totalMin, 155)
    assert.equal(d.sessions, 4)
  })
  test('ein gelöschtes Fach verschwindet nicht aus der Summe', () => {
    const unbekannt = d.bySubject.find((s) => s.subjectId === 'weg')
    assert.equal(unbekannt.min, 20)
    assert.equal(unbekannt.name, '(unbekanntes Fach)')
  })
  test('archivierte Fächer bleiben mit Namen drin', () => {
    const or = d.bySubject.find((s) => s.subjectId === 's2')
    assert.equal(or.name, 'OR')
    assert.equal(or.archiviert, true)
  })
  test('Fächer absteigend nach Minuten', () => {
    assert.deepEqual(d.bySubject.map((s) => s.min), [90, 45, 20])
  })
  test('Wochentage in Pauls Reihenfolge, Dienstag richtig zugeordnet', () => {
    assert.equal(d.byWeekday[0].weekday, 'Mo')
    assert.equal(d.byWeekday[1].min, 75) // Di: 30 + 45
    assert.equal(d.byWeekday[1].avgMin, 75)
  })
  test('jeder Tag des Zeitraums steht im Verlauf, auch ohne Lernzeit', () => {
    assert.equal(d.byDay.length, 7)
    assert.equal(d.byDay[6].min, 0)
  })
})

describe('Ziele und Score kommen aus der Score-Historie', () => {
  // Die Zielrechnung lebt im Browser. Der Bericht übernimmt, was der Browser
  // am Tag selbst festgehalten hat — statt eine zweite Fassung zu raten.
  const range = { from: '2026-09-21', to: '2026-09-22', days: 2 }
  const sessions = [
    { id: 'a', subjectId: 's1', date: '2026-09-21', durationMin: 120 },
    { id: 'b', subjectId: 's1', date: '2026-09-22', durationMin: 30 },
  ]
  const history = {
    '2026-09-21': { date: '2026-09-21', score: 90, goalMin: 90, tasksDone: 3, tasksTotal: 4 },
    '2026-09-22': { date: '2026-09-22', score: 40, goalMin: 90, tasksDone: 0, tasksTotal: 2 },
  }
  const d = buildDigest(ls(FAECHER, sessions, history), range)

  test('Ziel erreicht wird gegen das Ziel des Tages gezählt', () => {
    assert.equal(d.goalReachedDays, 1)
    assert.equal(d.daysWithGoal, 2)
  })
  test('Score-Mittel über die Tage mit Eintrag', () => {
    assert.deepEqual(d.score, { avg: 65, days: 2 })
  })
})

describe('Kaputte Daten bringen den Bericht nicht um', () => {
  test('ungültiges JSON ergibt einen leeren Bericht statt eines Fehlers', () => {
    const d = buildDigest({ 'morning.tracker.sessions': '{kaputt' }, { from: '2026-09-21', to: '2026-09-21', days: 1 })
    assert.equal(d.totalMin, 0)
    assert.equal(d.score, null)
  })
})
