// Die Tagesbewertung — eine Zahl, die Paul jeden Abend ansieht.
//
// Sie hatte bisher keinen Test. Das ist bei einer reinen Rechenfunktion mit
// einem klaren Versprechen ("100 Punkte erst bei anderthalbfacher Lernzeit")
// die teuerste Art von Lücke: eine verschobene Konstante ändert das Versprechen
// still, und auffallen würde es erst Wochen später an einem Gefühl.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  timePart, computeDayScore, TASKS_MAX, TIME_BASE, TIME_BONUS_MAX, DRAG_MAX,
} from '../src/lib/dayScore.ts'

const ZIEL = 300 // 5 Stunden
const erledigt = (id, prio) => ({ id, text: id, done: true, priority: prio, createdAt: Date.now() })
const offen = (id, prio, tage = 0) =>
  ({ id, text: id, done: false, priority: prio, createdAt: Date.now() - tage * 86_400_000 })

describe('Lernanteil', () => {
  test('halbes Ziel bringt den halben Grundwert', () => {
    assert.equal(timePart(ZIEL / 2, ZIEL), TIME_BASE / 2)
  })
  test('Ziel punktgenau bringt genau den Grundwert', () => {
    assert.equal(timePart(ZIEL, ZIEL), TIME_BASE)
  })
  test('anderthalbfach schoepft den Bonus voll aus', () => {
    assert.equal(timePart(1.5 * ZIEL, ZIEL), TIME_BASE + TIME_BONUS_MAX)
  })
  test('darueber bringt nichts mehr — der Tag ist nicht mit Stunden erkaufbar', () => {
    assert.equal(timePart(3 * ZIEL, ZIEL), TIME_BASE + TIME_BONUS_MAX)
  })
  test('eine Ueberminute ist genau eine halbe Pflichtminute wert', () => {
    const proPflicht = timePart(ZIEL, ZIEL) / ZIEL
    const proUeber = (timePart(1.5 * ZIEL, ZIEL) - timePart(ZIEL, ZIEL)) / (0.5 * ZIEL)
    assert.equal(Math.round((proUeber / proPflicht) * 100) / 100, 0.5)
  })
  test('ohne Ziel zaehlt nur, ob ueberhaupt gelernt wurde', () => {
    assert.equal(timePart(0, 0), 0)
    assert.equal(timePart(60, 0), TIME_BASE)
  })
})

describe('Das Versprechen: 100 Punkte erst bei anderthalbfach', () => {
  const alleAufgaben = [erledigt('a', 'dringend'), erledigt('b', 'normal')]
  test('Ziel getroffen und alles abgehakt reicht NICHT fuer 100', () => {
    const s = computeDayScore(alleAufgaben, ZIEL, ZIEL)
    assert.equal(s.score, TASKS_MAX + TIME_BASE) // 87
    assert.ok(s.score < 100, 'sonst waere die Regel wirkungslos')
  })
  test('anderthalbfach und alles abgehakt ergibt genau 100', () => {
    assert.equal(computeDayScore(alleAufgaben, 1.5 * ZIEL, ZIEL).score, 100)
  })
  test('der Abstand ist spuerbar, nicht kosmetisch', () => {
    const beiZiel = computeDayScore(alleAufgaben, ZIEL, ZIEL).score
    assert.ok(100 - beiZiel >= 10, `nur ${100 - beiZiel} Punkte Abstand — zu wenig, um etwas zu bedeuten`)
  })
})

describe('Aufgaben und Altlast', () => {
  test('Dringendes wiegt dreifach', () => {
    const nurDringendOffen = computeDayScore([erledigt('a', 'normal'), offen('b', 'dringend')], 0, ZIEL)
    const nurNormalOffen = computeDayScore([erledigt('a', 'dringend'), offen('b', 'normal')], 0, ZIEL)
    assert.ok(nurNormalOffen.tasks > nurDringendOffen.tasks)
  })
  test('frisch Offenes kostet nichts', () => {
    assert.equal(computeDayScore([offen('a', 'dringend', 1)], 0, ZIEL).drag, 0)
  })
  test('lange Offenes zieht, aber gedeckelt', () => {
    const viele = Array.from({ length: 20 }, (_, i) => offen('t' + i, 'dringend', 30))
    assert.equal(computeDayScore(viele, 0, ZIEL).drag, -DRAG_MAX)
  })
  test('Erledigtes zieht nie — Fertigwerden ist Erleichterung, keine Schuld', () => {
    assert.equal(computeDayScore([{ ...offen('a', 'dringend', 30), done: true }], 0, ZIEL).drag, 0)
  })
  test('der Score bleibt zwischen 0 und 100', () => {
    const viele = Array.from({ length: 50 }, (_, i) => offen('t' + i, 'dringend', 60))
    const s = computeDayScore(viele, 0, ZIEL)
    assert.ok(s.score >= 0 && s.score <= 100)
  })
})
