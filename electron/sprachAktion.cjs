// Einen verstandenen Sprachbefehl ausführen und die Antwort dazu formulieren.
//
// Kein Modell: die Sätze sind feste Vorlagen, damit die Antwort sofort da ist
// („Steht drauf: Miete überweisen, für Mittwoch."). Ausgeführt wird über
// dieselben Wege wie überall in Daily — hermesApi.addTodo, questionStore,
// brainPages.search. Einen Termin blendet der Browser aus (die Liste der
// ausgeblendeten Termine gehört ihm), hier wird er nur gefunden und vermerkt.
// Alles landet zusätzlich im Stimm-Protokoll (stimmeLog.cjs) und damit abends
// im Tagesbericht fürs Brain.
//
// Ergebnis: { saetze, ereignisse, ende }
//   saetze      zum Vorlesen
//   ereignisse  { typ: 'aktion', art, id, text, … } | { typ: 'hinweis', text }
//
// Streichen und Abhaken (seit 2026-11-04, Pauls Wahl: sofort, mit „zurück")
// tragen `alt` mit — den Eintrag vor der Änderung. hermesStimme behält ihn auf
// dem Server, damit „zurück" ihn genau so wiederherstellt; an den Browser geht
// er nicht.

const hermesApi = require('./hermesApi.cjs')
const questionStore = require('./questionStore.cjs')
const brainPages = require('./brainPages.cjs')
const stimmeLog = require('./stimmeLog.cjs')
const { fuersOhr } = require('./stimmeProtokoll.cjs')

const ZONE = 'Europe/Berlin'
const crypto = require('crypto')
const MAX_AUSZUG = 260

let suche = (q) => brainPages.search(q, { limit: 2, maxChars: 500 })
/** Nur für Tests: die Brain-Suche ersetzen. */
function _fuerTests({ sucheFn } = {}) { if (sucheFn) suche = sucheFn }

function todoEingabe({ text, wann }) {
  if (wann === 'woche') return { text, scope: 'week' }
  if (wann === 'heute') return { text }
  return { text, date: wann }
}

function wohin(task) {
  if (task.wo === 'woche') return 'für diese Woche'
  if (task.wo !== 'geplant' || !task.geplantAm) return 'für heute'
  const d = new Date(task.geplantAm + 'T12:00:00Z')
  const tage = Math.round((Date.parse(task.geplantAm) - Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: ZONE }))) / 86_400_000)
  if (tage === 1) return 'für morgen'
  if (tage > 1 && tage < 7) return `für ${d.toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' })}`
  return `für den ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
}

/** Erster Satz oder zwei, fürs Ohr. */
function kurzerAuszug(text) {
  const sauber = fuersOhr(String(text || '').replace(/\n+/g, ' ').replace(/\s*[-•]\s+/g, ' '))
  if (sauber.length <= MAX_AUSZUG) return sauber
  const schnitt = sauber.slice(0, MAX_AUSZUG)
  const ende = Math.max(schnitt.lastIndexOf('. '), schnitt.lastIndexOf('! '), schnitt.lastIndexOf('? '))
  return ende > 80 ? schnitt.slice(0, ende + 1) : schnitt.replace(/\s+\S*$/, '') + ' …'
}

function todo(b) {
  const task = hermesApi.addTodo(todoEingabe(b))
  const wo = wohin(task)
  const log = stimmeLog.merke({ art: 'todo', text: task.text, wo })
  return {
    saetze: [`Steht drauf: ${task.text}, ${wo}.`],
    ereignisse: [{ typ: 'aktion', art: 'todo', id: task.id, text: task.text, wo: task.wo, log }],
  }
}

function tagName(iso) {
  const tage = Math.round((Date.parse(iso) - Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: ZONE }))) / 86_400_000)
  if (tage === 1) return 'morgen'
  const d = new Date(iso + 'T12:00:00Z')
  if (tage > 1 && tage < 7) return `am ${d.toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' })}`
  return `am ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
}

function termin(b) {
  if (!b.ids.length) return { saetze: [`Einen Termin „${b.titel}" finde ich heute nicht.`], ereignisse: [] }
  const tage = b.tage && b.tage.length ? b.tage : b.datum ? [b.datum] : []
  // „am Freitag und am Sonntag" → „am Freitag und Sonntag"
  const namen = tage.map(tagName)
  const wann = namen.length ? ` ${namen.map((n, i) => (i ? n.replace(/^am /, '') : n)).join(namen.length > 2 ? ', ' : ' und ').replace(/, ([^,]+)$/, ' und $1')}` : ''
  const log = stimmeLog.merke({ art: 'termin', text: b.titel + wann })
  const mehr = b.ids.length > 1 ? ` (${b.ids.length} Einträge)` : ''
  const satz = tage.length
    ? `Okay, ${b.titel}${wann} nehme ich aus deinem Plan${mehr}. Im Kalender selbst bleibt alles stehen.`
    : `Okay, ${b.titel} nehme ich aus deinem Tag${mehr}.`
  return {
    saetze: [satz],
    ereignisse: [{ typ: 'aktion', art: 'termin', id: log, ids: b.ids, text: b.titel + wann }],
  }
}

/** Streichen oder abhaken — jede Aufgabe einzeln, damit „zurück" jede kennt. */
function aendereAufgaben(b) {
  const ereignisse = []
  const namen = []
  for (const id of b.ids) {
    const alt = b.art === 'streichen' ? hermesApi.deleteTodo(id) : hermesApi.setTodoDone(id, true)
    if (!alt) continue
    namen.push(alt.text)
    const log = stimmeLog.merke({ art: b.art, text: alt.text })
    ereignisse.push({ typ: 'aktion', art: b.art, id: crypto.randomUUID(), text: alt.text, log, alt })
  }
  if (!namen.length) return { saetze: ['Die Aufgabe finde ich nicht mehr in deiner Liste.'], ereignisse }
  const was = namen.join(' und ')
  return {
    saetze: [b.art === 'streichen' ? `Gestrichen: ${was}. Sag „zurück", wenn das falsch war.` : `Abgehakt: ${was}.`],
    ereignisse,
  }
}

function brain(b) {
  const r = suche(b.suche)
  stimmeLog.merke({ art: 'brain', text: b.suche })
  if (!r || !r.ok) return { saetze: ['Das Brain kann ich gerade nicht lesen.'], ereignisse: [] }
  const t = r.treffer[0]
  if (!t) return { saetze: [`Im Brain finde ich nichts zu ${b.suche}.`], ereignisse: [] }
  return {
    saetze: [`Im Brain, Seite ${t.titel}:`, kurzerAuszug(t.auszug)],
    ereignisse: [{ typ: 'aktion', art: 'brain', id: t.datei, text: t.titel, link: t.obsidian }],
  }
}

function antwort(b, frage) {
  if (!frage) return { saetze: ['Gerade ist keine Brain-Frage offen.'], ereignisse: [] }
  const r = questionStore.reagiere('antworten', b.text)
  return {
    saetze: ['Gespeichert, als Antwort auf die Frage von heute.'],
    ereignisse: [{ typ: 'aktion', art: 'antwort', id: r.id, text: b.text }],
  }
}

/** Führt einen geprüften Befehl aus. Fehler werden zum Hinweis, nicht zur Ausnahme. */
function fuehreAus(b, { frage = null } = {}) {
  try {
    switch (b.art) {
      case 'todo': return { ...todo(b), ende: false }
      case 'termin': return { ...termin(b), ende: false }
      case 'streichen':
      case 'erledigt': return { ...aendereAufgaben(b), ende: false }
      case 'rueckfrage': return { saetze: [b.text], ereignisse: [], ende: false }
      case 'brain': return { ...brain(b), ende: false }
      case 'antwort': return { ...antwort(b, frage), ende: false }
      case 'ende': return { saetze: [], ereignisse: [], ende: true }
      default: return { saetze: ['Das kann ich noch nicht.'], ereignisse: [], ende: false }
    }
  } catch (e) {
    const grund = String((e && e.message) || e).slice(0, 160)
    console.warn(`[sprache] ${b.art} nicht ausgeführt:`, grund)
    return { saetze: ['Das hat nicht geklappt.'], ereignisse: [{ typ: 'hinweis', text: `Nicht ausgeführt: ${grund}` }], ende: false }
  }
}

module.exports = { fuehreAus, kurzerAuszug, _fuerTests }
