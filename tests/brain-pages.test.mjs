// Das Second Brain jenseits der Persona: Fachseiten, Suche, offene Fragen.
//
// WARUM ALS EIGENER TEST
// Alle drei Wege scheitern leise. Findet die Fachzuordnung die falsche Seite,
// lernt Paul mit den Stichpunkten eines anderen Fachs. Lässt die Suche den
// Quellenabschnitt durch, landen Dateipfade im Prompt. Und kommt eine
// verworfene Frage wieder, klickt er nach einer Woche jede Frage weg.
// Getestet wird gegen einen kleinen Tresor im Temp-Ordner, nie gegen das echte Brain.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

let vault
let brainPages
let questionStore

function page(rel, text) {
  const p = path.join(vault, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}

before(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-brain-'))
  process.env.SECOND_BRAIN_PATH = vault
  // questionStore zieht stateStore nach — der darf nie Pauls echten Datenordner anfassen.
  process.env.DAILY_DATA_DIR = path.join(vault, '_daily-data')

  page('wiki/start.md', '# Cockpit\n\n→ [Statistik](themen/statistik-nachklausur.md)\n')
  page('wiki/log.md', '# Log\n\n## 2026-09-20 — Alt\n\n## 2026-09-23 — Neuester Eintrag\n')
  page('wiki/themen/statistik-nachklausur.md', [
    '# Statistik-Nachklausur',
    '',
    'Die Wiederholung von Data Science am 02.10.',
    '',
    '## Lernplan',
    '',
    '- Konfidenzintervalle wiederholen',
    '- Hypothesentests: Fehler 1. und 2. Art',
    '',
    '## Offene Fragen',
    '',
    '- ✅ Welcher Raum? Geklärt.',
    '- Bis wann muss die Anmeldung erfolgen? Frist unklar.',
    '- Welche Hilfsmittel sind erlaubt?',
    '  → **Stand 2026-09-23:** teilweise geklärt.',
    '',
    '## Quellen',
    '',
    '- /Users/paul/geheim/pfad.pdf',
  ].join('\n'))
  // So legt Hermes eine Lernzeit-Seite an: passender Name, aber keine Lernpunkte.
  page('wiki/themen/statistik-idsst.md', '# Statistik / IDSST\n\nDiese Fachseite bündelt die Lernzeitnachweise.\n\n## Einordnung\n\nNur Stunden.\n')
  page('wiki/themen/km-forum-discussion-3.md', '# KM Forum 3\n\nKnowledge Management Diskussion.\n\n## Offene Fragen\n\n- Genaue Abgabeuhrzeit?\n')
  page('wiki/themen/wohnen.md', '# Wohnen\n\nMiete, Kaution and more or less alles zur Wohnung. Matrikelnummer 03798890.\n')
  page('wiki/konzepte/arbeitsrhythmus.md', '# Arbeitsrhythmus\n\nWie Paul arbeitet.\n\n## Offene Fragen\n\n- Warum ist Dienstag der schwächste Tag?\n')

  brainPages = require('../electron/brainPages.cjs')
  questionStore = require('../electron/questionStore.cjs')
})

after(() => {
  fs.rmSync(vault, { recursive: true, force: true })
  delete process.env.SECOND_BRAIN_PATH
  delete process.env.DAILY_DATA_DIR
})

describe('Fach → Seiten', () => {
  test('„Statistik“ findet die Nachklausur-Seite samt Lernplan', () => {
    const r = brainPages.pagesForSubject('Statistik')
    assert.equal(r.seiten[0].datei, 'wiki/themen/statistik-nachklausur.md')
    assert.deepEqual(r.seiten[0].punkte, ['Konfidenzintervalle wiederholen', 'Hypothesentests: Fehler 1. und 2. Art'])
  })
  test('eine Seite ohne Lernpunkte steht hinter der mit Lernplan, auch bei besserem Namen', () => {
    // Sonst stünde unter dem Timer „Diese Fachseite bündelt die Lernzeitnachweise“
    // statt dessen, was vor der Klausur dran ist.
    const r = brainPages.pagesForSubject('Statistik')
    assert.equal(r.seiten[0].datei, 'wiki/themen/statistik-nachklausur.md')
    assert.ok(r.seiten.some((s) => s.datei === 'wiki/themen/statistik-idsst.md'))
  })
  test('„KM“ findet die KM-Seite über den Dateinamen', () => {
    assert.equal(brainPages.pagesForSubject('KM').seiten[0].datei, 'wiki/themen/km-forum-discussion-3.md')
  })
  test('„OR“ findet NICHT jede Seite mit dem englischen „or“', () => {
    // Die Wohnen-Seite enthält „or“ im Fliesstext — das darf nicht reichen.
    assert.equal(brainPages.pagesForSubject('OR').seiten.length, 0)
  })
  test('der Obsidian-Link zeigt auf Pauls Tresor, ohne Endung', () => {
    const url = brainPages.pagesForSubject('Statistik').seiten[0].obsidian
    assert.equal(url, 'obsidian://open?vault=Second%20Brain&file=wiki%2Fthemen%2Fstatistik-nachklausur')
  })
})

describe('Suche', () => {
  test('findet die passende Seite', () => {
    const r = brainPages.search('Wann ist die Statistik Nachklausur und was muss ich lernen?')
    assert.equal(r.treffer[0].datei, 'wiki/themen/statistik-nachklausur.md')
  })
  test('Quellenabschnitte und Kennungen kommen nie heraus', () => {
    const alles = JSON.stringify([brainPages.search('Statistik Quellen geheim pfad'), brainPages.search('Wohnen Matrikelnummer')])
    assert.ok(!alles.includes('geheim/pfad'), 'Quellenpfad im Auszug')
    assert.ok(!alles.includes('03798890'), 'Matrikelnummer im Auszug')
  })
  test('nur Füllwörter ergeben keine Treffer statt aller Seiten', () => {
    assert.deepEqual(brainPages.search('und oder aber').treffer, [])
  })
})

describe('Offene Fragen', () => {
  test('erledigte Fragen fallen heraus, Teilantworten nicht', () => {
    const r = brainPages.openQuestions({ limit: 50 })
    const texte = r.fragen.map((f) => f.frage)
    assert.ok(!texte.some((t) => t.includes('Welcher Raum')))
    assert.ok(texte.some((t) => t.includes('Hilfsmittel')))
  })
  test('Frist auf einer Cockpit-Seite steht ganz vorn', () => {
    const r = brainPages.openQuestions({ limit: 50 })
    assert.match(r.fragen[0].frage, /Anmeldung/)
    assert.ok(r.fragen[0].gruende.includes('Seite hängt am Cockpit'))
  })
  test('Konzept-Neugier steht hinter der Frist', () => {
    const r = brainPages.openQuestions({ limit: 50 })
    const idx = (s) => r.fragen.findIndex((f) => f.frage.includes(s))
    assert.ok(idx('Dienstag') > idx('Anmeldung'))
  })
  test('die id ist stabil über Aufrufe hinweg', () => {
    const a = brainPages.openQuestions({ limit: 50 }).fragen.map((f) => f.id)
    brainPages._resetCache()
    const b = brainPages.openQuestions({ limit: 50 }).fragen.map((f) => f.id)
    assert.deepEqual(a, b)
  })
  test('Verworfenes kommt nicht wieder — mit der Sperrregel des Fragenspeichers', () => {
    const erste = brainPages.openQuestions({ limit: 50 }).fragen[0]
    const verlauf = { [erste.id]: { status: 'verworfen', stand: '2026-09-23' } }
    const r = brainPages.openQuestions({ limit: 50, verlauf, gesperrt: questionStore.gesperrt, heute: '2026-09-23' })
    assert.ok(!r.fragen.some((f) => f.id === erste.id))
  })
})

describe('Frische', () => {
  test('meldet den letzten Log-Eintrag', () => {
    const f = brainPages.freshness()
    assert.equal(f.ok, true)
    assert.deepEqual(f.lastLog, { date: '2026-09-23', title: 'Neuester Eintrag' })
  })
})

describe('Neu im Brain', () => {
  test('nur heute und gestern, neueste zuerst, Links als Text, höchstens drei Punkte', () => {
    page('wiki/log.md', [
      '# Log', '',
      '## 2026-09-20 — Alt', '- zu alt', '',
      '## 2026-09-22 — Mails eingearbeitet', '- [[personen/daisy|Daisy]] hat geantwortet', '- [Fristen](themen/pruefungen-und-fristen.md) ergänzt',
      '- drei', '- vier (fällt weg)', '',
      '## 2026-09-23 — Neuester Eintrag', '- **Statistik**: neue Altklausur', '',
    ].join('\n'))
    const r = brainPages.neuImBrain({ heute: '2026-09-23' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.eintraege.map(e => e.datum), ['2026-09-23', '2026-09-22'])
    assert.deepEqual(r.eintraege[1].punkte, ['Daisy hat geantwortet', 'Fristen ergänzt', 'drei'])
    assert.equal(r.eintraege[0].punkte[0], 'Statistik: neue Altklausur')
    assert.match(r.log, /^obsidian:\/\//)
  })
  test('nichts Neues → leere Liste, kein Fehler', () => {
    assert.deepEqual(brainPages.neuImBrain({ heute: '2027-01-01' }).eintraege, [])
  })
})
