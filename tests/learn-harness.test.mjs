// LearnHarness → Daily: der grobe Lernstand, den LearnHarness ins Brain schreibt.
//
// WARUM ALS EIGENER TEST
// Die Datei kommt aus einer anderen App über Drive und die VM-Spiegelung.
// Ändert LearnHarness ihr Format, soll Daily die Zeile weglassen statt Unsinn
// zu zeigen. Und ein Thema darf nur dann zum Fach im Timer passen, wenn es
// wirklich dazugehört — „OR“ steckt sonst in jedem englischen Satz.
// Getestet wird gegen einen kleinen Tresor im Temp-Ordner, nie gegen das echte Brain.

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const NOW = Date.parse('2026-10-31T12:00:00Z')

let vault
let learnHarness

function stats(overrides = {}) {
  return {
    version: 2,
    generatedAt: '2026-10-31T10:00:00.000Z',
    idleGapMinutes: 10,
    recentDays: 14,
    totals: { sessions: 3, learningMinutes: 300, learningMinutesRecent: 130, questions: 20, graded: 10, correct: 7, propositions: 40, chains: 12 },
    days: [],
    topics: [
      { title: 'Bias-Variance-Tradeoff', context: 'FODS / Woche 5', lastActive: '2026-10-30', learningMinutesRecent: 70, learningMinutesTotal: 70, sessions: 2, kinds: ['practice', 'teach'], openQuestions: 3 },
      { title: 'Knowledge spirals', context: 'KM', lastActive: '2026-10-29', learningMinutesRecent: 60, learningMinutesTotal: 60, sessions: 1, kinds: ['teach'], openQuestions: 0 },
      { title: 'Alte Klausur Statistik', context: null, lastActive: '2026-09-01', learningMinutesRecent: 0, learningMinutesTotal: 170, sessions: 1, kinds: ['teach'], openQuestions: 1 },
    ],
    sessions: [],
    ...overrides,
  }
}

function schreibe(doc) {
  const file = path.join(vault, 'wiki', 'learnharness', 'learnharness-stats.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc))
  // Neue mtime erzwingen, sonst greift der Cache bei schnellen Schreibfolgen.
  const t = new Date(Date.now() + Math.random() * 1e6)
  fs.utimesSync(file, t, t)
}

before(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-learnharness-'))
  fs.mkdirSync(path.join(vault, 'wiki'), { recursive: true })
  process.env.SECOND_BRAIN_PATH = vault
  learnHarness = require('../electron/learnHarness.cjs')
})

after(() => {
  fs.rmSync(vault, { recursive: true, force: true })
  delete process.env.SECOND_BRAIN_PATH
})

beforeEach(() => learnHarness._resetCache())

describe('Lernstand lesen', () => {
  test('ohne Datei: kein Stand, mit Grund', () => {
    const r = learnHarness.lernstand(NOW)
    assert.equal(r.ok, false)
    assert.match(r.grund, /noch nichts/)
  })

  test('zeigt nur Themen mit Lernzeit in den letzten 14 Tagen', () => {
    schreibe(stats())
    const r = learnHarness.lernstand(NOW)
    assert.equal(r.ok, true)
    assert.equal(r.minuten, 130)
    assert.equal(r.veraltet, false)
    assert.deepEqual(r.themen.map((t) => t.titel), ['Bias-Variance-Tradeoff', 'Knowledge spirals'])
    assert.deepEqual(r.themen[0], {
      titel: 'Bias-Variance-Tradeoff', rahmen: 'FODS / Woche 5', minuten: 70, zuletzt: '2026-10-30', offeneFragen: 3, ueben: true,
    })
  })

  test('ein alter Stand wird als veraltet markiert', () => {
    schreibe(stats({ generatedAt: '2026-10-20T10:00:00.000Z' }))
    assert.equal(learnHarness.lernstand(NOW).veraltet, true)
  })

  test('Version 3 (mit Timer-Feldern) liest sich wie Version 2', () => {
    schreibe(stats({ version: 3, timer: { byDay: { '2026-10-30': { FODS: 40 } } } }))
    const r = learnHarness.lernstand(NOW)
    assert.equal(r.ok, true)
    assert.equal(r.minuten, 130)
  })

  test('fremdes oder kaputtes Format: keine Zeile statt Unsinn', () => {
    schreibe(stats({ version: 1 }))
    assert.equal(learnHarness.lernstand(NOW).ok, false)
    schreibe(stats({ version: 4 }))
    assert.equal(learnHarness.lernstand(NOW).ok, false)
    schreibe('{ kaputt')
    assert.equal(learnHarness.lernstand(NOW).ok, false)
  })

  test('kürzt lange Titel und lässt Themen ohne Pflichtfelder weg', () => {
    schreibe(stats({ topics: [
      { title: 'x'.repeat(500), context: '  ', lastActive: '2026-10-30', learningMinutesRecent: 5 },
      { title: 'Ohne Datum', lastActive: 'gestern', learningMinutesRecent: 5 },
    ] }))
    const r = learnHarness.lernstand(NOW)
    assert.equal(r.themen.length, 1)
    assert.equal(r.themen[0].titel.length, 120)
    assert.equal(r.themen[0].rahmen, null)
  })
})

describe('Klausuren aus LearnHarness', () => {
  const exam = (o = {}) => ({ exam: 'FODS', date: '2026-11-12', total: 4, started: 1, learningMinutes: 90, openQuestions: 2, focuses: [], ...o })

  test('zeigt kommende Klausuren mit Tagen bis dahin und Fortschritt', () => {
    schreibe(stats({ exams: [exam()] }))
    const [k] = learnHarness.lernstand(NOW).klausuren
    assert.deepEqual(k, {
      name: 'FODS', datum: '2026-11-12', tage: 12, schwerpunkte: 4, angefangen: 1, minuten: 90, offeneFragen: 2,
      stundenProWoche: null, wiederholungAb: null, minutenProTag: {}, fokusse: [],
    })
  })

  test('gibt die Lernminuten je Tag der letzten 14 Tage geprüft weiter', () => {
    schreibe(stats({ exams: [exam({ minutesByDay: { '2026-10-31': 45, '2026-10-20': 30, '2026-10-01': 90, '2026-11-02': 10, 'gestern': 5, '2026-10-30': -3 } })] }))
    const [k] = learnHarness.lernstand(NOW).klausuren
    assert.deepEqual(k.minutenProTag, { '2026-10-31': 45, '2026-10-20': 30 })
  })

  test('gibt die Planer-Felder je Schwerpunkt geprüft weiter', () => {
    schreibe(stats({ exams: [exam({ hoursPerWeek: 14, reviewFrom: '2026-11-26', focuses: [
      { title: 'Trees', weight: 'hoch', effortHours: 7, progress: 0.5, understanding: 0.8, done: 0.4, openQuestions: 3, learningMinutes: 60, started: true },
      { title: 'Odd', weight: 'urgent', effortHours: -1, progress: 7, understanding: null, done: 'x' },
    ] })] }))
    const [k] = learnHarness.lernstand(NOW).klausuren
    assert.equal(k.stundenProWoche, 14)
    assert.equal(k.wiederholungAb, '2026-11-26')
    assert.deepEqual(k.fokusse[0], { titel: 'Trees', gewicht: 'hoch', aufwandStunden: 7, fortschritt: 0.5, verstaendnis: 0.8, erledigt: 0.4, offeneFragen: 3, minuten: 60, angefangen: true })
    assert.deepEqual(k.fokusse[1], { titel: 'Odd', gewicht: null, aufwandStunden: null, fortschritt: 1, verstaendnis: null, erledigt: 0, offeneFragen: 0, minuten: 0, angefangen: false })
  })

  test('vergangene Klausuren fallen weg, solche ohne Datum bleiben', () => {
    schreibe(stats({ exams: [exam({ date: '2026-10-01' }), exam({ exam: 'KM', date: null })] }))
    assert.deepEqual(learnHarness.lernstand(NOW).klausuren.map((k) => [k.name, k.tage]), [['KM', null]])
  })

  test('ohne exams-Feld: leere Liste, Themen unverändert', () => {
    schreibe(stats())
    const r = learnHarness.lernstand(NOW)
    assert.deepEqual(r.klausuren, [])
    assert.equal(r.themen.length, 2)
  })
})

describe('Thema ↔ Fach im Timer', () => {
  const fods = { titel: 'Bias-Variance-Tradeoff', rahmen: 'FODS / Woche 5' }
  const km = { titel: 'Knowledge spirals', rahmen: 'Knowledge Management' }

  test('passt über Ordner und die Fach-Aliasse der Brain-Seiten', () => {
    assert.equal(learnHarness.passtZuFach(fods, 'FODS'), true)
    assert.equal(learnHarness.passtZuFach(km, 'KM'), true, 'Alias „knowledge management“')
    assert.equal(learnHarness.passtZuFach(fods, 'KM'), false)
  })

  test('kurze Kürzel nur als ganzes Wort', () => {
    assert.equal(learnHarness.passtZuFach({ titel: 'Normalformen', rahmen: 'Datenbanken' }, 'OR'), false)
    assert.equal(learnHarness.passtZuFach({ titel: 'Simplex', rahmen: 'OR' }, 'OR'), true)
  })
})
