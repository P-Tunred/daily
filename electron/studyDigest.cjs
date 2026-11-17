// Der Lernbericht — was Daily über Pauls Lernwochen weiß, für das Second Brain.
//
// WOZU DAS GUT IST
// Daily kennt jede Lernsitzung, jedes Tagesziel und jeden Tagesscore. Das
// Second Brain kannte davon bisher nichts: Die Fachseiten wussten, WAS vor
// einer Klausur zu lernen ist, aber nie, wie viel tatsächlich gelernt wurde.
// Und auf der Seite zum Arbeitsrhythmus stand seit Wochen die Frage, warum
// der Dienstag der schwächste Tag ist — die Antwort lag die ganze Zeit hier.
//
// WARUM DAILY NUR LIEFERT UND NICHT SCHREIBT
// Die Regel gilt weiter: ins Brain schreibt ausschliesslich Hermes (siehe
// questionStore.cjs, CONTEXT.md). Daily rechnet den Bericht, Hermes holt ihn
// über GET /api/hermes/digest und trägt ihn nach den Regeln der Brain-CLAUDE.md
// ein. Eine Datei, ein Schreiber.
//
// WARUM ES EINE REINE FUNKTION IST
// `buildDigest` bekommt die localStorage-Tabelle aus state.json und rechnet —
// ohne Dateizugriff, ohne Uhr. Damit ist sie testbar, und ein Fehler hier
// kann den Zustand nicht beschädigen: gelesen wird, geschrieben nie.
//
// WARUM DIE TAGESZIELE AUS DER SCORE-HISTORIE KOMMEN
// Das Tagesziel hängt an drei Ebenen (Wochentagsziel, Overrides, Epochen). Die
// Rechnung dafür lebt im Browser. Statt sie hier ein zweites Mal zu bauen —
// zwei Fassungen derselben Regel driften auseinander —, nimmt der Bericht das
// Ziel, das der Browser am jeweiligen Tag selbst in morning.scoreHistory
// festgehalten hat. Tage ohne Eintrag haben dann eben kein Ziel.

const ZONE = 'Europe/Berlin'
const DEFAULT_DAYS = 7
const MAX_DAYS = 366
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
// Montag zuerst: so liest Paul eine Woche, und so steht sie im Wochenplan.
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function parseJson(raw, fallback) {
  if (typeof raw !== 'string') return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

function isoToday(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = Montag … 6 = Sonntag. Mittags UTC, damit keine Zeitzone den Tag kippt. */
function weekdayIndex(iso) {
  return (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7
}

function validDate(iso) {
  if (!ISO_RE.test(iso)) return false
  const d = new Date(iso + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/** Zeitraum aus der Anfrage. Ohne Angabe: die letzten sieben VOLLEN Tage,
 *  also bis gestern — ein Bericht über den laufenden Tag wäre um Mitternacht
 *  schon falsch. Ungültiges wird abgelehnt, nicht geraten. */
function resolveRange(query = {}, today = isoToday()) {
  const to = query.to ?? addDays(today, -1)
  const from = query.from ?? addDays(to, -(DEFAULT_DAYS - 1))
  if (!validDate(from) || !validDate(to)) {
    throw Object.assign(new Error('from/to müssen gültige Daten im Format JJJJ-MM-TT sein.'), { status: 400 })
  }
  if (from > to) {
    throw Object.assign(new Error('from liegt nach to.'), { status: 400 })
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  if (days > MAX_DAYS) {
    throw Object.assign(new Error(`Höchstens ${MAX_DAYS} Tage pro Bericht.`), { status: 400 })
  }
  return { from, to, days }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

/**
 * Rechnet den Bericht aus der localStorage-Tabelle von state.json.
 * @param {Record<string,string>} ls  state.localStorage
 * @param {{from:string,to:string,days:number}} range
 */
function buildDigest(ls, range) {
  const subjects = parseJson(ls['morning.tracker.subjects'], [])
  const sessions = parseJson(ls['morning.tracker.sessions'], [])
  const history = parseJson(ls['morning.scoreHistory'], {})

  const subjectById = new Map(
    (Array.isArray(subjects) ? subjects : [])
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => [s.id, s]),
  )

  const inRange = (Array.isArray(sessions) ? sessions : []).filter((s) =>
    s && typeof s.date === 'string' && s.date >= range.from && s.date <= range.to &&
    typeof s.durationMin === 'number' && s.durationMin > 0)

  const perSubject = new Map()
  const perDay = new Map()
  const perWeekday = WEEKDAYS.map((label) => ({ weekday: label, min: 0, sessions: 0 }))

  for (const s of inRange) {
    const subj = perSubject.get(s.subjectId) ?? { min: 0, sessions: 0 }
    subj.min += s.durationMin
    subj.sessions += 1
    perSubject.set(s.subjectId, subj)

    perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.durationMin)

    const wd = perWeekday[weekdayIndex(s.date)]
    wd.min += s.durationMin
    wd.sessions += 1
  }

  const bySubject = [...perSubject.entries()]
    .map(([id, v]) => {
      const s = subjectById.get(id)
      return {
        subjectId: id,
        // Ein Fach, das es nicht mehr gibt, bleibt als Zahl erhalten — nur ohne
        // Namen. Weglassen hiesse, die Summe still kleiner zu machen.
        name: s ? String(s.name) : '(unbekanntes Fach)',
        archiviert: !!(s && s.archiviert),
        min: Math.round(v.min),
        sessions: v.sessions,
      }
    })
    .sort((a, b) => b.min - a.min)

  const byDay = []
  const scores = []
  // Wie oft jeder Wochentag im Zeitraum vorkommt — sonst verzerrt ein Bericht
  // über zehn Tage die Mittelwerte zugunsten der Tage, die zweimal drin sind.
  const weekdayCount = new Array(7).fill(0)
  for (let i = 0; i < range.days; i++) {
    const date = addDays(range.from, i)
    weekdayCount[weekdayIndex(date)] += 1
    const h = history && typeof history === 'object' ? history[date] : undefined
    const entry = { date, weekday: WEEKDAYS[weekdayIndex(date)], min: Math.round(perDay.get(date) ?? 0) }
    if (h && typeof h === 'object') {
      if (typeof h.goalMin === 'number') entry.goalMin = h.goalMin
      if (typeof h.score === 'number') { entry.score = h.score; scores.push(h.score) }
      if (typeof h.tasksDone === 'number') entry.tasksDone = h.tasksDone
      if (typeof h.tasksTotal === 'number') entry.tasksTotal = h.tasksTotal
    }
    byDay.push(entry)
  }

  const byWeekday = perWeekday.map((w, i) => ({
    ...w,
    min: Math.round(w.min),
    daysInRange: weekdayCount[i],
    avgMin: weekdayCount[i] ? Math.round(w.min / weekdayCount[i]) : 0,
  }))

  const totalMin = Math.round(inRange.reduce((a, s) => a + s.durationMin, 0))
  const daysWithGoal = byDay.filter((d) => typeof d.goalMin === 'number' && d.goalMin > 0)

  return {
    from: range.from,
    to: range.to,
    days: range.days,
    totalMin,
    sessions: inRange.length,
    avgMinPerDay: Math.round(totalMin / range.days),
    goalReachedDays: daysWithGoal.filter((d) => d.min >= d.goalMin).length,
    daysWithGoal: daysWithGoal.length,
    score: scores.length ? { avg: round1(scores.reduce((a, b) => a + b, 0) / scores.length), days: scores.length } : null,
    bySubject,
    byWeekday,
    byDay,
  }
}

module.exports = { buildDigest, resolveRange, weekdayIndex, isoToday, WEEKDAYS }
