// Mit Hermes sprechen, im Browser: wann die Aufnahme von selbst endet, und
// wie die Antwortzeilen des Servers gelesen werden.
//
// WARUM DIESE TESTS EXISTIEREN
// Paul soll reden und dann einfach aufhören — kein zweiter Klick. Endet die
// Aufnahme zu früh, schneidet sie ihm das Wort ab (kurzes Luftholen ist keine
// Stille); endet sie nie, wartet er vor einem roten Punkt. Und sagt er gar
// nichts, soll sie nicht ewig lauschen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { START, schritt, SCHWELLE, STILLE_MS, NICHTS_MS, HOECHSTENS_MS } from '../src/lib/stille.ts'
import { zeilenLeser } from '../src/lib/stimmeStrom.ts'

const LAUT = SCHWELLE * 3
const LEISE = SCHWELLE / 4

/** `ms` Millisekunden mit gleichem Pegel in 50-ms-Schritten. */
function lauf(z, pegel, ms) {
  let s = z
  for (let t = 0; t < ms; t += 50) s = schritt(s, pegel, 50)
  return s
}

describe('Stille-Erkennung', () => {
  test('reden, dann aufhören → fertig nach der Stille-Zeit', () => {
    let z = lauf(START, LAUT, 2000)
    assert.equal(z.phase, 'spricht')
    z = lauf(z, LEISE, STILLE_MS - 100)
    assert.equal(z.phase, 'spricht')
    z = lauf(z, LEISE, 200)
    assert.equal(z.phase, 'fertig')
    assert.equal(z.grund, 'stille')
  })

  test('kurzes Luftholen schneidet nicht ab', () => {
    let z = lauf(START, LAUT, 1000)
    z = lauf(z, LEISE, STILLE_MS / 2)
    z = lauf(z, LAUT, 500)
    z = lauf(z, LEISE, STILLE_MS / 2)
    assert.equal(z.phase, 'spricht')
  })

  test('ein Knacken ist noch kein Reden', () => {
    let z = lauf(START, LAUT, 100)
    z = lauf(z, LEISE, STILLE_MS * 2)
    assert.equal(z.phase, 'wartet')
  })

  test('gar nichts gesagt → hört nach einer Weile auf, Grund „nichts"', () => {
    const z = lauf(START, LEISE, NICHTS_MS + 100)
    assert.equal(z.phase, 'fertig')
    assert.equal(z.grund, 'nichts')
  })

  test('nach einer Antwort wartet es kürzer, wenn so bestellt (nichtsMs)', () => {
    const z = lauf({ ...START, nichtsMs: 3000 }, LEISE, 3100)
    assert.equal(z.phase, 'fertig')
    assert.equal(z.grund, 'nichts')
    assert.equal(lauf({ ...START, nichtsMs: 3000 }, LEISE, 2900).phase, 'wartet')
  })

  test('Dauerreden wird nach der Höchstzeit beendet', () => {
    const z = lauf(START, LAUT, HOECHSTENS_MS + 100)
    assert.equal(z.phase, 'fertig')
    assert.equal(z.grund, 'zulang')
  })

  test('verändert den alten Zustand nicht', () => {
    const vorher = JSON.stringify(START)
    schritt(START, LAUT, 500)
    assert.equal(JSON.stringify(START), vorher)
  })

  test('fertig bleibt fertig', () => {
    const z = lauf(START, LEISE, NICHTS_MS + 100)
    assert.deepEqual(schritt(z, LAUT, 50), z)
  })
})

describe('zeilenLeser', () => {
  test('liest JSON-Zeilen, egal wo die Bröckchen schneiden', () => {
    const l = zeilenLeser()
    assert.deepEqual(l.dazu('{"typ":"satz","te'), [])
    assert.deepEqual(l.dazu('xt":"Hallo."}\n{"typ":"fe'), [{ typ: 'satz', text: 'Hallo.' }])
    assert.deepEqual(l.dazu('rtig"}\n'), [{ typ: 'fertig' }])
  })

  test('kaputte und leere Zeilen werden übersprungen', () => {
    const l = zeilenLeser()
    assert.deepEqual(l.dazu('\n{kaputt}\n{"typ":"satz","text":"Ja."}\n'), [{ typ: 'satz', text: 'Ja.' }])
  })

  test('Rest ohne Zeilenende kommt mit ende()', () => {
    const l = zeilenLeser()
    l.dazu('{"typ":"fertig"}')
    assert.deepEqual(l.ende(), [{ typ: 'fertig' }])
  })
})
