// Kulissen: jedes Tier hat seine Umgebung. Geprüft wird, was man sieht und
// anfassen kann — Landeplätze, Blasen, Blüten, Wolken — und dass alles über
// lange Zeit stabil läuft.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { neuerTeich, schritt } from '../src/lib/asciiTeich.ts'
import { rasternGestalten, strecke } from '../src/lib/kulisse.ts'
import { neueKulisse } from '../src/lib/kulissen.ts'
import { eintauchen } from '../src/lib/kulisseTeich.ts'
import { neueWiese, wiesenSchritt } from '../src/lib/kulisseWiese.ts'
import { neueTiefsee, tiefseeSchritt, strahlenFeld } from '../src/lib/kulisseTiefsee.ts'
import { neuerHimmel, himmelSchritt, windFeld } from '../src/lib/kulisseHimmel.ts'

const zufallAb = (start) => { let seed = start; return () => (seed = (seed * 16807) % 2147483647) / 2147483647 }
const PUNKT = [{ x: 3, y: 6 }]
const lauf = (art, sekunden, maus = null) => {
  const zufall = zufallAb(7)
  let teich = neuerTeich(1000, 700, art, zufall)
  let k = neueKulisse(art, teich, zufall)
  const staende = new Set()
  for (let i = 0; i < sekunden * 30; i++) {
    const vorher = teich
    teich = { ...schritt(teich, 1 / 30, zufall), ziele: k.ziele }
    k = k.weiter({ dt: 1 / 30, vorher, nachher: teich, maus, wellen: null, zufall }).kulisse
    staende.add((k.unten ?? k.oben).stand)
  }
  return { teich, k, staende }
}

describe('Kulisse', () => {
  test('Gestalten: voll gefüllt oder nur als Umriss, deckt aber ganz', () => {
    const wolke = [{ palette: 14, kapseln: [strecke(60, 60, 0, 0, 40, 40)] }]
    const zelle = (x, y) => Math.floor(y / 12) * 20 + Math.floor(x / 6)
    const voll = rasternGestalten(wolke, 20, 10, 6, 12, PUNKT)
    const umriss = rasternGestalten(wolke, 20, 10, 6, 12, PUNKT, true)
    assert.ok(voll.proben[zelle(60, 60)] > 0.8, 'voll: Mitte dicht')
    assert.equal(umriss.proben[zelle(60, 60)], 0, 'Umriss: Mitte frei')
    assert.ok(umriss.proben[zelle(99, 60)] > 0.1, 'Umriss: Rand gezeichnet')
    assert.equal(umriss.deckung[zelle(60, 60)], 1, 'deckt trotzdem')
    assert.equal(umriss.farbe[zelle(60, 60)], 14)
  })

  for (const art of ['koi', 'libelle', 'qualle', 'schmetterling', 'vogel']) {
    test(`${art}: läuft eine Minute stabil, rastert nicht jedes Bild neu`, () => {
      const { k, staende } = lauf(art, 60)
      const r = (k.unten ?? k.oben).rastern(170, 60, 6, 12, PUNKT)
      assert.ok(r.proben.every(Number.isFinite) && r.proben.some((v) => v > 0), 'Ebene sichtbar')
      for (const t of k.teilchen) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && t.staerke >= 0)
      assert.ok(staende.size < 60 * 30, `${staende.size} Mal neu gerastert`)
      if (k.feld) assert.ok(k.feld(170, 60, 6, 12, 5).every((v) => v >= 0 && v <= 1))
    })
  }

  test('Wasser nur bei Koi und Libellen; Landeplätze nur für Libellen und Falter', () => {
    const t = neuerTeich(1000, 700, 'koi', zufallAb(3))
    const k = (art) => neueKulisse(art, { ...t, wesen: [] }, zufallAb(3))
    assert.deepEqual(['koi', 'libelle', 'qualle', 'schmetterling', 'vogel'].map((a) => k(a).wasser), [true, true, false, false, false])
    assert.equal(k('koi').ziele.length, 0)
    assert.ok(k('libelle').ziele.length >= 4)
    assert.ok(k('schmetterling').ziele.length >= 5)
    assert.ok(k('koi').oben && !k('koi').unten, 'Koi unter den Blättern')
    assert.ok(k('libelle').unten && !k('libelle').oben, 'Libellen über den Blättern')
  })

  test('Libellen landen auf Seerosen, und Falter auf Blüten', () => {
    for (const art of ['libelle', 'schmetterling']) {
      const { teich, k } = lauf(art, 40)
      const nahe = teich.wesen.filter((w) => w.warten > 0 && k.ziele.some((z) => Math.hypot(z.x - w.x, z.y - w.y) < 30))
      const angeflogen = teich.wesen.filter((w) => k.ziele.some((z) => Math.hypot(z.x - w.zielX, z.y - w.zielY) < 1))
      assert.ok(angeflogen.length + nahe.length > 0, `${art}: kein Tier fliegt einen Landeplatz an`)
    }
  })

  test('Libelle tippt aufs Wasser, wenn sie nicht auf einem Blatt landet', () => {
    const libelle = (warten, x) => ({ art: 'libelle', x, y: 200, winkel: 0, tiefe: 1, phase: 0, kurve: 0.1, versatz: 0, zielX: 0, zielY: 0, warten, farbe: 3, schreck: 0, fluchtWinkel: 0 })
    const teich = (wesen) => ({ breite: 800, hoehe: 600, zeit: 0, wesen })
    const blatt = { x: 200, y: 200, r: 40, kerbe: 0, dreh: 0, vx: 0, vy: 0, bluete: false, beruehrt: false }
    assert.equal(eintauchen(teich([libelle(0, 500)]), teich([libelle(2, 500)]), [blatt]).length, 1, 'Wasser: Ring')
    assert.equal(eintauchen(teich([libelle(0, 190)]), teich([libelle(2, 190)]), [blatt]).length, 0, 'Blatt: kein Ring')
    assert.equal(eintauchen(teich([libelle(1, 500)]), teich([libelle(2, 500)]), [blatt]).length, 0, 'schwebt schon')
  })

  test('Wiese: Blüte wippt beim Berühren und stäubt Pollen, der verweht', () => {
    let w = neueWiese(1000, 700, zufallAb(5))
    const b = w.blumen[0]
    w = wiesenSchritt(w, 1 / 30, { x: b.x, y: b.y }, zufallAb(9))
    const pollen = w.flug.filter((f) => !f.samen)
    assert.equal(pollen.length, 4)
    assert.ok(Math.abs(w.blumen[0].wippV) > 0, 'wippt')
    for (let i = 0; i < 90; i++) w = wiesenSchritt(w, 1 / 30, null, zufallAb(9))
    assert.equal(w.flug.filter((f) => !f.samen).length, 0, 'Pollen verweht')
    assert.ok(Math.abs(w.blumen[0].wippen) < 0.1, 'kommt zur Ruhe')
    for (const [i, a] of w.blumen.entries()) {
      for (const c of w.blumen.slice(i + 1)) assert.ok(Math.hypot(a.x - c.x, a.y - c.y) >= 130, 'Blüten mit Abstand')
    }
  })

  test('Tiefsee: Blasen steigen und platzen bei Berührung; Licht verblasst nach unten', () => {
    let see = neueTiefsee(1000, 700, zufallAb(4))
    const zufall = zufallAb(4)
    for (let i = 0; i < 300; i++) see = tiefseeSchritt(see, 1 / 30, null, zufall)
    assert.ok(see.blasen.length > 0, 'Blasen steigen')
    assert.ok(see.blasen.every((b) => b.y < 704), 'nach oben')
    const b = see.blasen[0]
    see = tiefseeSchritt(see, 1 / 30, { x: b.x, y: b.y }, () => 0.99)
    assert.ok(see.blasen.some((x) => x.platzt > 0), 'geplatzt')
    const feld = strahlenFeld(170, 60, 6, 12, 3)
    const oben = feld.slice(0, 170 * 10).filter((v) => v > 0).length
    const unten = feld.slice(170 * 52).filter((v) => v > 0).length
    assert.ok(oben > 0 && unten === 0, `oben ${oben}, unten ${unten}`)
  })

  test('Himmel: Wolken ziehen mit dem Schwarm, langsamer als er; Wind ist spärlich', () => {
    for (const richtung of [1, -1]) {
      let h = neuerHimmel(1000, 700, richtung, zufallAb(6))
      const vorher = h.wolken[0].x
      h = himmelSchritt(h, 1)
      const weg = h.wolken[0].x - vorher
      assert.ok(Math.sign(weg) === richtung && Math.abs(weg) < 20, `zieht ${weg}`)
    }
    const feld = windFeld(1)(170, 60, 6, 12, 2)
    const an = feld.filter((v) => v > 0).length
    assert.ok(an > 0 && an < feld.length * 0.08, `${an} Windzellen`)
  })

  test('neue Fenstergröße: alles bleibt, wo es relativ war, und wird neu gerastert', () => {
    const t = neuerTeich(1000, 700, 'vogel', zufallAb(2))
    const k = neueKulisse('schmetterling', t, zufallAb(2))
    const gross = k.aufGroesse(2, 1, 2000, 700)
    assert.ok(Math.abs(gross.ziele[0].x - k.ziele[0].x * 2) < 1e-9)
    assert.notEqual(gross.unten.stand, k.unten.stand)
  })
})
