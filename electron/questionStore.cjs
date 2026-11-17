// Die eine Frage, die das Dashboard Paul gelegentlich stellt.
//
// WOZU DAS GUT IST
// Das Second Brain führt seine Lücken selbst: jede Wiki-Seite hat laut der
// CLAUDE.md des Vaults einen Abschnitt `## Offene Fragen`, Widersprüche sind
// mit `> ⚠️ Widerspruch:` markiert. Bisher las die niemand — sie standen da und
// blieben stehen. Hier holt Hermes eine davon nach vorn, Paul antwortet
// nebenbei, und die Antwort geht zurück ins Brain.
//
// WARUM HÖCHSTENS EINE
// Ein Formular mit zehn Fragen beantwortet niemand; es wird zur Aufgabe, und
// Aufgaben schiebt man. Eine einzelne Frage im Vorbeigehen beantwortet man.
// Deshalb ist die Begrenzung serverseitig und nicht dem guten Willen des
// Agenten überlassen: ein zweiter Versuch bekommt 409, solange die erste weder
// beantwortet noch verworfen ist.
//
// WARUM RUHEZEITEN PRO FRAGE GESPEICHERT WERDEN
// Ohne Gedächtnis fragt ein Agent morgen dasselbe nochmal. Nach dreimal
// "Später" klickt Paul jede Frage reflexhaft weg — auch die eine, die zählt.
// Zurückgestellt heisst deshalb: frühestens in 7 Tagen. Verworfen heisst: nie
// wieder. Beides pro `id`, damit es einen Neustart und einen neuen Agenten-Lauf
// übersteht.
//
// WARUM DIE HERKUNFT PFLICHT IST
// "Aus deinen offenen Fragen" und "Hermes ist das aufgefallen" sind zwei sehr
// verschiedene Dinge. Das erste hat Paul selbst markiert, das zweite hat sich
// ein Agent ausgedacht. Wie ernst er das nimmt, ist seine Entscheidung — dafür
// muss er es aber sehen können. Eine Frage ohne saubere Herkunft wird deshalb
// abgelehnt, nicht stillschweigend als "hermes" verbucht.
//
// DAILY SCHREIBT NIE INS BRAIN
// Hier landet nur die Antwort. Ins Wiki trägt sie ausschliesslich Hermes ein,
// nach den Regeln der CLAUDE.md. Eine Datei, ein Schreiber — sonst überschreiben
// sich zwei Prozesse gegenseitig, und der Vault ist das Original.

const stateStore = require('./stateStore.cjs')

const QUESTION_KEY = 'morning.brainQuestion'
const ZONE = 'Europe/Berlin'

const QUELLEN = ['brain', 'hermes']
const RUHE_TAGE = 7
const MAX_FRAGE = 280
const MAX_WARUM = 400
const MAX_ANTWORT = 4000
// Mehr als das braucht niemand, und eine unbegrenzt wachsende Liste im Zustand
// wäre ein stiller Speicherfresser. Die ältesten Einträge fallen hinten raus;
// eine vor Jahren verworfene Frage darf ruhig wiederkommen.
const MAX_VERLAUF = 200

function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function fehler(status, message, extra) {
  const e = new Error(message)
  e.status = status
  if (extra) Object.assign(e, extra)
  return e
}

function text(v, max, feld) {
  if (typeof v !== 'string') throw fehler(400, `Feld "${feld}" fehlt oder ist kein Text`)
  const eine = v.replace(/\s+/g, ' ').trim()
  if (!eine) throw fehler(400, `Feld "${feld}" ist leer`)
  if (eine.length > max) throw fehler(400, `Feld "${feld}" ist ${eine.length} Zeichen lang, erlaubt sind ${max}`)
  return eine
}

// ── Lesen ───────────────────────────────────────────────────────────────────

/** Der abgelegte Zustand: die offene Frage plus das Gedächtnis darüber, was
 *  schon durch war. Kaputtes JSON wird wie "noch nichts" behandelt — der
 *  Zustand selbst ist ja lesbar, sonst hätte stateStore schon abgebrochen. */
function read(state) {
  const roh = state.localStorage[QUESTION_KEY]
  if (typeof roh !== 'string') return { offen: null, verlauf: {} }
  try {
    const v = JSON.parse(roh)
    if (v && typeof v === 'object') {
      const doc = {
        offen: v.offen && typeof v.offen === 'object' ? v.offen : null,
        verlauf: v.verlauf && typeof v.verlauf === 'object' ? v.verlauf : {},
      }
      // Die wartende Antwort MUSS mitgelesen werden. Fehlte sie hier, ginge
      // sie bei jedem Lesen still verloren: geschrieben wird immer das
      // Ergebnis von read(), also hätte der nächste Schreibvorgang sie
      // gelöscht — und Paul hätte umsonst geantwortet.
      if (v.antwort && typeof v.antwort === 'object') doc.antwort = v.antwort
      return doc
    }
  } catch { /* kaputt → wie leer */ }
  return { offen: null, verlauf: {} }
}

function write(state, doc) {
  // Verlauf beschneiden, bevor er gespeichert wird: neueste zuerst behalten.
  const eintraege = Object.entries(doc.verlauf)
  if (eintraege.length > MAX_VERLAUF) {
    eintraege.sort((a, b) => String(b[1].stand ?? '').localeCompare(String(a[1].stand ?? '')))
    doc.verlauf = Object.fromEntries(eintraege.slice(0, MAX_VERLAUF))
  }
  state.localStorage[QUESTION_KEY] = JSON.stringify(doc)
}

/** Darf diese id gerade gestellt werden?
 *  Gibt null zurück, wenn ja — sonst den Grund, damit die Ablehnung erklärbar
 *  ist statt nur "nein". */
function gesperrt(verlauf, id, heute) {
  const e = verlauf[id]
  if (!e) return null
  if (e.status === 'verworfen') return { grund: 'verworfen', seit: e.stand }
  if (e.status === 'beantwortet') return { grund: 'beantwortet', seit: e.stand }
  if (e.status === 'zurueckgestellt') {
    if (typeof e.frueheste === 'string' && heute < e.frueheste) {
      return { grund: 'zurueckgestellt', frueheste: e.frueheste }
    }
    return null // Ruhezeit vorbei
  }
  return null
}

// ── Stellen ─────────────────────────────────────────────────────────────────

function stelle(input) {
  const id = text(input.id, 120, 'id')
  const frage = text(input.frage, MAX_FRAGE, 'frage')
  const warum = text(input.warum, MAX_WARUM, 'warum')

  // Die Herkunft ist Pflicht und wird NICHT geraten. Ohne sie kann Paul nicht
  // unterscheiden, ob er die Frage selbst markiert hat oder ein Agent sie sich
  // ausgedacht hat — und genau diese Einordnung gehört ihm.
  if (!QUELLEN.includes(input.quelle)) {
    throw fehler(400, `Feld "quelle" muss "brain" oder "hermes" sein (bekommen: ${JSON.stringify(input.quelle)})`)
  }
  const quelle = input.quelle

  // Bei "brain" ist `seite` die Ursprungsseite, bei "hermes" der Vorschlag,
  // wohin die Antwort gehört. In beiden Fällen muss klar sein, wo sie landet —
  // eine Antwort ohne Ziel ist eine Notiz, die niemand wiederfindet.
  const seite = text(input.seite, 200, 'seite')

  const state = stateStore.read()
  const doc = read(state)
  const heute = serverDate()

  const sperre = gesperrt(doc.verlauf, id, heute)
  if (sperre) {
    throw fehler(409, sperreText(id, sperre), { gesperrt: sperre })
  }

  if (doc.offen) {
    throw fehler(409,
      `Es steht bereits eine offene Frage: "${doc.offen.frage}" (id ${doc.offen.id}). ` +
      'Vorgesehen ist genau eine — erst wenn sie beantwortet oder verworfen ist, geht die nächste durch.',
      { steht: { id: doc.offen.id, frage: doc.offen.frage, quelle: doc.offen.quelle } })
  }

  doc.offen = { id, frage, warum, quelle, seite, gestelltAm: heute, gestelltUm: new Date().toISOString() }
  write(state, doc)
  stateStore.write(state)
  return doc.offen
}

function sperreText(id, s) {
  if (s.grund === 'verworfen') return `Die Frage ${id} wurde verworfen ("ist egal") und wird nicht erneut gestellt.`
  if (s.grund === 'beantwortet') return `Die Frage ${id} wurde am ${s.seit} bereits beantwortet.`
  return `Die Frage ${id} wurde zurückgestellt und ist erst ab ${s.frueheste} wieder zulässig.`
}

// ── Pauls Reaktion ──────────────────────────────────────────────────────────

/** `aktion` ist eine von: antworten | spaeter | egal.
 *  Alle drei sind gleichwertig — "Später" darf nicht schwerer sein als
 *  "Antworten", sonst wird die Frage zur Last und irgendwann klickt man alles
 *  weg, was erscheint. */
function reagiere(aktion, antwortText) {
  const state = stateStore.read()
  const doc = read(state)
  if (!doc.offen) throw fehler(404, 'Es steht gerade keine offene Frage.')

  const heute = serverDate()
  const id = doc.offen.id
  const jetzt = new Date().toISOString()

  if (aktion === 'antworten') {
    const antwort = text(antwortText, MAX_ANTWORT, 'antwort')
    // Die Antwort bleibt stehen, bis Hermes sie abgeholt UND ins Brain
    // geschrieben hat. Würde sie hier schon verschwinden, ginge sie verloren,
    // falls der nächste Hermes-Lauf ausfällt.
    doc.antwort = { ...doc.offen, antwort, beantwortetAm: heute, beantwortetUm: jetzt }
    doc.verlauf[id] = { status: 'beantwortet', stand: heute }
    doc.offen = null
  } else if (aktion === 'spaeter') {
    const frueheste = new Date(Date.now() + RUHE_TAGE * 86_400_000)
      .toLocaleDateString('sv-SE', { timeZone: ZONE })
    doc.verlauf[id] = { status: 'zurueckgestellt', stand: heute, frueheste }
    doc.offen = null
  } else if (aktion === 'egal') {
    doc.verlauf[id] = { status: 'verworfen', stand: heute }
    doc.offen = null
  } else {
    throw fehler(400, `Unbekannte Aktion "${aktion}" — erlaubt sind antworten, spaeter, egal.`)
  }

  write(state, doc)
  stateStore.write(state)
  return { id, aktion, verlauf: doc.verlauf[id] }
}

/** Hermes holt die Antwort ab und meldet danach, dass sie im Brain steht.
 *  Erst dann wird sie hier gelöscht — und die nächste Frage kann kommen. */
function quittiereAntwort(id) {
  const state = stateStore.read()
  const doc = read(state)
  if (!doc.antwort) throw fehler(404, 'Es liegt keine abzuholende Antwort vor.')
  if (doc.antwort.id !== id) {
    throw fehler(409, `Die vorliegende Antwort gehört zu ${doc.antwort.id}, nicht zu ${id}.`)
  }
  const weg = doc.antwort
  delete doc.antwort
  write(state, doc)
  stateStore.write(state)
  return weg
}

/** Eine Antwort zurücknehmen, solange Hermes sie nicht abgeholt hat — die
 *  Frage steht danach wieder offen, als wäre nie geantwortet worden.
 *  Gebraucht, seit man auch per Stimme antworten kann (hermesStimme.cjs):
 *  ein falsch verstandener Satz darf nicht als Antwort im Brain landen. */
function nimmAntwortZurueck(id) {
  const state = stateStore.read()
  const doc = read(state)
  if (!doc.antwort || doc.antwort.id !== id) {
    throw fehler(404, 'Diese Antwort liegt nicht mehr vor — Hermes hat sie vermutlich schon abgeholt.')
  }
  if (doc.offen) throw fehler(409, 'Es steht schon eine neue Frage offen.')
  const { antwort: _a, beantwortetAm: _am, beantwortetUm: _um, ...frage } = doc.antwort
  const { [id]: _v, ...verlauf } = doc.verlauf
  write(state, { offen: frage, verlauf })
  stateStore.write(state)
  return frage
}

// ── Für die Oberfläche und für Hermes ───────────────────────────────────────

function zustand() {
  const doc = read(stateStore.read())
  return {
    serverDate: serverDate(),
    offen: doc.offen ?? null,
    antwort: doc.antwort ?? null,
    // Nur die Zahl, nicht der ganze Verlauf: das Frontend braucht ihn nicht,
    // und ein Zustand, der ungefragt Fragen-Historie ausliefert, ist unnötig
    // gesprächig.
    verlaufEintraege: Object.keys(doc.verlauf).length,
  }
}

module.exports = {
  QUESTION_KEY, RUHE_TAGE, QUELLEN,
  read, stelle, reagiere, quittiereAntwort, nimmAntwortZurueck, zustand, serverDate,
  // brainPages.openQuestions braucht dieselbe Sperrregel — nicht eine zweite
  // Fassung davon, die mit der Zeit anders entscheidet.
  gesperrt,
}
