// Was Daily an Hermes ZURUECKGEWIESEN hat — und zwar sichtbar.
//
// WARUM ES DAS BRAUCHT
// Am 1.9. um 06:06 hat Daily zweimal einen Vorschlag abgelehnt (die Kennung
// trug das Praefix "event:" statt "cal:"). Um 06:07 meldete Hermes' Auftrag
// `last_status: ok, last_error: None`. Die Karte zeigte danach einen Vorschlag
// statt zwei. Niemand hat je davon erfahren.
//
// Das ist kein Einzelfall, sondern die Bauart: Hermes' Erfolgskriterium ist
// "der Agent ist fertig geworden", nicht "Daily hat die Daten angenommen". Ein
// 400er aendert an seinem Auftragsstatus nichts. Solange das so ist, muss die
// andere Seite Buch fuehren — sonst faellt ein Datenverlust erst auf, wenn
// jemand zufaellig ins Journal sieht.
//
// WAS HIER BEWUSST NICHT PASSIERT
// Die Ablehnung wird nicht abgeschwaecht. Eine Wache, die nachgibt, weil das
// Melden unbequem ist, waere keine Wache. Hier wird nur MITGESCHRIEBEN.

const fs = require('fs')
const path = require('path')
const { dataPath } = require('./dataDir.cjs')

const PFAD = dataPath('hermes-rejects.json')
// Genug, um ein Muster zu erkennen ("dreimal dieselbe Kennung"), wenig genug,
// dass die Datei nicht waechst. Aeltere Eintraege sind ohnehin wertlos: was
// vor zwei Wochen abgelehnt wurde, ist entweder behoben oder taeglich sichtbar.
const MAX = 60
const ZONE = 'Europe/Berlin'

function heute() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function lies() {
  try {
    const d = JSON.parse(fs.readFileSync(PFAD, 'utf-8'))
    return Array.isArray(d.eintraege) ? d : { eintraege: [] }
  } catch {
    return { eintraege: [] }
  }
}

function schreibe(doc) {
  try {
    fs.mkdirSync(path.dirname(PFAD), { recursive: true })
    const tmp = PFAD + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
    fs.renameSync(tmp, PFAD)
  } catch (e) {
    // Buchfuehrung darf die Antwort nie kippen — sonst waere die Wache selbst
    // der Grund, warum ein Aufruf scheitert.
    console.warn('[abgelehnt] konnte nicht mitgeschrieben werden:', e.message)
  }
}

/** Eine Zurueckweisung festhalten. Wird aus hermesApi.json() gerufen, sobald
 *  eine Antwort 400 oder hoeher traegt. */
function merke(route, status, nachricht) {
  const doc = lies()
  doc.eintraege.unshift({
    route: String(route || '?'),
    status: Number(status) || 0,
    // Die Meldungen sind teils lange Erklaerungen. Der Anfang genuegt, um sie
    // zu unterscheiden — der volle Text steht ohnehin im Journal.
    nachricht: String(nachricht || '').replace(/\s+/g, ' ').slice(0, 220),
    tag: heute(),
    um: new Date().toISOString(),
  })
  if (doc.eintraege.length > MAX) doc.eintraege.length = MAX
  schreibe(doc)
}

/** Lage der letzten 24 Stunden. `zuletzt` ist der jüngste Eintrag, damit die
 *  Oberfläche etwas Konkretes zeigen kann statt nur einer Zahl — "3 Ablehnungen"
 *  sagt nichts, "Kennung ohne bekanntes Präfix" sagt, wo man hinsieht. */
function zustand() {
  const eintraege = lies().eintraege
  const grenze = Date.now() - 24 * 3600 * 1000
  const jung = eintraege.filter((e) => Date.parse(e.um) >= grenze)
  return {
    abgelehnt24h: jung.length,
    zuletzt: eintraege[0] ?? null,
    // Nach Route gruppiert: drei Ablehnungen auf /suggestions sind ein anderes
    // Problem als je eine auf drei verschiedenen Wegen.
    proRoute: jung.reduce((acc, e) => ({ ...acc, [e.route]: (acc[e.route] ?? 0) + 1 }), {}),
    eintraege: jung.slice(0, 12),
  }
}

module.exports = { merke, zustand, PFAD, MAX }
