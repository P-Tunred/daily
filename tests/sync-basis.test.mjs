#!/usr/bin/env node --test
// Die Versionsmarke des Abgleichs nach einem Bewusst-Schreibvorgang.
//
// WARUM DIESER TEST EXISTIERT
// Am 2026-10-13 gefunden: Routine abgehakt, dann eine Aufgabe abgehakt — die
// Aufgabe kam nach ein paar Sekunden zurück. /api/bewusst setzt die
// Server-Marke weiter, der Browser kannte sie nicht, sein nächster Upload bekam
// 409, und sync.ts übernahm den Serverstand ersetzend. Kein Fehler, keine
// Meldung — nur ein Haken, der wieder weg war.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { folgeSpruengen, mitSprung } from '../src/lib/syncBasis.ts'

describe('Eigene Sprünge der Server-Marke', () => {
  test('kennt der Browser die Vorher-Marke, zieht er nach', () => {
    const s = mitSprung({}, 'U0', 'U1')
    assert.deepEqual(folgeSpruengen('U0', s), { stand: 'U1', spruenge: {} })
  })
  test('zwei Haken hintereinander: die Kette wird ganz eingelöst', () => {
    const s = mitSprung(mitSprung({}, 'U0', 'U1'), 'U1', 'U2')
    assert.equal(folgeSpruengen('U0', s).stand, 'U2')
  })
  test('hat dazwischen jemand anderes geschrieben, bleibt die Marke stehen', () => {
    // Der Browser kennt U0, der Bewusst-Sprung ging von Uh (Hermes) aus. Nach-
    // ziehen hiesse, Hermes' Stand mit dem Browserstand zu überschreiben.
    const s = mitSprung({}, 'Uh', 'U1')
    const r = folgeSpruengen('U0', s)
    assert.equal(r.stand, 'U0')
    assert.deepEqual(r.spruenge, { Uh: 'U1' }, 'gemerkt bleibt er — falls U0 → Uh noch bekannt wird')
  })
  test('ein Sprung, der vor der eigenen Upload-Antwort ankommt, wird später eingelöst', () => {
    const s = mitSprung({}, 'U2', 'U3')           // Bewusst-Antwort zuerst
    assert.equal(folgeSpruengen('U0', s).stand, 'U0')
    assert.equal(folgeSpruengen('U2', s).stand, 'U3') // dann die Upload-Antwort: U2
  })
  test('Unsinn wird ignoriert, nicht geraten', () => {
    for (const [v, n] of [[undefined, 'U1'], ['U0', null], ['', 'U1'], ['U0', 'U0'], [1, 2]]) {
      assert.deepEqual(mitSprung({}, v, n), {})
    }
  })
  test('ein Kreis hängt nicht', () => {
    const s = { A: 'B', B: 'A' }
    assert.ok(['A', 'B'].includes(folgeSpruengen('A', s).stand))
  })
  test('es werden nicht unbegrenzt viele Sprünge gemerkt', () => {
    let s = {}
    for (let i = 0; i < 50; i++) s = mitSprung(s, `X${i}`, `Y${i}`)
    assert.ok(Object.keys(s).length <= 20)
  })
})
