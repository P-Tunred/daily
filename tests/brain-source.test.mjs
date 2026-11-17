#!/usr/bin/env node --test
// Was vom Second Brain in die Persona des Offline-Chats geht.
//
// WARUM DIESER TEST EXISTIERT
// `wiki/konzepte/` heisst „Begriffe und Methoden" und wächst mit Kursstoff.
// Bis 2026-10-07 las brainSource den ganzen Ordner und stellte Hypothesentests
// und ML-Grundbegriffe unter die Überschrift „Wie Paul arbeitet und
// angesprochen werden will" — 36k Tokens pro Nachricht, gut die Hälfte davon
// falsch beschriftet. Niemand hätte es bemerkt: der Chat antwortete ja.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let vault
let brain

before(() => {
  vault = mkdtempSync(join(tmpdir(), 'brain-'))
  mkdirSync(join(vault, 'wiki/personen'), { recursive: true })
  mkdirSync(join(vault, 'wiki/konzepte'), { recursive: true })
  writeFileSync(join(vault, 'wiki/personen/paul.md'), '# Paul\n\nStudiert in München.\n')
  writeFileSync(join(vault, 'wiki/konzepte/lern-und-arbeitsstil.md'), '# Lernstil\n\nLernt am besten mit Beispielen.\n')
  writeFileSync(join(vault, 'wiki/konzepte/hypothesentests-und-power.md'), '# Hypothesentests\n\nFehler 1. Art ist alpha.\n')
  process.env.SECOND_BRAIN_PATH = vault
  brain = require('../electron/brainSource.cjs')
})

after(() => {
  delete process.env.SECOND_BRAIN_PATH
  rmSync(vault, { recursive: true, force: true })
})

describe('Persona aus dem Second Brain', () => {
  test('alle Personen-Seiten kommen mit', () => {
    assert.match(brain.readBrain().text, /Studiert in München/)
  })
  test('eine Persona-Seite aus konzepte/ kommt mit', () => {
    assert.match(brain.readBrain().text, /Lernt am besten mit Beispielen/)
  })
  test('Kursstoff aus konzepte/ bleibt draussen', () => {
    // Er ist nicht verloren — der Offline-Chat findet ihn über die Suche.
    assert.doesNotMatch(brain.readBrain().text, /Fehler 1\. Art/)
    assert.ok(!brain.readBrain().pages.some((p) => p.includes('hypothesentests')))
  })
  test('die Liste nennt nur Seiten aus konzepte/, keine Pfade', () => {
    for (const f of brain.PERSONA_KONZEPTE) assert.match(f, /^[a-z0-9-]+\.md$/)
  })
})
