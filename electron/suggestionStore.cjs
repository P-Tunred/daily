// Die Vorschläge im Morgendialog — "Termin eintragen? Todo anlegen?"
//
// WOZU DAS GUT IST
// Hermes sieht Mails und Kalender und merkt, wenn daraus etwas folgen müsste.
// Bisher landete das bestenfalls als Satz im Briefing-Text, den man liest und
// dann doch nicht umsetzt. Hier wird daraus ein Ja/Nein im Vorbeigehen.
//
// WARUM HÖCHSTENS DREI, UND WARUM SERVERSEITIG
// Drei Entscheidungen trifft man im Stehen. Bei sieben fängt man an zu lesen,
// bei zehn klickt man alles weg. Die Grenze ist deshalb nicht Höflichkeit,
// sondern Vertrag: der vierte Vorschlag bekommt 400, mit Angabe wie viele
// schon angekommen sind. Ein Agent, der es gut meint, soll nicht mehr
// unterbringen können als vorgesehen.
//
// WARUM DIE KENNUNG AUS DER QUELLE KOMMEN MUSS — DER KERN DES GANZEN
// Formuliert Hermes denselben Vorschlag morgen anders ("Rechnung zahlen" statt
// "Rechnung begleichen") und die Kennung hinge am Wortlaut, wäre sie neu. Der
// abgelehnte Vorschlag käme jeden Morgen wieder, und nach einer Woche klickt
// Paul den ganzen Dialog reflexhaft weg — auch die Frist darin.
// Deshalb: die Kennung MUSS aus der Quelle abgeleitet sein (mail:, cal:,
// brain:). Alles andere wird mit 400 abgelehnt statt stillschweigend
// durchgelassen. Eine Kennung, die man nicht wiedererkennt, ist keine.
//
// WARUM ENTSCHIEDENES BEIM ANLEGEN VERWORFEN WIRD, NICHT BEIM ANZEIGEN
// Würde erst die Oberfläche filtern, zählte ein längst abgelehnter Vorschlag
// gegen das Dreierkontingent — und verdrängte einen, der noch etwas bewirkt
// hätte. Er wird deshalb schon hier verworfen: nicht angezeigt, nicht gezählt.
//
// WARUM DER SERVER BEI JA SELBST ANLEGT
// Sonst bräuchte der Browser das HERMES_TOKEN, um /api/hermes/todos zu rufen —
// und damit läge ein Token mit Schreibrechten im ausgelieferten JavaScript.
// Der Server hat die Logik ohnehin; er bekommt sie hier hereingereicht
// (siehe `anleger` in entscheide), statt sie zu importieren. Das vermeidet den
// Ringschluss hermesApi → suggestionStore → hermesApi.

const stateStore = require('./stateStore.cjs')
// Steht das schon irgendwo? — siehe dedupCheck.cjs fuer das Warum.
const dedupCheck = require('./dedupCheck.cjs')

const SUGGESTION_KEY = 'morning.suggestions'
const ZONE = 'Europe/Berlin'

const MAX_PRO_TAG = 3
const ARTEN = ['todo', 'termin']
/** Erlaubte Kennungs-Präfixe. Jedes zeigt auf etwas, das morgen noch genauso
 *  heisst — anders als ein Titel, den ein Modell jeden Tag neu formuliert. */
const PRAEFIXE = ['mail:', 'cal:', 'brain:']
/** Schreibweisen, die dasselbe meinen. Hermes hat am 1.9. einen Vorschlag mit
 *  `event:<UID>` geschickt und ihn zweimal abgelehnt bekommen — obwohl die UID
 *  aus dem Kalender stammte und damit genau das erfuellte, wofuer die Regel da
 *  ist. Sein Auftrag meldete trotzdem "ok", der Vorschlag war weg.
 *
 *  Die Regel bleibt, was sie war: die Kennung muss aus der QUELLE kommen. Nur
 *  der Name der Quelle wird uebersetzt statt bestraft. Eine Sperre, die richtige
 *  Daten wegen einer Vokabel verwirft, schuetzt nichts — sie verliert nur. */
const SYNONYME = { 'event:': 'cal:', 'kalender:': 'cal:', 'mail-id:': 'mail:', 'wiki:': 'brain:' }
const MAX_TITEL = 120
const MAX_WARUM = 300
/** Wie viele Entscheidungen im Protokoll bleiben. Hermes bekommt die letzten
 *  30 als Beispiele; ein paar mehr aufzuheben kostet nichts und erlaubt es,
 *  später eine Auswertung darüber zu legen. */
const MAX_PROTOKOLL = 200

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

// ── Lesen und Schreiben ─────────────────────────────────────────────────────

/** Der abgelegte Zustand.
 *
 *  `entschieden` ist das Gedächtnis und überlebt alles andere: Es wird NIE
 *  geleert, auch nicht beim Tageswechsel. Genau daran hängt die Zusage "einmal
 *  entschieden, nie wieder". */
function read(state) {
  const roh = state.localStorage[SUGGESTION_KEY]
  const leer = { tag: null, offen: [], quittiertAm: null, entschieden: {}, protokoll: [] }
  if (typeof roh !== 'string') return leer
  try {
    const v = JSON.parse(roh)
    if (!v || typeof v !== 'object') return leer
    return {
      tag: typeof v.tag === 'string' ? v.tag : null,
      offen: Array.isArray(v.offen) ? v.offen.filter((x) => x && typeof x === 'object') : [],
      quittiertAm: typeof v.quittiertAm === 'string' ? v.quittiertAm : null,
      entschieden: v.entschieden && typeof v.entschieden === 'object' ? v.entschieden : {},
      protokoll: Array.isArray(v.protokoll) ? v.protokoll.filter((x) => x && typeof x === 'object') : [],
    }
  } catch {
    return leer
  }
}

function write(state, doc) {
  if (doc.protokoll.length > MAX_PROTOKOLL) doc.protokoll = doc.protokoll.slice(0, MAX_PROTOKOLL)
  state.localStorage[SUGGESTION_KEY] = JSON.stringify(doc)
}

/** Die Vorschläge eines vergangenen Tages sind erledigt — aber `entschieden`
 *  und `protokoll` bleiben. Ohne diesen Schnitt stünden morgens noch die von
 *  gestern da, und der Dialog wäre eine Halde. */
function fuerHeute(doc, heute) {
  if (doc.tag === heute) return doc
  return { ...doc, tag: heute, offen: [], quittiertAm: null }
}

// ── Anlegen ─────────────────────────────────────────────────────────────────

function pruefeKennung(id) {
  let k = text(id, 200, 'id')
  // Erst uebersetzen, dann pruefen — und in kanonischer Form weiterreichen,
  // damit derselbe Termin nicht als `event:X` UND `cal:X` zweimal entschieden
  // werden kann. Ohne die Vereinheitlichung waere das Synonym schlimmer als
  // die Ablehnung.
  for (const [fremd, eigen] of Object.entries(SYNONYME)) {
    if (k.toLowerCase().startsWith(fremd)) {
      k = eigen + k.slice(fremd.length)
      break
    }
  }
  if (!PRAEFIXE.some((p) => k.startsWith(p))) {
    throw fehler(400,
      `Die Kennung "${k}" hat kein bekanntes Präfix. Erlaubt sind ${PRAEFIXE.join(', ')} — ` +
      'sie muss aus der QUELLE kommen (Mail-ID, Kalender-UID, Brain-Pfad), nicht aus dem Titel. ' +
      'Eine aus dem Wortlaut gebildete Kennung ändert sich, sobald der Vorschlag anders formuliert ist — ' +
      'und dann käme er nach einem Nein jeden Morgen wieder.')
  }
  if (k.split(':')[1]?.trim().length === 0) {
    throw fehler(400, `Die Kennung "${k}" hat ein Präfix, aber keinen Wert dahinter.`)
  }
  return k
}

/** Legt einen Vorschlag für heute an.
 *  Gibt `{ vorschlag }` zurück — oder `{ verworfen, grund }`, wenn die Kennung
 *  schon entschieden ist. Das ist KEIN Fehler: ein Agent, der brav nachfragt,
 *  soll eine klare Antwort bekommen, keine Ausnahme. */
function schlageVor(input) {
  const id = pruefeKennung(input.id)
  if (!ARTEN.includes(input.art)) {
    throw fehler(400, `Feld "art" muss "todo" oder "termin" sein (bekommen: ${JSON.stringify(input.art)})`)
  }
  const titel = text(input.titel, MAX_TITEL, 'titel')
  const warum = text(input.warum, MAX_WARUM, 'warum')

  if (input.nutzlast === undefined || input.nutzlast === null || typeof input.nutzlast !== 'object') {
    throw fehler(400, 'Feld "nutzlast" fehlt — ohne sie wüsste ein Ja nicht, was anzulegen ist.')
  }

  const state = stateStore.read()
  const heute = serverDate()
  const doc = fuerHeute(read(state), heute)

  // Regel 2 — schon entschieden, also weg. Vor der Zählung, damit ein
  // abgelehnter Vorschlag keinen Platz im Kontingent belegt.
  const frueher = doc.entschieden[id]
  if (frueher) {
    return {
      verworfen: id,
      grund: frueher.ja ? 'angenommen' : 'abgelehnt',
      am: frueher.datum,
      hinweis: `Der Vorschlag ${id} wurde am ${frueher.datum} bereits ${frueher.ja ? 'angenommen' : 'abgelehnt'} und wird nicht erneut gezeigt.`,
    }
  }

  // Regel 2b — steht die Sache schon im Bestand?
  //
  // Bisher prüfte nur `entschieden`, also ob DIESER Vorschlag schon einmal
  // abgelehnt wurde. Was Paul längst als Todo, Termin oder Fokus-Vorgang
  // führt, kam trotzdem erneut — und ein Morgen-Dialog, der Bekanntes
  // wiederholt, wird nach zwei Wochen weggeklickt.
  //
  // Vor der Zählung, damit ein verworfener Vorschlag keinen der drei Plätze
  // belegt. Protokolliert wird trotzdem: eine Ablehnung, die nirgends
  // auftaucht, ist von einem Ausfall nicht zu unterscheiden — und beim
  // Brain-Treffer ist genau das der Preis, den Paul bewusst gewählt hat.
  const vorhanden = dedupCheck.schonVorhanden(titel, id)
  if (vorhanden) {
    const grund = dedupCheck.grundText(vorhanden)
    doc.protokoll.unshift({
      id, art: input.art, titel,
      entscheidung: 'nicht-gezeigt',
      wo: vorhanden.wo,
      grund,
      datum: heute,
      um: new Date().toISOString(),
    })
    if (doc.protokoll.length > MAX_PROTOKOLL) doc.protokoll = doc.protokoll.slice(0, MAX_PROTOKOLL)
    write(state, doc)
    stateStore.write(state)
    console.log(`[vorschlag] ${id} nicht gezeigt — ${grund}`)
    return { verworfen: id, grund: 'schon-vorhanden', wo: vorhanden.wo, hinweis: grund }
  }

  // Derselbe Vorschlag zweimal am selben Tag ist kein neuer — ein
  // Wiederholungslauf soll nicht scheitern.
  const schonOffen = doc.offen.find((v) => v.id === id)
  if (schonOffen) return { vorschlag: schonOffen, wiederholung: true }

  // Regel 1 — höchstens drei.
  if (doc.offen.length >= MAX_PRO_TAG) {
    throw fehler(400,
      `Für ${heute} stehen bereits ${doc.offen.length} Vorschläge — mehr als ${MAX_PRO_TAG} sind nicht vorgesehen. ` +
      'Was nicht in die drei passt, gehört als Satz in den Briefing-Text.',
      { angekommen: doc.offen.length, grenze: MAX_PRO_TAG, ids: doc.offen.map((v) => v.id) })
  }

  const vorschlag = {
    id, art: input.art, titel, warum,
    datum: typeof input.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.datum) ? input.datum : null,
    nutzlast: input.nutzlast,
    quelle: id.split(':')[0],
    angelegtAm: heute,
  }
  doc.offen.push(vorschlag)
  write(state, doc)
  stateStore.write(state)
  return { vorschlag }
}

// ── Pauls Entscheidung ──────────────────────────────────────────────────────

/** Ja oder Nein zu einem Vorschlag.
 *
 *  `anleger` wird von aussen hereingereicht: `{ todo(nutzlast), termin(nutzlast) }`.
 *  So bleibt die Anlege-Logik dort, wo sie schon steht (hermesApi), ohne dass
 *  sich die beiden Module gegenseitig importieren. */
function entscheide(id, ja, anleger) {
  const heute = serverDate()

  // Erst NUR lesen, um den Vorschlag zu finden — noch nichts schreiben.
  const vorher = fuerHeute(read(stateStore.read()), heute)
  const gesucht = vorher.offen.find((v) => v.id === id)
  if (!gesucht) {
    // Schon entschieden? Dann ist das kein Fehler, sondern ein Doppelklick
    // oder ein zweites Fenster — dieselbe Antwort noch einmal geben.
    const frueher = vorher.entschieden[id]
    if (frueher) return { id, ja: frueher.ja, wiederholung: true, angelegt: frueher.angelegt ?? null }
    throw fehler(404, `Kein offener Vorschlag mit der Kennung ${id}.`)
  }

  let angelegt = null
  if (ja) {
    // Regel 4 — der Server legt selbst an. Schlägt das fehl, wird NICHT als
    // entschieden verbucht: sonst wäre der Vorschlag weg und der Eintrag nie
    // entstanden, und Paul erführe es nie.
    try {
      angelegt = gesucht.art === 'todo'
        ? anleger.todo(gesucht.nutzlast)
        : anleger.termin(gesucht.nutzlast)
    } catch (e) {
      throw fehler(400, `Anlegen fehlgeschlagen, nichts entschieden: ${e.message}`)
    }
  }

  // JETZT ERST den Zustand erneut lesen — und zwar zwingend.
  // `anleger.todo()` liest und schreibt den Zustand selbst. Würde hier der
  // Stand von oben weitergeschrieben, überschriebe er das gerade angelegte
  // Todo wieder: der Vorschlag wäre entschieden, der Eintrag aber weg. Genau
  // das ist beim Bauen passiert und hat der Rauchtest gefangen ("angelegtes
  // Todo taucht nicht in /todos auf").
  const state = stateStore.read()
  const doc = fuerHeute(read(state), heute)
  const i = doc.offen.findIndex((v) => v.id === id)
  const vorschlag = i >= 0 ? doc.offen[i] : gesucht
  if (i >= 0) doc.offen.splice(i, 1)
  doc.entschieden[id] = {
    ja, datum: heute, art: vorschlag.art, titel: vorschlag.titel,
    quelle: vorschlag.quelle, angelegt: angelegt ? angelegt.id : null,
  }
  // Neueste zuerst — Hermes liest die ersten 30 als Beispiele.
  doc.protokoll.unshift({
    id, ja, datum: heute, um: new Date().toISOString(),
    art: vorschlag.art, titel: vorschlag.titel, warum: vorschlag.warum, quelle: vorschlag.quelle,
  })

  write(state, doc)
  stateStore.write(state)
  return { id, ja, angelegt: angelegt ? angelegt.id : null }
}

/** Regel 3 — der Dialog ist für heute durch.
 *  "Später" quittiert NICHT: dann kommt er morgen wieder, und nichts ist
 *  entschieden. Wer nicht folgenlos vertagen kann, klickt irgendwann alles weg. */
function quittiere() {
  const state = stateStore.read()
  const heute = serverDate()
  const doc = fuerHeute(read(state), heute)
  doc.quittiertAm = heute
  write(state, doc)
  stateStore.write(state)
  return { quittiertAm: heute, offenGeblieben: doc.offen.length }
}

// ── Für die Oberfläche und für Hermes ───────────────────────────────────────

function zustand() {
  const heute = serverDate()
  const doc = fuerHeute(read(stateStore.read()), heute)
  return {
    serverDate: heute,
    // Nur was heute gilt. Vorschläge von gestern sind durch fuerHeute() weg.
    vorschlaege: doc.offen,
    // Regel 3 — die Oberfläche fragt genau das, statt selbst zu rechnen.
    dialogErledigt: doc.quittiertAm === heute,
    entschiedeneGesamt: Object.keys(doc.entschieden).length,
  }
}

/** Die letzten Entscheidungen — Hermes nimmt sie als Beispiele mit, damit er
 *  nicht dreimal dasselbe vorschlägt, was Paul dreimal abgelehnt hat. */
function entscheidungen(limit = 30, nurOffen = false) {
  const doc = read(stateStore.read())
  const n = Math.max(1, Math.min(200, Number(limit) || 30))
  const alle = nurOffen ? doc.protokoll.filter((e) => !e.imBrain) : doc.protokoll
  return {
    serverDate: serverDate(),
    gesamt: doc.protokoll.length,
    // Wie viele noch nicht im Brain stehen. Hermes fragt genau danach: was
    // muss ich noch festhalten?
    offenFuersBrain: doc.protokoll.filter((e) => !e.imBrain).length,
    entscheidungen: alle.slice(0, n),
  }
}

/** Quittung: diese Entscheidungen stehen jetzt im Second Brain.
 *
 *  WARUM EINE QUITTUNG UND KEIN ZEITSTEMPEL
 *  Ein "seit wann exportiert"-Datum wuerde bei jedem Fehlschlag luegen — Hermes
 *  koennte melden, er sei bis gestern durch, obwohl drei Eintraege nie
 *  ankamen. Ein Haken pro Eintrag kann das nicht: was keinen hat, ist offen.
 *  Derselbe Bau wie beim Kalender-Postausgang, der seit 1.414 Laeufen haelt.
 *
 *  Der Pfad im Brain wird mitgeschrieben, damit spaeter nachvollziehbar ist,
 *  WO etwas gelandet ist — eine Quittung ohne Fundort ist nur ein Versprechen. */
function imBrainVermerkt(ids, brainPfad) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw fehler(400, 'Feld "ids" braucht mindestens eine Kennung.')
  }
  const pfad = typeof brainPfad === 'string' && brainPfad.trim() ? brainPfad.trim().slice(0, 300) : null
  if (!pfad) {
    throw fehler(400, 'Feld "brainPfad" fehlt — ohne Fundort ist die Quittung wertlos.')
  }
  const state = stateStore.read()
  const doc = read(state)
  const gesucht = new Set(ids.map(String))
  let getroffen = 0
  doc.protokoll = doc.protokoll.map((e) => {
    if (!gesucht.has(String(e.id)) || e.imBrain) return e
    getroffen++
    return { ...e, imBrain: { pfad, am: new Date().toISOString() } }
  })
  if (getroffen === 0) {
    throw fehler(404, 'Keine dieser Kennungen ist offen — entweder unbekannt oder schon vermerkt.')
  }
  write(state, doc)
  stateStore.write(state)
  return { vermerkt: getroffen, brainPfad: pfad, offenFuersBrain: doc.protokoll.filter((e) => !e.imBrain).length }
}

module.exports = {
  SUGGESTION_KEY, MAX_PRO_TAG, PRAEFIXE, ARTEN,
  read, schlageVor, entscheide, quittiere, zustand, entscheidungen, serverDate,
  SYNONYME, pruefeKennung, imBrainVermerkt,
}
