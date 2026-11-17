// Das Widget auf iPhone und Mac: Score und Aufgaben des Tages, nur lesend.
//
// WOZU
// Paul, 2026-11-07: „wie wir den Score und Todos auf ein Widget auf Mac und
// iOS bekommen". Gewählt hat er Scriptable (kostenlos): ein kleines Skript auf
// dem iPhone holt GET /api/widget und zeichnet das Widget. Der Mac zeigt
// iPhone-Widgets seit Sonoma auf dem Schreibtisch — dort läuft dasselbe.
// Das Skript liegt in deploy/widget/daily-widget.js.
//
// WARUM DER SERVER DEN SCORE SELBST RECHNET
// Der Browser hält den Score in morning.scoreHistory fest — aber nur, solange
// Daily irgendwo offen ist. Hakt Paul per Stimme ab und öffnet Daily nicht,
// zeigte ein Widget den alten Stand. Deshalb rechnet der Server mit derselben
// Rechnung wie der Browser (src/lib/scoreSnapshot.ts, direkt geladen — Node 22
// kann TypeScript ohne Build, wie der Tagesbericht mit bewusst.ts). Keine
// zweite Fassung der Regel, die auseinanderdriften könnte.
//
// WOHER DAS TAGESZIEL KOMMT
// Das Ziel hängt im Browser an Budget, Bedarf und Klausurplan
// (lib/tagesziel.ts) — das gibt es hier nicht. Steht für heute ein Eintrag im
// Verlauf, gilt dessen Ziel: Das hat der Browser selbst so gerechnet. Fehlt er
// (Daily heute noch nie offen), gilt das Wochentagsziel aus dem Tracker, und
// die Antwort sagt das (`zielAusVerlauf: false`).
//
// WARUM EIN EIGENER SCHLÜSSEL
// DAILY_WIDGET_TOKEN statt des Daily-Passworts: Das Widget liegt auf dem
// Telefon, und ein Schlüssel, der nur diese eine lesende Route öffnet, verrät
// im schlimmsten Fall Score und Aufgabentitel — nicht den Zugang zu allem.
// Ist er nicht gesetzt, ist die Route aus (403). Ins Log kommt kein Text.

const crypto = require('node:crypto')
const stateStore = require('./stateStore.cjs')

const ZONE = 'Europe/Berlin'
const MAX_AUFGABEN = 5
const PRIO_STUFE = { dringend: 3, wichtig: 2, normal: 1 }

function token() {
  return (process.env.DAILY_WIDGET_TOKEN || '').trim()
}

function tokenOk(req) {
  const want = token()
  if (!want) return false
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  if (!m) return false
  const got = Buffer.from(m[1].trim())
  const exp = Buffer.from(want)
  return got.length === exp.length && crypto.timingSafeEqual(got, exp)
}

function json(state, key, fallback) {
  try {
    const v = JSON.parse(state.localStorage[key])
    return v ?? fallback
  } catch {
    return fallback
  }
}

function tagIn(ms) {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function vortag(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Beide Ablagen, ohne Doppelte — wie hermesApi.alleTodos. */
function alleTodos(state) {
  const gesehen = new Set()
  const liste = [...(Array.isArray(state.indexedDB?.todos) ? state.indexedDB.todos : []), ...json(state, 'morning.todos', [])]
  return liste.filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string' && !gesehen.has(t.id) && gesehen.add(t.id))
}

/** Wochentagsziel wie tracker/store.tsx goalMinForDate (ohne Epochen). */
function wochentagsZiel(state, iso) {
  const overrides = json(state, 'morning.tracker.goalOverrides', {})
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, iso) && Number.isFinite(overrides[iso])) return overrides[iso]
  const wd = new Date(iso + 'T12:00:00Z').getUTCDay()
  const proTag = json(state, 'morning.tracker.goalsByWeekday', null)
  if (Array.isArray(proTag) && proTag.length === 7 && Number.isFinite(proTag[wd])) return proTag[wd]
  const werktag = Number(json(state, 'morning.tracker.goalMin', 0)) || 0
  const wochenende = Number(json(state, 'morning.tracker.goalMinWeekend', 0)) || 0
  return wd === 0 || wd === 6 ? (wochenende || werktag) : werktag
}

/** Die Rechnung des Browsers, geladen wie im Tagesbericht. null, wenn Node
 *  kein TypeScript laden kann (Electron auf dem Mac) — dann zählt der Verlauf. */
function ladeRechnung() {
  try {
    const { tagesStand } = require('../src/lib/scoreSnapshot.ts')
    const { routineHakenAm } = require('../src/lib/bewusst.ts')
    return { tagesStand, routineHakenAm }
  } catch {
    return null
  }
}

/**
 * Was das Widget zeigt. Rein bis auf `rechnung` (eingereicht, damit Tests und
 * der Rückfall ohne TypeScript dieselbe Funktion nehmen).
 */
function widgetStand(state, nowMs, rechnung = ladeRechnung()) {
  const datum = tagIn(nowMs)
  const verlauf = json(state, 'morning.scoreHistory', {})
  const eintrag = verlauf && typeof verlauf === 'object' ? verlauf[datum] : null
  const gesternEintrag = verlauf && typeof verlauf === 'object' ? verlauf[vortag(datum)] : null

  const todos = alleTodos(state).filter((t) => t.origin !== 'bewusst')
  const tagesTodos = todos.filter((t) => (t.scope ?? 'day') === 'day')
  const offen = tagesTodos
    .filter((t) => !t.done)
    .sort((a, b) => (PRIO_STUFE[b.priority] || 1) - (PRIO_STUFE[a.priority] || 1) || (a.createdAt || 0) - (b.createdAt || 0))

  const zielAusVerlauf = !!(eintrag && Number.isFinite(eintrag.goalMin))
  const zielMin = zielAusVerlauf ? eintrag.goalMin : wochentagsZiel(state, datum)

  let teile = null
  let quelle = 'verlauf'
  if (rechnung) {
    const sessions = json(state, 'morning.tracker.sessions', []).filter((s) => s && typeof s.date === 'string')
    const bewusst = json(state, 'morning.bewusst.v1', null)
    let haken = 0
    try { haken = bewusst && bewusst.periods ? rechnung.routineHakenAm(bewusst, datum) : 0 } catch { haken = 0 }
    teile = rechnung.tagesStand(todos, sessions, datum, zielMin, nowMs, haken).parts
    quelle = 'server'
  } else if (eintrag) {
    teile = eintrag
  }

  return {
    datum,
    stand: new Date(nowMs).toISOString(),
    quelle,
    score: teile ? teile.score : null,
    gestern: gesternEintrag && Number.isFinite(gesternEintrag.score) ? gesternEintrag.score : null,
    teile: teile
      ? { lernzeit: teile.time, aufgaben: teile.tasks, routinen: teile.routineBonus || 0, altlasten: teile.drag || 0 }
      : null,
    lernMin: teile ? Math.round(teile.studyMin) : 0,
    zielMin,
    zielAusVerlauf,
    aufgaben: {
      offen: offen.length,
      erledigt: tagesTodos.length - offen.length,
      liste: offen.slice(0, MAX_AUFGABEN).map((t) => ({ text: t.text, prio: t.priority || 'normal' })),
    },
  }
}

function antworte(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function handle(req, res) {
  if (req.method !== 'GET') return antworte(res, 405, { error: 'Nur GET.' })
  if (!token()) return antworte(res, 403, { error: 'DAILY_WIDGET_TOKEN ist auf dem Server nicht gesetzt — Widget aus.' })
  if (!tokenOk(req)) {
    // Nur der Grund ins Log, nie der mitgeschickte Schlüssel. So sieht man auf
    // der VM, ob das Telefon den Server überhaupt erreicht.
    const grund = /^Bearer\s+\S/i.test(req.headers.authorization || '') ? 'falscher Schlüssel' : 'kein Schlüssel'
    console.log(`[widget] abgewiesen: ${grund}`)
    return antworte(res, 401, { error: 'Falscher oder fehlender Schlüssel.' })
  }
  try {
    const t0 = Date.now()
    const stand = widgetStand(stateStore.read(), Date.now())
    console.log(`[widget] Stand geliefert in ${Date.now() - t0} ms (${stand.quelle})`)
    return antworte(res, 200, stand)
  } catch (e) {
    console.error('[widget] Stand nicht lesbar:', e && e.message)
    return antworte(res, 503, { error: 'Stand gerade nicht lesbar.' })
  }
}

module.exports = { handle, widgetStand, tokenOk }
