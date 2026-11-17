#!/usr/bin/env node
// Produktionsprüfung, die NICHTS verändert.
//
// WARUM ES DIESE ZWEITE DATEI GIBT
// `smoke-api.mjs` legt Todos an, schreibt Briefings und stellt den Zustand
// hinterher wieder her. Als einmalige Abnahme ist das richtig. Als TÄGLICHER
// Lauf gegen Produktion ist es gefährlich: schreibt Hermes im selben Moment
// ein echtes Briefing, macht das Zurückstellen es wieder kaputt — und zwar
// unbemerkt, weil der Test ja "grün" meldet. Ein Wächter, der den Patienten
// verletzt, um seinen Puls zu messen, ist kein Wächter.
//
// Deshalb hier ausschliesslich GET. Keine Anthropic-Aufrufe (die kosten Geld),
// kein Hermes-Chat (der weckt ein Modell). Was diese Datei prüft, ist genau
// das, was morgens kaputt sein kann, ohne dass es jemand merkt.
//
// Aufruf:  node scripts/smoke-readonly.mjs [--url http://…] [--json]
// Exit 0 = alles gut, 1 = mindestens eine Prüfung rot.

import { readFileSync } from 'node:fs'

const ENV_FILE = '/etc/daily/env'
const TIMEOUT_MS = 15_000
const MIN_BRAIN_CHARS = 200

let envFile = ''
try { envFile = readFileSync(ENV_FILE, 'utf-8') } catch { /* nicht auf der VM */ }

function conf(name) {
  const v = process.env[name]
  if (v && v.trim()) return v.trim()
  const m = envFile.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim() : undefined
}

function argUrl() {
  const i = process.argv.indexOf('--url')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  const port = conf('PORT') || '4861'
  const host = conf('DAILY_HOST')
  if (host && host !== '127.0.0.1' && host !== 'localhost') return `http://${host}:${port}`
  return `http://127.0.0.1:${port}`
}

const BASE = argUrl().replace(/\/+$/, '')
const USER = conf('AUTH_USER') || 'paul'
const PASS = conf('AUTH_PASS')
const TOKEN = conf('HERMES_TOKEN')
const BASIC = PASS ? 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64') : null
const BEARER = TOKEN ? 'Bearer ' + TOKEN : null
const ALS_JSON = process.argv.includes('--json')

async function get(pfad, auth) {
  const headers = {}
  if (auth === 'basic' && BASIC) headers.Authorization = BASIC
  if (auth === 'bearer' && BEARER) headers.Authorization = BEARER
  return fetch(BASE + pfad, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

function expect(cond, msg) { if (!cond) throw new Error(msg) }

const PRUEFUNGEN = [
  {
    name: 'ping',
    async run() {
      const r = await get('/api/hermes/ping', 'bearer')
      expect(r.status === 200, `Status ${r.status}`)
      return 'Dienst antwortet'
    },
  },
  {
    name: 'state-parsebar',
    async run() {
      const r = await get('/api/state', 'basic')
      expect(r.ok, `Status ${r.status}`)
      const text = await r.text()
      const doc = JSON.parse(text)   // über die GANZE Antwort, nicht abgeschnitten
      const n = Object.keys(doc.localStorage ?? {}).length
      expect(n > 0, 'localStorage ist leer — das wäre Datenverlust')
      return `${Math.round(text.length / 1024)} KB, ${n} Schlüssel`
    },
  },
  {
    name: 'health',
    async run() {
      const r = await get('/api/health', 'basic')
      const h = await r.json()
      expect(r.status === 200, `Status ${r.status} (${h.status}) — Zustand lesbar: ${h.state?.readable}`)
      expect(h.state?.readable === true, 'Zustand ist nicht lesbar')
      return `${h.status}, ${h.state.keys} Schlüssel, Kalender ${h.sources.calendar ? '✓' : '—'}, Brain ${h.sources.brain ? '✓' : '—'}`
    },
  },
  {
    name: 'briefing-status',
    async run() {
      const r = await get('/api/briefing/status', 'basic')
      const s = await r.json()
      expect(s.state !== 'error', `Zustand nicht lesbar: ${s.reason}`)
      // "missing" ist KEIN Fehler — an manchen Tagen schreibt Hermes nichts.
      // Gemeldet wird es trotzdem, damit es im Journal sichtbar ist.
      if (s.state === 'missing') return 'kein Briefing hinterlegt (kein Fehler)'
      expect(s.serverDate, 'serverDate fehlt')
      const alt = s.state === 'stale' ? ` — ⚠ datiert auf ${s.briefingDate}` : ''
      return `${s.state}, Revision ${s.revision?.slice(0, 12)}…, anzeigbar: ${s.eligibleNow}` +
             `, gerendert: ${s.renderedAt ? 'ja' : 'nein'}${alt}`
    },
  },
  {
    name: 'briefing-heute-anzeigbar',
    async run() {
      const r = await get('/api/briefing/status', 'basic')
      const s = await r.json()
      if (s.state === 'missing') return 'übersprungen — kein Briefing'
      // DAS ist die Prüfung, die den Fehler vom 15.08. gefangen hätte:
      // gespeichert, aber nicht anzeigbar, weil falsch datiert.
      expect(s.eligibleNow === true,
        `Briefing ist auf ${s.briefingDate} datiert, Server steht auf ${s.serverDate} — es ist gespeichert, aber UNSICHTBAR.`)
      return `auf ${s.briefingDate} datiert, anzeigbar`
    },
  },
  {
    name: 'kalender',
    async run() {
      const r = await get('/api/calendar/upcoming', 'basic')
      expect(r.ok, `Status ${r.status}`)
      const v = await r.json()
      expect(Array.isArray(v), 'kein Array')
      return `${v.length} Termine im Horizont`
    },
  },
  {
    name: 'brain',
    async run() {
      const r = await get('/api/brain', 'basic')
      expect(r.ok, `Status ${r.status}`)
      const b = await r.json()
      expect(b.ok === true, `ok=${b.ok}`)
      const laenge = (b.text ?? '').length
      expect(laenge > MIN_BRAIN_CHARS, `nur ${laenge} Zeichen`)
      return `${laenge} Zeichen`
    },
  },
  {
    // „brain“ oben prüft nur, OB das Brain lesbar ist. Steht die stündliche
    // Spiegelung, bleibt es lesbar — nur eben mit altem Stand, und alles
    // sieht weiter grün aus. Hermes schreibt täglich; 48 Stunden ohne neuen
    // Stand heisst, dass irgendwo in der Kette etwas steht.
    name: 'brain-frisch',
    async run() {
      const r = await get('/api/brain/stand', 'basic')
      expect(r.ok, `Status ${r.status}`)
      const f = await r.json()
      expect(f.ok === true, 'kein Brain gefunden')
      const alterH = (Date.now() - Date.parse(f.updatedAt)) / 3_600_000
      const grenze = Number(process.env.BRAIN_MAX_AGE_H || 48)
      expect(alterH <= grenze, `letzte Änderung vor ${Math.round(alterH)} h (Grenze ${grenze} h) — Spiegelung oder Hermes-Lauf steht?`)
      const log = f.lastLog ? `, letzter Log ${f.lastLog.date}` : ''
      return `vor ${Math.round(alterH)} h geändert, ${f.pages} Seiten${log}`
    },
  },
]

const ergebnisse = []
for (const p of PRUEFUNGEN) {
  try {
    const info = await p.run()
    ergebnisse.push({ name: p.name, ok: true, info })
  } catch (e) {
    ergebnisse.push({ name: p.name, ok: false, info: e.message })
  }
}

const rot = ergebnisse.filter((r) => !r.ok)

if (ALS_JSON) {
  console.log(JSON.stringify({
    ok: rot.length === 0,
    base: BASE,
    at: new Date().toISOString(),
    checks: ergebnisse,
  }))
} else {
  console.log('')
  console.log(`  Daily read-only Prüfung — ${BASE}`)
  console.log('')
  const breite = Math.max(...ergebnisse.map((r) => r.name.length))
  for (const r of ergebnisse) {
    console.log(`  ${r.ok ? '✓' : '✖'} ${r.name.padEnd(breite)}  ${r.info}`)
  }
  console.log('')
  console.log(rot.length === 0
    ? `  ✓ Alle ${ergebnisse.length} Prüfungen bestanden. Nichts verändert.`
    : `  ✖ ${rot.length} von ${ergebnisse.length} fehlgeschlagen.`)
  console.log('')
}

process.exit(rot.length === 0 ? 0 : 1)
