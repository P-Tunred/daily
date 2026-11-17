// Das Widget (Scriptable auf iPhone und Mac): GET /api/widget.
//
// WARUM DIESE TESTS EXISTIEREN
// Das Widget zeigt Paul seinen Score, ohne dass Daily offen ist. Dann muss die
// Zahl dieselbe sein, die Daily zeigen würde — also mit derselben Rechnung
// (scoreSnapshot.ts) und demselben Ziel. Und die Route liegt vor dem
// Passwort-Gate: Ohne den richtigen eigenen Schlüssel darf sie nichts sagen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
process.env.DAILY_DATA_DIR = mkdtempSync(join(tmpdir(), 'widget-'))
const stateStore = require('../electron/stateStore.cjs')
const widget = require('../electron/widget.cjs')
const { tagesStand } = require('../src/lib/scoreSnapshot.ts')
const { routineHakenAm } = require('../src/lib/bewusst.ts')

// Donnerstag, 5. November 2026, 14:00 in Berlin
const JETZT = Date.parse('2026-11-05T13:00:00Z')
const TAG = 86_400_000

function zustand({ ls = {}, idb = [] } = {}) {
  const localStorage = {}
  for (const [k, v] of Object.entries(ls)) localStorage[k] = JSON.stringify(v)
  return { localStorage, indexedDB: { todos: idb, importantEvents: [], aiMessages: [] } }
}

const todo = (id, text, extra = {}) => ({ id, text, done: false, createdAt: JETZT - TAG, ...extra })

describe('Widget: Score wie im Browser', () => {
  test('rechnet mit scoreSnapshot.ts und dem Ziel aus dem Verlauf', () => {
    const todos = [todo('a', 'Copenhagen buchen', { priority: 'dringend' }), todo('b', 'Jacke', { done: true })]
    const sessions = [{ id: 's1', date: '2026-11-05', durationMin: 90 }, { id: 's2', date: '2026-11-04', durationMin: 300 }]
    const state = zustand({
      ls: {
        'morning.todos': todos,
        'morning.tracker.sessions': sessions,
        'morning.scoreHistory': { '2026-11-05': { date: '2026-11-05', score: 1, goalMin: 180, studyMin: 0 }, '2026-11-04': { date: '2026-11-04', score: 71, goalMin: 180 } },
      },
    })
    const stand = widget.widgetStand(state, JETZT)
    const erwartet = tagesStand(todos, sessions, '2026-11-05', 180, JETZT, 0).parts
    assert.equal(stand.quelle, 'server')
    assert.equal(stand.score, erwartet.score)
    assert.notEqual(stand.score, 1, 'nicht der alte Schnappschuss')
    assert.equal(stand.zielMin, 180)
    assert.equal(stand.zielAusVerlauf, true)
    assert.equal(stand.lernMin, 90)
    assert.equal(stand.gestern, 71)
    assert.deepEqual(stand.teile, { lernzeit: erwartet.time, aufgaben: erwartet.tasks, routinen: 0, altlasten: erwartet.drag })
  })

  test('ohne Eintrag heute: Wochentagsziel aus dem Tracker, und die Antwort sagt es', () => {
    const goals = [60, 120, 120, 120, 150, 120, 60] // So..Sa — Donnerstag = 150
    const state = zustand({ ls: { 'morning.tracker.goalsByWeekday': goals, 'morning.tracker.sessions': [] } })
    const stand = widget.widgetStand(state, JETZT)
    assert.equal(stand.zielMin, 150)
    assert.equal(stand.zielAusVerlauf, false)
    assert.equal(stand.score, 0)
  })

  test('ein Override für heute schlägt das Wochentagsziel', () => {
    const state = zustand({ ls: { 'morning.tracker.goalsByWeekday': [1, 1, 1, 1, 150, 1, 1], 'morning.tracker.goalOverrides': { '2026-11-05': 45 } } })
    assert.equal(widget.widgetStand(state, JETZT).zielMin, 45)
  })

  test('Routinen zählen wie im Browser', () => {
    const bewusst = {
      version: 1,
      periods: { 'day:2026-11-05': { goals: [{ id: 'r1', value: 1, target: 1 }, { id: 'r2', value: 0, target: 1 }] } },
    }
    const state = zustand({ ls: { 'morning.bewusst.v1': bewusst, 'morning.scoreHistory': { '2026-11-05': { goalMin: 60 } } } })
    const stand = widget.widgetStand(state, JETZT)
    const haken = routineHakenAm(bewusst, '2026-11-05')
    assert.equal(stand.teile.routinen, 2 * haken)
  })

  test('kann Node kein TypeScript laden, gilt der Schnappschuss aus dem Verlauf', () => {
    const state = zustand({ ls: { 'morning.scoreHistory': { '2026-11-05': { score: 64, time: 40, tasks: 24, drag: 0, routineBonus: 0, studyMin: 140, goalMin: 180 } } } })
    const stand = widget.widgetStand(state, JETZT, null)
    assert.equal(stand.quelle, 'verlauf')
    assert.equal(stand.score, 64)
    assert.equal(stand.lernMin, 140)
  })

  test('ohne Rechnung und ohne Eintrag: kein erfundener Score', () => {
    const stand = widget.widgetStand(zustand(), JETZT, null)
    assert.equal(stand.score, null)
    assert.equal(stand.teile, null)
  })
})

describe('Widget: Aufgaben', () => {
  test('nur offene Tagesaufgaben, dringend zuerst, ohne Routinen und ohne Doppelte, höchstens fünf', () => {
    const ls = [
      todo('n1', 'Normal alt', { createdAt: JETZT - 5 * TAG }),
      todo('w1', 'Wichtig', { priority: 'wichtig' }),
      todo('d1', 'Dringend', { priority: 'dringend' }),
      todo('wo', 'Für die Woche', { scope: 'week' }),
      todo('bw', 'Dehnen', { origin: 'bewusst' }),
      todo('x', 'Erledigt', { done: true }),
      todo('n2', 'Normal neu'),
      todo('n3', 'Drei'),
      todo('n4', 'Vier'),
    ]
    const idb = [todo('d1', 'Dringend', { priority: 'dringend' })] // dieselbe Aufgabe in der zweiten Ablage
    const stand = widget.widgetStand(zustand({ ls: { 'morning.todos': ls }, idb }), JETZT)
    assert.equal(stand.aufgaben.offen, 6)
    assert.equal(stand.aufgaben.erledigt, 1)
    assert.deepEqual(stand.aufgaben.liste.map((a) => a.text), ['Dringend', 'Wichtig', 'Normal alt', 'Normal neu', 'Drei'])
    assert.equal(stand.aufgaben.liste[0].prio, 'dringend')
    assert.equal(stand.aufgaben.liste[2].prio, 'normal')
  })
})

describe('Widget: Zugang', () => {
  function anfrage(method, auth) {
    return { method, headers: auth ? { authorization: auth } : {} }
  }
  function antwort() {
    const r = { code: 0, headers: {}, body: '' }
    r.writeHead = (c, h) => { r.code = c; r.headers = h }
    r.end = (b) => { r.body = b }
    return r
  }

  test('ohne DAILY_WIDGET_TOKEN ist die Route aus', () => {
    delete process.env.DAILY_WIDGET_TOKEN
    const res = antwort()
    widget.handle(anfrage('GET', 'Bearer irgendwas'), res)
    assert.equal(res.code, 403)
  })

  test('falscher oder fehlender Schlüssel: 401, und nichts vom Stand', () => {
    process.env.DAILY_WIDGET_TOKEN = 'widget-test-schluessel'
    for (const auth of [null, 'Bearer falsch', 'Basic cGF1bDp4']) {
      const res = antwort()
      widget.handle(anfrage('GET', auth), res)
      assert.equal(res.code, 401)
      assert.doesNotMatch(res.body, /score/)
    }
  })

  test('richtiger Schlüssel: der Stand, nicht zwischengespeichert', () => {
    process.env.DAILY_WIDGET_TOKEN = 'widget-test-schluessel'
    stateStore.write(zustand({ ls: { 'morning.todos': [todo('a', 'Copenhagen buchen')] } }))
    const res = antwort()
    widget.handle(anfrage('GET', 'Bearer widget-test-schluessel'), res)
    assert.equal(res.code, 200)
    assert.equal(res.headers['Cache-Control'], 'no-store')
    const stand = JSON.parse(res.body)
    assert.equal(stand.aufgaben.liste[0].text, 'Copenhagen buchen')
  })

  test('nur lesen: POST wird abgewiesen', () => {
    process.env.DAILY_WIDGET_TOKEN = 'widget-test-schluessel'
    const res = antwort()
    widget.handle(anfrage('POST', 'Bearer widget-test-schluessel'), res)
    assert.equal(res.code, 405)
  })
})
