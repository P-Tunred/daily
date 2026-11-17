// Hörbriefing-Knopf im Intro: wann er erscheint, wann nachgesehen wird, was
// auf ihm steht. Der Knopf ist seit 2026-11-01 das Einzige, was vom Player
// übrig ist — zeigt er sich zu selten, ist das gesprochene Update „weg".

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  abspielbar, naechsterBlick, knopfZeit, zeit, NACHSEHEN_ERZEUGE_MS, NACHSEHEN_FEHLT_MS,
} from '../src/lib/hoerbriefingKnopf.ts'

describe('abspielbar', () => {
  test('fertige Aufnahme → Knopf mit Datum, Dauer, Stimme', () => {
    assert.deepEqual(
      abspielbar({ datum: '2026-11-01', status: 'fertig', dauerSek: 222, ersatz: true }),
      { datum: '2026-11-01', dauerSek: 222, ersatz: true },
    )
  })
  test('ohne Aufnahme, in Arbeit oder fehlgeschlagen → nichts', () => {
    assert.equal(abspielbar(null), null)
    assert.equal(abspielbar({ datum: null }), null)
    assert.equal(abspielbar({ datum: '2026-11-01', status: 'erzeuge' }), null)
    assert.equal(abspielbar({ datum: '2026-11-01', status: 'fehler' }), null)
  })
  test('kaputtes Datum → nichts (es landet in der Audio-URL)', () => {
    assert.equal(abspielbar({ datum: '2026-11-01&x=1', status: 'fertig', dauerSek: 60 }), null)
  })
  test('unbekannte Dauer → 0, Ersatzstimme nur bei true', () => {
    assert.deepEqual(abspielbar({ datum: '2026-11-01', status: 'fertig' }), { datum: '2026-11-01', dauerSek: 0, ersatz: false })
    assert.equal(abspielbar({ datum: '2026-11-01', status: 'fertig', dauerSek: -5 }).dauerSek, 0)
  })
})

describe('naechsterBlick', () => {
  test('noch kein Hörbriefing → in ein paar Minuten wieder (Fenster offen vor dem Lauf)', () => {
    assert.equal(naechsterBlick({ datum: null }), NACHSEHEN_FEHLT_MS)
    assert.equal(naechsterBlick(null), NACHSEHEN_FEHLT_MS)
  })
  test('Aufnahme entsteht → bald wieder', () => {
    assert.equal(naechsterBlick({ datum: '2026-11-01', status: 'erzeuge' }), NACHSEHEN_ERZEUGE_MS)
  })
  test('fertig oder Fehler → für heute nicht mehr', () => {
    assert.equal(naechsterBlick({ datum: '2026-11-01', status: 'fertig' }), null)
    assert.equal(naechsterBlick({ datum: '2026-11-01', status: 'fehler' }), null)
  })
})

describe('Zahl auf dem Knopf', () => {
  test('vor dem Start die Dauer', () => {
    assert.equal(knopfZeit(0, 222), '3:42')
  })
  test('beim Hören die Restzeit', () => {
    assert.equal(knopfZeit(42, 222), '−3:00')
    assert.equal(knopfZeit(221.6, 222), '−0:00')
  })
  test('Dauer unbekannt → keine Zahl statt „0:00"', () => {
    assert.equal(knopfZeit(0, 0), null)
    assert.equal(knopfZeit(10, NaN), null)
  })
  test('zeit rundet und kippt nie ins Negative', () => {
    assert.equal(zeit(59.6), '1:00')
    assert.equal(zeit(-3), '0:00')
    assert.equal(zeit(NaN), '0:00')
  })
})
