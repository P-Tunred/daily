#!/usr/bin/env node
// Einmalig: die Tage seit dem 13.10.2026 mit Routine-Bonus neu rechnen.
//
// WARUM
// Pauls Entscheidung vom 2026-10-22: Routinen und Gym zählen ab jetzt in den
// Tagesscore, je +2 (src/lib/dayScore.ts, ROUTINE_BONUS) — und zwar
// rückwirkend ab dem 13.10. Ab diesem Tag speichert der Verlauf Gewichte und
// ungedeckelten Abzug; damit lässt sich jeder Tag EXAKT neu rechnen. Ältere
// Tage bleiben bei der alten Formel und sind im Verlauf daran erkennbar, dass
// ihnen `v: 2` fehlt.
//
// WIE
// Über die normale API, nicht an der Datei vorbei: GET /api/state, rechnen,
// PUT /api/state mit `baseUpdatedAt`. Hat zwischendurch jemand geschrieben,
// kommt 409 und das Skript bricht ab, statt fremde Änderungen zu überschreiben
// — dann einfach erneut starten. Geändert wird nur `morning.scoreHistory`.
//
// Aufruf auf der VM:
//   node --experimental-strip-types scripts/routinebonus-nachrechnen.mjs           # Probelauf
//   node --experimental-strip-types scripts/routinebonus-nachrechnen.mjs --apply   # schreiben

import { readFileSync } from 'node:fs'
import { routineHakenAm } from '../src/lib/bewusst.ts'
import { mitRoutineBonus } from '../src/lib/gestern.ts'

const AB = '2026-10-13'
const SCHREIBEN = process.argv.includes('--apply')

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
const bewusst = JSON.parse(ls['morning.bewusst.v1'] ?? 'null')
if (!bewusst || typeof bewusst !== 'object') { console.error('✖ Kein lesbarer Bewusst-Stand — nichts gerechnet.'); process.exit(1) }

// Heute schreibt die App selbst mit — hier nur abgeschlossene Tage.
const heute = heuteBerlin()
const neu = { ...verlauf }
const zeilen = []
for (const tag of Object.keys(verlauf).sort()) {
  if (tag < AB || tag >= heute) continue
  const alt = verlauf[tag]
  const haken = routineHakenAm(bewusst, tag)
  const gerechnet = mitRoutineBonus(alt, haken)
  if (!gerechnet) { zeilen.push(`  ${tag}  ${String(alt.score).padStart(3)}  —  ohne Gewichte, bleibt alte Formel`); continue }
  neu[tag] = gerechnet
  const diff = gerechnet.score - alt.score
  zeilen.push(`  ${tag}  ${String(alt.score).padStart(3)} → ${String(gerechnet.score).padStart(3)}  (${diff >= 0 ? '+' : ''}${diff})  ${haken} Haken`)
}

console.log('')
console.log(`  Routine-Bonus nachrechnen — ab ${AB}, bis gestern (${SCHREIBEN ? 'SCHREIBT' : 'Probelauf'})`)
console.log('')
console.log('  Tag         alt   neu')
for (const z of zeilen) console.log(z)
console.log('')

if (!SCHREIBEN) { console.log('  Nichts geschrieben. Mit --apply übernehmen.'); process.exit(0) }

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
const falsch = Object.keys(neu).filter((t) => t >= AB && t < heute && gelesen[t]?.score !== neu[t].score)
if (falsch.length) { console.error(`✖ Rücklesen weicht ab: ${falsch.join(', ')}`); process.exit(1) }
console.log(`  ✓ Geschrieben und zurückgelesen (Stand ${zurueck.updatedAt}).`)
