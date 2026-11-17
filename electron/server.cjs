// Built-in server for the standalone (packaged) Daily app.
// Replaces the Vite dev server at runtime: serves the static built frontend
// from ../dist AND implements the calendar API the app expects, so the app
// is fully self-contained — no terminal, no separate Vite needed.
//
//   GET /api/calendar/today     → CalendarEvent[]  (today)
//   GET /api/calendar/upcoming  → CalendarEvent[]  (today + next 90 days)
//   everything else             → static file from ../dist (SPA fallback)

const http = require('http')
const fs = require('fs')
const path = require('path')
// node-ical is a runtime dependency (see package.json "dependencies").
const ical = require('node-ical')
const { handleAnthropic } = require('./anthropicProxy.cjs')
// Local JSON calendar source (Google Calendar via the daily Drive export).
const calSource = require('./calendarSource.cjs')
// Live mail triage (Drive mail report → Claude classification → cache).
const mailTriage = require('./mailTriage.cjs')
const brainSource = require('./brainSource.cjs')
// Das Hörbriefing — Sprechtext von Hermes, Aufnahme von hier (hoerbriefing.cjs).
const hoerbriefing = require('./hoerbriefing.cjs')
const brainPages = require('./brainPages.cjs')
const learnHarness = require('./learnHarness.cjs')
const learnHarnessSitzungen = require('./learnHarnessSitzungen.cjs')
// Weekly Claude/GLM usage stats (footer dropdown).
const usageStats = require('./usageStats.cjs')
// Abo-Uebersicht (Claude, z.ai, Codex) — siehe subscriptions.cjs.
const subscriptions = require('./subscriptions.cjs')
// Buch ueber zurueckgewiesene Hermes-Aufrufe — siehe rejectLog.cjs.
const rejectLog = require('./rejectLog.cjs')
// Tagesabschluss am Abend — siehe dayClose.cjs fuer das Warum.
const dayClose = require('./dayClose.cjs')
// Tagesbeginn: faellige Termine und Wochenplanung — siehe dayStart.cjs.
const dayStart = require('./dayStart.cjs')
// Wann ein datierter Vorgang zur Aufgabe wird — siehe vorlaufStore.cjs.
const vorlaufStore = require('./vorlaufStore.cjs')
// Klemmt ein Kanal zum Brain? (Tagesbericht, Fristen, Hörbriefing …)
const kanaele = require('./kanaele.cjs')
// Freie Bloecke im Kalender — siehe gaps.cjs.
const gaps = require('./gaps.cjs')
// Zustand der App (Todos, Lernzeit, Score) als Datei — siehe stateStore.cjs.
const stateStore = require('./stateStore.cjs')
// Schreibzugang für Hermes (eigenes Bearer-Token, siehe hermesApi.cjs).
const hermesApi = require('./hermesApi.cjs')
const widget = require('./widget.cjs')
// Vorgaenge im Fokus — siehe electron/focusStore.cjs.
const focusStore = require('./focusStore.cjs')
// Postausgang zum echten Kalender — siehe calendarOutbox.cjs.
const calendarOutbox = require('./calendarOutbox.cjs')
// Briefing-Vertrag + Quittungen — siehe briefingStore.cjs fuer das Warum.
const briefingStore = require('./briefingStore.cjs')
const questionStore = require('./questionStore.cjs')
const suggestionStore = require('./suggestionStore.cjs')
const receipts = require('./receipts.cjs')
// Chat MIT Hermes (Browser → localhost-Webhook → hermes -z, siehe hermesChat.cjs).
const hermesChat = require('./hermesChat.cjs')
// Mit Hermes sprechen: hören (faster-whisper), Hermes fragen, vorlesen.
const stimmeHoeren = require('./stimmeHoeren.cjs')
const hermesStimme = require('./hermesStimme.cjs')
const stimmeKurz = require('./stimmeKurz.cjs')

const DIST = path.join(__dirname, '..', 'dist')
const REFRESH_MS = 15 * 60 * 1000
const USAGE_REFRESH_MS = 15 * 60 * 1000
// Mail triage runs ONCE PER DAY, targeted at the morning (Berlin). If the app
// isn't running at that hour, the first use of the day after it triggers the
// refresh instead. The tick just checks the day-gate — the real read+classify
// happens at most once per calendar day.
const TRIAGE_HOUR = 7
const TRIAGE_TICK_MS = 20 * 60 * 1000
// Der Abschluss prueft nur, ob er dran ist — die Arbeit passiert hoechstens
// einmal pro Kalendertag (Marker im Zustand). Halbstuendlich reicht: verpasst
// die Maschine 21:00, laeuft er eben um 21:30.
const ABSCHLUSS_TICK_MS = 30 * 60 * 1000
const LEARNHARNESS_TICK_MS = 5 * 60 * 1000

// ── Usage tracking (persists to disk, survives restarts) ──────────────────────
const { dataPath } = require('./dataDir.cjs')
const USAGE_PATH = dataPath('usage.json')
const usageStore = { days: {} } // { 'YYYY-MM-DD': { model: { input, output, calls } } }

function loadUsage() {
  try {
    const raw = fs.readFileSync(USAGE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.days === 'object') { usageStore.days = parsed.days }
  } catch { /* first run — empty */ }
}
function saveUsage() {
  try {
    fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true })
    fs.writeFileSync(USAGE_PATH, JSON.stringify(usageStore, null, 2))
  } catch { /* quota */ }
}
function recordUsage(model, inputTokens, outputTokens) {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  if (!usageStore.days[day]) usageStore.days[day] = {}
  const m = usageStore.days[day]
  if (!m[model]) m[model] = { input: 0, output: 0, calls: 0 }
  m[model].input += inputTokens || 0
  m[model].output += outputTokens || 0
  m[model].calls += 1
  saveUsage()
}
function pruneUsage() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutStr = cutoff.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  Object.keys(usageStore.days).forEach(d => { if (d < cutStr) delete usageStore.days[d] })
  saveUsage()
}

// ── Auth (Basic + session cookie "remember me") ───────────────────────────────
const crypto = require('crypto')
const AUTH_COOKIE = 'daily-session'
const AUTH_MAX_AGE = 30 * 24 * 3600 // 30 days

function readEnvFile() {
  try { return fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8') } catch { return '' }
}

function getCredentials() {
  const raw = readEnvFile()
  const envUser = process.env.AUTH_USER
  const envPass = process.env.AUTH_PASS
  const user = (envUser && envUser.trim()) ? envUser.trim()
    : (() => { const m = raw.match(/^AUTH_USER=(.+)$/m); return m ? m[1].trim() : 'paul' })()
  const pass = (envPass && envPass.trim()) ? envPass.trim()
    : (() => { const m = raw.match(/^AUTH_PASS=(.+)$/m); return m ? m[1].trim() : undefined })()
  return { user, pass }
}

function makeSessionToken(user, pass) {
  return crypto.createHash('sha256').update(`${user}:${pass}:${AUTH_COOKIE}`).digest('hex').slice(0, 32)
}

function readCookies(req) {
  const hdr = req.headers.cookie || ''
  const out = {}
  hdr.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=')
    if (k) out[k.trim()] = v.join('=').trim()
  })
  return out
}

function checkAuth(req, res) {
  const { user, pass } = getCredentials()
  if (!pass) return true // no password configured → open access

  // 1) Check session cookie ("remember me")
  const cookies = readCookies(req)
  if (cookies[AUTH_COOKIE] && cookies[AUTH_COOKIE] === makeSessionToken(user, pass)) return true

  // 2) Check Basic-Auth header
  const auth = req.headers.authorization || ''
  const match = auth.match(/^Basic\s+(.+)$/i)
  if (match) {
    const decoded = Buffer.from(match[1], 'base64').toString()
    const [u, p] = decoded.split(':')
    if (u === user && p === pass) {
      res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${makeSessionToken(user, pass)}; Path=/; Max-Age=${AUTH_MAX_AGE}; HttpOnly; SameSite=Strict`)
      return true
    }
  }

  // 3) Deny — prompt browser login dialog
  res.setHeader('WWW-Authenticate', 'Basic realm="Daily"')
  res.writeHead(401, { 'Content-Type': 'text/plain' })
  res.end('401 — Bitte anmelden')
  return false
}

let ICAL_URL
let cacheToday = []
let cacheUpcoming = []
let lastFetch = 0
let haveSource = false // true once a JSON or iCal source has produced events
let cacheTriage = { items: [], reportUpdatedAt: null, newestMailAt: null, stale: true }
let lastTriageDay = null // Berlin date string of the last successful daily refresh
let cacheGlmUsage = { available: false }
let cacheClaudeUsage = { available: false, resetAt: null }
let lastUsageFetch = 0

// ── iCal URL: env var first, then the bundled .env ──
function getIcalUrl() {
  if (process.env.VITE_GCAL_ICAL_URL) return process.env.VITE_GCAL_ICAL_URL.trim()
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
    const m = raw.match(/^VITE_GCAL_ICAL_URL=(.+)$/m)
    if (m) return m[1].trim()
  } catch { /* no .env — calendar just stays empty */ }
  return undefined
}

function todayBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function berlinHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' })).getHours()
}
function daysBerlin(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

async function fetchAndParse(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('iCal fetch failed: ' + res.status)
  const text = await res.text()
  const data = ical.sync.parseICS(text)
  const from = new Date(daysBerlin(-1))
  const to = new Date(daysBerlin(92))
  const events = []
  for (const key of Object.keys(data)) {
    const entry = data[key]
    if (!entry || entry.type !== 'VEVENT') continue
    let occurrences
    try {
      occurrences = ical.expandRecurringEvent(entry, { from, to, expandOngoing: true })
    } catch { continue }
    for (const occ of occurrences) {
      const startDate = new Date(occ.start)
      const endDate = occ.end ? new Date(occ.end) : startDate
      const startDay = startDate.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
      const endDay = endDate.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
      const uid = String(entry.uid != null ? entry.uid : (entry.summary != null ? entry.summary : Math.random()))
      events.push({
        id: uid + '|' + occ.start.toISOString(),
        title: String(entry.summary != null ? entry.summary : 'Ohne Titel'),
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        location: entry.location ? String(entry.location) : undefined,
        description: entry.description ? String(entry.description) : undefined,
        allDay: occ.isFullDay,
        _startDay: startDay,
        _endDay: endDay,
      })
    }
  }
  return events
}

function stripDayKeys(e) {
  const o = Object.assign({}, e)
  delete o._startDay
  delete o._endDay
  return o
}

async function refresh() {
  // 1) Prefer the local JSON export (Google Calendar → Drive → calendar.json).
  try {
    const local = calSource.readEvents()
    if (local && local.length) {
      const { today, upcoming } = calSource.split(local, 90)
      cacheToday = today
      cacheUpcoming = upcoming
      lastFetch = Date.now()
      haveSource = true
      console.log('[Daily server] calendar(json) ✓ today=' + today.length + ' upcoming=' + upcoming.length)
      return
    }
  } catch (e) {
    console.warn('[Daily server] calendar json error:', e && e.message)
  }
  // 2) Fallback: live iCal feed (only if a URL is configured).
  if (!ICAL_URL) return
  try {
    const all = await fetchAndParse(ICAL_URL)
    const today = todayBerlin()
    const horizon = daysBerlin(90)
    cacheToday = all
      .filter((e) => { const s = e._startDay, en = e._endDay; return s === today || (s < today && en > today) })
      .map(stripDayKeys)
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1
        if (!a.allDay && b.allDay) return 1
        return new Date(a.start) - new Date(b.start)
      })
    cacheUpcoming = all
      .filter((e) => e._startDay >= today && e._startDay <= horizon)
      .map(stripDayKeys)
      .sort((a, b) => new Date(a.start) - new Date(b.start))
    lastFetch = Date.now()
    haveSource = true
    console.log('[Daily server] calendar(ical) ✓ today=' + cacheToday.length + ' upcoming=' + cacheUpcoming.length)
  } catch (e) {
    console.warn('[Daily server] calendar fetch error:', e && e.message)
  }
}

// ── Static file serving ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function serveStatic(pathname, res) {
  const rel = (pathname === '/' ? '/index.html' : pathname).replace(/\.\.+/g, '')
  const filePath = path.join(DIST, rel)
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Asset with an extension that doesn't exist → 404.
      // Extensionless path → SPA fallback to index.html.
      if (path.extname(rel)) { res.writeHead(404); res.end('Not found'); return }
      fs.readFile(path.join(DIST, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(html)
      })
      return
    }
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream')
    res.end(data)
  })
}

/** Body lesen und als JSON auswerten. Gibt `undefined` zurueck, WENN schon
 *  geantwortet wurde — der Aufrufer muss dann sofort aussteigen. Sonst stuenden
 *  in jeder Route dieselben acht Zeilen. */
async function leseJson(req, res, limit = 32_768) {
  let roh = ''
  req.on('data', (c) => { roh += c; if (roh.length > limit) req.destroy() })
  await new Promise((r) => req.on('end', r))
  try { return JSON.parse(roh || '{}') }
  catch { respondJSON(res, { error: 'Ungültiges JSON' }, 400); return undefined }
}

function respondJSON(res, data, status) {
  res.statusCode = status || 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

// Once per day, at/after the morning hour. Cheap no-op the rest of the day.
// Only marks the day "done" once it actually got fresh (non-stale) data, so a
// morning where the report hasn't synced yet keeps retrying on later ticks.
async function refreshTriageCache() {
  const today = todayBerlin()
  if (lastTriageDay === today) return          // already refreshed today
  if (berlinHour() < TRIAGE_HOUR) return        // before the morning refresh time
  const result = await mailTriage.refreshTriage()
  cacheTriage = result
  if (!result.stale) lastTriageDay = today
}

async function refreshUsageCache() {
  const [claude, glm] = await Promise.all([
    usageStats.getClaudeUsage(),
    usageStats.getWeeklyGlmUsage(),
  ])
  cacheClaudeUsage = claude
  cacheGlmUsage = glm
  lastUsageFetch = Date.now()
}

/** Prueft, ob der Tagesabschluss dran ist, und fuehrt ihn dann aus.
 *  Fehler hier duerfen den Dienst nie mitnehmen — ein misslungener Abschluss
 *  ist aergerlich, ein abgestuerzter Server waere schlimmer. */
function tickAbschluss() {
  try {
    const r = dayClose.schliesseTag()
    if (r.gelaufen && r.verschoben > 0 && r.aeltester) {
      console.log(`[abschluss] laengster Laeufer: "${r.aeltester.text}" (${r.aeltester.male}x verschoben)`)
    }
  } catch (e) {
    console.warn('[abschluss] fehlgeschlagen:', e && e.message)
  }
}

/** Gespeicherte LearnHarness-Sitzungen übernehmen (learnHarnessSitzungen.cjs).
 *  Die Spiegelung kommt stündlich; öfter nachsehen kostet nur ein stat(). */
function tickLearnHarness() {
  try {
    learnHarnessSitzungen.uebernehmen()
  } catch (e) {
    console.warn('[learnharness] Übernahme fehlgeschlagen:', e && e.message)
  }
}

function tickTagesbeginn() {
  try {
    const r = dayStart.starteTag()
    if (r.gelaufen && (r.ausTerminen || r.ausWoche)) {
      console.log(`[tagesbeginn] ${r.titel.join(' · ')}`)
    }
  } catch (e) {
    console.warn('[tagesbeginn] fehlgeschlagen:', e && e.message)
  }
  // Eigener try: ein Fehler beim Nachsehen darf den Tagesbeginn nicht kosten.
  // Was gestern fällig war und offen blieb, zählt als „Vorlauf zu knapp".
  try {
    const n = vorlaufStore.pruefeVerpasst()
    if (n) console.log(`[vorlauf] ${n} Frist(en) verpasst vermerkt`)
  } catch (e) {
    console.warn('[vorlauf] Prüfung fehlgeschlagen:', e && e.message)
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    let pathname = '/'
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { /* keep / */ }

    // Hermes hat ein eigenes Bearer-Token statt des Benutzerpassworts —
    // deshalb VOR dem Basic-Auth-Gate, sonst käme er nie durch.
    // Genau /api/hermes und /api/hermes/…, NICHT /api/hermes-chat: das ist
    // Pauls Chat MIT Hermes und gehört hinter das Basic-Auth-Gate. Ein
    // startsWith('/api/hermes') hat ihn hier abgefangen und mit "fehlendes
    // Bearer-Token" abgewiesen — der Rauchtest auf der VM hat es entlarvt.
    if (pathname === '/api/hermes' || pathname.startsWith('/api/hermes/')) {
      return hermesApi.handle(req, res, pathname)
    }

    // Das Widget (iPhone/Mac, Scriptable) weist sich mit DAILY_WIDGET_TOKEN
    // aus, nicht mit Pauls Passwort — deshalb ebenfalls vor dem Gate.
    if (pathname === '/api/widget') return widget.handle(req, res)

    // Auth gate — protects everything
    if (!checkAuth(req, res)) return

    if (pathname === '/api/state' || pathname === '/api/bewusst' || pathname === '/api/projekte') {
      return stateStore.handle(req, res)
    }

    // Wie steht es um das heutige Briefing? Die Oberfläche fragt das, um ihre
    // Herkunftsmarkierung zu setzen ("Hermes · aktuell" vs. "lokale Texte") —
    // ohne diesen Endpunkt müsste sie es aus dem Zustand erraten und läge bei
    // einem unlesbaren Zustand still falsch.
    // Der Browser meldet, dass er eine konkrete Revision gerendert hat.
    //
    // HINTER DER NORMALEN ANMELDUNG, NICHT HINTER DEM HERMES-TOKEN: der
    // Browser hat nur Basic-Auth bzw. den Sitzungskeks. Stand die Route unter
    // /api/hermes/*, bekam er 401 — und die Beweiskette blieb bei "pending"
    // stehen, obwohl der Text sichtbar auf dem Schirm stand.
    //
    // Der Briefing-Zustand wird dabei NICHT angefasst. Sonst löste jede
    // Anzeige einen Abgleich aus, der Browser bekäme seine eigene Änderung
    // zurück und bestätigte sich in einer Endlosschleife selbst.
    if (pathname === '/api/briefing/rendered' && req.method === 'POST') {
      let roh = ''
      req.on('data', (c) => { roh += c; if (roh.length > 4096) req.destroy() })
      await new Promise((r) => req.on('end', r))
      let input
      try { input = JSON.parse(roh) } catch { return respondJSON(res, { error: 'Ungültiges JSON' }, 400) }
      const sha = String(input.sha256 || '').trim()
      if (!/^[a-f0-9]{64}$/.test(sha)) return respondJSON(res, { error: 'Feld "sha256" fehlt oder ist kein SHA-256.' }, 400)
      const r = receipts.markRendered(sha, input.surfaces)
      return respondJSON(res, { ok: true, ...r })
    }

    // Pauls Reaktion auf die Brain-Frage.
    //
    // WARUM HIER UND NICHT UNTER /api/hermes/*
    // Derselbe Grund wie eine Ebene höher: der Browser weist sich mit
    // Basic-Auth aus, nicht mit dem HERMES_TOKEN. Läge die Route im
    // Hermes-Zweig, bekäme jeder Klick ein stummes 401 — und die Antwort wäre
    // weg, ohne dass es jemand merkt.
    //
    // WARUM DER SERVER ENTSCHEIDET UND NICHT DER BROWSER
    // Die Ruhezeiten (7 Tage bzw. nie wieder) sind die eigentliche Substanz
    // dieser Funktion. Würde der Browser sie selbst in den localStorage
    // schreiben, gäbe es die Regel zweimal — und zwei Fassungen derselben
    // Regel driften auseinander. Hier gibt es sie einmal, in questionStore.
    if (pathname === '/api/question/answer' && req.method === 'POST') {
      let roh = ''
      req.on('data', (c) => { roh += c; if (roh.length > 16_384) req.destroy() })
      await new Promise((r) => req.on('end', r))
      let input
      try { input = JSON.parse(roh) } catch { return respondJSON(res, { error: 'Ungültiges JSON' }, 400) }
      try {
        const r = questionStore.reagiere(String(input.aktion || ''), input.antwort)
        console.log(`[question] ${r.aktion} für ${r.id}`)
        return respondJSON(res, { ok: true, ...r })
      } catch (e) {
        return respondJSON(res, { ok: false, error: e.message }, e.status || 400)
      }
    }

    if (pathname === '/api/question') {
      return respondJSON(res, questionStore.zustand())
    }

    // ── Vorschläge im Morgendialog ──
    // WARUM DAS HIER STEHT UND NICHT UNTER /api/hermes
    // Diese drei Routen ruft die OBERFLÄCHE. Lägen sie hinter dem
    // Hermes-Token, müsste der Browser es kennen — und damit stünde ein Token
    // mit vollem Schreibzugriff im ausgelieferten JavaScript. Hier gilt das
    // Benutzerpasswort, wie bei allem, was Paul selbst auslöst.
    //
    // Angelegt wird bei "Ja" trotzdem serverseitig, über dieselbe Logik, die
    // auch Hermes benutzt (hereingereicht, siehe suggestionStore.entscheide).
    if (pathname === '/api/suggestions') {
      return respondJSON(res, suggestionStore.zustand())
    }

    if (pathname === '/api/suggestions/decide' && req.method === 'POST') {
      let roh = ''
      req.on('data', (c) => { roh += c; if (roh.length > 16_384) req.destroy() })
      await new Promise((r) => req.on('end', r))
      let input
      try { input = JSON.parse(roh) } catch { return respondJSON(res, { error: 'Ungültiges JSON' }, 400) }
      if (typeof input.ja !== 'boolean') {
        return respondJSON(res, { error: 'Feld "ja" muss true oder false sein.' }, 400)
      }
      try {
        const r = suggestionStore.entscheide(String(input.id ?? ''), input.ja, {
          // Ein Ja auf einen älteren Vorschlag mit inzwischen vergangenem
          // Datum legt die Aufgabe auf heute, statt das Ja abzulehnen.
          todo: (nutzlast) => hermesApi.addTodo(nutzlast, { vergangenIstHeute: true }),
          termin: (nutzlast) => hermesApi.addEvent(nutzlast),
        })
        console.log(`[vorschlag] ${r.id}: ${r.ja ? 'JA' : 'nein'}${r.angelegt ? ` → angelegt ${r.angelegt}` : ''}`)
        return respondJSON(res, { ok: true, ...r })
      } catch (e) {
        return respondJSON(res, { ok: false, error: e.message }, e.status || 400)
      }
    }

    // ── Kalender-Postausgang (Browser, ohne Hermes-Token) ───────────────────
    // Von hier stellt Paul einen Termin in den Postausgang oder loescht ihn.
    // Das eigentliche Schreiben in den Kalender macht Hermes ueber den
    // /api/hermes-Zweig — der Browser hat weder Token noch CalDAV-Zugang.
    if (pathname === '/api/calendar/outbox' && req.method === 'GET') {
      return respondJSON(res, calendarOutbox.postausgang())
    }
    {
      const m = /^\/api\/calendar\/outbox\/(.+)$/.exec(pathname)
      if (m && (req.method === 'POST' || req.method === 'DELETE')) {
        const id = decodeURIComponent(m[1])
        try {
          if (req.method === 'POST') {
            const e = calendarOutbox.inKalender(id)
            console.log(`[kalender] in den Postausgang: ${e.title}`)
            return respondJSON(res, { ok: true, termin: e })
          }
          const r = calendarOutbox.loesche(id)
          console.log(`[kalender] loeschen: ${id}` + (r.sofortWeg ? ' (war nie im Kalender)' : ' → Loeschauftrag'))
          return respondJSON(res, { ok: true, ...r })
        } catch (e) {
          return respondJSON(res, { error: e.message }, e.status || 400)
        }
      }
    }

    // ── Vorgänge im Fokus (Browser, ohne Hermes-Token) ──────────────────────
    // Dieselbe Ablage wie /api/hermes/focus, andere Tür: der Browser hat kein
    // HERMES_TOKEN und soll auch keins bekommen — es steckte sonst im
    // ausgelieferten JavaScript. ANLEGEN und LÖSCHEN gibt es nur hier, hinter
    // dem Basic-Auth-Gate: das ist Pauls Entscheidung, nicht Hermes'.
    if (pathname === '/api/focus') {
      if (req.method === 'GET') return respondJSON(res, focusStore.zustand())
      if (req.method === 'POST') {
        const input = await leseJson(req, res); if (input === undefined) return
        try {
          // Todo → Fokus ist VERSCHIEBEN, nicht Kopieren: steht `vonTodoId`
          // drin, verschwindet das Todo. Sonst stünde derselbe Text an zwei
          // Orten und liefe auseinander, sobald einer abgehakt wird.
          let ausTodo = null
          if (typeof input.vonTodoId === 'string' && input.vonTodoId) {
            ausTodo = hermesApi.deleteTodo(input.vonTodoId)
            if (!ausTodo) return respondJSON(res, { error: `Kein Todo mit der id ${input.vonTodoId}.` }, 404)
            if (!input.titel) input.titel = ausTodo.text
          }
          const v = focusStore.anlegen(input)
          console.log(`[fokus] angelegt: ${v.titel} (${v.zustand})` + (ausTodo ? ' — aus Todo verschoben' : ''))
          return respondJSON(res, { ok: true, vorgang: v, ausTodo: ausTodo?.id ?? null }, 201)
        } catch (e) {
          return respondJSON(res, { ok: false, error: e.message, ...(e.imFokus ? { imFokus: e.imFokus } : {}) }, e.status || 400)
        }
      }
    }
    // Ein Kind-Todo wurde abgehakt → der Vorgang hat sich bewegt.
    // Eigene Route und nicht Teil von PATCH: der Browser kennt die Verweise
    // nicht und soll sie auch nicht kennen. Er meldet nur "dieses Todo ist
    // durch", der Server sucht den passenden Vorgang.
    if (pathname === '/api/focus/todo-done' && req.method === 'POST') {
      const input = await leseJson(req, res); if (input === undefined) return
      const getroffen = focusStore.bewegungDurchTodo(String(input.todoId ?? ''))
      if (getroffen.length) console.log(`[fokus] Schritt erledigt → ${getroffen.map((v) => v.titel).join(', ')}`)
      // Kam das Todo aus einer Frist, lernt das Vorlaufbuch daraus, wie
      // knapp es war. Nachgetragenes von gestern bringt `erledigtAm` mit.
      try {
        vorlaufStore.vermerkeErledigt(String(input.todoId ?? ''), input.erledigtAm)
      } catch (e) {
        console.warn('[vorlauf] Vermerk fehlgeschlagen:', e && e.message)
      }
      return respondJSON(res, { ok: true, bewegt: getroffen.map((v) => v.id) })
    }

    {
      const m = /^\/api\/focus\/(.+)$/.exec(pathname)
      if (m && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const id = decodeURIComponent(m[1])
        if (req.method === 'DELETE') {
          try { return respondJSON(res, { ok: true, entfernt: focusStore.entfernen(id) }) }
          catch (e) { return respondJSON(res, { error: e.message }, e.status || 400) }
        }
        const input = await leseJson(req, res); if (input === undefined) return
        try {
          // Fokus → Todo: der Vorgang geht, der Text lebt als Todo weiter.
          if (input.nachTodo === true) {
            const alt = focusStore.zustand().vorgaenge.find((v) => v.id === id)
            if (!alt) return respondJSON(res, { error: `Kein Vorgang mit der id ${id}.` }, 404)
            const todo = hermesApi.addTodo({ text: alt.titel, priority: 'normal' })
            focusStore.entfernen(id)
            console.log(`[fokus] "${alt.titel}" → zurück als Todo`)
            return respondJSON(res, { ok: true, todo, entfernt: id })
          }
          // Kind-Todo: der Vorgang BLEIBT stehen. Der Vorgang ist die Sache,
          // das Todo die Handlung — das ist keine Doppelung.
          if (typeof input.kindTodoText === 'string' && input.kindTodoText.trim()) {
            const todo = hermesApi.addTodo({ text: input.kindTodoText.trim(), priority: 'normal' })
            return respondJSON(res, { ok: true, vorgang: focusStore.aendern(id, { schrittTodoId: todo.id }), todo })
          }
          return respondJSON(res, { ok: true, vorgang: focusStore.aendern(id, input) })
        } catch (e) {
          return respondJSON(res, { error: e.message }, e.status || 400)
        }
      }
    }

    // "Fertig" — der Dialog ist für heute durch. "Später" ruft das NICHT auf:
    // dann kommt er morgen wieder, und nichts ist entschieden.
    if (pathname === '/api/suggestions/ack' && req.method === 'POST') {
      const r = suggestionStore.quittiere()
      console.log(`[vorschlag] Morgendialog quittiert für ${r.quittiertAm} (${r.offenGeblieben} unentschieden)`)
      return respondJSON(res, { ok: true, ...r })
    }

    if (pathname === '/api/briefing/status') {
      const s = briefingStore.status()
      return respondJSON(res, s, s.state === 'error' ? 503 : 200)
    }

    // Betriebsampel. NUR Metadaten — keine Inhalte, keine Geheimnisse. 503,
    // sobald der Zustand unlesbar ist: dann steht der Dienst zwar noch, darf
    // aber nichts mehr schreiben, und genau das muss ein Monitor sehen.
    if (pathname === '/api/health') {
      const st = stateStore.readiness()
      const b = briefingStore.status()
      const gesund = st.ok && b.state !== 'error'
      return respondJSON(res, {
        status: gesund ? 'ok' : 'degraded',
        serverDate: briefingStore.serverDate(),
        state: { readable: st.ok, code: st.ok ? null : st.code, keys: st.keys ?? null, updatedAt: st.updatedAt ?? null },
        briefing: { state: b.state, eligibleNow: b.eligibleNow, revision: b.revision ? b.revision.slice(0, 12) : null },
        sources: {
          calendar: haveSource,
          brain: (() => { try { const r = brainSource.serveBrain(); return !!(r && r.ok) } catch { return false } })(),
        },
        // Wie alt ist das Brain, das Daily sieht? „brain: true“ allein sagt
        // nur, dass es lesbar ist — eine stehende Spiegelung sähe genauso aus.
        brain: (() => { try { return brainPages.freshness() } catch { return { ok: false } } })(),
        // Was Daily an Hermes zurueckgewiesen hat. Gehoert in die
        // Gesundheitsauskunft, weil es genau der Fall ist, den sonst niemand
        // sieht: Hermes' Auftrag meldet ok, die Daten sind trotzdem weg.
        hermes: rejectLog.zustand(),
        // Kanäle, in denen etwas längst hätte passieren sollen.
        kanaele: (() => { try { return kanaele.stand().probleme } catch (e) { return [`Kanalprüfung: ${e.message}`] } })(),
        uptimeSec: Math.round(process.uptime()),
      }, gesund ? 200 : 503)
    }
    if (pathname === '/api/hermes-chat') {
      // Der Kalender-Cache geht mit, damit Hermes die Tageslage nicht selbst
      // zusammensuchen muss — das kostet ihn sonst Werkzeug-Aufrufe und Zeit.
      return hermesChat.handle(req, res, haveSource ? cacheToday : [])
    }
    // Mit Hermes sprechen — hinter der normalen Anmeldung: Paul redet, nicht
    // Hermes. GET sagt der Oberfläche, ob es geht, und wärmt die Erkennung an,
    // damit das Modell schon geladen ist, wenn Paul aufs Mikrofon drückt.
    if (pathname === '/api/stimme') {
      const hoeren = stimmeHoeren.bereit()
      if (hoeren) stimmeHoeren.starte()
      return respondJSON(res, { hoeren, hermes: hermesStimme.eingerichtet() })
    }
    if (pathname === '/api/stimme/hoeren') return stimmeHoeren.handle(req, res)
    if (pathname === '/api/stimme/vorlesen') return stimmeKurz.handle(req, res)
    if (pathname === '/api/stimme/sag' || pathname === '/api/stimme/zuruecknehmen') {
      return hermesStimme.handle(req, res, pathname, haveSource ? cacheToday : [], haveSource ? cacheUpcoming : [])
    }
    if (pathname === '/api/anthropic') {
      // Der Verbrauch kommt als Rückruf aus dem Proxy statt aus einem
      // überschriebenen res.end(): bei Streaming liefe die Antwort sonst in
      // vielen res.write()-Paketen an der Messung vorbei.
      return handleAnthropic(req, res, recordUsage)
    }
    if (pathname === '/api/calendar/today') {
      if (Date.now() - lastFetch > REFRESH_MS) await refresh()
      return respondJSON(res, haveSource ? cacheToday : null)
    }
    if (pathname === '/api/calendar/upcoming') {
      if (Date.now() - lastFetch > REFRESH_MS) await refresh()
      return respondJSON(res, haveSource ? cacheUpcoming : null)
    }
    if (pathname === '/api/triage') {
      await refreshTriageCache() // no-op unless the daily window just opened
      return respondJSON(res, cacheTriage)
    }
    // Weekly Claude/GLM quota for the edge bars
    if (pathname === '/api/usage') {
      if (Date.now() - lastUsageFetch > USAGE_REFRESH_MS) await refreshUsageCache()
      return respondJSON(res, { claude: cacheClaudeUsage, glm: cacheGlmUsage })
    }
    // Curated Second-Brain pages (people + working style) for Jarvis's persona
    // Hörbriefing für den Morgendialog: Status, Text, Frage — und die Aufnahme.
    if (pathname === '/api/hoerbriefing') {
      return respondJSON(res, hoerbriefing.heuteFuerAnzeige())
    }
    if (pathname === '/api/hoerbriefing/audio') {
      const datum = new URL(req.url, 'http://x').searchParams.get('datum') || hoerbriefing.serverDate()
      const datei = hoerbriefing.audioPfad(datum)
      if (!datei) return respondJSON(res, { error: 'Keine fertige Aufnahme.' }, 404)
      return hoerbriefing.sendeAudio(req, res, datei)
    }
    if (pathname === '/api/brain') {
      return respondJSON(res, brainSource.serveBrain())
    }
    // Die Brain-Seiten zum Fach, das gerade im Timer läuft (brainPages.cjs).
    if (pathname === '/api/brain/fach') {
      const name = new URL(req.url, 'http://x').searchParams.get('name') || ''
      return respondJSON(res, brainPages.pagesForSubject(name.slice(0, 80)))
    }
    // Suche für Jarvis' Offline-Modus: nur die Stellen, die zur Frage passen,
    // statt das ganze Wiki in jeden Prompt zu packen.
    if (pathname === '/api/brain/suche') {
      const q = new URL(req.url, 'http://x').searchParams.get('q') || ''
      return respondJSON(res, brainPages.search(q.slice(0, 400)))
    }
    // Was seit gestern ins Brain kam — eine leise Zeile im Intro.
    if (pathname === '/api/brain/neu') {
      return respondJSON(res, brainPages.neuImBrain())
    }
    if (pathname === '/api/brain/stand') {
      return respondJSON(res, brainPages.freshness())
    }
    // Woran Paul gerade in LearnHarness lernt (learnHarness.cjs). Mit ?fach=
    // werden die Themen markiert, die zum Fach im Timer passen.
    if (pathname === '/api/learnharness') {
      const fach = (new URL(req.url, 'http://x').searchParams.get('fach') || '').slice(0, 80)
      tickLearnHarness()
      const stand = { ...learnHarness.lernstand(), sitzungenOhneFach: learnHarnessSitzungen.letzterStand().ohneFach }
      if (!stand.ok || !fach) return respondJSON(res, stand)
      return respondJSON(res, { ...stand, themen: stand.themen.map((t) => ({ ...t, passtZumFach: learnHarness.passtZuFach(t, fach) })) })
    }
    // Zurueckgewiesene Hermes-Aufrufe der letzten 24 Stunden — die Oberflaeche
    // zeigt daraus einen schmalen Streifen, aber NUR wenn es etwas gibt.
    // Freie Bloecke der naechsten Tage, gerechnet aus dem Kalender.
    if (pathname === '/api/gaps') {
      return respondJSON(res, gaps.luecken())
    }
    // Aus einem freien Block einen Lernblock machen: Termin anlegen UND in den
    // Postausgang stellen. Beides in einem Aufruf, weil ein angelegter Termin,
    // der nicht im Postausgang landet, genau die stille Haelfte waere, die
    // niemand bemerkt.
    if (pathname === '/api/gaps/plan' && req.method === 'POST') {
      const input = await leseJson(req, res); if (input === undefined) return
      try {
        const ev = hermesApi.addEvent({
          title: String(input.titel || 'Lernblock').slice(0, 120),
          date: input.tag,
          kind: 'note',
          startZeit: input.von,
          endZeit: input.bis,
          note: 'Aus einer freien Kalenderluecke geplant.',
        })
        const imPostausgang = calendarOutbox.inKalender(ev.id)
        console.log(`[luecke] Lernblock ${ev.date} ${ev.startZeit || ''}-${ev.endZeit || ''}: ${ev.title}`)
        return respondJSON(res, { ok: true, termin: imPostausgang })
      } catch (e) {
        return respondJSON(res, { error: e.message }, e.status || 400)
      }
    }
    // Der letzte Tagesabschluss — was gestern liegenblieb, was am laengsten
    // mitlaeuft. Siehe dayClose.cjs.
    if (pathname === '/api/day-close') {
      return respondJSON(res, dayClose.letzter() ?? { tag: null })
    }
    // Die offene Vorlauf-Frage — siehe vorlaufStore.cjs.
    if (pathname === '/api/vorlauf' && req.method === 'GET') {
      return respondJSON(res, vorlaufStore.zustand())
    }
    if (pathname === '/api/vorlauf/antwort' && req.method === 'POST') {
      const input = await leseJson(req, res); if (input === undefined) return
      try {
        return respondJSON(res, { ok: true, ...vorlaufStore.antworte(input.vorlaufTage) })
      } catch (e) {
        return respondJSON(res, { error: e.message }, e.status || 400)
      }
    }
    if (pathname === '/api/vorlauf/verwerfen' && req.method === 'POST') {
      try {
        return respondJSON(res, { ok: true, ...vorlaufStore.verwirf() })
      } catch (e) {
        return respondJSON(res, { error: e.message }, e.status || 400)
      }
    }
    // Was der letzte Tagesbeginn uebertragen hat.
    if (pathname === '/api/day-start') {
      return respondJSON(res, dayStart.letzter() ?? { tag: null })
    }
    if (pathname === '/api/rejections') {
      return respondJSON(res, rejectLog.zustand())
    }
    if (pathname === '/api/kanaele') {
      return respondJSON(res, kanaele.stand())
    }
    // Abo-Uebersicht ganz unten im Dashboard: Plan, Laufzeit, Verbrauch, Kosten
    // fuer Claude, z.ai/GLM und Codex — siehe electron/subscriptions.cjs.
    if (pathname === '/api/subscriptions') {
      return respondJSON(res, await subscriptions.uebersicht())
    }
    // Per-day/model token counts of the app's own AI calls (UsageCard)
    if (pathname === '/api/token-usage') {
      return respondJSON(res, usageStore)
    }
    serveStatic(pathname, res)
  })
}

/** Bindeadresse des Servers.
 *
 *  Vorgabe ist 127.0.0.1 — dann hört er nur auf dem eigenen Rechner, so wie
 *  bisher auf dem Mac. Auf der VM muss weiter geöffnet werden (0.0.0.0 oder die
 *  Tailscale-Adresse), sonst kommt niemand ran. Das geht über DAILY_HOST.
 *
 *  ABER: ist kein AUTH_PASS gesetzt, gibt checkAuth() jede Anfrage frei. Offen
 *  im Netz stünden damit Kalender, Mail-Auswertung, das Second Brain UND
 *  /api/anthropic — also ein kostenloser Claude-Proxy auf fremde Rechnung.
 *  Deshalb wird DAILY_HOST ohne Passwort ignoriert. Die Reihenfolge
 *  "erst Passwort, dann öffnen" ist damit nicht mehr vergessbar. */
function bindHost() {
  const wanted = (process.env.DAILY_HOST || '').trim()
  if (!wanted || wanted === '127.0.0.1' || wanted === 'localhost') return '127.0.0.1'
  const { pass } = getCredentials()
  if (!pass) {
    console.error('[Daily server] ⚠️  DAILY_HOST=' + wanted + ' wird IGNORIERT — AUTH_PASS ist nicht gesetzt.')
    console.error('[Daily server]     Ohne Passwort wird nur 127.0.0.1 bedient. Erst AUTH_PASS in die')
    console.error('[Daily server]     Umgebung legen, dann neu starten.')
    return '127.0.0.1'
  }
  return wanted
}

/** Start the server. Pass a FIXED port so the renderer origin (and its
 *  localStorage / IndexedDB) is stable across launches. Resolves { port, server }. */
function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    const host = bindHost()
    server.listen(port || 0, host, () => {
      // Wire up the calendar source once the port is bound. refresh() prefers
      // the local JSON export and only falls back to iCal, so we always start it.
      ICAL_URL = getIcalUrl()
      loadUsage()
      pruneUsage()
      void refresh()
      setInterval(() => void refresh(), REFRESH_MS)
      // Show the last classified inbox instantly; the real read+classify is
      // gated to once per day at TRIAGE_HOUR. Seed the day-marker from the
      // cache so a restart doesn't re-refresh if today was already done.
      cacheTriage = mailTriage.servedCached()
      lastTriageDay = mailTriage.lastRefreshDay()
      void refreshTriageCache()
      setInterval(() => void refreshTriageCache(), TRIAGE_TICK_MS)
      void refreshUsageCache()
      setInterval(() => void refreshUsageCache(), USAGE_REFRESH_MS)
      // Beim Start einmal pruefen: war die Maschine ueber Nacht aus, wird der
      // Abschluss nachgeholt, statt den Tag stillschweigend zu ueberspringen.
      tickAbschluss()
      setInterval(tickAbschluss, ABSCHLUSS_TICK_MS)
      // Der Tagesbeginn haengt nicht an einer Uhrzeit, sondern am Datumswechsel:
      // er soll gelaufen sein, BEVOR Paul morgens hinsieht. Beim Start einmal,
      // dann im selben Takt — war die Maschine ueber Nacht aus, holt er nach.
      tickTagesbeginn()
      setInterval(tickTagesbeginn, ABSCHLUSS_TICK_MS)
      tickLearnHarness()
      setInterval(tickLearnHarness, LEARNHARNESS_TICK_MS)
      const actual = server.address().port
      console.log('[Daily server] listening on http://' + host + ':' + actual)

      // ZUSAETZLICH auf 127.0.0.1 hoeren, wenn die Hauptadresse eine andere ist.
      //
      // WARUM
      // Am 12.09. lieferte Hermes' Briefing-Auftrag nichts und meldete trotzdem
      // "completed". Seine Ausgabe sagte den Grund: "Daily ist lokal nicht
      // erreichbar (127.0.0.1:4861 verweigert die Verbindung)". Der Dienst hoert
      // nur auf DAILY_HOST — der Tailscale-Adresse. Jedes Werkzeug auf DERSELBEN
      // Maschine, das die naheliegende Annahme "localhost" trifft, laeuft ins
      // Leere. Das ist keine Eigenart von Hermes; es ist die Standardannahme.
      //
      // WARUM DAS NICHTS OEFFNET
      // 127.0.0.1 ist per Definition nur von diesem Rechner aus erreichbar. Wer
      // dort ankommt, ist ohnehin schon auf der Maschine. Die Basis-Anmeldung
      // gilt unveraendert. Ausdruecklich NICHT 0.0.0.0 — das haenge an jeder
      // Netzwerkkarte, auch der oeffentlichen.
      if (host !== '127.0.0.1' && host !== 'localhost') {
        const lokal = createServer()
        lokal.on('error', (e) => {
          // Ein belegter Localhost-Port darf den Dienst nicht mitnehmen: die
          // Hauptadresse laeuft ja. Laut melden, weitermachen.
          console.warn('[Daily server] 127.0.0.1:' + actual + ' nicht zusaetzlich belegbar:', e && e.message)
        })
        lokal.listen(actual, '127.0.0.1', () => {
          console.log('[Daily server] zusaetzlich erreichbar auf http://127.0.0.1:' + actual)
        })
      }

      resolve({ port: actual, server })
    })
  })
}

module.exports = { startServer }
