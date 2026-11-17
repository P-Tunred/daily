// Wann ein datierter Vorgang zur Aufgabe wird — und wie das System dazulernt.
//
// DAS PROBLEM
// "Beurlaubung: nachfassen, falls bis 17.09. nichts kommt" gehoert AN den Tag.
// "Frist: SU-Einmalcode laeuft am 04.09. ab" gehoert DAVOR — am Tag selbst ist
// es zu spaet. Beides sind Termine mit Datum, und keine feste Regel trifft
// beide. Der Unterschied liegt in der Bedeutung, nicht in den Daten.
//
// WIE HIER GELERNT WIRD — UND WIE NICHT
// Nichts wird trainiert und nichts wird geraten. Daily fuehrt Buch ueber
// Entscheidungen: welcher Vorgang bekam welchen Vorlauf, und wer hat das
// entschieden. Hermes liest dieses Buch, bevor er einen neuen Vorgang anlegt,
// und urteilt danach. Ist er unsicher, fragt er — genau einmal — und Pauls
// Antwort wird zur naechsten Zeile im Buch.
//
// Das ist fallbasiertes Schliessen, kein Modelltraining: nachvollziehbar,
// jederzeit einsehbar, und eine falsche Regel laesst sich loeschen statt
// "wegtrainieren". Bei zwei Dutzend Vorgaengen im Jahr waere alles andere
// Theater.
//
// WARUM DAS BUCH IN DAILY LIEGT UND NICHT IM SECOND BRAIN
// Ins Brain schreibt ausschliesslich Hermes, und der Schreibweg dorthin geht
// ueber Google Drive, wo ein falscher Aufruf Duplikate anlegt. Eine Regel, die
// bei jedem Lauf gelesen und gelegentlich ergaenzt wird, gehoert an den Ort mit
// dem verlaesslichen Schreibweg. Das Brain bleibt fuer Wissen ueber Paul; hier
// steht Wissen ueber seine Arbeitsweise mit DIESER App.
//
// WARUM HOECHSTENS EINE OFFENE FRAGE
// Dieselbe Begruendung wie beim Brain-Fragespeicher: ein Formular mit zehn
// Fragen beantwortet niemand. Eine Frage im Vorbeigehen beantwortet man.

const stateStore = require('./stateStore.cjs')

const KEY = 'morning.vorlauf'
const EVENT_KEY = 'morning.important.events'
const ZONE = 'Europe/Berlin'
/** Genug, um ein Muster zu erkennen; alles darueber liest ohnehin niemand mehr
 *  — und Hermes bekommt die Liste bei jedem Lauf in den Kontext gelegt. */
const MAX_REGELN = 60
/** Wie es ausging — genug für ein Muster pro Art, mehr liest niemand. */
const MAX_ERGEBNISSE = 80
/** Obergrenze fuer den Vorlauf. Vier Wochen vorher ist keine Erinnerung mehr,
 *  sondern ein zweites Todo, das genauso lange im Weg steht. */
const MAX_VORLAUF = 28

function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function fehler(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function lies(state) {
  const leer = { regeln: [], offen: null, ergebnisse: [] }
  try {
    const v = JSON.parse(state.localStorage[KEY])
    if (!v || typeof v !== 'object') return leer
    return {
      regeln: Array.isArray(v.regeln) ? v.regeln.filter((r) => r && typeof r === 'object') : [],
      offen: v.offen && typeof v.offen === 'object' ? v.offen : null,
      ergebnisse: Array.isArray(v.ergebnisse) ? v.ergebnisse.filter((r) => r && typeof r === 'object') : [],
    }
  } catch {
    return leer
  }
}

function schreibe(state, doc) {
  if (doc.regeln.length > MAX_REGELN) doc.regeln = doc.regeln.slice(0, MAX_REGELN)
  if (doc.ergebnisse.length > MAX_ERGEBNISSE) doc.ergebnisse = doc.ergebnisse.slice(0, MAX_ERGEBNISSE)
  state.localStorage[KEY] = JSON.stringify(doc)
}

function ganzeZahl(v, feld) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > MAX_VORLAUF) {
    throw fehler(400, `Feld "${feld}" braucht eine ganze Zahl von 0 bis ${MAX_VORLAUF} (Tage vor dem Termin).`)
  }
  return n
}

function text(v, max, feld) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (!s) throw fehler(400, `Feld "${feld}" fehlt.`)
  return s.slice(0, max)
}

/** Datum minus n Tage, als ISO-Tag. */
function minusTage(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() - n)
  return t.toISOString().slice(0, 10)
}

// ── Fragen ──────────────────────────────────────────────────────────────────

/** Hermes ist unsicher und laesst fragen.
 *
 *  Er MUSS einen Vorschlag mitgeben. Eine Frage ohne Vorschlag waelzt die
 *  ganze Denkarbeit auf Paul ab — dann kann der Agent es auch gleich lassen.
 *  Der Vorschlag ist die Vorauswahl im Dialog; Paul korrigiert sie oder nicht. */
function frage(input) {
  const state = stateStore.read()
  const doc = lies(state)
  if (doc.offen) {
    throw fehler(409,
      `Es steht bereits eine offene Vorlauf-Frage: "${doc.offen.titel}". ` +
      'Vorgesehen ist genau eine — erst wenn sie beantwortet ist, geht die naechste durch.')
  }
  const eventId = text(input.eventId, 100, 'eventId')
  const datum = String(input.datum ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw fehler(400, 'Feld "datum" braucht das Format JJJJ-MM-TT.')

  doc.offen = {
    eventId,
    titel: text(input.titel, 160, 'titel'),
    kind: typeof input.kind === 'string' ? input.kind : 'note',
    datum,
    vorschlag: ganzeZahl(input.vorschlag, 'vorschlag'),
    warum: input.warum ? text(input.warum, 300, 'warum') : null,
    gefragtAm: new Date().toISOString(),
  }
  schreibe(state, doc)
  stateStore.write(state)
  return doc.offen
}

/** Pauls Antwort: setzt den Stichtag am Termin UND schreibt die Regel fort.
 *
 *  Beides zusammen in einem Schreibvorgang — waere die Regel gespeichert und
 *  der Termin nicht, haette das System gelernt und trotzdem nichts getan. */
function antworte(vorlaufTage) {
  const n = ganzeZahl(vorlaufTage, 'vorlaufTage')
  const state = stateStore.read()
  const doc = lies(state)
  if (!doc.offen) throw fehler(404, 'Es steht keine Vorlauf-Frage offen.')
  const offen = doc.offen

  const stichtag = minusTage(offen.datum, n)
  let getroffen = 0
  const setze = (e) => {
    if (!e || e.id !== offen.eventId) return e
    getroffen++
    return { ...e, alsTodoAm: stichtag }
  }
  let liste = []
  try { liste = JSON.parse(state.localStorage[EVENT_KEY]) } catch { liste = [] }
  state.localStorage[EVENT_KEY] = JSON.stringify((Array.isArray(liste) ? liste : []).map(setze))
  if (Array.isArray(state.indexedDB.importantEvents)) {
    state.indexedDB.importantEvents = state.indexedDB.importantEvents.map(setze)
  }
  if (getroffen === 0) {
    throw fehler(404, `Der Termin ${offen.eventId} existiert nicht mehr — die Frage wurde verworfen.`)
  }

  doc.regeln.unshift({
    titel: offen.titel,
    kind: offen.kind,
    vorlaufTage: n,
    // "paul" wiegt schwerer als "hermes": eine selbst getroffene Entscheidung
    // ist ein Praezedenzfall, eine vom Agenten gesetzte nur eine Vermutung, die
    // niemand widersprochen hat.
    quelle: 'paul',
    am: serverDate(),
  })
  doc.offen = null
  schreibe(state, doc)
  stateStore.write(state)
  console.log(`[vorlauf] "${offen.titel}" → ${n} Tage vorher, Stichtag ${stichtag}`)
  return { titel: offen.titel, vorlaufTage: n, stichtag, regeln: doc.regeln.length }
}

/** Frage wegwerfen, ohne etwas zu lernen. Kein Praezedenzfall — "gerade keine
 *  Lust" ist keine Regel. */
function verwirf() {
  const state = stateStore.read()
  const doc = lies(state)
  if (!doc.offen) throw fehler(404, 'Es steht keine Vorlauf-Frage offen.')
  const titel = doc.offen.titel
  doc.offen = null
  schreibe(state, doc)
  stateStore.write(state)
  return { verworfen: titel }
}

/** Was Hermes eine Regel selbst gesetzt hat — ohne zu fragen, weil das Buch
 *  eindeutig war. Wird mitgeschrieben, damit sichtbar bleibt, worauf er sich
 *  berufen hat. */
function merkeEntscheidung(input) {
  const state = stateStore.read()
  const doc = lies(state)
  doc.regeln.unshift({
    titel: text(input.titel, 160, 'titel'),
    kind: typeof input.kind === 'string' ? input.kind : 'note',
    vorlaufTage: ganzeZahl(input.vorlaufTage, 'vorlaufTage'),
    quelle: 'hermes',
    am: serverDate(),
  })
  schreibe(state, doc)
  stateStore.write(state)
  return { regeln: doc.regeln.length }
}

// ── Wie es ausging ──────────────────────────────────────────────────────────
//
// WARUM DAS BUCH JETZT AUCH ERGEBNISSE FÜHRT (2026-10-27)
// Bis hier wusste das Buch nur, welchen Vorlauf jemand GEWÄHLT hat — nicht, ob
// er gereicht hat. Eine Regel „Abgabe: 2 Tage vorher", bei der die Aufgabe
// jedes Mal erst am Abgabetag erledigt wird, sah genauso gut aus wie eine, die
// passt. Jetzt steht neben jeder Regel, was daraus wurde: erledigt, wie viele
// Tage vor der Frist — oder verpasst. Hermes liest beides; die Auswertung
// sagt ihm, wo der Vorlauf zu knapp ist. Das ist der Teil, durch den das
// System mit der Zeit besser wird, statt nur Entscheidungen zu sammeln.

function tageZwischen(von, bis) {
  return Math.round((Date.parse(bis + 'T12:00:00Z') - Date.parse(von + 'T12:00:00Z')) / 86_400_000)
}

function lesListe(state, key) {
  try { const v = JSON.parse(state.localStorage[key]); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Ein Ergebnis anhängen — höchstens eins pro Termin. */
function vermerke(doc, ev, ergebnis) {
  if (doc.ergebnisse.some((r) => r.eventId === ev.id)) return false
  doc.ergebnisse.unshift({
    eventId: ev.id,
    titel: String(ev.title || '').slice(0, 160),
    kind: ev.kind || 'note',
    frist: ev.date,
    alsTodoAm: ev.alsTodoAm ?? null,
    vorlaufTage: ev.alsTodoAm ? tageZwischen(ev.alsTodoAm, ev.date) : null,
    ...ergebnis,
    am: serverDate(),
  })
  return true
}

/** Eine Aufgabe wurde abgehakt. Kam sie aus einem Termin, steht jetzt fest, wie
 *  viele Tage vor der Frist das war. `erledigtAm` nur, wenn es nicht heute war
 *  (Gestern-Nachtrag). */
function vermerkeErledigt(todoId, erledigtAm) {
  const state = stateStore.read()
  const todo = [...lesListe(state, 'morning.todos'), ...(state.indexedDB.todos || [])]
    .find((t) => t && t.id === todoId)
  if (!todo || !todo.ausTermin) return null
  const ev = [...lesListe(state, EVENT_KEY), ...(state.indexedDB.importantEvents || [])]
    .find((e) => e && e.id === todo.ausTermin)
  if (!ev || typeof ev.date !== 'string') return null
  const tag = typeof erledigtAm === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(erledigtAm) ? erledigtAm : serverDate()
  const doc = lies(state)
  const puffer = tageZwischen(tag, ev.date)
  if (!vermerke(doc, ev, { erledigtAm: tag, pufferTage: puffer, verpasst: puffer < 0 })) return null
  schreibe(state, doc)
  stateStore.write(state)
  console.log(`[vorlauf] erledigt: "${ev.title}" — ${puffer} Tage vor der Frist`)
  return doc.ergebnisse[0]
}

/** Morgens: Fristen, die gestern abgelaufen sind und deren Aufgabe noch offen
 *  ist, gelten als verpasst. Abgehakte ohne Vermerk werden nachgetragen. Ist
 *  die Aufgabe verschwunden (gelöscht, ohne Abhaken), weiss niemand, was war
 *  — das zählt nicht mit. */
function pruefeVerpasst() {
  const state = stateStore.read()
  const heute = serverDate()
  const doc = lies(state)
  const todos = [...lesListe(state, 'morning.todos'), ...(state.indexedDB.todos || [])]
  const events = lesListe(state, EVENT_KEY)
  let neu = 0
  for (const ev of events) {
    if (!ev || !ev.todoErzeugt || typeof ev.date !== 'string') continue
    if (doc.ergebnisse.some((r) => r.eventId === ev.id)) continue
    const todo = todos.find((t) => t && t.ausTermin === ev.id)
    // Abgehakt, aber die Meldung beim Abhaken kam nie an (offline, Hermes hat
    // abgehakt …): der Zeitstempel am Todo reicht, um nachzutragen.
    if (todo && todo.done && Number.isFinite(todo.doneAt)) {
      const tag = new Date(todo.doneAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
      const puffer = tageZwischen(tag, ev.date)
      if (/^\d{4}-\d{2}-\d{2}$/.test(tag) && vermerke(doc, ev, { erledigtAm: tag, pufferTage: puffer, verpasst: puffer < 0 })) neu++
      continue
    }
    if (ev.date >= heute) continue
    if (todo && !todo.done) {
      if (vermerke(doc, ev, { erledigtAm: null, pufferTage: null, verpasst: true })) neu++
    } else if (!todo) {
      if (vermerke(doc, ev, { erledigtAm: null, pufferTage: null, verpasst: null, unbekannt: true })) neu++
    }
  }
  if (neu) { schreibe(state, doc); stateStore.write(state) }
  return neu
}

/** Was die Ergebnisse pro Art sagen — in einem Satz, den Hermes umsetzen kann.
 *  Bewusst schlicht: bei ein paar Dutzend Fristen im Jahr wäre mehr Statistik
 *  Theater. Ab drei Fällen gibt es eine Empfehlung. */
function auswertung(ergebnisse) {
  const proArt = {}
  for (const r of ergebnisse) {
    if (r.unbekannt) continue
    const a = (proArt[r.kind] ||= { faelle: 0, verpasst: 0, puffer: [] })
    a.faelle++
    if (r.verpasst) a.verpasst++
    else if (Number.isFinite(r.pufferTage)) a.puffer.push(r.pufferTage)
  }
  return Object.fromEntries(Object.entries(proArt).map(([kind, a]) => {
    const mittel = a.puffer.length ? Math.round((a.puffer.reduce((x, y) => x + y, 0) / a.puffer.length) * 10) / 10 : null
    let empfehlung = 'noch zu wenige Fälle'
    if (a.faelle >= 3) {
      if (a.verpasst / a.faelle >= 0.25 || (mittel !== null && mittel < 1)) empfehlung = 'Vorlauf zu knapp — um 1–2 Tage erhöhen'
      else if (mittel !== null && mittel >= 4) empfehlung = 'reichlich Puffer — Vorlauf kann kürzer'
      else empfehlung = 'passt'
    }
    return [kind, { faelle: a.faelle, verpasst: a.verpasst, mittlererPufferTage: mittel, empfehlung }]
  }))
}

// ── Auskunft ────────────────────────────────────────────────────────────────

/** Fuer Hermes: das ganze Buch plus die Frage, die gerade offen ist. */
function fuerHermes() {
  const doc = lies(stateStore.read())
  return {
    serverDate: serverDate(),
    maxVorlaufTage: MAX_VORLAUF,
    frageOffen: !!doc.offen,
    hinweis: doc.offen
      ? 'Es steht bereits eine Frage offen — eine zweite wird mit 409 abgelehnt.'
      : 'Lies die Regeln, bevor du einen datierten Vorgang anlegst. Findest du einen klaren Praezedenzfall, setze alsTodoAm selbst und melde ihn ueber /vorlauf/entschieden. Nur wenn nichts passt: fragen.',
    regeln: doc.regeln,
    // Wie es ausging — und was das für den nächsten Vorlauf heisst.
    ergebnisse: doc.ergebnisse.slice(0, 20),
    auswertung: auswertung(doc.ergebnisse),
  }
}

/** Fuer die Oberflaeche: nur die offene Frage. */
function zustand() {
  const doc = lies(stateStore.read())
  return { serverDate: serverDate(), offen: doc.offen, gelernt: doc.regeln.length }
}

module.exports = {
  frage, antworte, verwirf, merkeEntscheidung, fuerHermes, zustand,
  vermerkeErledigt, pruefeVerpasst, auswertung, tageZwischen,
  minusTage, KEY, MAX_VORLAUF,
}
