#!/usr/bin/env node --test
// Fristen aus dem Brain, der Tagesbericht ins Brain, und was beides lernt.
//
// WARUM DIESE TESTS EXISTIEREN
// Beide Wege laufen jeden Tag unbeaufsichtigt. Ein Fehler zeigt sich nicht als
// Absturz, sondern als Frist, die doppelt dasteht, als gelöschte Frist, die
// jeden Morgen wiederkommt, oder als Entscheidung, die als „im Brain"
// abgehakt ist, obwohl Hermes sie nie geschrieben hat. Genau das prüfen sie.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// VOR dem ersten require — sonst schriebe der Test in Pauls echten Zustand.
process.env.DAILY_DATA_DIR = mkdtempSync(join(tmpdir(), 'brain-fristen-'))
const stateStore = require('../electron/stateStore.cjs')
const fristenSync = require('../electron/fristenSync.cjs')
const vorlauf = require('../electron/vorlaufStore.cjs')
const tagesbericht = require('../electron/tagesbericht.cjs')
const kanaele = require('../electron/kanaele.cjs')

const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const plus = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const QUELLE = 'wiki/themen/pruefungen-und-fristen.md'

const ls = (key, fallback = null) => { try { return JSON.parse(stateStore.read().localStorage[key]) } catch { return fallback } }
const events = () => ls('morning.important.events', [])
const todos = () => ls('morning.todos', [])
const setze = (key, wert) => { const s = stateStore.read(); s.localStorage[key] = JSON.stringify(wert); stateStore.write(s) }
const leeren = () => { rmSync(join(process.env.DAILY_DATA_DIR, 'state.json'), { force: true }) }

const frist = (id, tage, extra = {}) => ({ id: `brain:frist-${id}`, title: `Frist ${id}`, date: plus(heute, tage), kind: 'deadline', ...extra })

describe('Fristen-Abgleich', () => {
  beforeEach(leeren)

  test('zweimal derselbe Stand legt nichts doppelt an', () => {
    const liste = [frist('a', 10), frist('b', 20, { kind: 'exam' })]
    const r1 = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: liste })
    assert.deepEqual(r1.neu, ['brain:frist-a', 'brain:frist-b'])
    const r2 = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: liste })
    assert.equal(r2.neu.length, 0)
    assert.equal(r2.unveraendert, 2)
    assert.equal(events().length, 2)
    assert.equal(stateStore.read().indexedDB.importantEvents.length, 2, 'beide Speicher, sonst überschreibt der Browser')
    assert.ok(events().every((e) => e.quelleId.startsWith('brain:') && !e.id.startsWith('brain:')), 'eigene Event-id, Brain-Kennung getrennt')
  })

  test('geändertes Datum wird übernommen, die Event-id bleibt', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10)] })
    const id = events()[0].id
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 12)] })
    assert.deepEqual(r.geaendert, ['brain:frist-a'])
    assert.equal(events()[0].id, id)
    assert.equal(events()[0].date, plus(heute, 12))
  })

  test('Stichtag heute: die Aufgabe entsteht sofort und nur einmal', () => {
    const f = frist('sofort', 5, { alsTodoAm: heute })
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [f] })
    assert.deepEqual(r.aufgabeSofort, ['brain:frist-sofort'])
    assert.equal(todos().filter((t) => t.ausTermin).length, 1)
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [f] })
    assert.equal(todos().filter((t) => t.ausTermin).length, 1)
    assert.equal(events()[0].todoErzeugt, heute)
  })

  test('weggeklickte Frist bleibt weg', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10)] })
    setze('morning.important.events', events().map((e) => ({ ...e, dismissed: true })))
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10)] })
    assert.equal(r.weggeklickt, 1)
    assert.equal(events()[0].dismissed, true)
  })

  test('in Daily gelöschte Frist kommt nicht wieder', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10)] })
    setze('morning.important.events', [])
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10)] })
    assert.equal(r.geloescht, 1)
    assert.equal(r.neu.length, 0)
    assert.equal(events().length, 0)
  })

  test('zurückgezogen nur bei vollständiger Liste — und nie, was schon Aufgabe ist', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10), frist('b', 10, { alsTodoAm: heute })] })
    const teil = fristenSync.gleiche({ quelle: QUELLE, fristen: [frist('c', 10)] })
    assert.equal(teil.zurueckgezogen.length, 0)
    assert.ok(teil.hinweis)
    const voll = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('c', 10)] })
    assert.deepEqual(voll.zurueckgezogen, ['brain:frist-a'], 'b hat schon eine Aufgabe und bleibt')
    // Taucht a wieder auf, darf es zurückkommen — es war nicht Paul, der es löschte.
    const wieder = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10), frist('c', 10)] })
    assert.deepEqual(wieder.neu, ['brain:frist-a'])
  })

  test('kaputte Zeile kippt den Abgleich nicht und wird nicht als gestrichen behandelt', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10), frist('b', 10)] })
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 10), { ...frist('b', 10), date: '2026-02-31' }] })
    assert.equal(r.uebersprungen.length, 1)
    assert.equal(r.zurueckgezogen.length, 0)
    assert.equal(events().length, 2)
  })

  test('dieselbe Sache aus dem Kalender wird übernommen, nicht verdoppelt', () => {
    const tag = plus(heute, 2)
    setze('morning.important.events', [{ id: 'gcal-1', kind: 'exam', title: '⚠️ FODS Exam 1 (ML750N) — Uhrzeit bestätigen', date: tag }])
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('fods', 2, { title: 'FODS Written Exam 1 / Coding', kind: 'exam', alsTodoAm: plus(heute, 1) })] })
    assert.deepEqual(r.zusammengelegt, ['brain:frist-fods'])
    assert.equal(events().length, 1)
    assert.equal(events()[0].id, 'gcal-1')
    assert.match(events()[0].title, /ML750N/, 'Titel bleibt der aus dem Kalender')
    assert.equal(events()[0].alsTodoAm, plus(heute, 1))
    const zweimal = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('fods', 2, { title: 'FODS Written Exam 1 / Coding', kind: 'exam', alsTodoAm: plus(heute, 1) })] })
    assert.equal(zweimal.unveraendert, 1)
    // Fällt die Frist aus dem Brain, bleibt der Kalendereintrag — nur ohne Brain-Spur.
    const weg = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('anderes', 9)] })
    assert.deepEqual(weg.zurueckgezogen, ['brain:frist-fods'])
    const kal = events().find((e) => e.id === 'gcal-1')
    assert.ok(kal && !kal.quelleId && !kal.alsTodoAm)
  })

  test('schon angelegte Doppelung wird zusammengelegt, die Aufgabe zieht mit', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('km', 3, { title: 'KM Written Re-exam (Nachklausur)', kind: 'exam', alsTodoAm: heute })] })
    const brainEv = events()[0]
    setze('morning.important.events', [...events(), { id: 'gcal-2', kind: 'exam', title: 'DSV · KM Written Re-exam', date: plus(heute, 3) }])
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('km', 3, { title: 'KM Written Re-exam (Nachklausur)', kind: 'exam', alsTodoAm: heute })] })
    assert.deepEqual(r.zusammengelegt, ['brain:frist-km'])
    assert.deepEqual(events().map((e) => e.id), ['gcal-2'])
    assert.equal(events()[0].todoErzeugt, heute)
    const todo = todos().find((t) => t.ausTermin)
    assert.equal(todo.ausTermin, 'gcal-2')
    assert.notEqual(todo.ausTermin, brainEv.id)
    assert.equal(r.aufgabeSofort.length, 0, 'keine zweite Aufgabe')
  })

  test('verschiedene Dinge am selben Tag bleiben getrennt', () => {
    setze('morning.important.events', [{ id: 'gcal-3', kind: 'birthday', title: 'Geburtstag Martha', date: plus(heute, 4) }])
    const r = fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('ethik', 4, { title: 'Abgabe Ethik-Essay' })] })
    assert.equal(r.zusammengelegt.length, 0)
    assert.equal(events().length, 2)
  })

  test('laut abgelehnt: fehlende Quelle, doppelte ids', () => {
    assert.throws(() => fristenSync.gleiche({ fristen: [] }), /quelle/)
    assert.throws(() => fristenSync.gleiche({ quelle: QUELLE, fristen: [frist('a', 1), frist('a', 2)] }), /Doppelte/)
  })
})

describe('Vorlaufbuch lernt aus Ergebnissen', () => {
  beforeEach(leeren)

  test('Abhaken vermerkt den Puffer bis zur Frist', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 3, { alsTodoAm: heute })] })
    const todo = todos().find((t) => t.ausTermin)
    const r = vorlauf.vermerkeErledigt(todo.id)
    assert.equal(r.pufferTage, 3)
    assert.equal(r.verpasst, false)
    assert.equal(vorlauf.vermerkeErledigt(todo.id), null, 'nur einmal pro Frist')
  })

  test('Nachtrag von gestern zählt mit gestern', () => {
    fristenSync.gleiche({ quelle: QUELLE, vollstaendig: true, fristen: [frist('a', 3, { alsTodoAm: heute })] })
    const todo = todos().find((t) => t.ausTermin)
    assert.equal(vorlauf.vermerkeErledigt(todo.id, plus(heute, -1)).pufferTage, 4)
  })

  test('morgens: offene Aufgabe nach der Frist = verpasst; abgehakte ohne Meldung wird nachgetragen', () => {
    const ev = (id, tage) => ({ id, title: id, kind: 'deadline', date: plus(heute, tage), alsTodoAm: plus(heute, tage - 2), todoErzeugt: plus(heute, tage - 2) })
    setze('morning.important.events', [ev('alt-offen', -1), ev('abgehakt', 2)])
    setze('morning.todos', [
      { id: 't1', text: 'x', done: false, ausTermin: 'alt-offen' },
      { id: 't2', text: 'y', done: true, doneAt: Date.now(), ausTermin: 'abgehakt' },
    ])
    assert.equal(vorlauf.pruefeVerpasst(), 2)
    const erg = ls('morning.vorlauf').ergebnisse
    assert.equal(erg.find((r) => r.eventId === 'alt-offen').verpasst, true)
    assert.equal(erg.find((r) => r.eventId === 'abgehakt').pufferTage, 2)
    assert.equal(vorlauf.pruefeVerpasst(), 0, 'kein zweiter Vermerk')
  })

  test('Auswertung: ab drei Fällen eine Empfehlung', () => {
    const r = (kind, puffer, verpasst = false) => ({ kind, pufferTage: puffer, verpasst })
    assert.equal(vorlauf.auswertung([r('exam', 0), r('exam', 1)]).exam.empfehlung, 'noch zu wenige Fälle')
    assert.match(vorlauf.auswertung([r('exam', 0), r('exam', null, true), r('exam', 2)]).exam.empfehlung, /zu knapp/)
    assert.match(vorlauf.auswertung([r('deadline', 5), r('deadline', 6), r('deadline', 7)]).deadline.empfehlung, /kann kürzer/)
    assert.equal(vorlauf.auswertung([r('deadline', 2), r('deadline', 2), r('deadline', 3)]).deadline.empfehlung, 'passt')
  })
})

describe('Tagesbericht', () => {
  beforeEach(leeren)

  const antwort = { id: 'brain:frage-1', frage: 'Was hilft dir beim Lernen?', antwort: 'Kurze Blöcke', beantwortetAm: heute, beantwortetUm: new Date().toISOString() }
  const entscheidung = (id, datum) => ({ id, ja: true, datum, um: new Date().toISOString(), art: 'todo', titel: `Vorschlag ${id}` })

  test('enthält Zahlen, Antwort und Entscheidungen — und nennt deren ids', () => {
    setze('morning.todos', [{ id: 'x', text: 'Mathe Blatt 3', done: true, doneAt: Date.now() }])
    setze('morning.brainQuestion', { offen: null, verlauf: {}, antwort })
    setze('morning.suggestions', { tag: heute, offen: [], entschieden: {}, protokoll: [entscheidung('vorschlag:a', heute)] })
    const b = tagesbericht.baue()
    assert.equal(b.dateiname, `${heute}_daily.md`)
    assert.match(b.markdown, /^---\nquelle: Daily/)
    assert.match(b.markdown, /Mathe Blatt 3/)
    assert.match(b.markdown, /Kurze Blöcke/)
    assert.match(b.markdown, /Vorschlag vorschlag:a/)
    assert.equal(b.enthaelt.antwortId, 'brain:frage-1')
    assert.deepEqual(b.enthaelt.entscheidungIds, ['vorschlag:a'])
  })

  test('veralteter Score-Schnappschuss wird nicht als Zahl weitergegeben', () => {
    setze('morning.scoreHistory', { [heute]: { date: heute, score: 0, tasks: 0, time: 0, drag: -3, studyMin: 0, goalMin: 300, tasksDone: 0 } })
    setze('morning.tracker.sessions', [{ id: 's1', date: heute, durationMin: 120, subjectId: 'f' }])
    const md = tagesbericht.baue().markdown
    assert.match(md, /Score: nicht verlässlich/)
    assert.doesNotMatch(md, /0\/100/)
    assert.match(md, /Lernzeit: \*\*2 h/)
  })

  test('keine Berichte über die Zukunft', () => {
    assert.throws(() => tagesbericht.baue(plus(heute, 1)), /erfunden/)
  })

  test('Quittung hakt Antwort und Entscheidungen ab — erst dann', () => {
    setze('morning.brainQuestion', { offen: null, verlauf: {}, antwort })
    setze('morning.suggestions', { tag: heute, offen: [], entschieden: {}, protokoll: [entscheidung('vorschlag:a', heute)] })
    const pfad = `raw/inbox/${heute}_daily.md`
    const r = tagesbericht.quittiere({ datum: heute, pfad, antwortId: antwort.id, entscheidungIds: ['vorschlag:a'] })
    assert.equal(r.ok, true)
    assert.equal(ls('morning.brainQuestion').antwort, undefined)
    assert.equal(ls('morning.suggestions').protokoll[0].imBrain !== undefined && ls('morning.suggestions').protokoll[0].imBrain !== false, true)
    assert.equal(tagesbericht.letzteQuittung().letzter, heute)
  })

  test('Quittung mit falschem Pfad wird abgelehnt und hakt nichts ab', () => {
    setze('morning.brainQuestion', { offen: null, verlauf: {}, antwort })
    assert.throws(() => tagesbericht.quittiere({ datum: heute, pfad: 'wiki/irgendwo.md', antwortId: antwort.id }), /raw\/inbox/)
    assert.equal(ls('morning.brainQuestion').antwort.id, antwort.id)
  })

  test('Quittung mit veralteter Antwort-id: Rest geht durch, Problem wird genannt', () => {
    setze('morning.brainQuestion', { offen: null, verlauf: {}, antwort })
    const r = tagesbericht.quittiere({ datum: heute, pfad: `raw/inbox/${heute}_daily.md`, antwortId: 'brain:andere' })
    assert.ok(r.probleme.length >= 1)
    assert.equal(ls('morning.brainQuestion').antwort.id, antwort.id, 'die echte Antwort bleibt liegen')
  })
})

describe('Kanäle', () => {
  beforeEach(leeren)

  test('nie eingerichtet ist kein Alarm', () => {
    setze('morning.suggestions', { tag: heute, offen: [], entschieden: {}, protokoll: [{ id: 'vorschlag:alt', ja: true, datum: '2026-09-01', art: 'todo', titel: 'alt' }] })
    assert.deepEqual(kanaele.stand().probleme, [])
  })

  test('alter Tagesbericht und liegengebliebene Entscheidungen melden sich', () => {
    setze('morning.tagesbericht', { letzter: plus(heute, -4), pfad: 'raw/inbox/x.md', um: new Date().toISOString() })
    setze('morning.suggestions', { tag: heute, offen: [], entschieden: {}, protokoll: [{ id: 'vorschlag:alt', ja: true, datum: plus(heute, -5), art: 'todo', titel: 'alt' }] })
    const p = kanaele.stand().probleme
    assert.equal(p.length, 2)
    assert.match(p[0], /seit 4 Tagen/)
    assert.match(p[1], /seit 5 Tagen/)
  })

  test('Fristen-Abgleich älter als zwei Tage meldet sich', () => {
    setze('morning.fristenSync', { quelle: QUELLE, um: new Date(Date.now() - 3 * 86_400_000).toISOString() })
    assert.match(kanaele.stand().probleme[0], /Fristen seit 3 Tagen/)
  })
})
