// Calendar source — shared by the packaged server (electron/server.cjs) and the
// Vite dev plugin (server/calendarPlugin.ts).
//
// Resolution order for the events file:
//   1. CALENDAR_JSON_PATH env var (explicit override), if readable.
//   2. The Google-Drive-for-Desktop synced export: the newest
//      `upcoming_events.json` found under ~/Library/CloudStorage/GoogleDrive-*.
//      This keeps the dashboard fresh every morning with zero extra jobs — the
//      morning automation writes the export to Drive, Drive syncs it locally,
//      we read it here. Robust to Drive recreating the file with a new id daily.
//   3. The bundled snapshot electron/data/calendar.json (seed / on-demand).
//
// The file may be in either shape and we normalize on read:
//   - raw export   { upcoming_events: [{ summary, start, calendar, … }] }
//   - normalized   { events: [{ id, title, start, allDay, calendar, … }] }
//
// If nothing is readable the caller falls back to the iCal feed, so the calendar
// never hard-fails.

const fs = require('fs')
const os = require('os')
const path = require('path')

// ── normalization (single source of truth; also used by scripts/build-calendar.mjs)

function isDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim())
}
function toIso(value) {
  const s = String(value).trim()
  if (isDateOnly(s)) return s // keep date-only for all-day; the UI handles it
  const d = new Date(s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? s : d.toISOString()
}
function cleanTitle(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() || 'Ohne Titel'
}

/** Normalize one raw export event → the CalendarEvent shape the app expects. */
function normalizeEvent(e) {
  const allDay = isDateOnly(e.start)
  const start = toIso(e.start)
  const end = e.end ? toIso(e.end) : start
  const uid = String(e.uid != null ? e.uid : e.summary != null ? e.summary : Math.random())
  return {
    id: `${uid}|${start}`,
    // Die nackte UID zusaetzlich zur zusammengesetzten id. Ohne sie liesse sich
    // ein von Daily angelegter Termin nicht wiedererkennen, wenn er ueber den
    // Export zurueckkommt: Daily kennt die UID, aber nicht den Zeitpunkt, den
    // der Kalender daraus macht — und `id` enthaelt beides.
    // Nur setzen, wenn die Quelle wirklich eine UID mitgab; der Rueckfall auf
    // den Titel (oben) waere als Schluessel wertlos und wuerde beim Entdoppeln
    // fremde Termine zusammenwerfen.
    uid: e.uid != null && String(e.uid).trim() ? String(e.uid).trim() : undefined,
    title: cleanTitle(e.summary != null ? e.summary : e.title),
    start,
    end,
    location: e.location ? String(e.location).trim() : undefined,
    description: e.description ? String(e.description).trim() : undefined,
    allDay,
    calendar: e.calendar ? String(e.calendar).trim() : undefined,
  }
}

/** True if an event object is already in normalized shape (has id + allDay). */
function isNormalized(e) {
  return e && typeof e.id === 'string' && typeof e.allDay === 'boolean'
}

/** Turn a parsed doc (raw export OR normalized) into normalized events, sorted. */
function normalizeDoc(doc) {
  const list = Array.isArray(doc)
    ? doc
    : Array.isArray(doc.upcoming_events)
      ? doc.upcoming_events
      : Array.isArray(doc.events)
        ? doc.events
        : []
  const events = list.map((e) => (isNormalized(e) ? e : normalizeEvent(e)))
  events.sort((a, b) => startMs(a) - startMs(b))
  return {
    generatedAt: new Date().toISOString(),
    source: doc && doc.exported_at ? `drive:${doc.exported_at}` : 'drive',
    count: events.length,
    events,
  }
}

// ── source-file resolution ──────────────────────────────────────────────────────

let resolvedPath // cached; cleared on read failure so we re-resolve next time

function bundledPath() {
  return path.join(__dirname, 'data', 'calendar.json')
}

/** Bounded recursive search for `upcoming_events.json` under a directory. Uses
 *  statSync (metadata only — does not download streamed files). Capped so a huge
 *  Drive can't stall the server. Returns { path, mtime } candidates. */
function findExports(root, out, budget) {
  if (budget.dirs <= 0) return
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  budget.dirs--
  for (const ent of entries) {
    const p = path.join(root, ent.name)
    if (ent.isFile() && ent.name === 'upcoming_events.json') {
      try {
        out.push({ path: p, mtime: fs.statSync(p).mtimeMs })
      } catch {
        /* ignore */
      }
    } else if (ent.isDirectory() && !ent.name.startsWith('.')) {
      findExports(p, out, budget)
    }
  }
}

// Known sub-paths to the export, checked directly before any walk (fast +
// deterministic). Covers the trailing space in "Mails " and the German UI name.
const FAST_PATHS = [
  'My Drive/KI/Mails /Calendar/upcoming_events.json',
  'My Drive/KI/Mails/Calendar/upcoming_events.json',
  'Meine Ablage/KI/Mails /Calendar/upcoming_events.json',
  'Meine Ablage/KI/Mails/Calendar/upcoming_events.json',
]

/** Locate the newest synced `upcoming_events.json` under any GoogleDrive-* mount.
 *  Tries the known sub-paths first; only walks the Drive if those miss. */
function findSyncedExport() {
  const cs = path.join(os.homedir(), 'Library', 'CloudStorage')
  let roots
  try {
    roots = fs
      .readdirSync(cs)
      .filter((d) => d.startsWith('GoogleDrive'))
      .map((d) => path.join(cs, d))
  } catch {
    return null
  }

  // fast path: direct hits at the known location
  const hits = []
  for (const root of roots) {
    for (const rel of FAST_PATHS) {
      const p = path.join(root, rel)
      try {
        hits.push({ path: p, mtime: fs.statSync(p).mtimeMs })
      } catch {
        /* not here */
      }
    }
  }
  if (hits.length) {
    hits.sort((a, b) => b.mtime - a.mtime)
    return hits[0].path
  }

  // fallback: bounded recursive search (handles a changed folder structure)
  const found = []
  const budget = { dirs: 4000 } // cap directories visited across all mounts
  for (const root of roots) findExports(root, found, budget)
  if (!found.length) return null
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0].path
}

function resolveSourcePath() {
  if (resolvedPath && fs.existsSync(resolvedPath)) return resolvedPath
  // 1) explicit override
  const env = process.env.CALENDAR_JSON_PATH
  if (env && fs.existsSync(env)) return (resolvedPath = env)
  // 2) Google Drive Desktop synced export
  const synced = findSyncedExport()
  if (synced) return (resolvedPath = synced)
  // 3) bundled snapshot
  const bundled = bundledPath()
  if (fs.existsSync(bundled)) return (resolvedPath = bundled)
  return null
}

/** Read + normalize the events file. Returns normalized CalendarEvent[], or null
 *  if there is no usable source (→ caller falls back to iCal). */
function readEvents() {
  const file = resolveSourcePath()
  if (!file) return null
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    resolvedPath = undefined // re-resolve next time (e.g. Drive offline)
    return null
  }
  try {
    const events = normalizeDoc(JSON.parse(raw)).events
    return events.length ? events : null
  } catch {
    return null
  }
}

// ── today / upcoming split (Berlin-local) ───────────────────────────────────────

function todayBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function daysBerlin(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function berlinDay(value) {
  const s = String(value)
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function startMs(e) {
  const s = e.start.length === 10 ? e.start + 'T00:00:00Z' : e.start
  return new Date(s).getTime()
}

function split(events, horizonDays = 90) {
  const today = todayBerlin()
  const horizon = daysBerlin(horizonDays)

  const enriched = events.map((e) => ({
    ...e,
    _startDay: berlinDay(e.start),
    _endDay: berlinDay(e.end || e.start),
  }))

  const todayEvents = enriched
    .filter((e) => e._startDay === today || (e._startDay < today && e._endDay > today))
    .sort((a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return startMs(a) - startMs(b)
    })
    .map(strip)

  const upcoming = enriched
    .filter((e) => e._startDay >= today && e._startDay <= horizon)
    .sort((a, b) => startMs(a) - startMs(b))
    .map(strip)

  return { today: todayEvents, upcoming }
}

function strip(e) {
  const o = { ...e }
  delete o._startDay
  delete o._endDay
  return o
}

module.exports = { readEvents, split, resolveSourcePath, normalizeDoc }
