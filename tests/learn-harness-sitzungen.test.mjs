// LearnHarness → Daily: gespeicherte Timer-Sitzungen werden Dailys Lernzeit.
//
// WARUM ALS EIGENER TEST
// Hier schreibt Daily in seinen eigenen Zustand — in die Lernsitzungen, an
// denen Score und Verlauf hängen. Jede Sitzung darf genau einmal ankommen,
// beim richtigen Fach, und eine in Daily gelöschte darf nicht wiederkommen.
// Getestet gegen einen Tresor und einen Datenordner im Temp-Ordner.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const NOW = Date.parse('2026-10-31T12:00:00Z')

let vault
let dataDir
let sitzungen
let stateStore

const SUBJECTS = [
  { id: 's-fods', name: 'FODS', color: '#000' },
  { id: 's-km', name: 'KM', color: '#000' },
  { id: 's-stat', name: 'Statistik', color: '#000', archiviert: true },
]

function schreibeStats(sessions) {
  const file = path.join(vault, 'wiki', 'learnharness', 'learnharness-stats.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({
    version: 3,
    generatedAt: '2026-10-31T11:00:00.000Z',
    recentDays: 14,
    totals: { learningMinutesRecent: 0 },
    topics: [],
    timer: { byDay: {}, sessions },
  }))
  const t = new Date(Date.now() + Math.random() * 1e6)
  fs.utimesSync(file, t, t)
}

const tracker = () => JSON.parse(stateStore.read().localStorage['morning.tracker.sessions'] ?? '[]')

before(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-lh-sitzungen-'))
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-lh-data-'))
  process.env.SECOND_BRAIN_PATH = vault
  process.env.DAILY_DATA_DIR = dataDir
  stateStore = require('../electron/stateStore.cjs')
  sitzungen = require('../electron/learnHarnessSitzungen.cjs')
  const state = stateStore.read()
  state.localStorage['morning.tracker.subjects'] = JSON.stringify(SUBJECTS)
  state.localStorage['morning.tracker.sessions'] = JSON.stringify([{ id: 'r-alt', subjectId: 's-km', date: '2026-10-30', durationMin: 25 }])
  stateStore.write(state)
})

after(() => {
  fs.rmSync(vault, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
  delete process.env.SECOND_BRAIN_PATH
  delete process.env.DAILY_DATA_DIR
})

describe('Fach zuordnen', () => {
  test('der Fachname als ganzes Wort im LearnHarness-Fach', () => {
    assert.equal(sitzungen.fachZuordnen('FODS Theorie', SUBJECTS)?.id, 's-fods')
    assert.equal(sitzungen.fachZuordnen('km', SUBJECTS)?.id, 's-km')
  })

  test('kein Teilwort, kein archiviertes Fach', () => {
    assert.equal(sitzungen.fachZuordnen('Kmeans Übung', SUBJECTS), null)
    assert.equal(sitzungen.fachZuordnen('Statistik', SUBJECTS), null)
  })
})

describe('Sitzungen übernehmen', () => {
  test('bucht jede gespeicherte Sitzung als Tracker-Sitzung beim richtigen Fach', () => {
    schreibeStats([
      { id: 'mh1-0', subject: 'FODS Theorie', day: '2026-10-31', minutes: 42, start: '2026-10-31T09:00:00.000Z' },
      { id: 'mh1-1', subject: 'KM', day: '2026-10-31', minutes: 15, start: '2026-10-31T09:50:00.000Z' },
      { id: 'mh1-2', subject: 'Statistik', day: '2026-10-31', minutes: 10, start: '2026-10-31T10:10:00.000Z' },
    ])
    const r = sitzungen.uebernehmen(NOW)
    assert.equal(r.neu, 2)
    assert.deepEqual(r.ohneFach, ['Statistik'])
    const neu = tracker().filter((s) => s.note === 'LearnHarness')
    assert.deepEqual(neu.map((s) => [s.id, s.subjectId, s.date, s.durationMin]), [
      ['lh-mh1-0', 's-fods', '2026-10-31', 42],
      ['lh-mh1-1', 's-km', '2026-10-31', 15],
    ])
    assert.equal(neu[0].startedAtMs, Date.parse('2026-10-31T09:00:00.000Z'))
    assert.ok(tracker().some((s) => s.id === 'r-alt'), 'alte Sitzungen bleiben')
  })

  test('ein zweiter Lauf bucht nichts doppelt', () => {
    assert.equal(sitzungen.uebernehmen(NOW).neu, 0)
    assert.equal(tracker().length, 3)
  })

  test('eine in Daily gelöschte Sitzung kommt nicht wieder', () => {
    const state = stateStore.read()
    state.localStorage['morning.tracker.sessions'] = JSON.stringify(tracker().filter((s) => s.id !== 'lh-mh1-1'))
    stateStore.write(state)
    assert.equal(sitzungen.uebernehmen(NOW).neu, 0)
    assert.ok(!tracker().some((s) => s.id === 'lh-mh1-1'))
  })

  test('kaputte Einträge fallen weg, der Rest kommt an', () => {
    schreibeStats([
      { id: 'mh2-0', subject: 'FODS', day: 'gestern', minutes: 30 },
      { id: '../böse', subject: 'FODS', day: '2026-10-31', minutes: 30 },
      { id: 'mh2-1', subject: 'FODS', day: '2026-10-31', minutes: 0 },
      { id: 'mh2-2', subject: 'FODS', day: '2026-10-31', minutes: 20 },
    ])
    assert.equal(sitzungen.uebernehmen(NOW).neu, 1)
    assert.ok(tracker().some((s) => s.id === 'lh-mh2-2' && s.durationMin === 20 && !('startedAtMs' in s)))
  })
})
