// Schreibzugang für Hermes — /api/hermes/*
//
// WARUM EIGENE ROUTEN STATT DIREKT IN DIE DATEI
// Hermes läuft auf derselben Maschine und könnte `state.json` technisch selbst
// beschreiben. Genau das soll er nicht: zwei Prozesse ohne Sperre auf derselben
// Datei ist der klassische Weg, still Daten zu verlieren. Über HTTP gibt es
// genau einen Schreiber (diesen Dienst), atomare Schreibvorgänge und den
// täglichen Schnappschuss — alles, was stateStore.cjs ohnehin schon mitbringt.
//
// EIGENES TOKEN, NICHT DAS BENUTZERPASSWORT
// Hermes weist sich mit `Authorization: Bearer <HERMES_TOKEN>` aus, getrennt von
// AUTH_PASS. So kann Paul sein Passwort ändern, ohne die Automatik zu killen —
// und ein verlorenes Hermes-Token abziehen, ohne sich selbst auszusperren.
// Ist HERMES_TOKEN nicht gesetzt, ist die ganze Schnittstelle AUS (403).
//
// DOPPELTE ABLAGE IST ABSICHT
// Todos und Termine leben in der App an zwei Orten: in den IndexedDB-Listen und
// als Spiegel in `localStorage`. Viele Komponenten lesen den Spiegel. Wer nur
// eine Seite schreibt, erzeugt Einträge, die je nach Ansicht da sind oder nicht.
// Deshalb schreibt jede Funktion hier immer beide.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')
const usageStats = require('./usageStats.cjs')
const subscriptions = require('./subscriptions.cjs')
const rejectLog = require('./rejectLog.cjs')
const vorlaufStore = require('./vorlaufStore.cjs')
const focusStore = require('./focusStore.cjs')
// Postausgang zum echten Kalender — siehe calendarOutbox.cjs fuer das Warum.
const calendarOutbox = require('./calendarOutbox.cjs')
const receipts = require('./receipts.cjs')
const studyDigest = require('./studyDigest.cjs')
const hoerbriefing = require('./hoerbriefing.cjs')
const brainPages = require('./brainPages.cjs')
const learnHarness = require('./learnHarness.cjs')
const fristenSync = require('./fristenSync.cjs')
const tagesbericht = require('./tagesbericht.cjs')
const projekte = require('./projekte.cjs')

const MAX_BODY = 256 * 1024

// ── Authentifizierung ───────────────────────────────────────────────────────

function configuredToken() {
  return (process.env.HERMES_TOKEN || '').trim()
}

function tokenOk(req) {
  const want = configuredToken()
  if (!want) return false
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  if (!m) return false
  const got = Buffer.from(m[1].trim())
  const exp = Buffer.from(want)
  if (got.length !== exp.length) return false
  return crypto.timingSafeEqual(got, exp)   // kein Zeichen-für-Zeichen-Vergleich
}

// ── Hilfen ──────────────────────────────────────────────────────────────────

function json(res, code, body) {
  // Jede Zurueckweisung wird mitgeschrieben — siehe rejectLog.cjs. Der Haken
  // sitzt hier und nicht an den ~20 Fehlerstellen einzeln: eine davon wuerde
  // sonst beim naechsten Umbau vergessen, und genau die faellt dann still aus.
  // Die Route haengt am res-Objekt statt an einer Modulvariablen, weil zwischen
  // Routenwahl und Antwort ein await liegt und sich zwei Anfragen sonst
  // gegenseitig die Route ueberschreiben koennten.
  if (code >= 400) {
    try { rejectLog.merke(res._dailyRoute, code, body && body.error) } catch { /* nie die Antwort kippen */ }
  }
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

function parseList(state, key) {
  try {
    const v = JSON.parse(state.localStorage[key] ?? '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

// ── Schreiben ───────────────────────────────────────────────────────────────

/** Legt einen Eintrag in der IndexedDB-Liste UND im localStorage-Spiegel ab. */
function append(state, store, lsKey, item) {
  const list = Array.isArray(state.indexedDB[store]) ? state.indexedDB[store] : []
  state.indexedDB[store] = [...list, item]
  const mirror = parseList(state, lsKey)
  state.localStorage[lsKey] = JSON.stringify([...mirror, item])
  return item
}

/** Gegenstück zu append(): nimmt den Eintrag aus BEIDEN Ablagen.
 *
 *  Wer nur eine Seite löscht, macht es schlimmer als vorher — der Eintrag ist
 *  dann je nach Ansicht weg oder wieder da, und beim nächsten Abgleich schreibt
 *  die überlebende Seite ihn zurück. Deshalb hier immer beide, in einem
 *  einzigen stateStore.write().
 *
 *  Gefiltert wird statt "erstes Vorkommen entfernen": stünde dieselbe ID
 *  versehentlich doppelt drin, bliebe sonst eine Leiche zurück, die kein
 *  zweiter Aufruf mehr fassen kann (der erste meldet ja Erfolg). */
function remove(state, store, lsKey, id) {
  const list = Array.isArray(state.indexedDB[store]) ? state.indexedDB[store] : []
  const mirror = parseList(state, lsKey)
  const hit = list.find((e) => e && e.id === id) || mirror.find((e) => e && e.id === id)
  if (!hit) return null
  state.indexedDB[store] = list.filter((e) => !(e && e.id === id))
  state.localStorage[lsKey] = JSON.stringify(mirror.filter((e) => !(e && e.id === id)))
  return hit
}

function deleteTodo(id) {
  const state = stateStore.read()
  const gone = remove(state, 'todos', 'morning.todos', id)
  if (!gone) return null
  stateStore.write(state)
  return gone
}

/** Beide Ablagen als eine Liste, ohne doppelte ids (IndexedDB zuerst). */
function alleTodos(state) {
  const list = Array.isArray(state.indexedDB.todos) ? state.indexedDB.todos : []
  const gesehen = new Set()
  return [...list, ...parseList(state, 'morning.todos')].filter((t) => t && typeof t.id === 'string' && !gesehen.has(t.id) && gesehen.add(t.id))
}

/** Offene Aufgaben für die Stimme — ohne Routinen, die gehören ins Routinenbuch. */
function offeneTodos() {
  return alleTodos(stateStore.read()).filter((t) => !t.done && t.origin !== 'bewusst' && typeof t.text === 'string')
}

/** Abhaken oder wieder öffnen, in BEIDEN Ablagen (siehe remove). → der Eintrag vorher | null */
function setTodoDone(id, done) {
  const state = stateStore.read()
  const vorher = alleTodos(state).find((t) => t.id === id)
  if (!vorher || vorher.origin === 'bewusst') return null
  const neu = (t) => {
    if (!t || t.id !== id) return t
    const { doneAt, ...rest } = t
    return done ? { ...rest, done: true, doneAt: Date.now() } : { ...rest, done: false }
  }
  if (Array.isArray(state.indexedDB.todos)) state.indexedDB.todos = state.indexedDB.todos.map(neu)
  state.localStorage['morning.todos'] = JSON.stringify(parseList(state, 'morning.todos').map(neu))
  stateStore.write(state)
  return vorher
}

/** Eine gestrichene Aufgabe unverändert zurücklegen (Rücknahme per Stimme). */
function restoreTodo(task) {
  if (!task || typeof task.id !== 'string') return null
  const state = stateStore.read()
  if (alleTodos(state).some((t) => t.id === task.id)) return null
  append(state, 'todos', 'morning.todos', task)
  stateStore.write(state)
  return task
}

function deleteEvent(id) {
  const state = stateStore.read()
  const gone = remove(state, 'importantEvents', 'morning.important.events', id)
  if (!gone) return null
  stateStore.write(state)
  return gone
}

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/
/** Weiter als ein Jahr im Voraus plant niemand eine Aufgabe — eher ein Tippfehler im Jahr. */
const MAX_TAGE_VORAUS = 366

function gueltigesDatum(s) {
  if (typeof s !== 'string' || !ISO_TAG.test(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
/** ISO-Wochentag eines Datums: 1 = Montag … 7 = Sonntag (wie Task.plannedDay). */
function isoWochentag(s) {
  const d = new Date(s + 'T12:00:00Z').getUTCDay()
  return d === 0 ? 7 : d
}

/** Wohin eine Aufgabe von Hermes gehört.
 *
 *  WARUM ES DAS GIBT
 *  Bisher landete alles, was Hermes anlegte, sofort in der heutigen Liste —
 *  auch „Donnerstag Wohnungsbesichtigung vorbereiten" oder „am 12.11.
 *  Rückmeldung an Daisy". `date` wurde zwar gespeichert, war aber reine
 *  Information: die Tagesliste filtert nicht danach. Paul wollte (2026-10-22),
 *  dass Hermes eine Aufgabe für einen bestimmten Tag oder für diese Woche
 *  eintragen kann.
 *
 *  DIE REGEL
 *  - `date` = heute oder fehlt, ohne `scope`  → heute (wie bisher)
 *  - `date` in der Zukunft                    → Wochenliste mit `geplantAm`;
 *    electron/dayStart.cjs schiebt sie an genau diesem Morgen in den Tag
 *  - `scope: "week"` ohne `date`              → Wochenliste, optional mit
 *    `plannedDay` (1 = Mo … 7 = So)
 *  - `date` in der Vergangenheit oder ungültig → 400. Still auf heute zu
 *    setzen hiesse, Hermes glauben zu lassen, er habe etwas geplant. */
function zielFuerTodo(input, { vergangenIstHeute = false } = {}) {
  const heute = today()
  if (input.date !== undefined && input.date !== null && input.date !== '') {
    if (!gueltigesDatum(input.date)) {
      throw new Error(`Feld "date" muss ein gültiges Datum JJJJ-MM-TT sein (bekommen: ${JSON.stringify(input.date)})`)
    }
    // Pauls Ja auf einen älteren Vorschlag: das Datum ist inzwischen vorbei,
    // aber er will die Aufgabe — also heute. Nur Hermes' direkter Eintrag wird
    // abgelehnt; dort hiesse ein vergangenes Datum, dass er sich verrechnet hat.
    if (input.date < heute && vergangenIstHeute) return { wo: 'heute', felder: { scope: 'day', date: heute } }
    if (input.date < heute) {
      throw new Error(`Feld "date" (${input.date}) liegt vor heute (${heute}) — für einen vergangenen Tag lässt sich nichts planen.`)
    }
    const tage = Math.round((Date.parse(input.date) - Date.parse(heute)) / 86_400_000)
    if (tage > MAX_TAGE_VORAUS) {
      throw new Error(`Feld "date" (${input.date}) liegt mehr als ${MAX_TAGE_VORAUS} Tage voraus — Tippfehler im Jahr?`)
    }
    if (input.date > heute) {
      return { wo: 'geplant', felder: { scope: 'week', geplantAm: input.date, plannedDay: isoWochentag(input.date) } }
    }
  }
  if (input.scope === 'week') {
    const tag = Number(input.plannedDay)
    if (input.plannedDay !== undefined && !(Number.isInteger(tag) && tag >= 1 && tag <= 7)) {
      throw new Error(`Feld "plannedDay" muss 1 (Mo) bis 7 (So) sein (bekommen: ${JSON.stringify(input.plannedDay)})`)
    }
    return { wo: 'woche', felder: { scope: 'week', ...(input.plannedDay !== undefined ? { plannedDay: tag } : {}) } }
  }
  return { wo: 'heute', felder: { scope: 'day', date: heute } }
}

function addTodo(input, optionen = {}) {
  const text = String(input.text || '').trim()
  if (!text) throw new Error('Feld "text" fehlt')
  const ziel = zielFuerTodo(input, optionen)
  const state = stateStore.read()
  const task = {
    id: crypto.randomUUID(),
    text,
    done: false,
    createdAt: Date.now(),
    ...ziel.felder,
  }
  if (['dringend', 'wichtig', 'normal'].includes(input.priority)) task.priority = input.priority
  if (Number.isFinite(input.estimatedMin)) task.estimatedMin = Number(input.estimatedMin)
  if (typeof input.category === 'string') task.category = input.category
  if (typeof input.description === 'string') task.description = input.description
  if (typeof input.subjectId === 'string') task.subjectId = input.subjectId
  append(state, 'todos', 'morning.todos', task)
  stateStore.write(state)
  // `wo` gehört nicht zur Aufgabe, nur zur Antwort: Hermes soll Paul sagen
  // können, WO sie gelandet ist — nicht, wo er dachte, dass sie landet.
  Object.defineProperty(task, 'wo', { value: ziel.wo, enumerable: false })
  return task
}

/** "HH:MM" oder nichts. Ein halb gesetztes Zeitfenster waere schlimmer als
 *  keins: der Kalender bekaeme einen Termin mit Anfang und ohne Ende. */
function zeit(v) {
  const s = String(v ?? '').trim()
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null
}

function addEvent(input) {
  const title = String(input.title || '').trim()
  const date = String(input.date || '').trim()
  if (!title) throw new Error('Feld "title" fehlt')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Feld "date" braucht das Format JJJJ-MM-TT')
  const state = stateStore.read()
  const ev = {
    id: crypto.randomUUID(),
    kind: ['exam', 'birthday', 'deadline', 'note'].includes(input.kind) ? input.kind : 'note',
    title,
    date,
  }
  // Uhrzeiten sind optional und werden nur GEMEINSAM uebernommen — siehe zeit().
  // Ohne sie bleibt es ein Ganztagseintrag, genau wie bisher.
  const von = zeit(input.startZeit)
  const bis = zeit(input.endZeit)
  if (von && bis && bis > von) { ev.startZeit = von; ev.endZeit = bis }

  // Stichtag, an dem aus dem Termin eine Aufgabe wird — siehe dayStart.cjs.
  // Bewusst ein EIGENES Datum: bei "nachfassen, falls bis zum 17. nichts kommt"
  // ist es der Tag selbst, bei "Frist laeuft am 4. ab" muss es davor liegen.
  if (typeof input.alsTodoAm === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.alsTodoAm)) {
    ev.alsTodoAm = input.alsTodoAm
  }
  if (typeof input.note === 'string') ev.note = input.note
  if (Number.isFinite(input.requiredHours)) ev.requiredHours = Number(input.requiredHours)
  if (input.recurringYearly === true) ev.recurringYearly = true
  if (typeof input.subjectId === 'string') ev.subjectId = input.subjectId
  append(state, 'importantEvents', 'morning.important.events', ev)
  stateStore.write(state)
  return ev
}

// ── Lernziele ───────────────────────────────────────────────────────────────
// Damit "Lernzeit nächste Woche 5h pro Tag" aus dem Chat heraus wirklich
// passiert, statt nur beantwortet zu werden.
//
// Zwei Ebenen, wie in der App (src/tracker/store.tsx):
//   goalsByWeekday  — number[7], So..Sa, Minuten. Der Dauerzustand.
//   goalOverrides   — { "JJJJ-MM-TT": Minuten }. Einzelne Tage, temporär.
// Wer Wochentagsziele setzt, bekommt die Overrides der betroffenen Wochentage
// gelöscht — exakt das Verhalten von setGoalForWeekday im Store. Ohne das
// überdeckt ein vergessener Override das neue Ziel, und die App zeigt andere
// Stunden als gerade vereinbart (der Sync-Bug, den wir schon einmal hatten).

const WEEKDAY_GOALS_KEY = 'morning.tracker.goalsByWeekday'
const GOAL_OVERRIDES_KEY = 'morning.tracker.goalOverrides'
const MAX_DAY_MIN = 16 * 60

function readGoals(state) {
  let byWeekday = null
  try {
    const v = JSON.parse(state.localStorage[WEEKDAY_GOALS_KEY] ?? 'null')
    if (Array.isArray(v) && v.length === 7) byWeekday = v.map((n) => Number(n) || 0)
  } catch { /* unlesbar → wie nicht gesetzt */ }
  let overrides = {}
  try {
    const v = JSON.parse(state.localStorage[GOAL_OVERRIDES_KEY] ?? '{}')
    if (v && typeof v === 'object') overrides = v
  } catch { /* dito */ }
  return { byWeekday, overrides }
}

function minutesOk(n) {
  return Number.isFinite(n) && n >= 0 && n <= MAX_DAY_MIN
}

function weekdayOfIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

function updateGoals(input) {
  const state = stateStore.read()
  const { byWeekday, overrides } = readGoals(state)
  const nextByWeekday = byWeekday ? [...byWeekday] : [240, 240, 240, 240, 240, 240, 240]
  let nextOverrides = { ...overrides }
  const touchedWeekdays = new Set()

  if (Array.isArray(input.weekdayMinutes)) {
    if (input.weekdayMinutes.length !== 7 || !input.weekdayMinutes.every(minutesOk)) {
      throw new Error('Feld "weekdayMinutes" braucht 7 Werte (So..Sa), je 0–' + MAX_DAY_MIN + ' Minuten')
    }
    for (let i = 0; i < 7; i++) { nextByWeekday[i] = Math.round(input.weekdayMinutes[i]); touchedWeekdays.add(i) }
  }

  if (input.weekday !== undefined) {
    const wd = Number(input.weekday)
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new Error('Feld "weekday" braucht 0 (So) bis 6 (Sa)')
    if (!minutesOk(Number(input.minutes))) throw new Error('Feld "minutes" braucht 0–' + MAX_DAY_MIN)
    nextByWeekday[wd] = Math.round(Number(input.minutes))
    touchedWeekdays.add(wd)
  }

  if (input.overrides && typeof input.overrides === 'object') {
    for (const [iso, min] of Object.entries(input.overrides)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Override-Datum "${iso}" braucht das Format JJJJ-MM-TT`)
      if (min === null) { delete nextOverrides[iso]; continue }
      if (!minutesOk(Number(min))) throw new Error(`Override für ${iso}: 0–${MAX_DAY_MIN} Minuten (oder null zum Löschen)`)
      nextOverrides[iso] = Math.round(Number(min))
    }
  }

  if (input.clearOverrides === true) nextOverrides = {}

  // Neue Wochentagsziele räumen die Overrides der betroffenen Wochentage ab —
  // aber nur, wenn dieser Aufruf sie nicht selbst gerade gesetzt hat.
  const explicit = new Set(Object.keys(input.overrides || {}))
  for (const iso of Object.keys(nextOverrides)) {
    if (touchedWeekdays.has(weekdayOfIso(iso)) && !explicit.has(iso)) delete nextOverrides[iso]
  }

  state.localStorage[WEEKDAY_GOALS_KEY] = JSON.stringify(nextByWeekday)
  state.localStorage[GOAL_OVERRIDES_KEY] = JSON.stringify(nextOverrides)
  stateStore.write(state)
  return { weekdayMinutes: nextByWeekday, overrides: nextOverrides }
}

// ── Morgen-Briefing ─────────────────────────────────────────────────────────
// Hermes schreibt, Daily zeigt. Gespeichert wird NUR das aktuelle Briefing,
// keine Historie — was gestern zählte, hilft heute nicht, und ein wachsendes
// Feld im Zustand würde bei jedem Abgleich mitwandern.
//
// WARUM DIE ZWEI REGELN HIER STEHEN UND NICHT IN HERMES' PROMPT
// Der Sinn des Pop-ups ist seine Seltenheit. Eins, das zu oft kommt, wird nach
// einer Woche reflexhaft weggeklickt — und dann auch das eine, das gezählt
// hätte. Eine Prompt-Anweisung ist eine Bitte: ein Modell, das sich vertut,
// ein zweiter Agent, ein Wiederholungslauf nach einem Fehler — schon ploppt es
// zweimal. Hier ist es eine Zusage, die auch dann hält, wenn der Aufrufer sich
// irrt. Deshalb serverseitig.
//
// REIHENFOLGE DER PRÜFUNGEN IST WICHTIG
// Erst das Quittierte verwerfen, dann auf Dopplung prüfen. Andersherum bekäme
// ein erneut geschicktes, längst abgehaktes Alert eine 409 zurück statt still
// entfernt zu werden — und der Text des Briefings ginge mit unter.

// Der Briefing-Vertrag lebt jetzt in briefingStore.cjs — samt Read-after-write,
// Quittungen und Idempotenz. Hier bleibt nur die Weiche, damit diese Datei die
// Schnittstelle beschreibt und nicht zusaetzlich die Fachlogik traegt.
const briefingStore = require('./briefingStore.cjs')
const questionStore = require('./questionStore.cjs')
const suggestionStore = require('./suggestionStore.cjs')
const BRIEFING_KEY = briefingStore.BRIEFING_KEY
const ACK_KEY = briefingStore.ACK_KEY

// ── Weiche ──────────────────────────────────────────────────────────────────

async function handle(req, res, pathname) {
  const route = pathname.replace(/^\/api\/hermes/, '') || '/'
  // Vor den Torpruefungen setzen, damit auch ein 401 mit Route mitgeschrieben
  // wird — ein abgewiesenes Token auf /briefing ist eine andere Nachricht als
  // eines auf /ping.
  res._dailyRoute = req.method + ' ' + route

  if (!configuredToken()) {
    return json(res, 403, { error: 'HERMES_TOKEN ist auf dem Server nicht gesetzt — Schnittstelle deaktiviert.' })
  }
  if (!tokenOk(req)) {
    return json(res, 401, { error: 'Ungültiges oder fehlendes Bearer-Token.' })
  }


  if (req.method === 'GET' && route === '/ping') {
    return json(res, 200, { ok: true, service: 'daily', time: new Date().toISOString() })
  }

  if (req.method === 'GET' && route === '/state') {
    return json(res, 200, stateStore.read())
  }

  if (req.method === 'GET' && route === '/todos') {
    const state = stateStore.read()
    return json(res, 200, { todos: state.indexedDB.todos || [] })
  }

  // Was Daily aus Pauls Umgang mit seinen Aufgaben gelernt hat — was er
  // durchzieht, was er wegräumt (src/lib/prioLernen.ts). Der Text entsteht im
  // Browser und liegt fertig im Zustand; hier wird er nur ausgeliefert, damit
  // dieselbe Rechnung nicht ein zweites Mal in anderer Sprache existiert.
  // Für das Briefing und das Hörbriefing: dort soll stehen, was Paul wichtig
  // ist, nicht was irgendwer für wichtig hält.
  if (req.method === 'GET' && route === '/prioritaeten') {
    const state = stateStore.read()
    let stand = null
    try { stand = JSON.parse(state.localStorage['morning.prioritaeten.v1'] ?? 'null') } catch { /* kaputt → leer */ }
    const signale = Array.isArray(stand?.signale) ? stand.signale : []
    return json(res, 200, {
      profil: typeof stand?.profil === 'string' ? stand.profil : '',
      profilAm: typeof stand?.profilAm === 'string' ? stand.profilAm : null,
      signale: signale.length,
      // Die letzten Handlungen, damit Hermes Beispiele nennen kann.
      zuletzt: signale.slice(-15).map((s) => ({ art: s.art, text: String(s.text || '').slice(0, 100), ts: s.ts })),
    })
  }

  if (req.method === 'GET' && route === '/events') {
    const state = stateStore.read()
    return json(res, 200, { events: state.indexedDB.importantEvents || [] })
  }

  if (route === '/goals') {
    if (req.method === 'GET') {
      const { byWeekday, overrides } = readGoals(stateStore.read())
      return json(res, 200, { weekdayMinutes: byWeekday, overrides })
    }
    if (req.method === 'PUT') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const result = updateGoals(input)
        console.log('[hermes] Lernziele geändert:', JSON.stringify(result.weekdayMinutes))
        return json(res, 200, { ok: true, ...result })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
  }

  if (route === '/briefing') {
    if (req.method === 'GET') {
      return json(res, 200, {
        briefing: briefingStore.readBriefing(stateStore.read()),
        serverDate: briefingStore.serverDate(),
      })
    }
    if (req.method === 'POST') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const r = briefingStore.publish(input)
        console.log(
          `[hermes] Briefing ${r.receipt.result} für ${r.receipt.effectiveDate}` +
          ` — Revision ${r.receipt.storedSha256.slice(0, 12)}…` +
          (r.wiederholung ? ' (Wiederholung, kein zweiter Schreibvorgang)' : '') +
          (r.verworfen ? ` (Alert ${r.verworfen} war quittiert und wurde verworfen)` : '') +
          (r.receipt.transformations.length ? ` (${r.receipt.transformations.length} gekürzt)` : ''),
        )
        return json(res, r.status, {
          ok: true, briefing: r.briefing, verworfen: r.verworfen ?? null, receipt: r.receipt,
        })
      } catch (e) {
        const status = e.status || 400
        if (status >= 500) console.error('[hermes] Briefing fehlgeschlagen:', e.message)
        else console.warn('[hermes] Briefing abgelehnt (' + status + '):', e.message)
        return json(res, status, { ok: false, error: e.message, steht: e.steht, serverDate: e.serverDate, frueher: e.frueher })
      }
    }
  }

  // Die Vorschläge im Morgendialog — siehe suggestionStore.cjs für das Warum
  // der vier Regeln (höchstens drei, Kennung aus der Quelle, einmal
  // entschieden nie wieder, ein Dialog pro Tag).
  // Pauls Projekte: Hermes legt an, ergänzt und schlägt vor; löschen und
  // abhaken bleibt bei Paul. Regeln und Warum in electron/projekte.cjs.
  if (route === '/projekte' || route.startsWith('/projekte/')) {
    return projekte.handleHermes(req, res, route, { json, readBody })
  }

  if (route === '/suggestions') {
    if (req.method === 'GET') {
      return json(res, 200, suggestionStore.zustand())
    }
    if (req.method === 'POST') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const r = suggestionStore.schlageVor(input)
        if (r.verworfen) {
          // Kein Fehler: der Agent hat brav gefragt, die Antwort ist "kenne ich
          // schon". 200 statt 201, damit der Unterschied sichtbar ist.
          console.log(`[hermes] Vorschlag ${r.verworfen} verworfen — ${r.grund} am ${r.am}`)
          return json(res, 200, { ok: true, ...r })
        }
        console.log(
          `[hermes] Vorschlag (${r.vorschlag.art}) ${r.vorschlag.id}: ${r.vorschlag.titel}` +
          (r.wiederholung ? ' (stand heute schon)' : ''),
        )
        return json(res, r.wiederholung ? 200 : 201, { ok: true, ...r })
      } catch (e) {
        const status = e.status || 400
        console.warn(`[hermes] Vorschlag abgelehnt (${status}):`, e.message)
        return json(res, status, { ok: false, error: e.message, angekommen: e.angekommen, grenze: e.grenze, ids: e.ids })
      }
    }
  }

  // Was Paul angenommen und abgelehnt hat — Hermes nimmt es beim nächsten Lauf
  // als Beispiele mit, statt dreimal dasselbe vorzuschlagen.
  // Entscheidungen lesen. `?offen=1` liefert nur, was noch nicht im Second
  // Brain steht — damit Hermes nicht jeden Tag dieselben dreissig durchgeht.
  if (route === '/decisions' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams
    return json(res, 200, suggestionStore.entscheidungen(q.get('limit') ?? 30, q.get('offen') === '1'))
  }

  // Quittung: diese Entscheidungen stehen jetzt im Brain.
  //
  // WARUM DAILY DAS NICHT SELBST SCHREIBT
  // Unveraendert die Regel von Anfang an: ins Second Brain schreibt
  // ausschliesslich Hermes. Daily fuehrt nur Buch darueber, WAS noch
  // festzuhalten ist, und nimmt die Quittung entgegen.
  if (route === '/decisions' && req.method === 'POST') {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      const r = suggestionStore.imBrainVermerkt(input.ids, input.brainPfad)
      console.log(`[hermes] ${r.vermerkt} Entscheidung(en) im Brain vermerkt → ${r.brainPfad}`)
      return json(res, 200, { ok: true, ...r })
    } catch (e) {
      return json(res, e.status || 400, { error: e.message })
    }
  }

  // Die eine Frage aus dem Second Brain — siehe questionStore.cjs für das
  // Warum der drei Regeln (eine offene Frage, Ruhezeiten pro id, Herkunft
  // Pflicht). Hermes stellt sie und holt die Antwort wieder ab; ins Wiki
  // schreibt sie ausschliesslich er.
  if (route === '/question') {
    if (req.method === 'GET') {
      return json(res, 200, questionStore.zustand())
    }
    if (req.method === 'POST') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const gestellt = questionStore.stelle(input)
        console.log(`[hermes] Frage gestellt (${gestellt.quelle}): ${gestellt.frage}`)
        return json(res, 201, { ok: true, frage: gestellt })
      } catch (e) {
        const status = e.status || 400
        console.warn(`[hermes] Frage abgelehnt (${status}):`, e.message)
        return json(res, status, { ok: false, error: e.message, steht: e.steht, gesperrt: e.gesperrt })
      }
    }
    // Hermes meldet, dass die Antwort im Brain steht — erst danach wird sie
    // hier gelöscht und die nächste Frage kann kommen.
    if (req.method === 'DELETE') {
      let input = {}
      try { const b = await readBody(req); if (b) input = JSON.parse(b) } catch { /* ohne Rumpf: id aus Query */ }
      const id = input.id || new URL(req.url, 'http://x').searchParams.get('id')
      if (!id) return json(res, 400, { error: 'Feld "id" fehlt — welche Antwort wurde eingetragen?' })
      try {
        const weg = questionStore.quittiereAntwort(String(id))
        console.log(`[hermes] Antwort abgeholt und geleert: ${weg.id}`)
        return json(res, 200, { ok: true, geleert: weg.id })
      } catch (e) {
        return json(res, e.status || 400, { ok: false, error: e.message })
      }
    }
  }

  // Das Hörbriefing — siehe hoerbriefing.cjs für das Warum der Regeln (nur
  // heute, höchstens fünf Minuten, jeden Tag ein anderer Einstieg, am Ende die
  // Brain-Frage). POST nimmt den Text an und stösst die Aufnahme an; ob sie
  // fertig ist, sagt GET — „angenommen" ist noch nicht „hörbar".
  if (route === '/hoerbriefing') {
    if (req.method === 'GET') {
      return json(res, 200, {
        serverDate: hoerbriefing.serverDate(),
        heute: hoerbriefing.heuteFuerAnzeige(),
        // Was in den letzten Tagen gesagt wurde — damit es heute anders klingt.
        verlauf: hoerbriefing.verlauf(7, hoerbriefing.serverDate()).map(({ datum, einstieg, text }) => ({ datum, einstieg, text })),
      })
    }
    if (req.method === 'POST') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const r = hoerbriefing.veroeffentliche(input)
        console.log(`[hermes] Hörbriefing ${r.datum} angenommen — ${r.woerter} Wörter, ~${r.geschaetztMin} min, Aufnahme läuft`)
        return json(res, 202, r)
      } catch (e) {
        const status = e.status || 400
        console.warn(`[hermes] Hörbriefing abgelehnt (${status}): ${e.message}`)
        return json(res, status, { ok: false, error: e.message, steht: e.steht, gleichWie: e.gleichWie, serverDate: e.serverDate })
      }
    }
  }
  // Die Aufnahme selbst — für Telegram.
  if (route === '/hoerbriefing/audio' && req.method === 'GET') {
    const datum = new URL(req.url, 'http://x').searchParams.get('datum') || hoerbriefing.serverDate()
    const datei = hoerbriefing.audioPfad(datum)
    if (!datei) return json(res, 404, { error: `Für ${datum} gibt es (noch) keine fertige Aufnahme — Status über GET /api/hermes/hoerbriefing.` })
    return hoerbriefing.sendeAudio(req, res, datei)
  }

  // Der Lernbericht fürs Brain — siehe studyDigest.cjs. Nur lesen: Daily
  // rechnet, Hermes trägt ein. Ohne Parameter die letzten sieben vollen Tage.
  if (route === '/digest' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams
    try {
      const range = studyDigest.resolveRange({ from: q.get('from') ?? undefined, to: q.get('to') ?? undefined })
      return json(res, 200, studyDigest.buildDigest(stateStore.read().localStorage, range))
    } catch (e) {
      return json(res, e.status || 500, { error: e.message })
    }
  }

  // Woran Paul gerade in LearnHarness lernt — dieselbe grobe Liste, die die
  // Lernzeit-Seite zeigt. Fürs Briefing: was gerade dran ist, ohne raten.
  if (route === '/learnharness' && req.method === 'GET') {
    return json(res, 200, learnHarness.lernstand())
  }

  // Die offenen Fragen des Brains, dringendste zuerst — damit Hermes für
  // POST /question nicht selbst dreissig Seiten durchgehen muss und nicht
  // jeden Tag dieselbe Neugierfrage vor der mit der Frist stellt. Verworfenes,
  // Beantwortetes und gerade Zurückgestelltes ist schon herausgefiltert.
  if (route === '/brain/fragen' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams
    const limit = Number.parseInt(q.get('limit') || '10', 10) || 10
    const doc = questionStore.read(stateStore.read())
    const r = brainPages.openQuestions({
      limit,
      verlauf: doc.verlauf,
      gesperrt: questionStore.gesperrt,
      heute: questionStore.serverDate(),
    })
    if (doc.offen) r.fragen = r.fragen.filter((f) => f.id !== doc.offen.id)
    return json(res, r.ok ? 200 : 503, { ...r, offen: doc.offen ? doc.offen.id : null })
  }

  // Quittung nachschlagen — prüft GEGEN DEN AKTUELLEN BESTAND, nicht gegen
  // das, was beim Schreiben galt. Das ist der Unterschied zwischen "damals
  // gespeichert" und "steht immer noch so da".
  {
    const m = /^\/receipts\/([\w-]+)$/.exec(route)
    if (m && req.method === 'GET') {
      const aktuell = briefingStore.revision(briefingStore.readBriefing(stateStore.read()))
      const r = receipts.verify(m[1], aktuell)
      if (!r) return json(res, 404, { error: `Keine Quittung mit der ID ${m[1]}.` })
      return json(res, 200, r)
    }
  }

  // Die Render-Meldung liegt bewusst NICHT hier, sondern unter
  // /api/briefing/rendered (server.cjs). Grund: dieser ganze Zweig verlangt
  // das HERMES_TOKEN, und genau das hat der Browser nicht — er weist sich mit
  // Basic-Auth bzw. Sitzungskeks aus. Hier stand die Route zuerst; sie gab dem
  // Browser stumme 401 zurück, und die Kette endete bei "pending", obwohl der
  // Text sichtbar auf dem Schirm stand. Aufgefallen ist es nur, weil die
  // Quittung geprüft wurde statt der Bildschirm.

  // Vom Mac zugespielte Claude-Quote — siehe usageStats.cjs für das Warum
  // (der OAuth-Login liegt im macOS-Schlüsselbund, den es hier nicht gibt).
  if (route === '/claude-usage' && req.method === 'PUT') {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      const saved = usageStats.writePushedUsage(input)
      console.log(`[hermes] Claude-Quote zugespielt: ${saved.usedPct}% verbraucht`)
      return json(res, 200, { ok: true, ...saved })
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
  }

  // Codex/ChatGPT-Abo, ebenfalls vom Mac zugespielt.
  //
  // WARUM NUR PLAN UND LAUFZEIT UND KEIN VERBRAUCH
  // ChatGPTs Backend beantwortet jede programmatische Anfrage mit 403 hinter
  // Cloudflares Botabwehr — auch mit gueltigem Token. Der Verbrauch ist damit
  // schlicht nicht abrufbar. Plan und Laufzeit stehen dagegen im Anmeldetoken
  // auf dem Mac und brauchen ueberhaupt keine Anfrage.
  if (route === '/codex-abo' && req.method === 'PUT') {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      const saved = subscriptions.schreibeCodex(input)
      console.log(`[hermes] Codex-Abo zugespielt: ${saved.plan}, laeuft bis ${saved.laufzeitBis || '?'}`)
      return json(res, 200, { ok: true, ...saved })
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
  }

  // ── Fristen aus dem Brain ───────────────────────────────────────────────
  // Siehe fristenSync.cjs. PUT schickt die VOLLSTÄNDIGE Liste mit festen ids;
  // Daily gleicht ab statt anzuhängen, sodass ein täglicher Lauf nichts
  // verdoppelt. GET zeigt, was zuletzt ankam.
  if (route === '/fristen') {
    if (req.method === 'GET') return json(res, 200, fristenSync.zustand())
    if (req.method === 'PUT') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const r = fristenSync.gleiche(input)
        console.log(`[hermes] Fristen abgeglichen: ${r.neu.length} neu, ${r.geaendert.length} geändert, ${r.zurueckgezogen.length} zurückgezogen, ${r.uebersprungen.length} übersprungen`)
        return json(res, 200, r)
      } catch (e) {
        const status = e.status || 400
        console.warn(`[hermes] Fristen abgelehnt (${status}): ${e.message}`)
        return json(res, status, { ok: false, error: e.message })
      }
    }
  }

  // ── Tagesbericht fürs Brain ─────────────────────────────────────────────
  // Siehe tagesbericht.cjs. Daily schreibt den Text, Hermes legt ihn
  // unverändert nach raw/inbox/ und quittiert — erst die Quittung hakt die
  // mitgeschickte Antwort und die Entscheidungen ab.
  if (route === '/tagesbericht' && req.method === 'GET') {
    const datum = new URL(req.url, 'http://x').searchParams.get('datum') || undefined
    try {
      return json(res, 200, tagesbericht.baue(datum))
    } catch (e) {
      return json(res, e.status || 500, { error: e.message })
    }
  }
  if (route === '/tagesbericht/quittung' && req.method === 'POST') {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      const r = tagesbericht.quittiere(input)
      console.log(`[hermes] Tagesbericht ${r.datum} im Brain: ${r.pfad}` + (r.probleme?.length ? ` — ${r.probleme.join(' | ')}` : ''))
      return json(res, 200, r)
    } catch (e) {
      return json(res, e.status || 400, { ok: false, error: e.message })
    }
  }

  // ── Vorlauf: wann wird ein datierter Vorgang zur Aufgabe ────────────────
  // Siehe vorlaufStore.cjs. Hermes liest das Buch, urteilt, und fragt nur,
  // wenn nichts passt.
  if (route === '/vorlauf' && req.method === 'GET') {
    return json(res, 200, vorlaufStore.fuerHermes())
  }
  if (route === '/vorlauf/frage' && req.method === 'POST') {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      const f = vorlaufStore.frage(input)
      console.log(`[vorlauf] Frage gestellt: "${f.titel}" (Vorschlag ${f.vorschlag} Tage)`)
      return json(res, 200, { ok: true, frage: f })
    } catch (e) {
      return json(res, e.status || 400, { error: e.message })
    }
  }
  if (route === '/vorlauf/entschieden' && req.method === 'POST') {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      return json(res, 200, { ok: true, ...vorlaufStore.merkeEntscheidung(input) })
    } catch (e) {
      return json(res, e.status || 400, { error: e.message })
    }
  }

  if (req.method === 'POST' && (route === '/todos' || route === '/events')) {
    let input
    try { input = JSON.parse(await readBody(req)) } catch (e) {
      return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
    }
    try {
      const created = route === '/todos' ? addTodo(input) : addEvent(input)
      const wo = created.wo
      console.log(`[hermes] ${route} angelegt:`, created.text || created.title, wo ? `(${wo}${created.geplantAm ? ' ' + created.geplantAm : ''})` : '')
      return json(res, 201, { ok: true, created, ...(wo ? { wo } : {}) })
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
  }

  // Löschen. Eine unbekannte ID gibt 404 statt 200 zurück: sonst meldet ein
  // Aufräum-Lauf über eine falsche Liste lauter Erfolge und Hermes glaubt,
  // die Duplikate seien weg, während sie noch alle dastehen.
  if (req.method === 'DELETE') {
    const m = /^\/(todos|events)\/(.+)$/.exec(route)
    if (m) {
      const [, kind, id] = m
      const gone = kind === 'todos' ? deleteTodo(id) : deleteEvent(id)
      if (!gone) {
        return json(res, 404, { error: `Kein Eintrag mit der ID ${id} in ${kind} — nichts gelöscht.` })
      }
      console.log(`[hermes] ${kind} gelöscht:`, gone.text || gone.title)
      return json(res, 200, { ok: true, deleted: gone })
    }
  }

  // ── Postausgang zum echten Kalender ───────────────────────────────────────
  // Daily spricht kein CalDAV und bekommt die Zugangsdaten nicht. Hermes holt
  // hier ab, was anzulegen oder zu loeschen ist, und meldet das Ergebnis
  // zurueck — inklusive der echten UID, ohne die der Termin doppelt im
  // Horizont stuende und sich spaeter nicht loeschen liesse.
  if (route === '/calendar-outbox' && req.method === 'GET') {
    return json(res, 200, calendarOutbox.postausgang())
  }
  {
    const m = /^\/calendar-outbox\/(.+)$/.exec(route)
    if (m && req.method === 'PATCH') {
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const r = calendarOutbox.melde(decodeURIComponent(m[1]), input)
        console.log(`[kalender] ${r.art ?? 'melde'} ${r.ok ? 'ok' : 'FEHLER'}` +
          (r.calUid ? ` — UID ${r.calUid}` : '') + (r.fehler ? ` — ${r.fehler}` : ''))
        return json(res, 200, r)
      } catch (e) {
        return json(res, e.status || 400, { error: e.message })
      }
    }
  }

  // ── Vorgänge im Fokus ─────────────────────────────────────────────────────
  // Hermes darf hier LESEN und WEITERSCHALTEN, aber nichts Neues anlegen:
  // was Aufmerksamkeit bekommt, entscheidet Paul. Neue Vorgänge kann er über
  // den Vorschlags-Dialog anregen — dort steht ein Ja/Nein davor.
  if (route === '/focus' && req.method === 'GET') {
    return json(res, 200, focusStore.zustand())
  }
  if (route === '/focus' && req.method === 'POST') {
    return json(res, 403, {
      error: 'Hermes legt keine Vorgänge an. Was in den Fokus gehört, entscheidet Paul — ' +
        'reg es über POST /api/hermes/suggestions an, dann steht ein Ja/Nein davor.',
    })
  }
  {
    const m = /^\/focus\/(.+)$/.exec(route)
    if (m && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const id = decodeURIComponent(m[1])
      if (req.method === 'DELETE') {
        try {
          const weg = focusStore.entfernen(id)
          console.log('[hermes] Vorgang entfernt:', weg.titel)
          return json(res, 200, { ok: true, entfernt: weg })
        } catch (e) {
          return json(res, e.status || 400, { error: e.message })
        }
      }
      let input
      try { input = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'Ungültiges JSON: ' + e.message })
      }
      try {
        const v = focusStore.aendern(id, input, 'hermes')
        console.log(`[hermes] Vorgang "${v.titel}" → ${v.zustand}` + (v.zuletztWarum ? ` (${v.zuletztWarum})` : ''))
        return json(res, 200, { ok: true, vorgang: v })
      } catch (e) {
        return json(res, e.status || 400, { error: e.message })
      }
    }
  }

  return json(res, 404, {
    error: 'Unbekannte Route',
    verfuegbar: [
      'GET    /api/hermes/ping',
      'GET    /api/hermes/state',
      'GET    /api/hermes/todos',
      'POST   /api/hermes/todos   {"text":"…","priority":"wichtig","estimatedMin":30}  — ohne date/scope: heute',
      '                           {"text":"…","date":"JJJJ-MM-TT"}       — für einen bestimmten Tag (kommt an dem Morgen in die Tagesliste)',
      '                           {"text":"…","scope":"week","plannedDay":4}  — in „Diese Woche" (plannedDay optional, 1=Mo…7=So)',
      '                           Antwort enthält "wo": heute | geplant | woche. Vergangenes oder ungültiges date → 400.',
      'DELETE /api/hermes/todos/<id>',
      'GET    /api/hermes/events',
      'POST   /api/hermes/events  {"title":"…","date":"JJJJ-MM-TT","kind":"deadline"}',
      'DELETE /api/hermes/events/<id>',
      'GET    /api/hermes/calendar-outbox',
      'PATCH  /api/hermes/calendar-outbox/<id>  {"ok":true,"calUid":"…"} | {"ok":false,"fehler":"…"}',
      'GET    /api/hermes/focus',
      'PATCH  /api/hermes/focus/<id>  {"zustand":"wartet","wartetAuf":"…","begruendung":"…"}',
      'DELETE /api/hermes/focus/<id>',
      'GET    /api/hermes/goals',
      'PUT    /api/hermes/goals   {"weekday":0-6,"minutes":n} | {"weekdayMinutes":[7]} | {"overrides":{"JJJJ-MM-TT":n|null}}',
      'GET    /api/hermes/briefing',
      'POST   /api/hermes/briefing {"date":"JJJJ-MM-TT","text":"…","alert":{"id":"…","title":"…","why":"…","deadline":"JJJJ-MM-TT"}}',
      '                            alert ist optional · höchstens eins pro Tag (sonst 409) · quittierte werden verworfen',
      'GET    /api/hermes/question',
      'POST   /api/hermes/question {"id":"…","frage":"…","warum":"…","quelle":"brain|hermes","seite":"wiki/…"}',
      '                            höchstens EINE offene Frage (sonst 409) · zurückgestellte 7 Tage gesperrt, verworfene für immer',
      'DELETE /api/hermes/question {"id":"…"}  — Antwort abgeholt und ins Brain eingetragen, Platz für die nächste',
      'GET    /api/hermes/brain/fragen?limit=10  — offene Fragen aus dem Wiki, dringendste zuerst, Gesperrtes gefiltert',
      'GET    /api/hermes/digest?from=JJJJ-MM-TT&to=JJJJ-MM-TT  — Lernbericht (ohne Angabe: letzte 7 volle Tage)',
      'GET    /api/hermes/learnharness  — Themen, an denen Paul in LearnHarness die letzten 14 Tage gelernt hat',
      'POST   /api/hermes/hoerbriefing {"datum":"<heute>","text":"…≤740 Wörter (~5 min), endet mit der Frage?","frage":{"id","frage","warum","seite"}}',
      '                            → 202, Aufnahme läuft · 409 bei gleichem Einstieg wie an einem der letzten 7 Tage oder anderer offener Brain-Frage',
      '                            optional "stil":"…" (≤300 Zeichen, Sprechweise des Tages) · im Text erlaubt: <short pause> <laugh> <sigh>',
      'GET    /api/hermes/hoerbriefing  — Status heute (erzeuge|fertig|fehler) + Verlauf der letzten 7 Texte',
      'GET    /api/hermes/hoerbriefing/audio?datum=JJJJ-MM-TT  — die MP3 (für Telegram)',
    ],
  })
}

// addTodo/addEvent sind mit exportiert, weil server.cjs sie beim "Ja" auf einen
// Vorschlag braucht (siehe suggestionStore.cjs). Bewusst dieselbe Funktion und
// keine zweite Fassung: sonst gäbe es die Anlege-Regeln zweimal, und zwei
// Fassungen derselben Regel driften auseinander.
// addTodo/addEvent sind mit exportiert, weil server.cjs sie beim "Ja" auf einen
// Vorschlag und beim Verschieben zwischen Todo und Fokus braucht — der Browser
// hat kein HERMES_TOKEN und soll auch keins bekommen.
// deleteTodo gehoert dazu: "Todo → Fokus" ist VERSCHIEBEN, das Todo muss dabei
// verschwinden. Ohne diesen Export war der Knopf still wirkungslos (400
// "deleteTodo is not a function") — aufgefallen erst im Ende-zu-Ende-Test.
module.exports = { handle, addTodo, addEvent, deleteTodo, deleteEvent, zielFuerTodo, offeneTodos, setTodoDone, restoreTodo }
