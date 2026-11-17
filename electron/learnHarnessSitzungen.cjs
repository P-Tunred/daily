// LearnHarness → Daily: gespeicherte Lernsitzungen als Dailys eigene Lernzeit.
//
// WARUM (Paul, 2026-10-31)
// Paul lernt in LearnHarness und will dafür nicht zu Dailys Timer wechseln.
// LearnHarness hat einen eigenen Timer; „Save“ beendet dort eine Lernsitzung.
// Die gespeicherten Sitzungen stehen in learnharness-stats.json unter
// `timer.sessions` (eine je Tag und Fach) und kommen mit der stündlichen
// Spiegelung auf die VM. Hier werden sie zu ganz normalen Sitzungen im
// Tracker — Score, Lernzeit-Seite, Tagesbericht und Planer zählen sie mit.
//
// JEDE SITZUNG GENAU EINMAL
// Übernommene Kennungen stehen in `morning.learnharness.uebernommen`. Eine
// Sitzung, die Paul in Daily löscht, kommt deshalb nicht wieder. Der Planer
// nimmt pro Tag das Größere aus Timer und LearnHarness-Zeit, nie die Summe —
// die übernommenen Minuten zählen dort also nicht doppelt.
//
// FACH
// Das LearnHarness-Fach („FODS Theorie“) wird dem aktiven Daily-Fach
// zugeordnet, dessen Name (oder Alias aus brainPages) als ganzes Wort darin
// steht; der längste Treffer gewinnt. Ohne Treffer bleibt die Sitzung liegen
// und erscheint unter `ohneFach`, bis es ein passendes Fach gibt.
//
// Daily schreibt dabei nur in seinen eigenen Zustand, nie ins Brain.

const stateStore = require('./stateStore.cjs')
const brainPages = require('./brainPages.cjs')
const learnHarness = require('./learnHarness.cjs')

const SESSIONS_KEY = 'morning.tracker.sessions'
const SUBJECTS_KEY = 'morning.tracker.subjects'
const UEBERNOMMEN_KEY = 'morning.learnharness.uebernommen'
const MAX_GEMERKT = 5000
const NOTIZ = 'LearnHarness'

let letzterLauf = { neu: 0, ohneFach: [] }

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function liste(state, key) {
  try {
    const v = JSON.parse(state.localStorage[key] ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Das aktive Daily-Fach zu einem LearnHarness-Fach, oder null. */
function fachZuordnen(fach, subjects) {
  let best = null
  for (const s of subjects) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || s.archiviert) continue
    for (const term of brainPages.subjectTerms(s.name)) {
      const passt = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}($|[^\\p{L}\\p{N}])`, 'iu').test(fach)
      if (passt && (!best || term.length > best.laenge)) best = { id: s.id, name: s.name, laenge: term.length }
    }
  }
  return best
}

/** Neue gespeicherte Sitzungen aus LearnHarness in den Tracker übernehmen. */
function uebernehmen(now = Date.now()) {
  const stand = learnHarness.lernstand(now)
  if (!stand.ok || !stand.sitzungen.length) {
    letzterLauf = { neu: 0, ohneFach: [] }
    return letzterLauf
  }
  const state = stateStore.read()
  const subjects = liste(state, SUBJECTS_KEY)
  const gemerkt = new Set(liste(state, UEBERNOMMEN_KEY).filter((x) => typeof x === 'string'))
  const sessions = liste(state, SESSIONS_KEY)
  const vorhanden = new Set(sessions.map((s) => s && s.id))
  const neue = []
  const ohneFach = new Set()
  for (const s of stand.sitzungen) {
    const id = `lh-${s.id}`
    if (gemerkt.has(id) || vorhanden.has(id)) continue
    const fach = fachZuordnen(s.fach, subjects)
    if (!fach) {
      ohneFach.add(s.fach)
      continue
    }
    neue.push({ id, subjectId: fach.id, date: s.datum, durationMin: s.minuten, ...(s.startMs ? { startedAtMs: s.startMs } : {}), note: NOTIZ })
    gemerkt.add(id)
  }
  if (neue.length) {
    state.localStorage[SESSIONS_KEY] = JSON.stringify([...sessions, ...neue])
    state.localStorage[UEBERNOMMEN_KEY] = JSON.stringify([...gemerkt].slice(-MAX_GEMERKT))
    stateStore.write(state)
    console.log(`[learnharness] ${neue.length} Lernsitzung(en) übernommen`)
  }
  letzterLauf = { neu: neue.length, ohneFach: [...ohneFach] }
  return letzterLauf
}

/** Was der letzte Lauf ergab — für /api/learnharness. */
const letzterStand = () => letzterLauf

module.exports = { uebernehmen, fachZuordnen, letzterStand }
