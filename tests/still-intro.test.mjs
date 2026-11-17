// Still-Intro: wie der Satz des Tages geteilt wird und was ohne Hermes oben
// steht. Der Satz ist das Erste, was Paul morgens liest — ein falsch
// geschnittener Nachsatz oder ein leerer Platz fiele sofort auf.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { teileSatz, lokalerSatz, urteil, zielHinweisText } from '../src/lib/stillIntro.ts'

describe('teileSatz', () => {
  test('erster Satz trägt, der Rest wird Nachsatz', () => {
    assert.deepEqual(
      teileSatz('Statistik zuerst, solange der Kopf frisch ist. Der Rest ist Kleinkram.'),
      { satz: 'Statistik zuerst, solange der Kopf frisch ist.', nachsatz: 'Der Rest ist Kleinkram.' },
    )
  })
  test('ein einzelner Satz bleibt ganz, ohne Nachsatz', () => {
    assert.deepEqual(teileSatz('Okay — nur das hier musst du heute machen.'), {
      satz: 'Okay — nur das hier musst du heute machen.', nachsatz: '',
    })
  })
  test('Satz ohne Schlusszeichen bleibt ganz', () => {
    assert.deepEqual(teileSatz('  Heute frei  '), { satz: 'Heute frei', nachsatz: '' })
  })
  test('Frage und Ausruf trennen ebenfalls; alles danach bleibt zusammen', () => {
    assert.deepEqual(teileSatz('Klausur Freitag! Heute Kapitel 4. Morgen 5.'), {
      satz: 'Klausur Freitag!', nachsatz: 'Heute Kapitel 4. Morgen 5.',
    })
  })
})

describe('lokalerSatz', () => {
  test('offene Aufgaben → „nur das hier"', () => {
    assert.match(lokalerSatz(3, 0), /^Nur das hier/)
  })
  test('nichts heute, aber Woche → Hinweis auf die Woche', () => {
    assert.match(lokalerSatz(0, 2), /Woche/)
  })
  test('ganz leer → freier Tag', () => {
    assert.equal(lokalerSatz(0, 0), 'Nichts Festes heute. Mach draus, was du willst.')
  })
})

describe('urteil', () => {
  test('Score 0 ohne Lernzeit → noch nichts', () => {
    assert.equal(urteil(0, 0), 'Noch nichts eingetragen.')
  })
  test('Score 0, aber gelernt → ein Anfang', () => {
    assert.equal(urteil(0, 10), 'Ein Anfang.')
  })
  test('Stufen an den Grenzen', () => {
    assert.equal(urteil(30, 0), 'Halb drin.')
    assert.equal(urteil(55, 0), 'Gut unterwegs.')
    assert.equal(urteil(80, 0), 'Gut unterwegs.')
    assert.equal(urteil(85, 0), 'Reicht für heute.')
  })
})

describe('zielHinweisText', () => {
  test('mit Teilen', () => {
    assert.equal(
      zielHinweisText('1 h', '2 h', ['Statistik: 1 h']),
      'Ziel heute 1 h, von 2 h verfügbar. Aus: Statistik: 1 h.',
    )
  })
  test('ohne Teile kein „Aus:"', () => {
    assert.equal(zielHinweisText('1 h', '2 h', []), 'Ziel heute 1 h, von 2 h verfügbar.')
  })
})
