// Zeichen nach Form: die sechs Proben einer Zelle wählen das Zeichen, dessen
// gemessene Form am besten passt. Die Fälle hier prüfen, dass Lage und Richtung
// ankommen — unten gefüllt → unten sitzendes Zeichen, schräg → Schrägstrich.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { glyphFuer, glyphenBild, geformt, mitKontrast, GLYPHEN } from '../src/lib/glyphenForm.ts'

// Reihenfolge: oben links, oben rechts, Mitte links, Mitte rechts, unten links, unten rechts
const zeichen = (proben) => GLYPHEN[glyphFuer(proben)]

describe('Zeichen nach Form', () => {
  test('leer bleibt leer, voll wird ein dichtes Zeichen', () => {
    assert.equal(zeichen([0, 0, 0, 0, 0, 0]), ' ')
    assert.ok('@#08OH'.includes(zeichen([1, 1, 1, 1, 1, 1])), zeichen([1, 1, 1, 1, 1, 1]))
  })

  test('nur unten gefüllt → Zeichen, das unten sitzt', () => {
    assert.ok('_.,'.includes(zeichen([0, 0, 0, 0, 0.5, 0.5])), zeichen([0, 0, 0, 0, 0.5, 0.5]))
  })

  test('nur oben gefüllt → Zeichen, das oben sitzt', () => {
    assert.ok(`"^'\``.includes(zeichen([0.6, 0.6, 0, 0, 0, 0])), zeichen([0.6, 0.6, 0, 0, 0, 0]))
  })

  test('nur Mitte gefüllt → waagrechter Strich', () => {
    assert.ok('-~='.includes(zeichen([0, 0, 0.45, 0.45, 0, 0])), zeichen([0, 0, 0.45, 0.45, 0, 0]))
  })

  test('Schräge von rechts oben nach links unten → /', () => {
    assert.equal(zeichen([0, 0.55, 0.45, 0.15, 0.45, 0]), '/')
  })

  test('Schräge von links oben nach rechts unten → \\', () => {
    assert.equal(zeichen([0.55, 0, 0.25, 0.3, 0, 0.45]), '\\')
  })

  test('keine Wahl ohne Grund: dieselben Proben, dasselbe Zeichen (Zwischenspeicher)', () => {
    const p = [0.3, 0.7, 0.2, 0.9, 0.1, 0.4]
    assert.equal(glyphFuer(p), glyphFuer(p))
    assert.equal(glyphFuer(Float32Array.from([9, 9, 9, 9, ...p]), 4), glyphFuer(p))
  })

  test('Kontrast hebt Unterschiede, lässt das Hellste und verändert die Eingabe nicht', () => {
    const p = [0.2, 0.8, 0.4, 0.8, 0.1, 0.6]
    const k = mitKontrast(p)
    assert.equal(Math.max(...k), 0.8)
    assert.ok(k[0] < p[0] && k[2] < p[2])
    assert.deepEqual(p, [0.2, 0.8, 0.4, 0.8, 0.1, 0.6])
  })

  test('Silhouette: unter dem Umriss nichts, darüber steigend', () => {
    assert.equal(geformt(0.02), 0)
    assert.ok(geformt(0.2) > geformt(0.1) && geformt(1) > geformt(0.5))
    assert.ok(geformt(1) <= 1)
  })

  test('ganzes Bild: unsichtbare Zellen bleiben leer, Licht macht dichter', () => {
    const proben = new Float32Array(12).fill(0.12)
    const dichte = Float32Array.from([0.12, 0.01])
    const ohne = glyphenBild(proben, dichte, dichte, 0.05)
    assert.equal(ohne[1], 0)
    assert.ok(ohne[0] > 0)
    const mit = glyphenBild(proben, dichte, Float32Array.from([0.36, 0.01]), 0.05)
    assert.ok(mit[0] !== ohne[0], 'Licht ändert nichts')
  })
})
