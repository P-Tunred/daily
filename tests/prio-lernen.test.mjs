// Das Prioritäten-Lernen und die Empfehlungen daraus.
//
// Beides ist reine Rechnung — und gerade deshalb leicht still zu verbiegen:
// ein vertauschtes Vorzeichen, und Daily empfiehlt genau das zum Streichen,
// was Paul am liebsten erledigt.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  baueModell, bewerte, grundSatz, signalAus, stichwoerter, quelleVon, profil, profilText, mitSignal, MAX_SIGNALE,
} from '../src/lib/prioLernen.ts'
import { empfehle, ruht, isoWochentag } from '../src/lib/empfehlung.ts'

const TAG = 86_400_000
const JETZT = new Date('2026-10-30T10:00:00').getTime() // ein Freitag
const HEUTE = '2026-10-30'

const aufgabe = (id, text, extra = {}) => ({ id, text, done: false, createdAt: JETZT - TAG, ...extra })
const viele = (n, t, art, alter = 1) => Array.from({ length: n }, (_, i) => signalAus(t, art, { ts: JETZT - (alter + i) * TAG }))

describe('Stichwörter und Herkunft', () => {
  test('Füllwörter und kurze Wörter fallen raus', () => {
    assert.deepEqual(stichwoerter('Mail an die Uni wegen Prüfung schreiben'), ['mail', 'prüfung', 'schreiben'])
  })
  test('Herkunft aus den Spuren der Aufgabe', () => {
    assert.equal(quelleVon({ id: 'local-1' }), 'selbst')
    assert.equal(quelleVon({ id: 'h-7' }), 'hermes')
    assert.equal(quelleVon({ id: 'x', ausTermin: 'ev1' }), 'termin')
  })
})

describe('Modell', () => {
  const uni = aufgabe('local-a', 'Übungsblatt Analysis', { category: 'uni' })
  const privat = aufgabe('local-b', 'Steuererklärung sortieren', { category: 'privat' })

  test('ohne Signale weiss es nichts', () => {
    const b = bewerte(uni, baueModell([], JETZT))
    assert.equal(b.wert, 0)
    assert.equal(b.grund, null)
  })

  test('erledigt macht wichtig, gelöscht unwichtig', () => {
    const m = baueModell([...viele(5, uni, 'erledigt'), ...viele(5, privat, 'geloescht')], JETZT)
    assert.ok(bewerte(aufgabe('local-c', 'Tutorium vorbereiten', { category: 'uni' }), m).wert > 0.3)
    assert.ok(bewerte(aufgabe('local-d', 'Keller aufräumen', { category: 'privat' }), m).wert < -0.3)
  })

  test('alte Signale zählen weniger als frische', () => {
    const alt = baueModell(viele(4, uni, 'geloescht', 200), JETZT)
    const frisch = baueModell(viele(4, uni, 'geloescht', 1), JETZT)
    const k = 'kat:uni'
    assert.ok(alt.merkmale.get(k).evidenz < frisch.merkmale.get(k).evidenz)
  })

  test('abgelehntes "streichen?" zählt FÜR die Aufgabe', () => {
    const m = baueModell(viele(4, privat, 'vorschlagNein').map(s => ({ ...s, empfehlung: 'streichen' })), JETZT)
    assert.ok(m.merkmale.get('kat:privat').gewicht > 0)
  })

  test('„selbst eingetragen" ist nie die Begründung', () => {
    const m = baueModell(viele(6, aufgabe('local-q', 'Irgendwas'), 'erledigt'), JETZT)
    const b = bewerte(aufgabe('local-r', 'Etwas anderes'), m)
    assert.ok(b.wert > 0)
    assert.equal(grundSatz(b), null)
  })

  test('Profil nennt Wichtiges und Unwichtiges mit Belegen', () => {
    const m = baueModell([...viele(5, uni, 'erledigt'), ...viele(5, privat, 'geloescht')], JETZT)
    const p = profil(m)
    assert.ok(p.wichtig.some(z => z.name === 'Uni' && /5× erledigt/.test(z.belege)))
    assert.ok(p.unwichtig.some(z => z.name === 'Privat'))
    assert.match(profilText(m), /Wichtig für Paul: .*Uni/)
  })

  test('die Signalliste bleibt gekappt', () => {
    let l = []
    for (let i = 0; i < MAX_SIGNALE + 20; i++) l = mitSignal(l, signalAus(uni, 'erledigt', { ts: i }))
    assert.equal(l.length, MAX_SIGNALE)
    assert.equal(l[0].ts, 20)
  })
})

describe('Empfehlungen', () => {
  const leer = baueModell([], JETZT)

  test('für heute Geplantes aus der Woche soll rein', () => {
    const t = aufgabe('local-w', 'Bericht', { scope: 'week', plannedDay: isoWochentag(HEUTE) })
    const e = empfehle([t], leer, { heute: HEUTE, jetzt: JETZT })
    assert.equal(e[0].art, 'heute')
    assert.match(e[0].grund, /geplant/)
  })

  test('erst nächste Woche dran → kein Vorschlag', () => {
    const t = aufgabe('local-w', 'Bericht', { scope: 'week', geplantAm: '2026-11-12' })
    assert.deepEqual(empfehle([t], leer, { heute: HEUTE, jetzt: JETZT }), [])
  })

  test('was Paul oft löscht und lange wartet, darf weg', () => {
    const vorbild = aufgabe('local-x', 'Newsletter lesen', { category: 'sonstiges' })
    const m = baueModell(viele(6, vorbild, 'geloescht'), JETZT)
    const t = aufgabe('local-y', 'Newsletter abbestellen', { scope: 'week', category: 'sonstiges', createdAt: JETZT - 10 * TAG })
    const e = empfehle([t], m, { heute: HEUTE, jetzt: JETZT })
    assert.equal(e[0]?.art, 'streichen')
  })

  test('eine Aufgabe, die seit Tagen mitläuft, soll zurück in die Woche', () => {
    const t = aufgabe('local-z', 'Fahrrad reparieren', { verschoben: 4 })
    const e = empfehle([t], leer, { heute: HEUTE, jetzt: JETZT })
    assert.equal(e[0].art, 'woche')
  })

  test('ein Nein ruht — "heute" drei Tage, "streichen" für immer', () => {
    assert.equal(ruht({ 'a:heute': '2026-10-29' }, 'a', 'heute', HEUTE), true)
    assert.equal(ruht({ 'a:heute': '2026-10-20' }, 'a', 'heute', HEUTE), false)
    assert.equal(ruht({ 'a:streichen': '2026-01-01' }, 'a', 'streichen', HEUTE), true)
    const t = aufgabe('local-w', 'Bericht', { scope: 'week', plannedDay: isoWochentag(HEUTE) })
    assert.deepEqual(empfehle([t], leer, { heute: HEUTE, jetzt: JETZT, abgelehnt: { 'local-w:heute': HEUTE } }), [])
  })

  test('ein voller Tag bekommt nur noch Fälliges dazu', () => {
    const vorbild = aufgabe('local-v', 'Klausur lernen', { category: 'lern' })
    const m = baueModell(viele(6, vorbild, 'erledigt'), JETZT)
    const tag = Array.from({ length: 7 }, (_, i) => aufgabe(`local-t${i}`, `Aufgabe ${i}`))
    const kandidat = aufgabe('local-k', 'Klausur wiederholen', { scope: 'week', category: 'lern', priority: 'wichtig' })
    assert.ok(!empfehle([...tag, kandidat], m, { heute: HEUTE, jetzt: JETZT }).some(e => e.id === 'local-k'))
    assert.ok(empfehle([kandidat], m, { heute: HEUTE, jetzt: JETZT }).some(e => e.id === 'local-k' && e.art === 'heute'))
  })

  test('Routinen und Erledigtes werden nie empfohlen', () => {
    const r = { id: 'routine:2026-10-30:stretch', text: 'Dehnen', done: false, scope: 'day', verschoben: 9 }
    const d = aufgabe('local-d', 'fertig', { done: true, verschoben: 9 })
    assert.deepEqual(empfehle([r, d], leer, { heute: HEUTE, jetzt: JETZT }), [])
  })
})
