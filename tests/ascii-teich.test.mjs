// ASCII-Teich: die leisen Koi hinter dem Thema Glas.
//
// WARUM ALS EIGENER TEST
// Die Rechnung läuft 30-mal pro Sekunde im Hintergrund. Fehler sieht man
// dort nicht als Absturz, sondern als Fische, die verschwinden, festkleben
// oder über das ganze Fenster schmieren. Die Fälle hier fangen genau das.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  neuerTeich, schritt, rastern, kapseln, inKapsel, zeichenStufe,
  teichAufGroesse, koiLaenge, ZEICHEN, PALETTEN, reagieren, WACH_RADIUS,
  beleuchten, rasternProben, zellMittel,
} from '../src/lib/asciiTeich.ts'

const ARTEN = ['koi', 'libelle', 'qualle', 'schmetterling', 'vogel']

function festerZufall(start = 1) {
  let s = start
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

describe('Teich anlegen', () => {
  test('ein Motiv = eine Art; kleines Fenster: mindestens drei Koi', () => {
    const t = neuerTeich(400, 300, 'koi', festerZufall())
    assert.equal(t.wesen.length, 3)
    assert.ok(t.wesen.every((w) => w.art === 'koi'))
  })

  test('großes Fenster: nach oben begrenzt — es soll leise bleiben', () => {
    const grenzen = { koi: 5, libelle: 5, qualle: 6, schmetterling: 7, vogel: 9 }
    for (const art of ARTEN) {
      assert.equal(neuerTeich(5000, 3000, art, festerZufall()).wesen.length, grenzen[art], art)
    }
  })

  test('jedes Tier hat eine gültige Palette, Koi gibt es in mehreren Farben', () => {
    for (const art of ARTEN) {
      for (const w of neuerTeich(3000, 2000, art, festerZufall(11)).wesen) {
        assert.ok(PALETTEN[w.farbe]?.length === 5, `${art}: ${w.farbe}`)   // fünf Töne je Palette
      }
    }
    const koiFarben = new Set(neuerTeich(3000, 2000, 'koi', festerZufall(3)).wesen.map((w) => w.farbe))
    assert.ok(koiFarben.size > 1)
  })

  test('Vögel ziehen als Schwarm in eine Richtung', () => {
    const t = neuerTeich(2000, 1200, 'vogel', festerZufall(8))
    const x = t.wesen.map((w) => Math.cos(w.winkel))
    assert.ok(x.every((v) => v > 0.9) || x.every((v) => v < -0.9))
  })
})

describe('bewegen', () => {
  test('schritt verändert den alten Teich nicht', () => {
    const t = neuerTeich(1200, 800, 'koi', festerZufall())
    const vorher = JSON.stringify(t)
    schritt(t, 0.03, festerZufall(7))
    assert.equal(JSON.stringify(t), vorher)
  })

  for (const art of ARTEN) {
    test(`${art}: bewegt sich und bleibt nach langer Zeit beim Fenster`, () => {
      let t = neuerTeich(1200, 800, art, festerZufall(3))
      const start = t.wesen.map((w) => [w.x, w.y])
      for (let i = 0; i < 12_000; i++) t = schritt(t, 1 / 30, festerZufall(i + 2))
      assert.ok(t.wesen.some((w, i) => Math.hypot(w.x - start[i][0], w.y - start[i][1]) > 5))
      for (const w of t.wesen) {
        // Koi dürfen um ihre Länge hinaus (sonst verschwände der Schwanz
        // sichtbar), alle anderen um 120 px; Falter gaukeln etwas darüber.
        const rand = art === 'koi' ? koiLaenge(1) + 20 : 140
        assert.ok(w.x >= -rand && w.x <= 1200 + rand, `x=${w.x}`)
        assert.ok(w.y >= -rand && w.y <= 800 + rand, `y=${w.y}`)
      }
    })
  }

  test('Quallen steigen nach oben', () => {
    let t = neuerTeich(1200, 3000, 'qualle', festerZufall(6))
    const vorher = t.wesen.map((w) => w.y)
    for (let i = 0; i < 60; i++) t = schritt(t, 1 / 30)
    assert.ok(t.wesen.every((w, i) => w.y < vorher[i]))
  })

  test('nach langer Pause springt nichts quer übers Bild', () => {
    const t = neuerTeich(1200, 800, 'vogel', festerZufall(5))
    const n = schritt(t, 30, festerZufall(9))
    for (let i = 0; i < t.wesen.length; i++) {
      const d = Math.hypot(n.wesen[i].x - t.wesen[i].x, n.wesen[i].y - t.wesen[i].y)
      assert.ok(d < 20, `Sprung ${d}px`)
    }
  })

  test('neue Fenstergröße: Wesen bleiben an ihrer relativen Stelle', () => {
    const t = neuerTeich(1000, 500, 'koi', festerZufall(4))
    const g = teichAufGroesse(t, 2000, 1000)
    assert.equal(g.wesen[0].x, t.wesen[0].x * 2)
    assert.equal(g.wesen[0].y, t.wesen[0].y * 2)
  })
})

describe('scheu vor der Maus', () => {
  const teich = { breite: 1200, hoehe: 800, zeit: 0, wesen: [] }
  const tier = (art, extra = {}) => ({
    art, x: 600, y: 400, winkel: 0, tiefe: 1, phase: 0, kurve: 0.1, versatz: 0,
    zielX: 600, zielY: 400, warten: 2, farbe: 0, schreck: 0, fluchtWinkel: 0, ...extra,
  })
  const laufen = (w, maus, sekunden) => {
    let n = w
    for (let i = 0; i < Math.round(sekunden * 30); i++) n = reagieren(n, maus, 1 / 30, teich)
    return n
  }

  test('weit weg: kein Schreck, nichts bewegt sich', () => {
    const w = tier('qualle')
    const n = laufen(w, { x: 600 + WACH_RADIUS + 120, y: 400 }, 1)
    assert.equal(n.schreck, 0)
    assert.equal(n.x, w.x)
  })

  test('Berührung: voller Schreck sofort, Flucht hält ein paar Sekunden', () => {
    const beruehrt = reagieren(tier('qualle'), { x: 610, y: 400 }, 1 / 30, teich)
    assert.equal(beruehrt.schreck, 1)
    const spaeter = laufen(beruehrt, null, 1)
    assert.ok(spaeter.schreck > 0.5, `nach 1 s ohne Zeiger nur ${spaeter.schreck}`)
    assert.equal(laufen(spaeter, null, 3).schreck, 0)
  })

  test('bloße Nähe macht nur unruhig, erst Berührung schlägt in Flucht um', () => {
    const koi = tier('koi', { winkel: 0 })
    const nah = reagieren(koi, { x: 600 - koiLaenge(1) * 0.4, y: 400 - 140 }, 1 / 30, teich)
    assert.ok(nah.schreck > 0 && nah.schreck <= 0.2, `Nähe: ${nah.schreck}`)
    const beruehrt = reagieren(koi, { x: 600 - koiLaenge(1) * 0.3, y: 400 }, 1 / 30, teich)
    assert.equal(beruehrt.schreck, 1)
  })

  test('berührter Koi dreht blitzschnell ab und schießt davon', () => {
    // Koi schwimmt nach rechts, Zeiger tippt ihm auf den Kopf.
    const w = tier('koi', { winkel: 0, fluchtWinkel: 0 })
    const maus = { x: 610, y: 402 }
    const einSchritt = reagieren(w, maus, 1 / 30, teich)
    // Ein Schritt: schon ein Dreh, aber kein Satz auf den Zeiger zu.
    assert.ok(Math.abs(einSchritt.winkel) > 0.15, `dreht kaum: ${einSchritt.winkel}`)
    assert.ok(einSchritt.x - w.x < 2, `schießt auf den Zeiger zu: ${einSchritt.x - w.x}`)
    // Nach einer Sekunde: gewendet und weit weg.
    const n = laufen(einSchritt, null, 1)
    assert.ok(Math.cos(n.winkel) < -0.5, `schaut noch zum Zeiger: ${n.winkel}`)
    assert.ok(Math.hypot(n.x - maus.x, n.y - maus.y) > 150, `nur ${Math.hypot(n.x - maus.x, n.y - maus.y)} px weg`)
  })

  test('am Schwanz berührt: der Koi schießt nach vorn', () => {
    const w = tier('koi', { winkel: 0 })   // Kopf bei 600, Schwanz nach links
    const n = laufen(reagieren(w, { x: 600 - koiLaenge(1) * 0.7, y: 400 }, 1 / 30, teich), null, 0.5)
    assert.ok(n.x - w.x > 80, `nur ${n.x - w.x} px nach vorn`)
  })

  test('je näher, desto größer der Schreck', () => {
    const nah = reagieren(tier('qualle'), { x: 600, y: 400 - 60 }, 1 / 30, teich)
    const fern = reagieren(tier('qualle'), { x: 600, y: 400 - 90 }, 1 / 30, teich)
    assert.ok(nah.schreck > fern.schreck, `${nah.schreck} ≤ ${fern.schreck}`)
  })

  test('alle Arten fliehen nach Berührung weit vom Zeiger weg', () => {
    for (const art of ARTEN) {
      const maus = { x: 605, y: 400 }
      const n = laufen(reagieren(tier(art, { warten: 0 }), maus, 1 / 30, teich), null, 1)
      const weg = Math.hypot(n.x - maus.x, n.y - maus.y)
      assert.ok(weg > 100, `${art}: nur ${weg.toFixed(0)} px weg`)
    }
  })

  test('Libelle und Falter hören auf zu schweben und nehmen ein Ziel auf der anderen Seite', () => {
    for (const art of ['libelle', 'schmetterling']) {
      const n = laufen(tier(art), { x: 610, y: 400 }, 0.2)
      assert.equal(n.warten, 0, art)
      assert.ok(n.zielX < 600, `${art}: Ziel ${n.zielX}`)
      assert.ok(n.x < 600, `${art}: fliegt nicht weg (${n.x})`)
    }
  })

  test('Zeiger mitten im Teich: alle Tiere bleiben im Spiel und halten Abstand', () => {
    for (const art of ['koi', 'schmetterling', 'qualle']) {
      let t = neuerTeich(1200, 800, art, festerZufall(12))
      for (let i = 0; i < 3000; i++) t = schritt(t, 1 / 30, festerZufall(i), { x: 600, y: 400 })
      for (const w of t.wesen) {
        assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y), art)
        assert.ok(Math.hypot(w.x - 600, w.y - 400) > 20, `${art} sitzt auf dem Zeiger`)
      }
    }
  })
})

describe('rastern', () => {
  test('Mitte einer Kapsel ist dicht, außerhalb ist nichts', () => {
    const k = { ax: 0, ay: 0, bx: 100, by: 0, ra: 10, rb: 10 }
    assert.equal(inKapsel(k, 50, 0), 1)
    assert.equal(inKapsel(k, 50, 12), 0)
    assert.ok(inKapsel(k, 50, 8) > 0 && inKapsel(k, 50, 8) < 0.3)
  })

  test('ein Koi füllt Zellen um seinen Kopf, nicht das ganze Raster', () => {
    const t = { breite: 700, hoehe: 420, zeit: 0, wesen: [{
      art: 'koi', x: 350, y: 210, winkel: 0, tiefe: 1, phase: 0, kurve: 0.1, versatz: 0,
      zielX: 0, zielY: 0, warten: 0, farbe: 1, schreck: 0, fluchtWinkel: 0,
    }] }
    const { dichte: feld, farbe } = rastern(t, 100, 30, 7, 14)
    const belegt = feld.filter((v) => v > 0).length
    assert.ok(belegt > 20, `nur ${belegt} Zellen`)
    assert.ok(belegt < feld.length * 0.1, `${belegt} Zellen sind zu viel`)
    // Kopf liegt bei x=350 → Spalte 50, Zeile 15; dort ist es dicht.
    assert.ok(feld[15 * 100 + 48] > 0.5)
    assert.equal(farbe[15 * 100 + 48], 1)
    // Hinter dem Schwanz ist nichts mehr.
    // Die Schwanzflosse ist breit und schlägt aus — 60 px Luft dahinter.
    const hinterSchwanz = Math.floor((350 - koiLaenge(1) - 60) / 7)
    assert.equal(feld[15 * 100 + hinterSchwanz], 0)
  })

  test('ferne Koi sind blasser als nahe', () => {
    const koi = (tiefe) => ({ breite: 700, hoehe: 420, zeit: 0, wesen: [{
      art: 'koi', x: 350, y: 210, winkel: 0, tiefe, phase: 0, kurve: 0.1, versatz: 0,
      zielX: 0, zielY: 0, warten: 0, farbe: 0, schreck: 0, fluchtWinkel: 0,
    }] })
    const max = (f) => f.dichte.reduce((a, b) => Math.max(a, b), 0)
    assert.ok(max(rastern(koi(0.45), 100, 30, 7, 14)) < max(rastern(koi(1), 100, 30, 7, 14)))
  })

  test('Libelle besteht aus Leib und vier Flügeln', () => {
    const l = neuerTeich(800, 600, 'libelle', festerZufall(2)).wesen[0]
    assert.equal(kapseln(l).length, 5)
  })

  test('jede Art zeichnet im Fenster sichtbare Zeichen', () => {
    for (const art of ARTEN) {
      const t = neuerTeich(1400, 900, art, festerZufall(4))
      const { dichte } = rastern(t, 200, 65, 7, 14)
      assert.ok(dichte.some((v) => zeichenStufe(v) >= 3), `${art} hat kein dichtes Inneres`)
    }
  })
})

describe('Zeichen', () => {
  test('innen dicht, am Rand licht, draußen nichts', () => {
    assert.equal(zeichenStufe(0), -1)
    assert.equal(zeichenStufe(0.03), -1)
    assert.equal(ZEICHEN[zeichenStufe(0.06)], '.')
    assert.equal(ZEICHEN[zeichenStufe(1)], '@')
    // stufenlos: jede Stufe ist dichter als die vorige, keine fällt aus
    const stufen = Array.from({ length: 101 }, (_, i) => zeichenStufe(i / 100))
    for (let i = 1; i < stufen.length; i++) assert.ok(stufen[i] >= stufen[i - 1])
    assert.deepEqual([...new Set(stufen.filter((s) => s >= 0))], ZEICHEN.map((_, i) => i))
  })
})

describe('Proben je Zelle', () => {
  test('eine Probe in der Zellmitte ergibt genau rastern', () => {
    const t = neuerTeich(600, 400, 'koi', festerZufall(4))
    const ein = rasternProben(t, 100, 34, 6, 12, [{ x: 3, y: 6 }])
    const alt = rastern(t, 100, 34, 6, 12)
    assert.deepEqual(ein.proben, alt.dichte)
    assert.deepEqual(ein.farbe, alt.farbe)
  })

  test('sechs Proben: Mittel liegt zwischen kleinster und größter', () => {
    const t = neuerTeich(600, 400, 'qualle', festerZufall(9))
    const stellen = [1, 3, 5].flatMap((z) => [1, 3].map((s) => ({ x: 1.5 * s, y: 1.25 + 9.5 * z / 6 })))
    const { proben } = rasternProben(t, 100, 34, 6, 12, stellen)
    const mittel = zellMittel(proben, 6)
    assert.equal(mittel.length, 100 * 34)
    for (let i = 0; i < mittel.length; i++) {
      const teil = proben.slice(i * 6, i * 6 + 6)
      assert.ok(mittel[i] >= Math.min(...teil) - 1e-6 && mittel[i] <= Math.max(...teil) + 1e-6)
    }
    assert.ok(mittel.some((v) => v > 0.3), 'Qualle fehlt')
  })
})

describe('Licht von links oben', () => {
  const scheibe = () => {
    const d = new Float32Array(81 * 81)
    for (let z = 0; z < 81; z++) for (let c = 0; c < 81; c++) d[z * 81 + c] = Math.max(0, 1 - Math.hypot((c - 40) * 6, (z - 40) * 12) / 300)
    return d
  }

  test('die zum Licht gewandte Seite ist dichter als die abgewandte', () => {
    const d = scheibe()
    const h = beleuchten(d, 81, 81, 6, 12)
    const linksOben = 30 * 81 + 25, rechtsUnten = 50 * 81 + 55   // spiegelbildlich zur Mitte
    assert.ok(Math.abs(d[linksOben] - d[rechtsUnten]) < 1e-6, 'Feld nicht symmetrisch')
    assert.ok(h[linksOben] > d[linksOben] && h[rechtsUnten] < d[rechtsUnten], `${h[linksOben]} / ${h[rechtsUnten]}`)
  })

  test('was sichtbar war, bleibt sichtbar; Leere bleibt leer; die Mitte bleibt', () => {
    const d = scheibe()
    const h = beleuchten(d, 81, 81, 6, 12)
    for (let i = 0; i < d.length; i++) {
      if (zeichenStufe(d[i]) >= 0) assert.ok(zeichenStufe(h[i]) >= 0, `Zelle ${i} verschwindet`)
      else assert.equal(h[i], d[i])
      assert.ok(h[i] <= 1)
    }
    assert.ok(Math.abs(h[40 * 81 + 40] - d[40 * 81 + 40]) < 1e-6)
  })

  test('verändert das Eingabefeld nicht', () => {
    const d = scheibe()
    const kopie = Float32Array.from(d)
    beleuchten(d, 81, 81, 6, 12)
    assert.deepEqual(d, kopie)
  })
})
