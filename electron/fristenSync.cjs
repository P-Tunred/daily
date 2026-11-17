// Fristen aus dem Second Brain → Termine mit Stichtag in Daily.
//
// WOZU
// `wiki/themen/pruefungen-und-fristen.md` ist die beste Fristenliste, die Paul
// hat — gepflegt von Hermes aus Mails, Kursseiten und Gesprächen. Daily kannte
// sie bisher nur als Hintergrund für die Mail-Sortierung. Eine Frist, die dort
// steht, kam nie als Aufgabe bei Paul an. (Wunsch vom 2026-10-27.)
//
// WARUM HERMES LIEST UND DAILY ABGLEICHT
// Die Seite ist Fliesstext mit Vorbehalten („Teilnahme nicht belegt",
// „Uhrzeit offen"). Was davon eine echte Frist ist, kann nur jemand
// entscheiden, der den Text versteht — Hermes. Was danach passiert, muss
// dagegen verlässlich sein: keine Dubletten, nichts zurückholen, was Paul
// weggeklickt hat, nichts löschen, woraus schon eine Aufgabe wurde. Das ist
// gewöhnlicher Code und steht hier.
//
// DER VERTRAG: VOLLSTÄNDIGE LISTE, FESTE KENNUNG
// Hermes schickt bei jedem Lauf ALLE aktuellen Fristen der Seite, jede mit
// einer Kennung, die aus der Seite kommt (`brain:fristen#…`) und sich nicht
// ändert, wenn er den Titel anders formuliert. Daily gleicht ab:
//   neu        → Termin anlegen
//   geändert   → Termin anpassen (Stichtag nur, solange noch keine Aufgabe da ist)
//   fehlt jetzt → zurückziehen — ausser die Aufgabe existiert schon oder die
//                Frist ist vorbei; was Paul in der Hand hat, bleibt.
// Ein zweiter Lauf am selben Tag ändert nichts. Das ist der ganze Grund für
// den vollständigen Abgleich statt „füge hinzu": ein Agent, der jeden Morgen
// anlegt, legt jeden Morgen doppelt an.
//
// DER STICHTAG (`alsTodoAm`)
// Wann aus der Frist eine Aufgabe wird, entscheidet Hermes mit dem
// Vorlauf-Buch (vorlaufStore.cjs) — dort stehen Pauls frühere Entscheidungen
// und seit 2026-10-27 auch, wie es ausging. Fehlt der Stichtag, bleibt die
// Frist sichtbar im Horizont, wird aber nie zur Aufgabe; der Bericht sagt das.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')
const dayStart = require('./dayStart.cjs')
const vorlauf = require('./vorlaufStore.cjs')

const EVENT_KEY = 'morning.important.events'
const TODO_KEY = 'morning.todos'
const MARKER_KEY = 'morning.fristenSync'
const ZONE = 'Europe/Berlin'
const MAX_FRISTEN = 200
const MAX_ANGELEGT = 500
const KENNUNG = /^brain:[\w./#:-]{3,120}$/
const ISO = /^\d{4}-\d{2}-\d{2}$/
const ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })

function fehler(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {})
}

function gueltigesDatum(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function liste(state, key) {
  try { const v = JSON.parse(state.localStorage[key]); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Eine Frist aus der Anfrage prüfen. Gibt { frist } oder { grund } zurück —
 *  eine kaputte Zeile kippt nicht den ganzen Abgleich, steht aber im Bericht. */
function pruefe(f, tag) {
  if (!f || typeof f !== 'object') return { grund: 'kein Objekt' }
  if (typeof f.id !== 'string' || !KENNUNG.test(f.id)) return { grund: 'id muss mit "brain:" beginnen (3–120 Zeichen, ohne Leerzeichen)' }
  const title = String(f.title ?? '').replace(/\s+/g, ' ').trim()
  if (!title) return { grund: 'title fehlt' }
  if (!gueltigesDatum(f.date)) return { grund: `date ungültig (${JSON.stringify(f.date)})` }
  const frist = {
    id: f.id,
    title: title.slice(0, 200),
    date: f.date,
    kind: f.kind === 'exam' ? 'exam' : 'deadline',
  }
  if (f.alsTodoAm !== undefined && f.alsTodoAm !== null && f.alsTodoAm !== '') {
    if (!gueltigesDatum(f.alsTodoAm)) return { grund: `alsTodoAm ungültig (${JSON.stringify(f.alsTodoAm)})` }
    if (f.alsTodoAm > f.date) return { grund: 'alsTodoAm liegt nach der Frist' }
    if (vorlauf.tageZwischen(f.alsTodoAm, f.date) > vorlauf.MAX_VORLAUF) return { grund: `Vorlauf über ${vorlauf.MAX_VORLAUF} Tage` }
    // Ein Stichtag in der Vergangenheit heisst: die Aufgabe ist jetzt fällig.
    frist.alsTodoAm = f.alsTodoAm < tag ? tag : f.alsTodoAm
  }
  if (typeof f.note === 'string' && f.note.trim()) frist.note = f.note.replace(/\s+/g, ' ').trim().slice(0, 500)
  if (ZEIT.test(f.startZeit ?? '') && ZEIT.test(f.endZeit ?? '') && f.endZeit > f.startZeit) {
    frist.startZeit = f.startZeit
    frist.endZeit = f.endZeit
  }
  return { frist }
}

const FELDER = ['title', 'date', 'kind', 'note', 'startZeit', 'endZeit']

// Wörter ab zwei Zeichen, klein, ohne Satzzeichen und Emoji.
function woerter(t) {
  return new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))
}

/** Steht dieselbe Sache schon in Daily — meist aus dem Kalender?
 *
 *  WARUM
 *  Der erste echte Lauf (2026-10-27) legte „FODS Written Exam 1 / Coding"
 *  neben „FODS Exam 1 (ML750N)" aus dem Kalender: zwei Karten, ein Termin.
 *  Gleicher Tag und mindestens zwei gemeinsame Wörter gilt als dieselbe
 *  Sache. Dann wird nicht doppelt angelegt, sondern der vorhandene Eintrag
 *  übernommen: Titel und Uhrzeit bleiben, wie sie sind (der Kalender kennt
 *  sie genauer), das Brain steuert nur den Stichtag für die Aufgabe bei. */
function zwilling(events, f, vergeben) {
  const w = woerter(f.title)
  return events.find((e) => e && !e.quelleId && !e.dismissed && e.date === f.date && !vergeben.has(e.id) &&
    [...woerter(e.title)].filter((x) => w.has(x)).length >= 2) || null
}

const OHNE_BRAIN = ['quelleId', 'quelle', 'adoptiert']

/**
 * Den Stand der Fristenseite übernehmen. Gibt einen Bericht zurück, der jede
 * Entscheidung zählt — Hermes soll Paul sagen können, was passiert ist.
 */
function gleiche(input = {}) {
  const tag = heute()
  const quelle = typeof input.quelle === 'string' && input.quelle.trim() ? input.quelle.trim().slice(0, 200) : null
  if (!quelle) throw fehler(400, 'Feld "quelle" fehlt (z. B. "wiki/themen/pruefungen-und-fristen.md").')
  if (!Array.isArray(input.fristen)) throw fehler(400, 'Feld "fristen" muss eine Liste sein — die VOLLSTÄNDIGE aktuelle Liste der Seite.')
  if (input.fristen.length > MAX_FRISTEN) throw fehler(400, `Höchstens ${MAX_FRISTEN} Fristen pro Abgleich.`)
  const ids = input.fristen.map((f) => f && f.id)
  const doppelt = ids.filter((id, i) => id && ids.indexOf(id) !== i)
  if (doppelt.length) throw fehler(400, `Doppelte Kennungen: ${[...new Set(doppelt)].join(', ')}`)

  const bericht = { neu: [], geaendert: [], unveraendert: 0, zurueckgezogen: [], zusammengelegt: [], weggeklickt: 0, geloescht: 0, uebersprungen: [], ohneStichtag: [], aufgabeSofort: [] }
  const gueltig = []
  for (const f of input.fristen) {
    const r = pruefe(f, tag)
    if (r.grund) bericht.uebersprungen.push({ id: f && f.id, grund: r.grund })
    else gueltig.push(r.frist)
  }

  const state = stateStore.read()
  // Was dieser Abgleich je angelegt hat. Fehlt so eine Frist jetzt in Daily,
  // hat Paul sie gelöscht (Horizont-Karte löscht wirklich, statt nur
  // auszublenden) — dann darf der nächste Lauf sie nicht wiederbeleben.
  let alterMarker = null
  try { alterMarker = JSON.parse(state.localStorage[MARKER_KEY]) } catch { /* noch nie */ }
  const angelegt = new Set(Array.isArray(alterMarker?.angelegt) ? alterMarker.angelegt : [])
  const ls = liste(state, EVENT_KEY)
  const idb = Array.isArray(state.indexedDB.importantEvents) ? state.indexedDB.importantEvents : []

  // Eine Änderung an beiden Ablagen, in EINEM Schreibvorgang (siehe dayStart.cjs).
  const aendern = new Map()   // event-id → neues Objekt
  const entfernen = new Set() // event-ids
  const anlegen = []

  const bestehend = ls.filter((e) => e && e.quelleId)
  const vergeben = new Set()   // schon übernommene Zwillinge — jeder nur einmal
  const umhaengen = new Map()  // alte Event-id → neue, für Aufgaben mit ausTermin
  for (const f of gueltig) {
    const alt = bestehend.find((e) => e.quelleId === f.id)
    if (!alt && angelegt.has(f.id)) { bericht.geloescht++; continue }
    if (!alt && f.date < tag) { bericht.uebersprungen.push({ id: f.id, grund: 'Frist liegt schon in der Vergangenheit' }); continue }
    // Gibt es dieselbe Sache schon ohne Brain-Kennung, wird sie übernommen.
    // Auch nachträglich: eine schon angelegte Doppelung wird zusammengelegt,
    // eine daran hängende Aufgabe zieht mit um.
    const twin = (!alt || (!alt.adoptiert && !alt.dismissed)) ? zwilling(ls, f, vergeben) : null
    if (twin) {
      vergeben.add(twin.id)
      const neu = { ...twin, quelleId: f.id, quelle, adoptiert: true }
      const todoTag = alt?.todoErzeugt || twin.todoErzeugt
      if (todoTag) {
        neu.todoErzeugt = todoTag
        if (alt?.alsTodoAm) neu.alsTodoAm = alt.alsTodoAm
      } else if (f.alsTodoAm) neu.alsTodoAm = f.alsTodoAm
      aendern.set(twin.id, neu)
      if (alt) {
        entfernen.add(alt.id)
        if (alt.todoErzeugt) umhaengen.set(alt.id, twin.id)
      }
      angelegt.add(f.id)
      bericht.zusammengelegt.push(f.id)
      continue
    }
    if (!alt) {
      const ev = { ...f, id: crypto.randomUUID(), quelleId: f.id, quelle }
      anlegen.push(ev)
      angelegt.add(f.id)
      bericht.neu.push(f.id)
      continue
    }
    // Weggeklickt heisst: Paul will sie nicht sehen. Nicht zurückholen.
    if (alt.dismissed) { bericht.weggeklickt++; continue }
    const neu = { ...alt }
    // Übernommene Einträge gehören inhaltlich dem Kalender — nur der Stichtag
    // kommt vom Brain.
    for (const k of alt.adoptiert ? [] : FELDER) { if (f[k] === undefined) delete neu[k]; else neu[k] = f[k] }
    // Den Stichtag nur ändern, solange daraus noch keine Aufgabe wurde — sonst
    // läge die Aufgabe am alten Tag und der Termin behauptete einen neuen.
    if (!alt.todoErzeugt) { if (f.alsTodoAm) neu.alsTodoAm = f.alsTodoAm; else delete neu.alsTodoAm }
    const vorher = JSON.stringify([...FELDER, 'alsTodoAm'].map((k) => alt[k]))
    const nachher = JSON.stringify([...FELDER, 'alsTodoAm'].map((k) => neu[k]))
    if (vorher === nachher) { bericht.unveraendert++; continue }
    aendern.set(alt.id, neu)
    bericht.geaendert.push(f.id)
  }
  // Was die Seite nicht mehr nennt: zurückziehen — aber nur, was Paul noch
  // nicht in der Hand hat. Und nur, wenn Hermes ausdrücklich sagt, dass die
  // Liste vollständig ist, und sie nicht leer ist: eine versehentlich halbe
  // Liste würde sonst echte Fristen wegräumen, still und ohne Fehler.
  const genannt = new Set(gueltig.map((f) => f.id))
  const darfZurueckziehen = input.vollstaendig === true && gueltig.length > 0
  if (!darfZurueckziehen) bericht.hinweis = 'Nichts zurückgezogen: dafür "vollstaendig": true und eine nicht leere Liste schicken.'
  for (const e of darfZurueckziehen ? bestehend : []) {
    if (e.quelle !== quelle || genannt.has(e.quelleId)) continue
    if (bericht.uebersprungen.some((u) => u.id === e.quelleId)) continue // nur kaputt geschickt, nicht gestrichen
    if (e.todoErzeugt || e.date < tag || e.dismissed) continue
    if (e.adoptiert) {
      // Der Eintrag war vorher schon da — nur die Brain-Spur entfernen.
      const zurueck = { ...e }
      for (const k of [...OHNE_BRAIN, 'alsTodoAm']) delete zurueck[k]
      aendern.set(e.id, zurueck)
    } else entfernen.add(e.id)
    // Selbst zurückgezogen, nicht von Paul gelöscht: taucht sie im Brain
    // wieder auf, darf sie wiederkommen.
    angelegt.delete(e.quelleId)
    bericht.zurueckgezogen.push(e.quelleId)
  }

  const neueListe = (l) => [
    ...l.filter((e) => !(e && entfernen.has(e.id))).map((e) => (e && aendern.has(e.id) ? aendern.get(e.id) : e)),
    ...anlegen,
  ]
  let events = neueListe(ls)
  let eventsIdb = neueListe(idb)

  // Ist der Stichtag schon da (heute oder vorbei), entsteht die Aufgabe JETZT —
  // der Tagesbeginn ist heute womöglich schon gelaufen und käme erst morgen.
  const todos = liste(state, TODO_KEY)
  const todosIdb = Array.isArray(state.indexedDB.todos) ? state.indexedDB.todos : []
  const neueTodos = []
  const markiert = new Set()
  for (const e of events) {
    if (!e || !e.quelleId || e.dismissed || e.todoErzeugt || !e.alsTodoAm || e.alsTodoAm > tag || e.date < tag) continue
    neueTodos.push(dayStart.alsTodo(e, tag))
    markiert.add(e.id)
    bericht.aufgabeSofort.push(e.quelleId)
  }
  const markiere = (e) => (e && markiert.has(e.id) ? { ...e, todoErzeugt: tag } : e)
  events = events.map(markiere)
  eventsIdb = eventsIdb.map(markiere)

  for (const e of events) {
    if (e && e.quelle === quelle && !e.dismissed && !e.alsTodoAm && !e.todoErzeugt && e.date >= tag) bericht.ohneStichtag.push(e.quelleId)
  }

  state.localStorage[EVENT_KEY] = JSON.stringify(events)
  state.indexedDB.importantEvents = eventsIdb
  if (neueTodos.length || umhaengen.size) {
    // Aufgaben einer zusammengelegten Doppelung zeigen auf den bleibenden
    // Eintrag — sonst verlöre das Vorlaufbuch beim Abhaken die Frist.
    const haenge = (t) => (t && umhaengen.has(t.ausTermin) ? { ...t, ausTermin: umhaengen.get(t.ausTermin) } : t)
    state.localStorage[TODO_KEY] = JSON.stringify([...todos.map(haenge), ...neueTodos])
    state.indexedDB.todos = [...todosIdb.map(haenge), ...neueTodos]
  }
  const marker = {
    quelle, stand: typeof input.stand === 'string' ? input.stand.slice(0, 40) : null, um: new Date().toISOString(),
    fristen: gueltig.length, neu: bericht.neu.length, geaendert: bericht.geaendert.length,
    zurueckgezogen: bericht.zurueckgezogen.length, zusammengelegt: bericht.zusammengelegt.length,
    uebersprungen: bericht.uebersprungen.length,
    angelegt: [...angelegt].slice(-MAX_ANGELEGT),
  }
  state.localStorage[MARKER_KEY] = JSON.stringify(marker)
  stateStore.write(state)

  console.log(`[fristen] ${quelle}: ${gueltig.length} Fristen — ${bericht.neu.length} neu, ${bericht.geaendert.length} geändert, ` +
    `${bericht.zurueckgezogen.length} zurückgezogen, ${bericht.zusammengelegt.length} zusammengelegt, ${bericht.uebersprungen.length} übersprungen, ${bericht.aufgabeSofort.length} Aufgabe sofort`)
  return { ok: true, serverDate: tag, ...bericht }
}

/** Was Daily aus dem Brain übernommen hat — und wann zuletzt abgeglichen wurde. */
function zustand() {
  const state = stateStore.read()
  let marker = null
  try { marker = JSON.parse(state.localStorage[MARKER_KEY]) } catch { /* noch nie */ }
  const fristen = liste(state, EVENT_KEY).filter((e) => e && e.quelleId)
    .map(({ quelleId, title, date, kind, alsTodoAm, todoErzeugt, dismissed }) => ({ id: quelleId, title, date, kind, alsTodoAm, todoErzeugt, dismissed }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { serverDate: heute(), letzterAbgleich: marker, fristen }
}

module.exports = { gleiche, zustand, pruefe, MARKER_KEY }
