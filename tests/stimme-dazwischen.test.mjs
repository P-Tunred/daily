// Dazwischenreden: wann Daily merkt, dass Paul spricht, während das
// Hörbriefing oder Hermes gerade spricht — und wie die Aufnahme als WAV
// zum Erkenner geht.
//
// WARUM DIESE TESTS EXISTIEREN
// Das Mikrofon hört beim Briefing mit. Über Lautsprecher hört es dabei auch
// das Briefing selbst (Echo). Reagiert es darauf, unterbricht sich das
// Briefing ständig selbst — das wäre schlimmer als gar kein Dazwischenreden.
// Reagiert es zu träge, redet Paul ins Leere. Geprüft wird beides mit
// nachgebauten Pegelverläufen: Kopfhörer (kaum Echo), Lautsprecher (Echo in
// Sprachrhythmus), Knacken, und Paul, der lauter ist als das Echo.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { LAUSCHEN, lauschSchritt, AUSLOESEN_MS, EINSCHWINGEN_MS, MIN_PEGEL } from '../src/lib/dazwischen.ts'
import { alsWav, ZIEL_RATE } from '../src/lib/wav.ts'

const T = 43   // ms je Messfenster, wie im Browser (2048 Samples bei 48 kHz)

/** Pegelverlauf durchspielen; gibt den Zeitpunkt (ms) des Auslösens oder null. */
function spiele(pegelFn, ms) {
  let z = LAUSCHEN
  for (let t = 0; t < ms; t += T) {
    const r = lauschSchritt(z, pegelFn(t), T)
    z = r.zustand
    if (r.ausgeloest) return t
  }
  return null
}

/** Echo eines Sprechers: Silben von ~200 ms, dazwischen Pausen. */
const echo = (stark) => (t) => (Math.floor(t / 200) % 3 === 2 ? stark * 0.1 : stark * (0.6 + 0.4 * Math.sin(t / 37)))

describe('Dazwischenreden erkennen', () => {
  test('Kopfhörer: Paul fängt an zu reden → nach kurzer Zeit ausgelöst', () => {
    const t = spiele((t) => (t < 2000 ? 0.002 : 0.12), 4000)
    assert.ok(t !== null, 'nicht ausgelöst')
    assert.ok(t >= 2000 + AUSLOESEN_MS - T && t <= 2000 + AUSLOESEN_MS + 2 * T, `bei ${t} ms`)
  })

  test('Lautsprecher: das Echo des Briefings allein löst nie aus', () => {
    assert.equal(spiele(echo(0.06), 30_000), null)
  })

  test('Lautsprecher: Paul deutlich lauter als das Echo → ausgelöst', () => {
    const t = spiele((t) => (t < 5000 ? echo(0.06)(t) : 0.25), 8000)
    assert.ok(t !== null && t >= 5000, `bei ${t}`)
  })

  test('ein Knacken oder Husten löst nicht aus', () => {
    assert.equal(spiele((t) => (t > 3000 && t < 3000 + AUSLOESEN_MS / 2 ? 0.3 : 0.002), 6000), null)
  })

  test('in der Einschwingzeit wird nicht ausgelöst — das Echo wird erst gelernt', () => {
    const t = spiele(() => 0.2, EINSCHWINGEN_MS + 2000)
    assert.ok(t === null || t >= EINSCHWINGEN_MS, `bei ${t}`)
  })

  test('sehr leise Geräusche über dem Rauschen lösen nicht aus', () => {
    assert.equal(spiele((t) => (t < 2000 ? 0.001 : MIN_PEGEL * 0.7), 6000), null)
  })

  test('verändert den alten Zustand nicht', () => {
    const vorher = JSON.stringify(LAUSCHEN)
    lauschSchritt(LAUSCHEN, 0.5, T)
    assert.equal(JSON.stringify(LAUSCHEN), vorher)
  })
})

describe('alsWav', () => {
  const sinus = (rate, sek) => {
    const f = new Float32Array(Math.round(rate * sek))
    for (let i = 0; i < f.length; i++) f[i] = Math.sin(i / 10) * 0.5
    return f
  }

  test('16 kHz mono 16 Bit, Kopf stimmt, Länge passt', () => {
    const b = alsWav([sinus(48000, 0.5), sinus(48000, 0.5)], 48000)
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const txt = (o, n) => String.fromCharCode(...b.slice(o, o + n))
    assert.equal(txt(0, 4), 'RIFF')
    assert.equal(txt(8, 4), 'WAVE')
    assert.equal(v.getUint16(22, true), 1)            // mono
    assert.equal(v.getUint32(24, true), ZIEL_RATE)
    assert.equal(v.getUint16(34, true), 16)
    const daten = v.getUint32(40, true)
    assert.equal(daten, ZIEL_RATE * 2)                // eine Sekunde
    assert.equal(b.byteLength, 44 + daten)
  })

  test('übersteuerte Werte werden begrenzt statt umzuklappen', () => {
    const b = alsWav([new Float32Array([2, -2, 2, -2, 2, -2])], ZIEL_RATE)
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    assert.equal(v.getInt16(44, true), 32767)
    assert.equal(v.getInt16(46, true), -32768)
  })

  test('leer → nur der Kopf', () => {
    assert.equal(alsWav([], 48000).byteLength, 44)
  })
})
