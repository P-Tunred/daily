#!/usr/bin/env node
// Einmalig: Tage, deren Score mit veralteter Lernzeit festgehalten wurde, mit
// der gemessenen Lernzeit neu rechnen.
//
// WARUM
// Bis 2026-10-27 hielt nur das offene Dashboard den Score fest, und der
// Tracker las Sitzungen von anderen Geräten nicht nach (behoben in
// hooks/useScoreSnapshot.ts und tracker/store.tsx). An 9 der letzten 40 Tage
// steht deshalb zu wenig Lernzeit im Verlauf — am 26.10. 0 min bei 367.
//
// WAS ES TUT — UND WAS NICHT
// Nur Tage mit Gewichten (ab 13.10.), nur nach oben (gemessen > festgehalten),
// nur abgeschlossene Tage. Aufgaben und Abzug bleiben, wie festgehalten — die
// erledigten Todos sind um 02:00 weggeräumt und lassen sich nicht nachzählen.
// Tage mit MEHR Lernzeit im Verlauf als an Sitzungen gespeichert werden nur
// aufgelistet: dort sind womöglich Sitzungen verloren gegangen, und welche
// Seite stimmt, lässt sich von hier aus nicht entscheiden.
//
// WIE
// Über die normale API: GET /api/state, rechnen, PUT /api/state mit
// `baseUpdatedAt`. Bei 409 bricht es ab, statt fremde Änderungen zu
// überschreiben. Geändert wird nur `morning.scoreHistory`.
//
// Aufruf auf der VM:
//   node --experimental-strip-types scripts/score-lernzeit-nachrechnen.mjs           # Probelauf
//   node --experimental-strip-types scripts/score-lernzeit-nachrechnen.mjs --apply   # schreiben

import { readFileSync } from 'node:fs'
import { routineHakenAm } from '../src/lib/bewusst.ts'
import { mitGemessenerLernzeit } from '../src/lib/scoreSnapshot.ts'

const SCHREIBEN = process.argv.includes('--apply')
/** Rundungsrauschen und eine laufende Sitzung beim Festhalten — darunter
 *  wird nichts angefasst. */
const TOLERANZ_MIN = 5

let envFile = ''
try { envFile = readFileSync('/etc/daily/env', 'utf-8') } catch { /* nicht auf der VM */ }
const conf = (name) => {
  const v = process.env[name]
  if (v && v.trim()) return v.trim()
  const m = envFile.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim() : undefined
}
const urlArg = process.argv.indexOf('--url')
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : `http://127.0.0.1:${conf('PORT') || '4861'}`).replace(/\/+$/, '')
const PASS = conf('AUTH_PASS')
const AUTH = PASS ? { Authorization: 'Basic ' + Buffer.from(`${conf('AUTH_USER') || 'paul'}:${PASS}`).toString('base64') } : {}

function heuteBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

const res = await fetch(BASE + '/api/state', { headers: AUTH, signal: AbortSignal.timeout(15000) })
if (!res.ok) { console.error(`✖ GET /api/state: ${res.status}`); process.exit(1) }
const state = await res.json()
const ls = state.localStorage ?? {}
const verlauf = JSON.parse(ls['morning.scoreHistory'] ?? '{}')
const sitzungen = JSON.parse(ls['morning.tracker.sessions'] ?? '[]')
const bewusst = JSON.parse(ls['morning.bewusst.v1'] ?? 'null')
if (!Array.isArray(sitzungen)) { console.error('✖ Sitzungen nicht lesbar — nichts gerechnet.'); process.exit(1) }

const gemessen = {}
for (const s of sitzungen) {
  if (s && typeof s.date === 'string' && Number.isFinite(s.durationMin)) gemessen[s.date] = (gemessen[s.date] ?? 0) + s.durationMin
}

// Heute hält die App selbst fest — hier nur abgeschlossene Tage.
const heute = heuteBerlin()
const neu = { ...verlauf }
const geaendert = []
const zeilen = []
const fraglich = []
for (const tag of Object.keys(verlauf).sort()) {
  if (tag >= heute) continue
  const alt = verlauf[tag]
  const min = gemessen[tag] ?? 0
  if (alt.studyMin > min + TOLERANZ_MIN) { fraglich.push(`  ${tag}  Verlauf ${alt.studyMin} min, gespeichert ${min} min`); continue }
  if (alt.studyMin + TOLERANZ_MIN >= min) continue
  const haken = bewusst ? routineHakenAm(bewusst, tag) : (alt.routineHaken ?? 0)
  const gerechnet = mitGemessenerLernzeit(alt, min, haken)
  if (!gerechnet) { zeilen.push(`  ${tag}  ${String(alt.score).padStart(3)}  —  ${alt.studyMin} → ${min} min, ohne Gewichte: bleibt`); continue }
  neu[tag] = gerechnet
  geaendert.push(tag)
  zeilen.push(`  ${tag}  ${String(alt.score).padStart(3)} → ${String(gerechnet.score).padStart(3)}   Lernzeit ${alt.studyMin} → ${min} min`)
}

console.log('')
console.log(`  Score mit gemessener Lernzeit nachrechnen (${SCHREIBEN ? 'SCHREIBT' : 'Probelauf'})`)
console.log('')
for (const z of zeilen.length ? zeilen : ['  Nichts zu tun.']) console.log(z)
if (fraglich.length) {
  console.log('')
  console.log('  Nicht angefasst — im Verlauf MEHR Lernzeit als an Sitzungen gespeichert:')
  for (const z of fraglich) console.log(z)
}
console.log('')

if (!SCHREIBEN || geaendert.length === 0) { if (!SCHREIBEN) console.log('  Nichts geschrieben. Mit --apply übernehmen.'); process.exit(0) }

const put = await fetch(BASE + '/api/state', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...AUTH },
  body: JSON.stringify({
    baseUpdatedAt: state.updatedAt,
    localStorage: { ...ls, 'morning.scoreHistory': JSON.stringify(neu) },
    indexedDB: state.indexedDB,
  }),
  signal: AbortSignal.timeout(15000),
})
if (put.status === 409) { console.error('✖ Zwischendurch geändert (409) — nichts überschrieben. Bitte erneut starten.'); process.exit(1) }
if (!put.ok) { console.error(`✖ PUT /api/state: ${put.status}`); process.exit(1) }

// Prüfen statt glauben: zurücklesen und vergleichen.
const zurueck = await (await fetch(BASE + '/api/state', { headers: AUTH })).json()
const gelesen = JSON.parse(zurueck.localStorage['morning.scoreHistory'] ?? '{}')
const falsch = geaendert.filter((t) => gelesen[t]?.score !== neu[t].score || gelesen[t]?.studyMin !== neu[t].studyMin)
if (falsch.length) { console.error(`✖ Rücklesen weicht ab: ${falsch.join(', ')}`); process.exit(1) }
console.log(`  ✓ ${geaendert.length} Tag(e) geschrieben und zurückgelesen (Stand ${zurueck.updatedAt}).`)
