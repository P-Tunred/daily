// Weekly "KI-Nutzung" stats for the small footer dropdown. Two independent
// sources, each degrading gracefully on its own:
//
//  - Claude: local Claude Code session log (~/.claude/metrics/costs.jsonl,
//    written by a Stop hook). This is CLI usage/estimated cost — NOT the
//    claude.ai Pro/Max subscription's own 5h/weekly rate-limit quota, which
//    has no public API. Closest available proxy for "how much have I used".
//  - GLM (z.ai): the real quota-monitoring API, gated on a ZAI_API_KEY in
//    .env. Endpoint + response shape aren't publicly documented by z.ai —
//    verified instead against github.com/guyinwonder168/opencode-glm-quota,
//    a maintained open-source client for the same endpoint.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { dataPath } = require('./dataDir.cjs')

const COSTS_PATH = path.join(os.homedir(), '.claude', 'metrics', 'costs.jsonl')
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const GLM_QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'

// Claude Pro plan quota — the same undocumented endpoint Claude Code's own
// /usage screen reads with the local OAuth login. Verified against two
// independent open-source clients (blueberrycongee/termcanvas,
// s-soroosh/claude-code-js); may break if Anthropic changes it.
const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e' // Claude Code's public client id
const PLAN_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TOKEN_MIN_TTL_MS = 60_000

// ── Claude Code (local session log) ─────────────────────────────────────────

function readCostRows() {
  let text
  try {
    text = fs.readFileSync(COSTS_PATH, 'utf-8')
  } catch {
    return []
  }
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* skip malformed row */ }
  }
  return rows
}

/** Monday 00:00 local time of the week containing `now` — the UI shows
 *  "diese Woche" with a fixed reset point, not a rolling 7-day window. */
function startOfWeekMs(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/** The hook appends one row per assistant turn, and each row holds the
 *  CUMULATIVE total for that session so far (not a delta) — so we dedupe to
 *  the latest row per session_id before summing, or a multi-turn session
 *  would be counted many times over. */
function getWeeklyClaudeUsage(now = Date.now()) {
  const rows = readCostRows()
  const weekStart = startOfWeekMs(now)
  const resetAt = new Date(weekStart + WEEK_MS).toISOString()
  if (rows.length === 0) return { available: false, resetAt }

  const since = weekStart
  const latestBySession = new Map()
  for (const row of rows) {
    const ts = Date.parse(row.timestamp)
    if (!Number.isFinite(ts) || ts < since) continue
    const sid = row.session_id || 'default'
    const prev = latestBySession.get(sid)
    if (!prev || ts > prev._ts) latestBySession.set(sid, { ...row, _ts: ts })
  }
  if (latestBySession.size === 0) return { available: false, resetAt }

  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const row of latestBySession.values()) {
    costUsd += Number(row.estimated_cost_usd) || 0
    inputTokens += Number(row.input_tokens) || 0
    outputTokens += Number(row.output_tokens) || 0
  }

  return {
    available: true,
    sessions: latestBySession.size,
    costUsd: Math.round(costUsd * 100) / 100,
    inputTokens,
    outputTokens,
    resetAt,
  }
}

// ── Claude Pro plan (real subscription quota via Claude Code's OAuth login) ──
// The token lives in the macOS Keychain where Claude Code (CLI) put it. It
// never leaves this process: /api/usage only serves derived percentages.

function readKeychainDoc() {
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf-8', timeout: 5000 },
    )
    const parsed = JSON.parse(raw.trim())
    return parsed && parsed.claudeAiOauth ? parsed : null
  } catch {
    return null
  }
}

function readKeychainAccount() {
  try {
    const out = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE],
      { encoding: 'utf-8', timeout: 5000 },
    )
    const m = out.match(/"acct"<blob>="([^"]*)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Rotating refresh tokens: after a refresh the OLD refresh token may be
 *  invalid, so persisting the new pair back is not optional — skipping it
 *  would silently log Claude Code (CLI) out. Best-effort beyond that. */
function writeKeychainDoc(doc) {
  const account = readKeychainAccount()
  if (!account) return
  try {
    execFileSync(
      '/usr/bin/security',
      ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', JSON.stringify(doc)],
      { encoding: 'utf-8', timeout: 5000 },
    )
  } catch { /* best-effort */ }
}

// ── Zugangsdaten als Datei (Linux) ──────────────────────────────────────────
// Auf dem Mac liegen sie im Schluesselbund, auf Linux legt Claude Code sie als
// Datei ab. Damit kann sich die VM EIGENSTAENDIG anmelden (`claude login`) und
// die Quote rund um die Uhr selbst holen — ohne den Mac.
//
// WARUM NICHT `claude setup-token`
// Ausprobiert, geht nicht: Anthropic antwortet 403 "does not meet scope
// requirement user:profile". So ein Token darf Inferenz, aber keine Kontodaten
// lesen — und genau daran haengt die Quote. Nur eine vollstaendige Anmeldung
// bringt die noetige Berechtigung mit.
//
// WARUM DAS DIE MAC-ANMELDUNG NICHT STOERT
// Es ist eine EIGENE Anmeldung mit eigenem Token. Gefaehrlich waere nur, ein
// und denselben rotierenden Token auf zwei Maschinen zu benutzen — das ist
// hier nicht der Fall.
//
// Die Datei gehoert dem Dienst und wird von ihm fortgeschrieben: erneuert er
// den Token, muss das neue Paar zurueck in die Datei, sonst ist die Anmeldung
// beim naechsten Mal wertlos.
const CREDS_PATH = (process.env.CLAUDE_CREDENTIALS_PATH || '').trim() || dataPath('claude-credentials.json')

function readCredsFile() {
  try {
    const doc = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'))
    return doc && doc.claudeAiOauth ? doc : null
  } catch {
    return null
  }
}

function writeCredsFile(doc) {
  try {
    fs.mkdirSync(path.dirname(CREDS_PATH), { recursive: true })
    const tmp = CREDS_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, CREDS_PATH)
  } catch (e) {
    console.warn('[usage] Zugangsdaten konnten nicht zurueckgeschrieben werden:', e.message)
  }
}

/** Schluesselbund zuerst (macOS), sonst die Datei — je nachdem, wo dieser
 *  Rechner seine Anmeldung hat. */
function readCreds() {
  return readKeychainDoc() || readCredsFile()
}

function writeCreds(doc) {
  if (readKeychainDoc()) writeKeychainDoc(doc)
  else writeCredsFile(doc)
}

/** Liefert einen gueltigen Zugangstoken — ODER den Grund, warum nicht.
 *
 *  WARUM NICHT EINFACH `null`
 *  Vorher gab diese Funktion in vier verschiedenen Faellen dasselbe `null`
 *  zurueck: nie angemeldet, Token abgelaufen, Erneuerung abgelehnt, Netz weg.
 *  Oben kam davon nur "Login noetig" an — und weil das auch beim allerersten
 *  Start dransteht, war acht Tage lang nicht zu sehen, dass die Anmeldung
 *  einmal funktioniert hatte und am 22.08. gestorben war. Ein Fehler, der wie
 *  ein Anfangszustand aussieht, wird nie repariert. */
async function getFreshAccessToken() {
  const doc = readCreds()
  const creds = doc && doc.claudeAiOauth
  if (!creds) return { token: null, grund: 'nie-angemeldet' }
  const plan = typeof creds.subscriptionType === 'string' ? creds.subscriptionType : null
  const abgelaufenSeit = typeof creds.expiresAt === 'number' ? new Date(creds.expiresAt).toISOString() : null
  if (
    creds.accessToken &&
    typeof creds.expiresAt === 'number' &&
    creds.expiresAt - Date.now() > TOKEN_MIN_TTL_MS
  ) {
    return { token: creds.accessToken, grund: null, plan, abgelaufenSeit: null }
  }
  if (!creds.refreshToken) return { token: null, grund: 'kein-erneuerungstoken', plan, abgelaufenSeit }
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    // 400 invalid_grant heisst: der Erneuerungstoken ist verbraucht oder
    // zurueckgezogen. Das ist NICHT dasselbe wie "Netz kaputt" und braucht
    // eine andere Handlung — naemlich eine neue Anmeldung am Mac.
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const tot = res.status === 400 && /invalid_grant/.test(text)
      return { token: null, grund: tot ? 'anmeldung-abgelaufen' : 'erneuerung-http-' + res.status, plan, abgelaufenSeit }
    }
    const p = await res.json()
    if (!p || typeof p.access_token !== 'string') return { token: null, grund: 'erneuerung-unerwartet', plan, abgelaufenSeit }
    writeCreds({
      ...doc,
      claudeAiOauth: {
        ...creds,
        accessToken: p.access_token,
        refreshToken: typeof p.refresh_token === 'string' ? p.refresh_token : creds.refreshToken,
        expiresAt: Date.now() + (Number(p.expires_in) || 0) * 1000,
      },
    })
    return { token: p.access_token, grund: null, plan, abgelaufenSeit: null }
  } catch {
    return { token: null, grund: 'netz', plan, abgelaufenSeit }
  }
}

/** Real Pro-plan quota (weekly + 5h window), or null so callers can fall back
 *  to the local session-log estimate. */
async function planQuote() {
  const auth = await getFreshAccessToken()
  if (!auth.token) return { ok: false, grund: auth.grund, plan: auth.plan, abgelaufenSeit: auth.abgelaufenSeit }
  try {
    const res = await fetch(PLAN_USAGE_URL, {
      headers: { Authorization: 'Bearer ' + auth.token, 'anthropic-beta': 'oauth-2025-04-20' },
    })
    if (!res.ok) return { ok: false, grund: 'quote-http-' + res.status, plan: auth.plan, abgelaufenSeit: null }
    const body = await res.json()
    const week = body && body.seven_day
    const five = body && body.five_hour
    if (!week || typeof week.utilization !== 'number') {
      return { ok: false, grund: 'quote-unerwartet', plan: auth.plan, abgelaufenSeit: null }
    }
    const usedPct = Math.max(0, Math.min(100, week.utilization))
    return {
      ok: true,
      plan: auth.plan,
      daten: {
        available: true,
        source: 'plan',
        planName: auth.plan,
        usedPct,
        remainingPct: 100 - usedPct,
        resetAt: typeof week.resets_at === 'string' ? week.resets_at : null,
        fiveHourUsedPct: five && typeof five.utilization === 'number'
          ? Math.max(0, Math.min(100, five.utilization))
          : null,
      },
    }
  } catch {
    return { ok: false, grund: 'netz', plan: auth.plan, abgelaufenSeit: null }
  }
}

/** Unveraenderter Vertrag fuer bestehende Aufrufer (scripts/push-claude-usage.mjs):
 *  die echten Zahlen, oder `null`. Wer den GRUND braucht, nimmt planQuote(). */
async function getClaudePlanUsage() {
  const q = await planQuote()
  return q.ok ? q.daten : null
}

// ── Zugespielte Quote (Mac → Server) ────────────────────────────────────────
// WARUM ES DAS BRAUCHT
// Die echte Abo-Quote haengt am OAuth-Login von Claude Code, und der liegt im
// macOS-Schluesselbund. Auf der Linux-VM, wo Daily produktiv laeuft, gibt es
// den nicht — die Anzeige blieb deshalb dauerhaft leer.
//
// WARUM NICHT EINFACH DEN TOKEN KOPIEREN
// Weil der Refresh-Token ROTIERT: erneuert ihn die VM, ist die Kopie auf dem
// Mac ungueltig und Claude Code dort waere ausgeloggt. Zwei Maschinen an einem
// rotierenden Token schliessen sich gegenseitig aus. Stattdessen rechnet der
// Mac die Prozentzahlen selbst aus und schiebt NUR diese hoch — kein
// Zugangsdatum verlaesst je den Rechner, auf dem es hingehoert.
const PUSHED_PATH = dataPath('claude-usage.json')
// 36 Stunden, nicht 6: der Mac schläft nachts, und genau dann passiert an der
// Quote ohnehin nichts. Mit 6 Stunden stand die Anzeige jeden Morgen leer da,
// obwohl der letzte Wert noch völlig richtig war. Ganz ohne Grenze soll es aber
// auch nicht sein — ein tagealter Stand als aktuelle Quote wäre gelogen.
const PUSHED_MAX_AGE_MS = 36 * 60 * 60 * 1000

function readPushedUsage() {
  try {
    const doc = JSON.parse(fs.readFileSync(PUSHED_PATH, 'utf-8'))
    if (!doc || typeof doc.usedPct !== 'number') return null
    const age = Date.now() - Date.parse(doc.receivedAt || 0)
    // Veraltete Werte lieber gar nicht zeigen als falsch: ein zwei Tage alter
    // Stand sieht aus wie eine aktuelle Quote und waere schlicht gelogen.
    if (!Number.isFinite(age) || age > PUSHED_MAX_AGE_MS) return null
    return { ...doc, source: 'pushed', ageMs: age }
  } catch {
    return null
  }
}

function writePushedUsage(input) {
  const usedPct = Number(input && input.usedPct)
  if (!Number.isFinite(usedPct) || usedPct < 0 || usedPct > 100) {
    throw new Error('Feld "usedPct" braucht 0–100')
  }
  const doc = {
    available: true,
    usedPct,
    remainingPct: 100 - usedPct,
    resetAt: typeof input.resetAt === 'string' ? input.resetAt : null,
    fiveHourUsedPct: Number.isFinite(Number(input.fiveHourUsedPct)) ? Number(input.fiveHourUsedPct) : null,
    // Der Planname steht nur im Schluesselbund des Macs. Ohne ihn muesste die
    // Abo-Karte "Pro" raten — und raten ist in einer Kostenuebersicht falsch.
    planName: typeof input.planName === 'string' && input.planName.trim() ? input.planName.trim() : null,
    receivedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(PUSHED_PATH), { recursive: true })
  fs.writeFileSync(PUSHED_PATH, JSON.stringify(doc, null, 2) + '\n')
  return doc
}

/** Reihenfolge nach Verlaesslichkeit: eigener Token (fest hinterlegt oder aus
 *  dem Schluesselbund), dann die vom Mac zugespielte Quote als Rueckfallebene,
 *  zuletzt der lokale Sitzungs-Schaetzwert. Sobald CLAUDE_OAUTH_TOKEN steht,
 *  greift der erste Weg und der Mac wird nicht mehr gebraucht. */
// Aus einem Kuerzel wird ein Satz, der sagt, was zu TUN ist. "Login noetig"
// beschreibt einen Zustand; "die Anmeldung am Mac ist abgelaufen" beschreibt
// eine Ursache, und nur damit weiss man, wo man hingreifen muss.
const GRUND_TEXT = {
  'nie-angemeldet': 'Claude Code ist auf diesem Rechner nicht angemeldet. Im Terminal: claude, dann /login.',
  'anmeldung-abgelaufen': 'Die Claude-Anmeldung ist abgelaufen und lässt sich nicht erneuern. Im Terminal: claude, dann /login.',
  'kein-erneuerungstoken': 'Die hinterlegte Anmeldung ist unvollständig. Neu anmelden: claude, dann /login.',
  'erneuerung-unerwartet': 'Anthropic hat auf die Erneuerung unerwartet geantwortet.',
  netz: 'Anthropic war nicht erreichbar.',
}

function grundText(grund) {
  if (!grund) return 'Kontingent nicht abrufbar.'
  if (GRUND_TEXT[grund]) return GRUND_TEXT[grund]
  if (grund.startsWith('erneuerung-http-')) return `Die Erneuerung der Anmeldung schlug fehl (HTTP ${grund.slice(16)}).`
  if (grund.startsWith('quote-http-')) return `Anthropic lehnte die Quotenabfrage ab (HTTP ${grund.slice(11)}).`
  return 'Kontingent nicht abrufbar.'
}

/** Der zugespielte Stand OHNE Altersgrenze — nur um sagen zu koennen, wann er
 *  zuletzt gestimmt hat. Als Quote wird er hier ausdruecklich nicht benutzt. */
function readPushedRaw() {
  try {
    const doc = JSON.parse(fs.readFileSync(PUSHED_PATH, 'utf-8'))
    return doc && typeof doc.usedPct === 'number' ? doc : null
  } catch {
    return null
  }
}

async function getClaudeUsage() {
  const q = await planQuote()
  if (q.ok) return q.daten
  const pushed = readPushedUsage()
  if (pushed) return pushed

  const lokal = getWeeklyClaudeUsage()
  if (lokal.available) return { ...lokal, source: 'local' }

  // Nichts hat funktioniert. Statt eines stummen available:false geht der
  // Grund mit nach oben — samt dem Datum, an dem es zuletzt ging. Genau diese
  // beiden Angaben haben acht Tage lang gefehlt.
  const alt = readPushedRaw()
  const veraltet = alt && !pushed
  return {
    ...lokal,
    source: 'local',
    grund: veraltet ? 'mac-stand-veraltet' : q.grund,
    grundText: veraltet
      ? 'Der Mac hat seit dem letzten Stand keine neue Quote geschickt — dort ist die Claude-Anmeldung abgelaufen.'
      : grundText(q.grund),
    zuletztGesehenAm: alt ? alt.receivedAt || null : q.abgelaufenSeit || null,
    planName: q.plan || null,
  }
}

// ── GLM / z.ai (real quota API) ──────────────────────────────────────────────

function getZaiKey() {
  if (process.env.ZAI_API_KEY) return process.env.ZAI_API_KEY.trim()
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
    const m = raw.match(/^ZAI_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch { /* no .env — GLM side just stays unavailable */ }
  return undefined
}

/** z.ai encodes the averaging window as (unit, number) pairs on each limit
 *  item rather than naming it: unit=3/number=5 is their 5-hour window,
 *  unit=6/number=1 is weekly. Undocumented publicly — taken from the working
 *  parser in opencode-glm-quota (src/utils/token-limits.ts). */
// Der Typ-Name ist NICHT stabil: bis Sommer 2026 hieß er TOKENS_LIMIT, seit
// August 2026 liefert z.ai CREDIT_LIMIT für dieselben Einträge. Genau daran ist
// die Anzeige stillschweigend gestorben — die Antwort war gültig, nur der Name
// neu. Identifiziert wird ein Eintrag deshalb über das Zeitfenster (unit/number)
// und eine brauchbare Prozentzahl; der Typ wird nur noch grob geprüft, damit ein
// weiterer Umbenennen nicht wieder alles lahmlegt.
function isQuotaItem(item) {
  return !!item && typeof item.type === 'string' && /_LIMIT$/.test(item.type)
    && typeof item.percentage === 'number'
}
function isWeeklyTokenLimit(item) {
  return isQuotaItem(item) && item.unit === 6 && item.number === 1
}
function isFiveHourTokenLimit(item) {
  return isQuotaItem(item) && item.unit === 3 && item.number === 5
}

async function getWeeklyGlmUsage() {
  const key = getZaiKey()
  if (!key) return { available: false, reason: 'no-key' }

  try {
    const res = await fetch(GLM_QUOTA_URL, {
      headers: {
        // z.ai expects the raw token, no "Bearer " prefix.
        Authorization: key,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return { available: false, reason: 'http-' + res.status }
    const body = await res.json()
    const limits = body && body.data && body.data.limits
    if (!Array.isArray(limits)) return { available: false, reason: 'bad-shape' }

    const weekly = limits.find(isWeeklyTokenLimit)
    if (!weekly) return { available: false, reason: 'no-weekly-item' }
    const fiveHour = limits.find(isFiveHourTokenLimit)

    const usedPct = typeof weekly.percentage === 'number' ? weekly.percentage : 0
    return {
      available: true,
      usedPct,
      remainingPct: Math.max(0, Math.min(100, 100 - usedPct)),
      resetAt: typeof weekly.nextResetTime === 'number' ? new Date(weekly.nextResetTime).toISOString() : null,
      fiveHourUsedPct: fiveHour && typeof fiveHour.percentage === 'number' ? fiveHour.percentage : null,
      // z.ai ist der einzige der drei Anbieter, der die Planstufe und echte
      // Stueckzahlen herausgibt. Beides geht mit — "1729 von 10000" sagt mehr
      // als "17 %", und die Randleiste ignoriert die Felder einfach.
      level: typeof body.data.level === 'string' ? body.data.level : null,
      credits: typeof weekly.usage === 'number'
        ? { verbraucht: weekly.currentValue, gesamt: weekly.usage, uebrig: weekly.remaining }
        : null,
    }
  } catch {
    return { available: false, reason: 'fetch-error' }
  }
}

module.exports = {
  getClaudeUsage, getClaudePlanUsage, getWeeklyClaudeUsage, getWeeklyGlmUsage,
  readPushedUsage, writePushedUsage,
}
