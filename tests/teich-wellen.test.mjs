// Wellen im Koi-Teich: ein Schreck macht einen Ring, der sich ausbreitet und
// verebbt — und nie aufschaukelt, auch wenn ein Koi lange flieht.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { neueWellen, wellenSchritt, anstoesse, welleBei, wellenZeichen, tropfen, glanz, glanzFeld, WELLE_PX } from '../src/lib/teichWellen.ts'

const groesste = (w) => w.jetzt.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const koi = (extra = {}) => ({
  art: 'koi', x: 300, y: 300, winkel: 0, tiefe: 1, phase: 0, kurve: 0.1, versatz: 0,
  zielX: 0, zielY: 0, warten: 0, farbe: 0, schreck: 0, fluchtWinkel: 0, ...extra,
})
const teich = (wesen) => ({ breite: 600, hoehe: 600, zeit: 0, wesen })

describe('Wellen', () => {
  test('Ring breitet sich aus und verebbt', () => {
    let w = wellenSchritt(neueWellen(600, 600), [{ x: 300, y: 300, hoehe: 2.4 }])
    for (let i = 0; i < 10; i++) w = wellenSchritt(w, [])
    // Nach 10 Schritten ist die Welle ~10 Zellen weit gekommen.
    const draussen = Math.abs(welleBei(w, { x: 300 + 8 * WELLE_PX, y: 300 }))
    assert.ok(draussen > 0.05, `Ring kommt nicht an: ${draussen}`)
    for (let i = 0; i < 150; i++) w = wellenSchritt(w, [])
    assert.ok(groesste(w) < 0.05, `verebbt nicht: ${groesste(w)}`)
  })

  test('Ringe sind rund, nicht in die Höhe gezogen', () => {
    let w = wellenSchritt(neueWellen(600, 600), [{ x: 300, y: 300, hoehe: 2.4 }])
    for (let i = 0; i < 12; i++) w = wellenSchritt(w, [])
    const quer = Math.abs(welleBei(w, { x: 300 + 10 * WELLE_PX, y: 300 }))
    const hoch = Math.abs(welleBei(w, { x: 300, y: 300 + 10 * WELLE_PX }))
    assert.ok(Math.abs(quer - hoch) < 1e-6, `${quer} ≠ ${hoch}`)
  })

  test('ein lange fliehender Koi schaukelt nichts auf', () => {
    let w = neueWellen(600, 600)
    for (let i = 0; i < 600; i++) w = wellenSchritt(w, [{ x: 100 + (i * 7) % 400, y: 300, hoehe: 0.5 }])
    assert.ok(groesste(w) < 6, `schaukelt auf: ${groesste(w)}`)
  })

  test('Schwall nur beim Erschrecken, Kielwelle nur beim Fliehen, nur beim Koi', () => {
    const vorher = teich([koi(), koi({ schreck: 0.6 }), koi({ art: 'libelle', schreck: 0 })])
    const nachher = teich([koi({ schreck: 1 }), koi({ schreck: 0.58 }), koi({ art: 'libelle', schreck: 1 })])
    const a = anstoesse(vorher, nachher)
    assert.equal(a.length, 2)
    assert.ok(a[0].hoehe > a[1].hoehe, 'Schwall stärker als Kielwelle')
    assert.equal(anstoesse(teich([koi({ tiefe: 0.5 })]), teich([koi({ tiefe: 0.5, schreck: 0.1 })])).length, 0, 'ruhiger Koi in der Tiefe')
  })

  test('ruhiger Koi dicht unter der Oberfläche kräuselt nur leicht', () => {
    const [a] = anstoesse(teich([koi()]), teich([koi()]))
    assert.ok(a && a.hoehe > 0 && a.hoehe < 0.1, `Kräuseln: ${a?.hoehe}`)
  })

  test('Tropfen: im Mittel knapp einer je Sekunde, im Bild', () => {
    let seed = 3
    const zufall = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    let n = 0
    for (let i = 0; i < 3000; i++) {
      for (const t of tropfen(600, 400, 1 / 30, zufall)) {
        n++
        assert.ok(t.x >= 0 && t.x <= 600 && t.y >= 0 && t.y <= 400 && t.hoehe > 0)
      }
    }
    assert.ok(n > 60 && n < 120, `${n} Tropfen in 100 s`)
  })

  test('Glanz: nur an wenigen Stellen, zwischen 0 und 1, wandert mit der Zeit', () => {
    let an = 0
    let anders = 0
    for (let y = 0; y < 600; y += 12) {
      for (let x = 0; x < 900; x += 7) {
        const g = glanz(x, y, 10)
        assert.ok(g >= 0 && g <= 1)
        if (g > 0) an++
        if ((g > 0) !== (glanz(x, y, 14) > 0)) anders++
      }
    }
    const zellen = 50 * 129
    assert.ok(an > zellen * 0.01 && an < zellen * 0.18, `${an} von ${zellen} glänzen`)
    assert.ok(anders > 0, 'Glanz steht still')
  })

  test('Glanz fürs ganze Raster = Glanz je Punkt', () => {
    const feld = glanzFeld(129, 50, 7, 12, 10)
    for (let z = 0; z < 50; z++) {
      for (let c = 0; c < 129; c++) assert.ok(Math.abs(feld[z * 129 + c] - glanz(c * 7, z * 12, 10)) < 1e-5)
    }
  })

  test('Zeichen: flaches Wasser bleibt leer, Kamm und Tal sind verschieden', () => {
    assert.equal(wellenZeichen(0.05), null)
    assert.equal(wellenZeichen(1), '~')
    assert.equal(wellenZeichen(-1), '_')
    assert.equal(wellenZeichen(0.2), '-')
  })

  test('Anstoß am Rand bricht nicht', () => {
    const w = wellenSchritt(neueWellen(600, 600), [{ x: -50, y: 2000, hoehe: 3 }, { x: 0, y: 0, hoehe: 3 }])
    assert.ok(w.jetzt.every(Number.isFinite))
  })
})
