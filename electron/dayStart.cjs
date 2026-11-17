// Der Tagesbeginn — was heute dran ist, kommt heute auf die Liste.
//
// ZWEI DINGE, EIN ANLASS
//
// 1. WARTENDE VORGAENGE
// "Beurlaubung: Nachfassen bei studium@uni.example, falls bis 17.09. nichts kommt"
// ist keine Aufgabe fuer heute. Als Todo eingetragen stuende sie zwei Wochen
// im Weg und wuerde jeden Tag mitgelesen und weggeschoben — bis sie zur Tapete
// wird und man sie am 17. uebersieht. Als Termin im Horizont steht sie richtig,
// tut aber am Stichtag nichts. Hier wird aus dem Termin an seinem Tag eine
// Aufgabe.
//
// 2. WOCHENPLANUNG
// Ein Wochen-Todo mit `plannedDay: 4` sagt "das mache ich Donnerstag". Bisher
// war das nur eine Sortiermarke — am Donnerstag musste man es von Hand in den
// Tag ziehen. Wer das vergisst, hat Donnerstag eine leere Tagesliste und eine
// volle Wochenliste.
//
// WARUM VERSCHOBEN UND NICHT KOPIERT
// Dieselbe Regel wie bei Todo → Fokus: sonst stuende derselbe Text an zwei
// Orten und liefe auseinander, sobald einer abgehakt wird.
//
// WARUM DAS HIER UND NICHT IM BROWSER PASSIERT
// Der Browser laeuft nur, wenn Paul hinsieht. Ein Uebertrag, der davon abhaengt,
// dass jemand die App offen hat, passiert genau dann nicht, wenn er gebraucht
// wird — am Morgen eines vollen Tages.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')

const MARKER_KEY = 'morning.dayStart'
const TODO_KEY = 'morning.todos'
const EVENT_KEY = 'morning.important.events'
const ZONE = 'Europe/Berlin'

function heute() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. Passend zu Task.plannedDay. */
function wochentag() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: ZONE })).getDay()
  return d === 0 ? 7 : d
}

function leseListe(state, key) {
  try {
    const v = JSON.parse(state.localStorage[key])
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function leseMarker(state) {
  try {
    const v = JSON.parse(state.localStorage[MARKER_KEY])
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** Ein Termin, aus dem heute eine Aufgabe werden soll.
 *
 *  `alsTodoAm` ist absichtlich ein EIGENES Datum und nicht einfach `date`:
 *  bei "Nachfassen, falls bis zum 17. nichts kommt" ist der Stichtag der Tag
 *  selbst, bei "Frist laeuft am 4. ab" muss die Aufgabe vorher da sein. Ein
 *  Feld fuer beides waere in einem der Faelle immer falsch. */
function faelligHeute(e, tag) {
  if (!e || typeof e !== 'object' || e.dismissed) return false
  if (e.todoErzeugt) return false
  return typeof e.alsTodoAm === 'string' && e.alsTodoAm <= tag
}

function alsTodo(e, tag) {
  return {
    id: crypto.randomUUID(),
    text: String(e.title || 'Ohne Titel').slice(0, 200),
    done: false,
    createdAt: Date.now(),
    scope: 'day',
    date: tag,
    // Rueckverweis auf den Termin. Ohne ihn liesse sich spaeter nicht mehr
    // sagen, woher die Aufgabe kam — und der Termin im Horizont saehe aus,
    // als haette er nie etwas ausgeloest.
    ausTermin: e.id,
    ...(e.note ? { description: String(e.note).slice(0, 500) } : {}),
  }
}

/** Ein Wochen-Todo, das fuer heute geplant war. */
/** Ist ein Wochen-Todo heute dran?
 *
 *  Mit `geplantAm` (ein konkretes Datum, etwa von Hermes für „am 12.11."): an
 *  genau diesem Tag — oder danach, falls der Tagesbeginn an dem Tag nicht lief
 *  (Server aus). Sonst bliebe es für immer in der Wochenliste liegen.
 *
 *  Ohne Datum wie bisher am geplanten Wochentag. Das Datum hat Vorrang: eine
 *  Aufgabe für in drei Wochen trägt zwar `plannedDay` (für die Anzeige), darf
 *  aber nicht schon am nächsten passenden Wochentag in den Tag rutschen. */
function fuerHeuteGeplant(t, tagNr, tag = heute()) {
  if (!t || t.done || t.scope !== 'week') return false
  if (typeof t.geplantAm === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.geplantAm)) return t.geplantAm <= tag
  return Number(t.plannedDay) === tagNr
}

function schiebeInDenTag(t, tag) {
  return { ...t, scope: 'day', date: tag, ausWoche: true }
}

function faellig(state) {
  const m = leseMarker(state)
  return !m || m.tag !== heute()
}

/**
 * Fuehrt den Tagesbeginn aus. Hoechstens einmal pro Kalendertag — der Marker
 * verhindert, dass ein Neustart mittags dieselben Termine ein zweites Mal in
 * Aufgaben verwandelt.
 */
function starteTag({ erzwingen = false } = {}) {
  const state = stateStore.read()
  const tag = heute()
  if (!erzwingen && !faellig(state)) {
    return { gelaufen: false, grund: 'heute-schon', tag }
  }

  const tagNr = wochentag()
  const todosVorher = leseListe(state, TODO_KEY)
  const idbVorher = Array.isArray(state.indexedDB.todos) ? state.indexedDB.todos : []
  const eventsVorher = leseListe(state, EVENT_KEY)
  const idbEvents = Array.isArray(state.indexedDB.importantEvents) ? state.indexedDB.importantEvents : []

  // 1) Faellige Termine → neue Aufgaben
  const faellige = eventsVorher.filter((e) => faelligHeute(e, tag))
  const neueTodos = faellige.map((e) => alsTodo(e, tag))
  const erledigteIds = new Set(faellige.map((e) => e.id))
  const markiere = (e) => (erledigteIds.has(e.id) ? { ...e, todoErzeugt: tag } : e)

  // 2) Wochen-Todos fuer heute → in die Tagesliste
  const zuSchieben = new Set(todosVorher.filter((t) => fuerHeuteGeplant(t, tagNr, tag)).map((t) => t.id))
  for (const t of idbVorher) if (fuerHeuteGeplant(t, tagNr, tag)) zuSchieben.add(t.id)

  const uebertrage = (liste) =>
    [...liste.map((t) => (zuSchieben.has(t.id) && fuerHeuteGeplant(t, tagNr, tag) ? schiebeInDenTag(t, tag) : t)), ...neueTodos]

  // BEIDE Ablagen in EINEM Schreibvorgang — sonst schreibt die ueberlebende
  // Seite beim naechsten Abgleich ihren alten Stand zurueck.
  state.localStorage[TODO_KEY] = JSON.stringify(uebertrage(todosVorher))
  state.indexedDB.todos = uebertrage(idbVorher)
  state.localStorage[EVENT_KEY] = JSON.stringify(eventsVorher.map(markiere))
  state.indexedDB.importantEvents = idbEvents.map(markiere)

  const bericht = {
    tag,
    wochentag: tagNr,
    ausTerminen: neueTodos.length,
    ausWoche: zuSchieben.size,
    titel: [...faellige.map((e) => e.title), ...todosVorher.filter((t) => zuSchieben.has(t.id)).map((t) => t.text)]
      .map((s) => String(s).slice(0, 80)),
    um: new Date().toISOString(),
  }
  state.localStorage[MARKER_KEY] = JSON.stringify(bericht)
  stateStore.write(state)

  if (bericht.ausTerminen || bericht.ausWoche) {
    console.log(`[tagesbeginn] ${tag}: ${bericht.ausTerminen} aus Terminen, ${bericht.ausWoche} aus der Wochenliste`)
  }
  return { gelaufen: true, ...bericht }
}

function letzter() {
  try {
    return leseMarker(stateStore.read())
  } catch {
    return null
  }
}

module.exports = { starteTag, faellig, letzter, MARKER_KEY, faelligHeute, fuerHeuteGeplant, schiebeInDenTag, alsTodo }
