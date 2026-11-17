#!/usr/bin/env node --test
// Gestern nachtragen — die Rechnung.
//
// WARUM DIESE TESTS EXISTIEREN
// Der Nachtrag ändert einen Tag, der schon vorbei ist. Rechnet er falsch,
// fällt es niemandem auf: gestern schaut man sich nicht noch einmal an. Und
// zwei Fehler wären besonders billig zu machen — dieselbe Aufgabe zweimal
// gutschreiben, oder einen Tag mit null Aufgaben „erfinden", den die App nie
// gesehen hat.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  gesternVon, nachtragbareAufgaben, nachgerechneterTag, anfangDesTags, endeDesTags,
} from '../src/lib/gestern.ts'
import { TASKS_MAX, TIME_BASE, timePart, dragCost } from '../src/lib/dayScore.ts'
import {
  emptyState, configure, periodFor, updateGoal, recordSuggestion,
} from '../src/lib/bewusst.ts'

const HEUTE = '2026-10-13'
const GESTERN = '2026-10-12'
const AM = '2026-10-13T08:00:00.000Z'
const tageVor = (n) => anfangDesTags(HEUTE) - n * 86_400_000 + 3_600_000
const aufgabe = (id, prio = 'normal', alterTage = 1, extra = {}) =>
  ({ id, text: id, done: false, priority: prio, createdAt: tageVor(alterTage), ...extra })

/** Ein Tag, wie recordScoreDay ihn seit dem 13.10. festhält. */
const tag = (extra = {}) => ({
  date: GESTERN, score: 40, tasks: 12, time: 26, drag: 0, studyMin: 150, goalMin: 300,
  tasksDone: 1, tasksTotal: 3, weightedDone: 1, weightedTotal: 3, dragRaw: 0, ...extra,
})
const nachtrag = (extra = {}) =>
  ({ date: GESTERN, studyMin: 150, goalMin: 300, erledigt: [], am: AM, anlegen: true, ...extra })

describe('Welcher Tag ist gestern', () => {
  test('über die Monatsgrenze', () => {
    assert.equal(gesternVon('2026-11-01'), '2026-10-31')
  })
  test('über die Jahresgrenze', () => {
    assert.equal(gesternVon('2027-01-01'), '2026-12-31')
  })
  test('über die Zeitumstellung (25.10.2026)', () => {
    assert.equal(gesternVon('2026-10-26'), '2026-10-25')
  })
})

describe('Welche Aufgaben sich für gestern abhaken lassen', () => {
  test('nur offene Tagesaufgaben von vor heute', () => {
    const liste = [
      aufgabe('alt'),
      aufgabe('heute-angelegt', 'normal', 0),
      aufgabe('schon-erledigt', 'normal', 1, { done: true }),
      aufgabe('wochenliste', 'normal', 1, { scope: 'week' }),
      aufgabe('routine', 'normal', 1, { origin: 'bewusst' }),
      { id: 'ohne-datum', text: 'x', done: false },
    ]
    assert.deepEqual(nachtragbareAufgaben(liste, HEUTE).map((t) => t.id), ['alt'])
  })
})

describe('Lernzeit nachtragen', () => {
  test('der Lernanteil wird aus der neuen Summe gerechnet, mit dem festgehaltenen Ziel', () => {
    const neu = nachgerechneterTag(tag(), nachtrag({ studyMin: 300, goalMin: 999 }))
    assert.equal(neu.studyMin, 300)
    assert.equal(neu.goalMin, 300, 'eine spätere Zieländerung darf gestern nicht umschreiben')
    assert.equal(neu.time, TIME_BASE)
    assert.equal(neu.score, Math.round(TASKS_MAX / 3 + TIME_BASE))
  })
  test('der Tag ist als nachgetragen gekennzeichnet', () => {
    assert.equal(nachgerechneterTag(tag(), nachtrag({ studyMin: 200 })).nachgetragen.am, AM)
  })
  test('ändert sich nichts, kommt derselbe Eintrag zurück', () => {
    const vorher = tag()
    assert.equal(nachgerechneterTag(vorher, nachtrag()), vorher)
  })
})

describe('Aufgabe gestern erledigt', () => {
  test('ihr Gewicht wandert in den erledigten Teil — dringend zählt dreifach', () => {
    const neu = nachgerechneterTag(tag({ weightedDone: 1, weightedTotal: 6 }),
      nachtrag({ erledigt: [aufgabe('a', 'dringend')] }))
    assert.equal(neu.weightedDone, 4)
    assert.equal(neu.weightedTotal, 6)
    assert.equal(neu.tasks, Math.round(TASKS_MAX * 4 / 6))
    assert.equal(neu.tasksDone, 2)
  })
  test('ihr Liegenbleiber-Abzug fällt weg', () => {
    const alt = aufgabe('alt', 'dringend', 20)
    const kosten = dragCost(alt, endeDesTags(GESTERN))
    assert.ok(kosten > 0, 'Testvoraussetzung: die Aufgabe kostet gestern etwas')
    const neu = nachgerechneterTag(tag({ dragRaw: kosten, drag: -Math.round(kosten) }),
      nachtrag({ erledigt: [alt] }))
    assert.equal(neu.dragRaw, 0)
    assert.equal(neu.drag, 0)
  })
  test('dieselbe Aufgabe zweimal bringt nur einmal etwas', () => {
    const a = aufgabe('a', 'wichtig')
    const einmal = nachgerechneterTag(tag(), nachtrag({ erledigt: [a] }))
    const zweimal = nachgerechneterTag(einmal, nachtrag({ erledigt: [a] }))
    assert.equal(zweimal, einmal)
    assert.equal(nachgerechneterTag(tag(), nachtrag({ erledigt: [a, a] })).tasksDone, 2)
  })
  test('erledigt kann nie mehr sein als insgesamt', () => {
    const neu = nachgerechneterTag(tag({ weightedDone: 3, weightedTotal: 3 }),
      nachtrag({ erledigt: [aufgabe('neu', 'dringend')] }))
    assert.ok(neu.weightedDone <= neu.weightedTotal)
    assert.equal(neu.tasks, TASKS_MAX)
  })
  test('ein alter Eintrag ohne Gewichte: Aufgabenteil bleibt stehen, Lernzeit zählt trotzdem', () => {
    const alt = { ...tag(), weightedDone: undefined, weightedTotal: undefined, dragRaw: undefined }
    const neu = nachgerechneterTag(alt, nachtrag({ studyMin: 300, erledigt: [aufgabe('a')] }))
    assert.equal(neu.tasks, alt.tasks, 'ohne Gewichte wäre jeder neue Wert geraten')
    assert.equal(neu.time, TIME_BASE)
    assert.equal(neu.weightedTotal, undefined)
  })
})

describe('Gestern hat die App nie gesehen', () => {
  test('der automatische Abgleich legt keinen Tag an', () => {
    // „Tage, die die App nie sah, zählen nicht" — kein erfundener Nulltag.
    assert.equal(nachgerechneterTag(undefined, nachtrag({ studyMin: 120, anlegen: false })), undefined)
  })
  test('ein ausdrücklicher Eintrag legt ihn an — nur mit dem, was eingetragen wurde', () => {
    const neu = nachgerechneterTag(undefined, nachtrag({ studyMin: 150, erledigt: [aufgabe('a', 'wichtig')] }))
    assert.equal(neu.tasks, TASKS_MAX)
    assert.equal(neu.tasksTotal, 1)
    assert.equal(neu.time, Math.round(timePart(150, 300)))
  })
  test('ohne irgendeinen Inhalt gibt es nichts anzulegen', () => {
    assert.equal(nachgerechneterTag(undefined, nachtrag({ studyMin: 0 })), undefined)
  })
})

describe('Bewusst leben für gestern', () => {
  const mitRoutine = () => configure(emptyState(), 'day', ['stretch'], '2026-10-01')

  test('eine Routine von gestern lässt sich abhaken, das Audit trägt das Datum des Nachtrags', () => {
    const s = mitRoutine()
    const neu = updateGoal(s, periodFor(s, 'day', GESTERN), 'stretch', { value: 1 }, HEUTE)
    const p = neu.periods[`day:${GESTERN}`]
    assert.equal(p.goals.find((g) => g.id === 'stretch').value, 1)
    assert.match(p.audit.at(-1), /^2026-10-13: stretch/)
  })
  test('montags landet „gestern im Gym" in der Vorwoche', () => {
    // 2026-10-12 ist ein Montag, gestern also Sonntag, der 11.
    const neu = recordSuggestion(emptyState(), 'week', 'gym', { delta: 1 }, '2026-10-12', '2026-10-11')
    assert.ok(neu.periods['week:2026-10-05'], 'Woche vom 05.10.')
    assert.equal(neu.periods['week:2026-10-12'], undefined)
    assert.equal(neu.periods['week:2026-10-05'].goals.find((g) => g.id === 'gym').value, 1)
  })
  test('ohne Tagesangabe bleibt alles wie bisher', () => {
    const neu = recordSuggestion(emptyState(), 'week', 'gym', { delta: 1 }, '2026-10-12')
    assert.ok(neu.periods['week:2026-10-12'])
  })
})
