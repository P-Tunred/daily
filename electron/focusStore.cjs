// Vorgänge — die Dinge, die länger dauern als ein Todo.
//
// WOZU DAS GUT IST
// Ein Todo ist binär: offen oder erledigt. Pauls wirkliche Vorgänge sind es
// nicht. Ein Antrag ist eingereicht und wartet dann wochenlang auf Antwort —
// nichts zu tun, aber auch nicht fertig. Für diesen Zustand gab es in der App
// keinen Platz, also stand er im Wiki, wo er selten reinschaut. Das Inkasso in
// Neuseeland liegt seit September 2025 mit zwölf Mahnungen herum, genau deshalb.
//
// WARUM HÖCHSTENS FÜNF
// Eine Fokusliste mit zwanzig Einträgen ist keine Fokusliste, sondern eine
// zweite Todo-Liste mit mehr Feldern. Die Begrenzung IST die Funktion: beim
// sechsten muss etwas weichen, und diese Entscheidung ist der eigentliche Wert.
// Deshalb steht sie hier im Server und nicht als Bitte in der Oberfläche.
//
// WARUM `letzteBewegung` DAS WICHTIGSTE FELD IST
// Ein Vorgang, der "wartet", sieht an jedem einzelnen Tag harmlos aus — er
// wartet ja. Erst die Dauer macht ihn zum Problem. Ohne dieses Feld gäbe es
// keinen Unterschied zwischen "gestern eingereicht" und "seit fünf Monaten
// nichts gehört", und genau der ist die ganze Information.
//
// WARUM DER NÄCHSTE SCHRITT EIN VERWEIS IST, KEIN TEXT
// Stünde er als Text im Vorgang, gäbe es ihn zweimal: hier und als Todo. Zwei
// Texte, die dasselbe meinen, laufen auseinander — man hakt das Todo ab und der
// Vorgang behauptet weiter, es sei zu tun. `schrittTodoId` verweist deshalb auf
// das echte Todo; die Karte liest den Text von dort. Ein Abhaken wirkt an
// beiden Stellen, weil es nur eine Stelle gibt.
//
// WER WAS DARF
// Anlegen darf nur Paul. Hermes darf Zustände WEITERSCHALTEN, wenn er in einer
// Mail sieht, dass sich etwas bewegt hat — aber keine neuen Vorgänge erfinden.
// Was in den Fokus gehört, ist eine Entscheidung über die eigene Aufmerksamkeit;
// die trifft kein Agent. Neue Vorgänge kann er über den Vorschlags-Dialog
// anregen, dort sagt Paul ja oder nein.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')

const FOCUS_KEY = 'morning.focus'
const ZONE = 'Europe/Berlin'

const MAX_VORGAENGE = 5
const ZUSTAENDE = ['offen', 'eingereicht', 'wartet', 'erledigt', 'verfallen']
// Ab wann ein wartender Vorgang auffällt. Zwei Wochen sind lang genug, dass
// eine normale Bearbeitung durch ist, und kurz genug, dass Nachfassen noch
// etwas bringt.
const STILL_TAGE = 14

const MAX_TITEL = 160
const MAX_WARTET_AUF = 120
const MAX_NOTIZ = 1000
const MAX_QUELLE = 200

function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function fehler(status, message, extra) {
  const e = new Error(message)
  e.status = status
  if (extra) Object.assign(e, extra)
  return e
}

function text(v, max, feld, pflicht = true) {
  if (v === undefined || v === null) {
    if (pflicht) throw fehler(400, `Feld "${feld}" fehlt`)
    return undefined
  }
  if (typeof v !== 'string') throw fehler(400, `Feld "${feld}" ist kein Text`)
  const eine = v.replace(/\s+/g, ' ').trim()
  if (!eine) {
    if (pflicht) throw fehler(400, `Feld "${feld}" ist leer`)
    return undefined
  }
  if (eine.length > max) throw fehler(400, `Feld "${feld}" ist ${eine.length} Zeichen lang, erlaubt sind ${max}`)
  return eine
}

// ── Lesen und Schreiben ─────────────────────────────────────────────────────

function read(state) {
  const roh = state.localStorage[FOCUS_KEY]
  if (typeof roh !== 'string') return { vorgaenge: [] }
  try {
    const v = JSON.parse(roh)
    if (v && typeof v === 'object' && Array.isArray(v.vorgaenge)) {
      return { vorgaenge: v.vorgaenge.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') }
    }
  } catch { /* kaputt → wie leer */ }
  return { vorgaenge: [] }
}

function write(state, doc) {
  state.localStorage[FOCUS_KEY] = JSON.stringify(doc)
}

/** Wie lange liegt ein Vorgang schon still? Kalendertage, keine Stunden —
 *  "seit 14 Tagen" soll auch um 23:50 noch 14 heissen. */
function tageStill(letzteBewegung, heute = serverDate()) {
  if (typeof letzteBewegung !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(letzteBewegung)) return null
  const [ay, am, ad] = letzteBewegung.split('-').map(Number)
  const [hy, hm, hd] = heute.split('-').map(Number)
  return Math.round((Date.UTC(hy, hm - 1, hd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Reichert einen Vorgang für die Anzeige an — abgeleitet, nicht gespeichert.
 *  Gespeicherte Ableitungen veralten still; diese hier wird bei jedem Lesen neu
 *  gerechnet und kann deshalb nicht falsch werden. */
function anreichern(v, heute) {
  const still = tageStill(v.letzteBewegung, heute)
  const wartend = v.zustand === 'wartet' || v.zustand === 'eingereicht'
  return {
    ...v,
    tageStill: still,
    // Nur wartende Vorgänge können "hängen". Ein offener Vorgang, an dem seit
    // 20 Tagen niemand war, ist keine Überraschung — er ist einfach offen.
    haengt: wartend && still !== null && still >= STILL_TAGE,
  }
}

// ── Anlegen ─────────────────────────────────────────────────────────────────

function anlegen(input) {
  const titel = text(input.titel, MAX_TITEL, 'titel')
  const zustand = input.zustand === undefined ? 'offen' : input.zustand
  if (!ZUSTAENDE.includes(zustand)) {
    throw fehler(400, `Feld "zustand" muss einer von ${ZUSTAENDE.join(', ')} sein (bekommen: ${JSON.stringify(input.zustand)})`)
  }

  const state = stateStore.read()
  const doc = read(state)
  const heute = serverDate()

  // Erledigte und verfallene zählen nicht gegen die Fünf — sie stehen nur noch
  // da, bis Paul sie wegräumt. Sonst müsste er aufräumen, um weiterarbeiten zu
  // können, und genau das schiebt man.
  const aktive = doc.vorgaenge.filter((v) => v.zustand !== 'erledigt' && v.zustand !== 'verfallen')
  if (aktive.length >= MAX_VORGAENGE) {
    throw fehler(400,
      `Im Fokus stehen bereits ${aktive.length} Vorgänge, mehr als ${MAX_VORGAENGE} sind nicht vorgesehen. ` +
      'Erst muss einer raus — das ist die Entscheidung, um die es hier geht.',
      { imFokus: aktive.map((v) => ({ id: v.id, titel: v.titel, zustand: v.zustand })) })
  }

  const vorgang = {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : crypto.randomUUID(),
    titel,
    zustand,
    letzteBewegung: heute,
    angelegtAm: heute,
  }
  const wartetAuf = text(input.wartetAuf, MAX_WARTET_AUF, 'wartetAuf', false)
  if (wartetAuf) vorgang.wartetAuf = wartetAuf
  const notiz = text(input.notiz, MAX_NOTIZ, 'notiz', false)
  if (notiz) vorgang.notiz = notiz
  const quelle = text(input.quelle, MAX_QUELLE, 'quelle', false)
  if (quelle) vorgang.quelle = quelle
  if (typeof input.schrittTodoId === 'string' && input.schrittTodoId.trim()) {
    vorgang.schrittTodoId = input.schrittTodoId.trim()
  }

  if (doc.vorgaenge.some((v) => v.id === vorgang.id)) {
    throw fehler(409, `Ein Vorgang mit der id ${vorgang.id} steht bereits im Fokus.`)
  }

  doc.vorgaenge = [...doc.vorgaenge, vorgang]
  write(state, doc)
  stateStore.write(state)
  return anreichern(vorgang, heute)
}

// ── Ändern ──────────────────────────────────────────────────────────────────

/** Weiterschalten. Auch Hermes darf das — er sieht in der Mail, dass das
 *  Studierendenwerk geantwortet hat, und setzt den Zustand.
 *
 *  `letzteBewegung` springt bei JEDER inhaltlichen Änderung auf heute. Das ist
 *  der Punkt: Bewegung ist, was jemand feststellt — nicht, was jemand plant. */
function aendern(id, input, wer = 'paul') {
  const state = stateStore.read()
  const doc = read(state)
  const i = doc.vorgaenge.findIndex((v) => v.id === id)
  if (i < 0) throw fehler(404, `Kein Vorgang mit der id ${id} im Fokus.`)

  const alt = doc.vorgaenge[i]
  const neu = { ...alt }
  let bewegt = false

  if (input.zustand !== undefined) {
    if (!ZUSTAENDE.includes(input.zustand)) {
      throw fehler(400, `Feld "zustand" muss einer von ${ZUSTAENDE.join(', ')} sein.`)
    }
    if (input.zustand !== alt.zustand) { neu.zustand = input.zustand; bewegt = true }
  }
  if (input.titel !== undefined) {
    const t = text(input.titel, MAX_TITEL, 'titel')
    if (t !== alt.titel) { neu.titel = t; bewegt = true }
  }
  if (input.wartetAuf !== undefined) {
    // null löscht das Feld — sonst liesse sich ein "wartet auf X" nie mehr
    // entfernen, wenn X geantwortet hat.
    if (input.wartetAuf === null) { delete neu.wartetAuf; bewegt = true }
    else { neu.wartetAuf = text(input.wartetAuf, MAX_WARTET_AUF, 'wartetAuf'); bewegt = true }
  }
  if (input.notiz !== undefined) {
    if (input.notiz === null) delete neu.notiz
    else neu.notiz = text(input.notiz, MAX_NOTIZ, 'notiz')
  }
  if (input.schrittTodoId !== undefined) {
    if (input.schrittTodoId === null) delete neu.schrittTodoId
    else neu.schrittTodoId = String(input.schrittTodoId).trim()
  }

  // Ausdrücklich mitgegeben schlägt abgeleitet — ein Hermes-Lauf, der eine
  // Mail von vorgestern auswertet, soll das Datum von vorgestern setzen können.
  if (typeof input.letzteBewegung === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.letzteBewegung)) {
    neu.letzteBewegung = input.letzteBewegung
  } else if (bewegt) {
    neu.letzteBewegung = serverDate()
  }

  if (input.begruendung !== undefined || wer !== 'paul') {
    // Nachvollziehbar halten, wer geschoben hat. Ohne das steht irgendwann ein
    // Zustand da, den niemand erklären kann — und man traut der Karte nicht mehr.
    neu.zuletztVon = wer
    const g = text(input.begruendung, 300, 'begruendung', false)
    if (g) neu.zuletztWarum = g
  }

  doc.vorgaenge = doc.vorgaenge.map((v, k) => (k === i ? neu : v))
  write(state, doc)
  stateStore.write(state)
  return anreichern(neu, serverDate())
}

function entfernen(id) {
  const state = stateStore.read()
  const doc = read(state)
  const weg = doc.vorgaenge.find((v) => v.id === id)
  if (!weg) throw fehler(404, `Kein Vorgang mit der id ${id} im Fokus.`)
  doc.vorgaenge = doc.vorgaenge.filter((v) => v.id !== id)
  write(state, doc)
  stateStore.write(state)
  return weg
}

/** Ein Kind-Todo wurde abgehakt → der zugehörige Vorgang hat sich bewegt.
 *  Gibt die berührten Vorgänge zurück (meist genau einer, oft keiner). */
function bewegungDurchTodo(todoId) {
  const state = stateStore.read()
  const doc = read(state)
  const heute = serverDate()
  let getroffen = []
  doc.vorgaenge = doc.vorgaenge.map((v) => {
    if (v.schrittTodoId !== todoId) return v
    // Der Verweis wird gelöst: das Todo ist erledigt, es gibt keinen offenen
    // nächsten Schritt mehr. Stünde die id weiter drin, zeigte die Karte
    // dauerhaft einen abgehakten Schritt an.
    const neu = { ...v, letzteBewegung: heute }
    delete neu.schrittTodoId
    getroffen.push(neu)
    return neu
  })
  if (!getroffen.length) return []
  write(state, doc)
  stateStore.write(state)
  return getroffen
}

// ── Für die Oberfläche und für Hermes ───────────────────────────────────────

function zustand() {
  const heute = serverDate()
  const doc = read(stateStore.read())
  const vorgaenge = doc.vorgaenge.map((v) => anreichern(v, heute))
  const aktive = vorgaenge.filter((v) => v.zustand !== 'erledigt' && v.zustand !== 'verfallen')
  return {
    serverDate: heute,
    vorgaenge,
    aktive: aktive.length,
    platzFrei: Math.max(0, MAX_VORGAENGE - aktive.length),
    haengend: vorgaenge.filter((v) => v.haengt).length,
    max: MAX_VORGAENGE,
    stillTage: STILL_TAGE,
  }
}

module.exports = {
  FOCUS_KEY, MAX_VORGAENGE, STILL_TAGE, ZUSTAENDE,
  read, anlegen, aendern, entfernen, bewegungDurchTodo, zustand, serverDate, tageStill,
}
