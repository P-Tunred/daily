// Seerosen im Koi-Teich: ein paar Blätter, nicht übereinander, mit Kerbe;
// Koi verschwinden darunter; angestoßen treiben sie weg und ziehen einen Ring.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  neueSeerosen, seerosenAnzahl, seerosenAufGroesse, blattDichte, blattDeckung, blueteDichte, rasternSeerosen, verdecken,
  seerosenSchritt, seerosenVerschoben, BLATT_PALETTE, BLUETE_PALETTE,
} from '../src/lib/teichSeerosen.ts'
import { neueWellen, wellenSchritt } from '../src/lib/teichWellen.ts'

let seed = 11
const zufall = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const blatt = (extra = {}) => ({ x: 200, y: 200, r: 40, kerbe: 0, dreh: 0, vx: 0, vy: 0, bluete: false, beruehrt: false, ...extra })

describe('Seerosen', () => {
  test('wenige Blätter, im Bild und nicht übereinander', () => {
    for (const [b, h] of [[800, 600], [1440, 900], [2560, 1440]]) {
      const rosen = neueSeerosen(b, h, zufall)
      assert.equal(rosen.length, seerosenAnzahl(b * h))
      assert.ok(rosen.length >= 4 && rosen.length <= 7)
      for (const [i, s] of rosen.entries()) {
        assert.ok(s.x >= s.r && s.x <= b - s.r && s.y >= s.r && s.y <= h - s.r, 'im Bild')
        for (const o of rosen.slice(i + 1)) assert.ok(Math.hypot(s.x - o.x, s.y - o.y) > s.r + o.r, 'überlappen')
      }
      assert.ok(rosen.some((s) => s.bluete), 'mindestens eine Blüte')
    }
  })

  test('Blatt: Strichzeichnung aus Rand und Adern, deckt aber ganz', () => {
    const s = blatt()
    assert.ok(blattDichte(s, 200, 200 - 38) > 0.4, 'Rand')
    assert.ok(blattDichte(s, 200 - 25, 200) > 0.2, 'Ader gegenüber der Kerbe')
    assert.ok(blattDichte(s, 200 + 20 * Math.cos(Math.PI / 8 + 0.2), 200 + 20 * Math.sin(Math.PI / 8 + 0.2)) < 0.05, 'zwischen den Adern frei')
    assert.equal(blattDeckung(s, 200, 200 - 20), 1, 'trotzdem deckt das Blatt')
    assert.equal(blattDeckung(s, 230, 200), 0, 'Kerbe zeigt nach kerbe = 0, also nach rechts')
    assert.equal(blattDichte(s, 230, 200), 0)
    assert.equal(blattDeckung(s, 250, 200), 0, 'draußen')
  })

  test('Blüte nur, wo eine ist, und dichter als das Blatt', () => {
    assert.equal(blueteDichte(blatt(), 195, 200), 0)
    const b = blueteDichte(blatt({ bluete: true }), 193, 200)
    assert.ok(b > 0.5, `Blüte ${b}`)
  })

  test('Rastern: Blatt- und Blütenfarbe, nur um das Blatt herum', () => {
    const punkte = [{ x: 3, y: 6 }]
    const { proben, farbe, deckung } = rasternSeerosen([blatt({ bluete: true })], 100, 40, 6, 12, punkte)
    const zelle = (x, y) => Math.floor(y / 12) * 100 + Math.floor(x / 6)
    assert.equal(farbe[zelle(193, 200)], BLUETE_PALETTE)
    assert.equal(farbe[zelle(201, 162)], BLATT_PALETTE, 'Rand oben')
    assert.ok(deckung[zelle(180, 220)] > 0.9, 'Blatt deckt innen')
    assert.equal(proben[zelle(450, 400)], 0)
    assert.equal(deckung[zelle(450, 400)], 0)
  })

  test('verdecken: Koi unter dem Blatt verschwindet, daneben bleibt er', () => {
    const tiere = Float32Array.from([0.8, 0.8, 0.8])
    const deckung = Float32Array.from([1, 0.5, 0])
    const sichtbar = verdecken(tiere, deckung)
    assert.equal(sichtbar[0], 0)
    assert.ok(sichtbar[1] > 0 && sichtbar[1] < 0.8)
    assert.ok(Math.abs(sichtbar[2] - 0.8) < 1e-6)
    assert.ok(Math.abs(tiere[0] - 0.8) < 1e-6, 'Eingabe bleibt unverändert')
  })

  test('Zeiger stößt ein Blatt an: einmal ein Ring, es treibt weg und kommt zur Ruhe', () => {
    let rosen = [blatt()]
    const maus = { x: 180, y: 200 }
    let s = seerosenSchritt(rosen, 1 / 30, 800, 600, maus, null)
    assert.equal(s.anstoesse.length, 1, 'Ring beim Berühren')
    assert.ok(s.rosen[0].vx > 0, 'treibt vom Zeiger weg')
    s = seerosenSchritt(s.rosen, 1 / 30, 800, 600, maus, null)
    assert.equal(s.anstoesse.length, 0, 'kein zweiter Ring, solange der Zeiger draufliegt')
    rosen = s.rosen
    for (let i = 0; i < 300; i++) rosen = seerosenSchritt(rosen, 1 / 30, 800, 600, null, null).rosen
    assert.ok(rosen[0].x > 205, `weggetrieben: ${rosen[0].x}`)
    assert.ok(Math.hypot(rosen[0].vx, rosen[0].vy) < 1, 'kommt zur Ruhe')
  })

  test('Wellen schieben Blätter leicht, nichts verlässt das Bild', () => {
    let w = wellenSchritt(neueWellen(800, 600), [{ x: 150, y: 200, hoehe: 2.4 }])
    let rosen = [blatt({ x: 200 }), blatt({ x: 760, y: 560, vx: 80, vy: 80 })]
    for (let i = 0; i < 120; i++) {
      w = wellenSchritt(w, [])
      rosen = seerosenSchritt(rosen, 1 / 30, 800, 600, null, w).rosen
    }
    assert.ok(rosen[0].x > 200, `Welle schiebt nicht: ${rosen[0].x}`)
    assert.ok(rosen[0].x < 260, 'nur leicht')
    assert.ok(rosen[1].x < 800 && rosen[1].y < 600, 'bleibt im Bild')
  })

  test('neu rastern erst, wenn ein Blatt merklich wandert oder sich dreht', () => {
    const alt = [blatt(), blatt({ x: 400 })]
    assert.equal(seerosenVerschoben(alt, [blatt({ x: 200.3 }), blatt({ x: 400, kerbe: 0.005 })]), false)
    assert.equal(seerosenVerschoben(alt, [blatt({ x: 201 }), blatt({ x: 400 })]), true, 'gewandert')
    assert.equal(seerosenVerschoben(alt, [blatt(), blatt({ x: 400, kerbe: 0.03 })]), true, 'gedreht: Rand wandert 1,2 px')
    assert.equal(seerosenVerschoben(alt, [blatt()]), true, 'andere Anzahl')
  })

  test('überlappende Blätter schieben sich auseinander; Größe mitnehmen', () => {
    let rosen = [blatt({ x: 200 }), blatt({ x: 230 })]
    for (let i = 0; i < 300; i++) rosen = seerosenSchritt(rosen, 1 / 30, 800, 600, null, null).rosen
    assert.ok(rosen[1].x - rosen[0].x > 60, `noch übereinander: ${rosen[1].x - rosen[0].x}`)
    const gross = seerosenAufGroesse(rosen, 2, 1)
    assert.ok(Math.abs(gross[0].x - rosen[0].x * 2) < 1e-9)
  })
})
