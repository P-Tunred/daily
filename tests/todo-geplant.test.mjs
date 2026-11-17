#!/usr/bin/env node --test
// Hermes trägt eine Aufgabe für einen bestimmten Tag oder für diese Woche ein.
//
// WARUM DIESE TESTS EXISTIEREN
// Bis 2026-10-22 landete alles von Hermes sofort in der heutigen Liste — ein
// mitgeschicktes Datum war reine Information. „Am 12.11. Rückmeldung an
// Daisy" stand drei Wochen lang jeden Morgen zwischen den Aufgaben des Tages.
// Und ein Datum in der Vergangenheit wäre still zu „heute" geworden: Hermes
// hätte Paul gesagt, es sei geplant, und es wäre einfach da gewesen.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { endeDerWoche, spaeterAlsDieseWoche, kurzesDatum } from '../src/lib/wochenplan.ts'

const require = createRequire(import.meta.url)
// VOR dem ersten require: dayStart und hermesApi laden den Zustandsspeicher,
// und der legt beim Laden seinen Datenordner an. Ohne diese Zeile wäre das auf
// dem Mac Pauls echter Ordner, auf der VM der von root.
process.env.DAILY_DATA_DIR = mkdtempSync(join(tmpdir(), 'todo-geplant-lokal-'))
const { fuerHeuteGeplant } = require('../electron/dayStart.cjs')
const { zielFuerTodo } = require('../electron/hermesApi.cjs')

const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const plus = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const wochentag = (iso) => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d }

describe('POST /api/hermes/todos — wohin eine Aufgabe kommt', () => {
  const PORT = 4897
  const base = `http://127.0.0.1:${PORT}`
  let dir, server
  const post = (body) => fetch(base + '/api/hermes/todos', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only' }, body: JSON.stringify(body),
  })
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'todo-geplant-'))
    server = spawn(process.execPath, ['-e', `require('./electron/server.cjs').startServer(${PORT})`],
      { env: { ...process.env, DAILY_DATA_DIR: dir, AUTH_PASS: '', HERMES_TOKEN: 'test-only' }, stdio: 'ignore' })
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }
  })
  after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); rmSync(dir, { recursive: true, force: true }) })

  test('ohne Datum und ohne scope: heute, wie bisher', async () => {
    const r = await (await post({ text: 'heute' })).json()
    assert.equal(r.wo, 'heute')
    assert.equal(r.created.scope, 'day')
    assert.equal(r.created.date, heute)
  })
  test('Datum heute: heute', async () => {
    assert.equal((await (await post({ text: 'auch heute', date: heute })).json()).wo, 'heute')
  })
  test('Datum in der Zukunft: wartet in der Wochenliste, mit dem Tag', async () => {
    const tag = plus(heute, 20)
    const r = await (await post({ text: 'in drei Wochen', date: tag })).json()
    assert.equal(r.wo, 'geplant')
    assert.equal(r.created.scope, 'week')
    assert.equal(r.created.geplantAm, tag)
    assert.equal(r.created.plannedDay, wochentag(tag))
    assert.equal(r.created.date, undefined, 'date heisst „wurde in den Tag gelegt" — das ist noch nicht passiert')
  })
  test('scope week: in „Diese Woche", mit oder ohne Wochentag', async () => {
    const ohne = await (await post({ text: 'irgendwann diese Woche', scope: 'week' })).json()
    assert.equal(ohne.wo, 'woche')
    assert.equal(ohne.created.plannedDay, undefined)
    const mit = await (await post({ text: 'Donnerstag', scope: 'week', plannedDay: 4 })).json()
    assert.equal(mit.created.plannedDay, 4)
  })
  test('Unsinn wird laut abgelehnt, nicht still zu heute', async () => {
    for (const body of [
      { text: 'gestern', date: plus(heute, -1) },
      { text: 'kaputt', date: '2026-02-31' },
      { text: 'kein Datum', date: 'morgen' },
      { text: 'Tippfehler im Jahr', date: plus(heute, 400) },
      { text: 'Wochentag 9', scope: 'week', plannedDay: 9 },
    ]) {
      const r = await post(body)
      assert.equal(r.status, 400, `${body.text}: Status ${r.status}`)
    }
  })
  test('ein Ja auf einen alten Vorschlag mit vergangenem Datum landet heute', () => {
    // Montag vorgeschlagen „Donnerstag: …", Freitag Ja gesagt — kein Fehler,
    // sondern heute. Hermes' direkter Eintrag mit vergangenem Datum bleibt 400.
    const alt = { text: 'alt', date: plus(heute, -3) }
    assert.throws(() => zielFuerTodo(alt), /liegt vor heute/)
    assert.deepEqual(zielFuerTodo(alt, { vergangenIstHeute: true }), { wo: 'heute', felder: { scope: 'day', date: heute } })
    // In der Zukunft bleibt ein Vorschlag geplant, auch mit der Option.
    assert.equal(zielFuerTodo({ text: 'bald', date: plus(heute, 2) }, { vergangenIstHeute: true }).wo, 'geplant')
  })
  test('geplant steht wirklich gespeichert — nicht nur in der Antwort', async () => {
    const tag = plus(heute, 5)
    await post({ text: 'zurückgelesen', date: tag })
    const { todos } = await (await fetch(base + '/api/hermes/todos', { headers: { Authorization: 'Bearer test-only' } })).json()
    const t = todos.find((x) => x.text === 'zurückgelesen')
    assert.equal(t.geplantAm, tag)
    assert.equal(t.scope, 'week')
  })
})

describe('Der Tagesbeginn schiebt geplante Aufgaben in den Tag', () => {
  const geplant = (geplantAm, plannedDay) => ({ id: 'x', text: 'x', done: false, scope: 'week', geplantAm, plannedDay })
  test('an genau dem Tag', () => {
    assert.equal(fuerHeuteGeplant(geplant('2026-11-12', 4), 4, '2026-11-12'), true)
  })
  test('nicht vorher — auch nicht am passenden Wochentag einer früheren Woche', () => {
    // 2026-10-22 ist ein Donnerstag; geplant ist der Donnerstag drei Wochen später.
    assert.equal(fuerHeuteGeplant(geplant('2026-11-12', 4), 4, '2026-10-22'), false)
  })
  test('lief der Tagesbeginn am Tag nicht, kommt sie am nächsten — statt nie', () => {
    assert.equal(fuerHeuteGeplant(geplant('2026-11-12', 4), 5, '2026-11-13'), true)
  })
  test('ohne Datum wie bisher am Wochentag', () => {
    assert.equal(fuerHeuteGeplant({ id: 'y', text: 'y', done: false, scope: 'week', plannedDay: 3 }, 3, '2026-10-21'), true)
    assert.equal(fuerHeuteGeplant({ id: 'y', text: 'y', done: false, scope: 'week', plannedDay: 3 }, 4, '2026-10-22'), false)
  })
  test('Erledigtes und Tagesaufgaben bleiben, wo sie sind', () => {
    assert.equal(fuerHeuteGeplant({ ...geplant('2026-10-22', 4), done: true }, 4, '2026-10-22'), false)
    assert.equal(fuerHeuteGeplant({ ...geplant('2026-10-22', 4), scope: 'day' }, 4, '2026-10-22'), false)
  })
})

describe('Was in der Wochenliste „später" ist', () => {
  test('die Woche endet am Sonntag', () => {
    assert.equal(endeDerWoche('2026-10-22'), '2026-10-25') // Do → So
    assert.equal(endeDerWoche('2026-10-25'), '2026-10-25') // So → So
    assert.equal(endeDerWoche('2026-10-26'), '2026-11-01') // Mo → So
  })
  test('diese Woche ist nicht später, nächste Woche schon', () => {
    assert.equal(spaeterAlsDieseWoche('2026-10-25', '2026-10-22'), false)
    assert.equal(spaeterAlsDieseWoche('2026-10-26', '2026-10-22'), true)
    assert.equal(spaeterAlsDieseWoche(undefined, '2026-10-22'), false)
  })
  test('das Datum ist kurz und ohne Punkt nach dem Wochentag', () => {
    assert.equal(kurzesDatum('2026-11-11'), 'Mi 11.11.')
    assert.equal(kurzesDatum('2026-11-15'), 'So 15.11.')
  })
})
