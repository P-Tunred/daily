// Wohin die App zur Laufzeit SCHREIBT.
//
// Ausdrücklich NICHT `electron/data/` im App-Bundle: `electron-builder` kopiert
// `electron/**/*` bei jedem `npm run dist` neu ins Bundle. Damit ging bisher
// `usage.json` verloren und `triage-cache.json` fiel auf den (alten) Repo-Stand
// zurück — der Tokenverbrauch war weg und die Mail-Triage fragte alles noch
// einmal. Signierte macOS-Bundles verbieten das Schreiben ohnehin.
//
// Auflösungsreihenfolge:
//   1. DAILY_DATA_DIR            — ausdrücklich gesetzt (VM: /var/lib/daily)
//   2. macOS  ~/Library/Application Support/Daily/data
//      Linux  $XDG_STATE_HOME/daily  (Vorgabe: ~/.local/state/daily)
//   3. electron/data/            — Notnagel, wenn 1 und 2 nicht schreibbar sind
//
// Beim ersten Lauf werden vorhandene `.json` aus dem alten Ort einmalig
// übernommen — aber nie über eine schon vorhandene Datei geschrieben.

const fs = require('fs')
const os = require('os')
const path = require('path')

const LEGACY_DIR = path.join(__dirname, 'data')

function preferredDir() {
  const override = process.env.DAILY_DATA_DIR
  if (override && override.trim()) return path.resolve(override.trim())
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Daily', 'data')
  }
  const xdg = process.env.XDG_STATE_HOME
  if (xdg && xdg.trim()) return path.join(path.resolve(xdg.trim()), 'daily')
  return path.join(os.homedir(), '.local', 'state', 'daily')
}

/** Alte Dateien einmalig übernehmen. Überschreibt nie — was am Zielort liegt,
 *  ist per Definition neuer als der Bundle-Stand. */
function seedFromLegacy(dir) {
  if (path.resolve(dir) === path.resolve(LEGACY_DIR)) return
  let names
  try { names = fs.readdirSync(LEGACY_DIR) } catch { return }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const to = path.join(dir, name)
    if (fs.existsSync(to)) continue
    try {
      fs.copyFileSync(path.join(LEGACY_DIR, name), to)
      console.log('[Daily data] übernommen:', name, '→', dir)
    } catch (e) {
      console.warn('[Daily data] konnte', name, 'nicht übernehmen:', e.message)
    }
  }
}

let resolved = null

function dataDir() {
  if (resolved) return resolved
  const wanted = preferredDir()
  try {
    fs.mkdirSync(wanted, { recursive: true })
    fs.accessSync(wanted, fs.constants.W_OK)
    resolved = wanted
    seedFromLegacy(resolved)
  } catch (e) {
    console.warn('[Daily data]', wanted, 'nicht schreibbar (' + e.message + ') — bleibe bei', LEGACY_DIR)
    resolved = LEGACY_DIR
  }
  return resolved
}

/** Voller Pfad einer Laufzeitdatei, z. B. dataPath('usage.json'). */
function dataPath(name) {
  return path.join(dataDir(), name)
}

module.exports = { dataDir, dataPath, LEGACY_DIR }
