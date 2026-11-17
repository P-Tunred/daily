// Die Ähnlichkeitsregel — der Teil, der still Schaden anrichten kann.
//
// WARUM ALS EIGENER TEST
// Wirft die Regel zu viel zusammen, verschluckt sie echte Aufgaben — und das
// fällt NIEMANDEM auf, weil der Vorschlag ja nie erscheint. Genau deshalb steht
// hier beides: was zusammengehört UND was getrennt bleiben muss. Die zweite
// Hälfte ist die wichtigere.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { aehnlich, GLEICH_AB } = require('../electron/dedupCheck.cjs')

const gleich = (a, b) => aehnlich(a, b) >= GLEICH_AB

describe('Dubletten erkennen', () => {
  test('gleiche Sache, andere Wortstellung', () => {
    assert.ok(gleich('Stockholm: Adresse melden', 'Adresse in Stockholm melden'))
  })
  test('gleiche Sache mit Füllwort', () => {
    assert.ok(gleich('Finnair: Zusatzgepäck buchen', 'Finnair Zusatzgepäck jetzt buchen'))
  })
  test('gleiche Sache, eine Fassung ausführlicher', () => {
    assert.ok(gleich('GRNVS-Note prüfen', 'GRNVS Note in TUMonline prüfen'))
  })
  test('Beträge und Daten stören nicht', () => {
    assert.ok(gleich('Allihoop: Lastschrift prüfen', 'Allihoop Lastschrift 700,95 € am 27.07. prüfen'))
  })
})

describe('Verschiedenes bleibt getrennt — der teure Fehler', () => {
  const paare = [
    ['Vertrag unterschreiben', 'Schlüsselübergabe klären'],
    ['Allihoop: Lastschrift prüfen', 'Allihoop: Konkurs-Infos lesen'],
    ['Stockholm: Adresse melden', 'Stockholm: Wohnung suchen'],
    ['Wise: E-Mail bestätigen', 'Wise: Konto eröffnen'],
    ['GRNVS: Note prüfen', 'GRNVS: Einwendung schreiben'],
  ]
  for (const [a, b] of paare) {
    test(`"${a}" ≠ "${b}"`, () => {
      assert.ok(!gleich(a, b), `wurden zusammengeworfen (${aehnlich(a, b).toFixed(2)})`)
    })
  }
})

describe('Randfälle', () => {
  test('leere Titel werfen nichts zusammen', () => {
    assert.equal(aehnlich('', 'irgendwas'), 0)
    assert.equal(aehnlich('', ''), 0)
  })
  test('ein einzelnes gemeinsames Wort reicht NICHT', () => {
    // Sonst würde "Allihoop" allein schon alles zum Thema zusammenziehen.
    assert.ok(!gleich('Allihoop', 'Allihoop Konkurs'))
  })
})

describe('Brain-Abgleich — nur bei erkennbarem Erledigt-Vermerk', () => {
  const { anteilImText, BRAIN_AB } = require('../electron/dedupCheck.cjs')
  const zeile = '- Zwischenvermietung: Antrag beim Studierendenwerk eingereicht und unterschrieben zurück (Stand: 2026-08-12)'

  test('Titel steckt in der Wiki-Zeile', () => {
    assert.ok(anteilImText('Zwischenvermietung: Antrag einreichen', zeile) >= BRAIN_AB)
  })
  test('nur ein gemeinsames Themenwort reicht NICHT', () => {
    // Sonst würde jede Zeile mit "Stockholm" jede Stockholm-Aufgabe schlucken.
    assert.ok(anteilImText('Stockholm: Adresse melden', '- Stockholm: Wohnung gefunden (Stand: 2026-08-01)') < BRAIN_AB)
  })
  test('leerer Titel trifft nie', () => {
    assert.equal(anteilImText('', zeile), 0)
  })
})
