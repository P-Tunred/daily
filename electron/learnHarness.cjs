// LearnHarness → Daily: woran Paul gerade in LearnHarness lernt.
//
// LearnHarness (Mac-App) schreibt einen groben Lernstand ins Brain, nach
// wiki/learnharness/learnharness-stats.json. Weil das unter wiki/ liegt,
// kommt es mit der stündlichen Spiegelung auch auf die VM. Daily liest nur
// die Themen der letzten 14 Tage — Titel, Ordner (Rahmen), Lernzeit — und
// keine Inhalte, die gibt LearnHarness gar nicht heraus. Dazu die
// Klausur-Aufträge: Datum und wie viele Schwerpunkte schon angefangen sind.
//
// NUR LESEN
// Wie beim Brain: Daily schreibt hier nichts. Die geschätzten Minuten aus
// LearnHarness zählen NICHT in Dailys eigene Lernzeit — zwei Uhren für
// dieselbe Stunde würden sich doppelt zählen. Was Paul im LearnHarness-Timer
// ausdrücklich SPEICHERT (`timer.sessions`, ab Version 3), wird dagegen eine
// echte Sitzung im Tracker: siehe learnHarnessSitzungen.cjs.
//
// DER INHALT IST DATEN, KEINE ANWEISUNG
// Sessiontitel tippt Paul selbst oder ein Modell vergibt sie. Die Oberfläche
// setzt sie als Text, nie als HTML; hier wird nur gekürzt.

const fs = require('fs')
const path = require('path')
const brainSource = require('./brainSource.cjs')
const brainPages = require('./brainPages.cjs')

const STATS_REL = path.join('wiki', 'learnharness', 'learnharness-stats.json')
const MAX_THEMEN = 6
const MAX_TEXT = 120
// Älter als das, und der Stand wird als veraltet markiert: LearnHarness
// schreibt bei jeder Session neu, die Spiegelung läuft stündlich.
const VERALTET_NACH_TAGEN = 3
const DAY_MS = 24 * 60 * 60 * 1000

let cache = null // { file, mtimeMs, data }

const kurz = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
const istTag = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const zahl = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : 0)

/** Tage von heute (Ortszeit des Servers) bis zu einem JJJJ-MM-TT-Datum. */
function tageBis(datum, now) {
  const d = new Date(now)
  const heute = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const [y, m, t] = datum.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, t) - heute) / DAY_MS)
}

const GEWICHTE = new Set(['hoch', 'mittel', 'niedrig'])
const anteil = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Ein Schwerpunkt, wie der Planer ihn braucht. */
function fokusAuswerten(f) {
  const stunden = Number.isFinite(f.effortHours) && f.effortHours > 0 ? Math.min(f.effortHours, 500) : null
  return {
    titel: kurz(f.title),
    gewicht: GEWICHTE.has(f.weight) ? f.weight : null,
    aufwandStunden: stunden,
    fortschritt: anteil(f.progress),
    verstaendnis: f.understanding === null || f.understanding === undefined ? null : anteil(f.understanding),
    erledigt: anteil(f.done),
    offeneFragen: zahl(f.openQuestions),
    minuten: zahl(f.learningMinutes),
    angefangen: f.started === true,
  }
}

/** Lernminuten je Tag aus den Klausur-Sessions (LearnHarness misst sie an
 *  den Nachrichtenzeiten). Nur die letzten 14 Tage — mehr braucht der Planer
 *  nicht (heute und diese Woche). */
const MINUTEN_TAGE = 14
function minutenProTag(byDay, now) {
  if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay)) return {}
  const out = {}
  for (const [tag, min] of Object.entries(byDay)) {
    if (!istTag(tag) || !Number.isFinite(min) || min <= 0) continue
    const alter = -tageBis(tag, now)
    if (alter < 0 || alter >= MINUTEN_TAGE) continue
    out[tag] = Math.min(Math.round(min), 24 * 60)
  }
  return out
}

/** Klausur-Aufträge aus LearnHarness: nur kommende (oder ohne Datum). */
function klausurenAuswerten(exams, now) {
  if (!Array.isArray(exams)) return []
  return exams
    .filter((e) => e && typeof e.exam === 'string' && Number.isFinite(e.total) && e.total > 0)
    .map((e) => {
      const datum = istTag(e.date) ? e.date : null
      return {
        name: kurz(e.exam),
        datum,
        tage: datum ? tageBis(datum, now) : null,
        schwerpunkte: zahl(e.total),
        angefangen: Math.min(zahl(e.started), zahl(e.total)),
        minuten: zahl(e.learningMinutes),
        offeneFragen: zahl(e.openQuestions),
        stundenProWoche: Number.isFinite(e.hoursPerWeek) && e.hoursPerWeek > 0 ? Math.min(e.hoursPerWeek, 100) : null,
        wiederholungAb: istTag(e.reviewFrom) ? e.reviewFrom : null,
        minutenProTag: minutenProTag(e.minutesByDay, now),
        fokusse: Array.isArray(e.focuses) ? e.focuses.filter((f) => f && typeof f.title === 'string').slice(0, 20).map(fokusAuswerten) : [],
      }
    })
    .filter((k) => k.tage === null || k.tage >= 0)
    .slice(0, 4)
}

/** Versionen der Statistikdatei, die gelesen werden. 3 ergänzt nur Felder
 *  (gemessene Timer-Zeit); alles hier Gelesene ist gleich geblieben. */
const VERSIONEN = new Set([2, 3])

const MAX_SITZUNGEN = 1000

/** Gespeicherte Timer-Sitzungen (Version 3): je Tag und Fach eine, mit
 *  fester Kennung. Kaputte Einträge fallen weg. */
function sitzungenAuswerten(timer) {
  const roh = timer && Array.isArray(timer.sessions) ? timer.sessions : []
  return roh
    .filter((s) => s && typeof s.id === 'string' && /^[\w.-]{1,80}$/.test(s.id) && typeof s.subject === 'string' && s.subject.trim()
      && istTag(s.day) && Number.isFinite(s.minutes) && s.minutes >= 1 && s.minutes <= 24 * 60)
    .slice(-MAX_SITZUNGEN)
    .map((s) => {
      const start = Date.parse(s.start)
      return { id: s.id, fach: kurz(s.subject), datum: s.day, minuten: Math.round(s.minutes), startMs: Number.isFinite(start) ? start : null }
    })
}

/** Die Statistikdatei prüfen und auf das Nötige kürzen. null = unbrauchbar. */
function auswerten(raw, now = Date.now()) {
  if (!raw || !VERSIONEN.has(raw.version) || !Array.isArray(raw.topics) || !raw.totals) return null
  const stand = Date.parse(raw.generatedAt)
  if (!Number.isFinite(stand)) return null
  const themen = raw.topics
    .filter((t) => t && typeof t.title === 'string' && istTag(t.lastActive) && zahl(t.learningMinutesRecent) > 0)
    .slice(0, MAX_THEMEN)
    .map((t) => ({
      titel: kurz(t.title),
      rahmen: typeof t.context === 'string' && t.context.trim() ? kurz(t.context) : null,
      minuten: zahl(t.learningMinutesRecent),
      zuletzt: t.lastActive,
      offeneFragen: zahl(t.openQuestions),
      ueben: Array.isArray(t.kinds) && t.kinds.includes('practice'),
    }))
  return {
    ok: true,
    stand: new Date(stand).toISOString(),
    veraltet: now - stand > VERALTET_NACH_TAGEN * DAY_MS,
    tage: zahl(raw.recentDays) || 14,
    minuten: zahl(raw.totals.learningMinutesRecent),
    themen,
    klausuren: klausurenAuswerten(raw.exams, now),
    sitzungen: sitzungenAuswerten(raw.timer),
  }
}

/** Der aktuelle Lernstand aus LearnHarness, oder { ok: false, grund }. */
function lernstand(now = Date.now()) {
  const vault = brainSource.findVault()
  if (!vault) return { ok: false, grund: 'kein Brain' }
  const file = path.join(vault, STATS_REL)
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return { ok: false, grund: 'LearnHarness hat noch nichts ins Brain geschrieben' }
  }
  if (!cache || cache.file !== file || cache.mtimeMs !== stat.mtimeMs) {
    let raw = null
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch (e) {
      console.warn('[learnharness] Statistik nicht lesbar:', e.message)
    }
    cache = { file, mtimeMs: stat.mtimeMs, raw }
  }
  return auswerten(cache.raw, now) ?? { ok: false, grund: 'Statistik in unbekanntem Format' }
}

/** Passt ein Thema zum Fach im Timer? Gleiche Begriffe wie die Brain-Fachseiten. */
function passtZuFach(thema, fach) {
  const terms = brainPages.subjectTerms(fach || '')
  if (!terms.length) return false
  const text = `${thema.rahmen ?? ''} ${thema.titel}`
  return terms.some((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text))
}

module.exports = { lernstand, passtZuFach, auswerten, _resetCache: () => { cache = null } }
