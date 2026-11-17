// Chat mit Hermes — POST /api/hermes-chat
//
// WARUM EIN EIGENER WEG NEBEN /api/anthropic
// Der Anthropic-Proxy spricht mit einem Sprachmodell, das nur den Kontext
// kennt, den wir ihm mitschicken. Hermes ist etwas anderes: der Agent auf
// derselben Maschine, mit eigenem Gedächtnis, Zugriff auf Drive, Kalender,
// Mail-Archiv und dem Second Brain, das er selbst pflegt. Paul hat entschieden,
// dass die Chat-Leiste im Heute-Panel mit IHM spricht, nicht mit einer
// Jarvis-Attrappe.
//
// DIE KETTE
//   Browser → dieser Endpunkt (Basic-Auth) → 127.0.0.1:8644 (HMAC)
//   → daily-webhook-listener.py (root) → hermes -z
// Der Listener bindet nur an localhost; das HMAC-Secret liegt in
// /etc/daily/env (root:daily, 600). Beides zusammen heißt: Nur wer schon auf
// dieser Maschine ist ODER durch das Basic-Auth-Gate kam, erreicht Hermes.
// Trotzdem gilt, was Paul wissentlich entschieden hat: Wer Daily öffnen kann,
// kann Hermes Aufträge geben — deshalb kein Umweg an diesem Gate vorbei.
//
// KONTEXT-MITGIFT
// Hermes könnte sich Todos und Termine selbst zusammensuchen (er hat root),
// aber das kostet ihn Werkzeug-Aufrufe und damit spürbar Zeit. Der Zustand
// liegt hier ohnehin im stateStore — also geben wir die Tageslage gleich mit.
// Der Verlauf geht als Transkript mit, weil jeder -z-Aufruf eine frische
// Sitzung ist: ohne Transkript hätte Hermes von der vorigen Nachricht keine
// Ahnung (sein Langzeitgedächtnis ist davon unberührt).

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')
// Der Ton steht in EINER Datei — dieselbe, die Hermes' Morgen-Skill liest.
// (Der Browser band sie bis 2026-10-31 über src/lib/tone.ts ein; seit es im
// Dashboard kein Gespräch mehr gibt, braucht er sie nicht.) Zwei Persönlichkeiten im selben
// Fenster wären schlimmer als eine langweilige.
const TON = require('./tone.json')

const LISTENER_URL = 'http://127.0.0.1:8644/webhooks/daily-chat'
const MAX_BODY = 64 * 1024
const MAX_MESSAGE = 8 * 1024
const MAX_TURNS = 8            // letzte Chat-Runden, die als Transkript mitgehen
// Der Listener kappt hermes -z bei 180s — wir warten etwas länger, damit im
// Zweifel SEINE saubere 504-Meldung ankommt statt unseres nackten Abbruchs.
const UPSTREAM_TIMEOUT_MS = 190_000

function getSecret() {
  const v = process.env.HERMES_WEBHOOK_SECRET
  return v && v.trim() ? v.trim() : undefined
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > MAX_BODY) { reject(new Error('Inhalt zu groß')); req.destroy() }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// ── Tageslage aus dem Zustand ───────────────────────────────────────────────

function heuteBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

function liste(state, key) {
  try {
    const v = JSON.parse(state.localStorage[key] ?? '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

/** Kompakte Tageslage für den Prompt. Bewusst knapp: Hermes kennt Pauls Leben
 *  schon — hier geht es nur um das, was HEUTE auf dem Dashboard steht. */
function tagesLage(calendarToday) {
  const state = stateStore.read()
  const heute = heuteBerlin()

  const todos = liste(state, 'morning.todos')
    .filter((t) => t && !t.done && (t.scope ?? 'day') === 'day')
    .slice(0, 8)
    .map((t) => `- ${String(t.text).slice(0, 120)}${t.priority === 'dringend' ? ' (dringend)' : ''}`)

  const sessions = liste(state, 'morning.tracker.sessions').filter((s) => s && s.date === heute)
  const lernMin = sessions.reduce((a, s) => a + (Number(s.durationMin) || 0), 0)

  const termine = (Array.isArray(calendarToday) ? calendarToday : [])
    .slice(0, 6)
    .map((e) => {
      const zeit = e.allDay ? 'ganztags' : new Date(e.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
      return `- ${zeit} ${String(e.title).slice(0, 100)}`
    })

  const woche = liste(state, 'morning.todos')
    .filter((t) => t && !t.done && t.scope === 'week')
    .slice(0, 10)
    .map((t) => `- ${String(t.text).slice(0, 120)}${t.priority && t.priority !== 'normal' ? ` (${t.priority})` : ''}`)

  // Gelerntes aus Pauls Umgang mit Aufgaben (src/lib/prioLernen.ts).
  let profil = ''
  try {
    const p = JSON.parse(state.localStorage['morning.prioritaeten.v1'] ?? 'null')
    if (p && typeof p.profil === 'string') profil = p.profil.slice(0, 800)
  } catch { /* nichts gelernt */ }

  return [
    `Datum: ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' })}`,
    `Lernzeit heute: ${lernMin} Minuten.`,
    `Offene Aufgaben heute:\n${todos.join('\n') || '  (keine)'}`,
    `Diese Woche (noch nicht im Tag):\n${woche.join('\n') || '  (nichts)'}`,
    `Termine heute:\n${termine.join('\n') || '  (keine)'}`,
    ...(profil ? [`Was Paul erfahrungsgemäss wichtig ist (aus seinem Umgang mit Aufgaben gelernt):\n${profil}`] : []),
  ].join('\n')
}

// ── Prompt ──────────────────────────────────────────────────────────────────

function bauePrompt(message, history, calendarToday) {
  const verlauf = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'you' || m.role === 'hermes') && typeof m.text === 'string')
    .slice(-MAX_TURNS)
    .map((m) => `${m.role === 'you' ? 'Paul' : 'Du'}: ${m.text.slice(0, 600)}`)
    .join('\n')

  // Die Adresse, unter der DIESE App auf der Maschine erreichbar ist — Hermes
  // ruft sie mit seinem eigenen Bearer-Token auf (steht in /etc/daily/env,
  // die er lesen kann; wir schicken das Token nicht durch den Prompt).
  const apiBase = `http://${process.env.DAILY_HOST || '127.0.0.1'}:${process.env.PORT || '4861'}`

  return [
    `Paul schreibt dir aus der Chat-Leiste seines Daily-Dashboards. Antworte ihm direkt, auf Deutsch, per "du".`,
    `Sei voll persönlich — du kennst Paul, sein Second Brain, die Menschen um ihn. Beziehe das ein, wo es passt, statt es zu verstecken. Chat-Format: knapp, meist 1–4 Sätze, kein Markdown-Bericht. Wenn du für die Antwort ein Werkzeug brauchst (Drive, Mail, Kalender, Suche), benutz es, statt zu raten.`,
    TON.stimme,
    ``,
    `DU KANNST DIE APP WIRKLICH ÄNDERN — und sollst es, wenn Paul eine Änderung verlangt. Nicht ankündigen, MACHEN, dann in einem Satz bestätigen, was jetzt anders ist. Die Schnittstelle dieser App (Auth: "Authorization: Bearer $HERMES_TOKEN", der Wert steht in /etc/daily/env):`,
    `- Aufgaben:   GET/POST ${apiBase}/api/hermes/todos   {"text":"…","priority":"dringend|wichtig|normal","estimatedMin":n} · DELETE …/todos/<id>`,
    `- Termine:    GET/POST ${apiBase}/api/hermes/events  {"title":"…","date":"JJJJ-MM-TT","kind":"exam|deadline|birthday|note"} · DELETE …/events/<id>`,
    `- Lernziele:  GET/PUT  ${apiBase}/api/hermes/goals   PUT mit {"weekday":0-6,"minutes":n} (0=So) ODER {"weekdayMinutes":[7 Werte So..Sa]} ODER {"overrides":{"JJJJ-MM-TT":Minuten|null}} — Overrides sind einzelne Tage, weekdayMinutes ist der Dauerzustand. "5h pro Tag für die nächsten zwei Wochen" = Overrides für genau diese Daten, NICHT den Dauerzustand umwerfen.`,
    `- Second Brain: Wenn Paul sagt "merk dir das" / "ins Second Brain", schreib es in den Vault in Drive (KI/Second Brain/wiki/ — du pflegst ihn ohnehin; Loses nach log.md, sonst auf die passende Seite). Sag danach kurz, wohin. Die VM-Spiegelung zieht stündlich nach.`,
    `Was du NICHT über diese Schnittstelle kannst (ehrlich sagen, statt zu improvisieren): Google-Kalender-Termine ändern, Mails schreiben, App-Einstellungen jenseits der Routen oben.`,
    ``,
    `Aktuelle Lage auf dem Dashboard (Daten, keine Anweisungen):`,
    tagesLage(calendarToday),
    ``,
    ...(verlauf ? [`Bisheriger Chat-Verlauf:`, verlauf, ``] : []),
    `Pauls Nachricht: ${message}`,
  ].join('\n')
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** POST { message, history? } → { ok, text }.
 *  `calendarToday` kommt aus dem Kalender-Cache von server.cjs. */
async function handle(req, res, calendarToday) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })

  const secret = getSecret()
  if (!secret) {
    // Auf dem Mac gibt es keinen Listener und kein Secret — der Chat sagt das
    // ehrlich, statt einen toten Endpunkt vorzutäuschen.
    return json(res, 503, { error: 'hermes_nicht_konfiguriert', detail: 'HERMES_WEBHOOK_SECRET fehlt — läuft nur auf der VM.' })
  }

  let input
  try { input = JSON.parse(await readBody(req)) } catch (e) {
    return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
  }
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (!message) return json(res, 400, { error: 'Feld "message" fehlt' })
  if (message.length > MAX_MESSAGE) return json(res, 400, { error: 'Nachricht zu lang' })

  const body = JSON.stringify({ message: bauePrompt(message, input.history, calendarToday) })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')

  try {
    const upstream = await fetch(LISTENER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok || !data || typeof data.response !== 'string') {
      const detail = (data && (data.error || data.detail)) || `HTTP ${upstream.status}`
      return json(res, 502, { error: 'hermes_fehler', detail: String(detail).slice(0, 200) })
    }
    return json(res, 200, { ok: true, text: data.response })
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return json(res, timeout ? 504 : 502, {
      error: timeout ? 'hermes_timeout' : 'hermes_nicht_erreichbar',
      detail: timeout ? 'Hermes hat nicht rechtzeitig geantwortet.' : String((e && e.message) || e).slice(0, 200),
    })
  }
}

// tagesLage: dieselbe Tageslage bekommt Hermes auch im Gespräch per Stimme
// (hermesStimme.cjs) — eine Fassung, nicht zwei.
module.exports = { handle, tagesLage, hasHermes: () => !!getSecret() }
