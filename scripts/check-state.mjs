#!/usr/bin/env node
// Zählt nach, was im Zustand auf der Platte steht — und vergleicht es mit dem
// neuesten Backup aus Google Drive. Die Dateigröße allein sagt nichts; erst
// gleiche Zahlen auf beiden Seiten heißen "nichts verloren".
//
// Aufruf:  node ~/morning-dashboard/scripts/check-state.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { dataPath, dataDir } = require('../electron/dataDir.cjs')

// ── Zustand laden ───────────────────────────────────────────────────────────
const statePath = dataPath('state.json')
if (!existsSync(statePath)) {
  console.error('Kein state.json unter', statePath)
  console.error('Daily einmal starten — beim ersten Start wird er angelegt.')
  process.exit(1)
}
const state = JSON.parse(readFileSync(statePath, 'utf-8'))

// ── Neuestes Backup in Drive suchen ─────────────────────────────────────────
function findBackup() {
  if (process.argv[2]) return process.argv[2]
  if (platform() !== 'darwin') return null
  const cs = join(homedir(), 'Library', 'CloudStorage')
  let roots = []
  try {
    roots = readdirSync(cs).filter((d) => d.startsWith('GoogleDrive')).map((d) => join(cs, d))
  } catch { return null }
  const found = []
  for (const root of roots) {
    for (const rel of ['My Drive/KI', 'Meine Ablage/KI', 'My Drive/KI/Daily-Backups', 'Meine Ablage/KI/Daily-Backups']) {
      const dir = join(root, rel)
      try {
        for (const f of readdirSync(dir)) {
          if (/^daily-backup-.*\.json$/.test(f)) {
            const p = join(dir, f)
            found.push({ p, m: statSync(p).mtimeMs })
          }
        }
      } catch { /* Ordner gibt es nicht */ }
    }
  }
  if (!found.length) return null
  found.sort((a, b) => b.m - a.m)
  return found[0].p
}

const backupPath = findBackup()
const backup = backupPath ? JSON.parse(readFileSync(backupPath, 'utf-8')) : null

// ── Zählen ──────────────────────────────────────────────────────────────────
function counts(doc) {
  const ls = doc.localStorage ?? {}
  const idb = doc.indexedDB ?? {}
  const list = (key) => { try { const v = JSON.parse(ls[key] ?? '[]'); return Array.isArray(v) ? v.length : Object.keys(v).length } catch { return 0 } }
  const sessions = (() => { try { return JSON.parse(ls['morning.tracker.sessions'] ?? '[]') } catch { return [] } })()
  const minutes = sessions.reduce((a, e) => a + (Number(e?.durationMin) || 0), 0)
  return {
    'localStorage-Schlüssel': Object.keys(ls).length,
    'Lernzeit-Sessions': sessions.length,
    'davon Stunden': Math.round(minutes / 60),
    'Studienblöcke': list('morning.tracker.studyBlocks'),
    'Fächer': list('morning.tracker.subjects'),
    'Score-Tage': list('morning.scoreHistory'),
    'Wichtige Termine': list('morning.important.events'),
    'Kalender-Entscheidungen': list('morning.calendar.seriesDecisions'),
    'Triage gesehen': list('morning.triage.seen'),
    'IndexedDB: Todos': (idb.todos ?? []).length,
    'IndexedDB: Termine': (idb.importantEvents ?? []).length,
    'IndexedDB: KI-Nachrichten': (idb.aiMessages ?? []).length,
  }
}

const now = counts(state)
const then = backup ? counts(backup) : null

// ── Ausgabe ─────────────────────────────────────────────────────────────────
console.log('')
console.log('  Zustand :', statePath)
console.log('  Stand   :', state.updatedAt ?? '—')
if (backupPath) console.log('  Backup  :', backupPath)
console.log('')

const width = Math.max(...Object.keys(now).map((k) => k.length))
let problems = 0
for (const [k, v] of Object.entries(now)) {
  const before = then ? then[k] : null
  let mark = ' '
  if (then) {
    if (v < before) { mark = '✖'; problems++ }
    else if (v > before) mark = '+'
    else mark = '✓'
  }
  const cmp = then ? `   (Backup: ${before})` : ''
  console.log(`  ${mark} ${k.padEnd(width)}  ${String(v).padStart(6)}${cmp}`)
}
console.log('')

// Schnappschüsse
try {
  const snaps = readdirSync(join(dataDir(), 'snapshots')).filter((f) => f.endsWith('.json'))
  console.log(`  Schnappschüsse: ${snaps.length} (${snaps.slice(-3).join(', ')})`)
} catch { console.log('  Schnappschüsse: noch keine') }
console.log('')

if (!then) {
  console.log('  Kein Backup zum Vergleichen gefunden — die Zahlen oben stehen für sich.')
} else if (problems) {
  console.log(`  ✖ ${problems} Wert(e) KLEINER als im Backup. Nicht weitermachen — nachsehen, woran es liegt.`)
  process.exit(1)
} else {
  console.log('  ✓ Nichts verloren. Alle Werte gleich oder größer als im Backup.')
}
console.log('')
