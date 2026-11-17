#!/usr/bin/env node
// Baubremse: bricht ab, wenn ein Geheimnis aus .env im ausgelieferten Bundle
// gelandet ist.
//
// Warum das nötig ist: Vite ersetzt jedes `import.meta.env.VITE_*` zur Bauzeit
// durch den Literalwert. Steht ein Schlüssel mit VITE_-Präfix in der .env und
// liest ihn irgendeine Komponente, wird er wortwörtlich ins JavaScript
// geschrieben, das der Browser lädt. Das passiert lautlos — kein Fehler, keine
// Warnung.
//
// Genau so war es hier: HighlightCard.tsx und JarvisPanel.tsx bauten einen
// Anthropic-Client im Browser (`dangerouslyAllowBrowser: true`). Beide Dateien
// gibt es nicht mehr, alle KI-Aufrufe laufen über den Server-Proxy
// (electron/anthropicProxy.cjs). Diese Prüfung bleibt trotzdem: sie kostet
// nichts und fängt den Rückfall, bevor er ausgeliefert wird.
//
// Diese Prüfung sucht die tatsächlichen Werte aus .env im Bauergebnis. Sie gibt
// die Werte nie aus — nur den Namen der Variablen und die betroffene Datei.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ENV = join(ROOT, '.env')

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASS|PASSWORD|CREDENTIAL)/i
const MIN_LEN = 12
const SCAN_EXT = /\.(js|mjs|cjs|css|html|json|map)$/i

if (!existsSync(DIST)) {
  console.log('[secrets] kein dist/ — nichts zu prüfen.')
  process.exit(0)
}
if (!existsSync(ENV)) {
  console.log('[secrets] keine .env — nichts zu prüfen.')
  process.exit(0)
}

const secrets = []
for (const line of readFileSync(ENV, 'utf-8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
  if (!m) continue
  const [, name, rawValue] = m
  const value = rawValue.trim().replace(/^["']|["']$/g, '')
  if (!SECRET_NAME.test(name)) continue
  if (value.length < MIN_LEN) continue
  secrets.push({ name, value })
}

if (!secrets.length) {
  console.log('[secrets] keine prüfbaren Geheimnisse in .env.')
  process.exit(0)
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (SCAN_EXT.test(entry)) yield p
  }
}

const leaks = []
for (const file of walk(DIST)) {
  let text
  try { text = readFileSync(file, 'utf-8') } catch { continue }
  for (const { name, value } of secrets) {
    if (text.includes(value)) leaks.push({ name, file: relative(ROOT, file) })
  }
}

if (leaks.length) {
  console.error('')
  console.error('  ✖ ABBRUCH — Geheimnis im ausgelieferten Bundle')
  console.error('')
  for (const { name, file } of leaks) {
    console.error(`    ${name}  →  ${file}`)
  }
  console.error('')
  console.error('  Der Wert steht im Klartext im JavaScript, das der Browser lädt.')
  console.error('  Behebung: den Schlüssel serverseitig lesen (electron/anthropicProxy.cjs')
  console.error('  über /api/anthropic) statt über import.meta.env.VITE_*, und das')
  console.error('  VITE_-Präfix aus der .env entfernen.')
  console.error('')
  process.exit(1)
}

console.log(`[secrets] ok — ${secrets.length} Geheimnis(se) geprüft, keines im Bundle.`)
