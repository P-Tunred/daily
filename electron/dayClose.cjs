// Der Tagesabschluss — abends, deterministisch, ohne Modell.
//
// WARUM KEIN AGENT
// Das hier ist reines Rechnen: welche Todos sind offen, wie lange schon. Die
// Zahlen aus 14 Tagen sind eindeutig — der Skript-Auftrag im System hat 1.414
// Laeufe ohne einen einzigen Formfehler, die Agenten-Auftraege produzieren
// regelmaessig welche (falsches Praefix, Feld als Zahl statt Text). Ein Modell
// fuer etwas einzusetzen, das eine Schleife kann, kauft nur Fehlerquellen.
//
// WAS ER TUT
// Offene Tagesaufgaben, die aelter als heute sind, bekommen das heutige Datum
// und einen Zaehler hoch. Sie verschwinden nicht und werden nicht neu sortiert
// — sie tragen nur mit, wie oft sie schon weitergeschoben wurden.
//
// WARUM DAS DER PUNKT IST
// Ohne Zaehler sieht eine Aufgabe, die seit drei Wochen mitlaeuft, genauso aus
// wie eine von heute Morgen. Beide stehen einfach da. Der Zaehler macht aus
// "steht auf der Liste" ein "steht seit 12 Tagen auf der Liste" — und das ist
// die Information, die eine Entscheidung ausloest: machen, delegieren oder
// streichen.
//
// WAS ER AUSDRUECKLICH NICHT TUT
// Nichts loeschen, nichts abhaken, nichts umsortieren, keine Aufgabe erfinden.
// Ein Abschluss, der eigenmaechtig aufraeumt, ist kein Abschluss, sondern ein
// Datenverlust mit gutem Gewissen.

const stateStore = require('./stateStore.cjs')

const MARKER_KEY = 'morning.dayClose'
const TODO_KEY = 'morning.todos'
const ZONE = 'Europe/Berlin'
/** Ab wann der Abschluss laufen darf (Berlin). Frueher waere er mitten im Tag
 *  und wuerde Aufgaben hochzaehlen, die noch erledigt werden. */
const STUNDE = 21

function heute() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}
function stundeBerlin() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: ZONE })).getHours()
}

function leseMarker(state) {
  try {
    const v = JSON.parse(state.localStorage[MARKER_KEY])
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

function parseListe(state) {
  try {
    const v = JSON.parse(state.localStorage[TODO_KEY])
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Eine offene Tagesaufgabe von gestern oder frueher. Wochenaufgaben bleiben
 *  unberuehrt: die haben absichtlich kein Tagesdatum. */
function istUeberfaellig(t, tag) {
  if (!t || typeof t !== 'object' || t.done) return false
  if (t.scope === 'week') return false
  return typeof t.date === 'string' && t.date < tag
}

function schiebe(t, tag) {
  return { ...t, date: tag, verschoben: (Number(t.verschoben) || 0) + 1 }
}

/** Laeuft der Abschluss heute noch? */
function faellig(state) {
  if (stundeBerlin() < STUNDE) return false
  const m = leseMarker(state)
  return !m || m.tag !== heute()
}

/**
 * Fuehrt den Abschluss aus. Idempotent: der Marker verhindert, dass derselbe
 * Tag zweimal zaehlt — sonst wuerde ein Neustart um 22 Uhr jede Aufgabe ein
 * zweites Mal hochzaehlen und der Zaehler waere gelogen.
 */
function schliesseTag({ erzwingen = false } = {}) {
  const state = stateStore.read()
  const tag = heute()
  if (!erzwingen && !faellig(state)) {
    const m = leseMarker(state)
    return { gelaufen: false, grund: m && m.tag === tag ? 'heute-schon' : 'zu-frueh', tag }
  }

  const vorher = parseListe(state)
  const idbVorher = Array.isArray(state.indexedDB.todos) ? state.indexedDB.todos : []

  const zuSchieben = new Set(vorher.filter((t) => istUeberfaellig(t, tag)).map((t) => t.id))
  for (const t of idbVorher) if (istUeberfaellig(t, tag)) zuSchieben.add(t.id)

  // BEIDE Ablagen, in EINEM Schreibvorgang. Wer nur eine Seite anfasst, macht
  // es schlimmer als vorher: beim naechsten Abgleich schreibt die andere Seite
  // ihren Stand zurueck. Genau dieselbe Regel wie in hermesApi.remove().
  const nachher = vorher.map((t) => (zuSchieben.has(t.id) && istUeberfaellig(t, tag) ? schiebe(t, tag) : t))
  const idbNachher = idbVorher.map((t) => (zuSchieben.has(t.id) && istUeberfaellig(t, tag) ? schiebe(t, tag) : t))

  const offen = nachher.filter((t) => t && !t.done && t.scope !== 'week').length
  const erledigtHeute = nachher.filter(
    (t) => t && t.done && typeof t.doneAt === 'number' &&
      new Date(t.doneAt).toLocaleDateString('sv-SE', { timeZone: ZONE }) === tag,
  ).length
  // Was am laengsten mitlaeuft — die eine Zahl, die eine Entscheidung ausloest.
  const aeltester = nachher
    .filter((t) => t && !t.done && Number(t.verschoben) > 0)
    .sort((a, b) => (Number(b.verschoben) || 0) - (Number(a.verschoben) || 0))[0]

  const bericht = {
    tag,
    verschoben: zuSchieben.size,
    erledigtHeute,
    offen,
    aeltester: aeltester ? { text: String(aeltester.text || '').slice(0, 80), male: Number(aeltester.verschoben) || 0 } : null,
    um: new Date().toISOString(),
  }

  state.localStorage[TODO_KEY] = JSON.stringify(nachher)
  state.indexedDB.todos = idbNachher
  state.localStorage[MARKER_KEY] = JSON.stringify(bericht)
  stateStore.write(state)

  console.log(`[abschluss] ${tag}: ${bericht.verschoben} verschoben, ${erledigtHeute} heute erledigt, ${offen} offen`)
  return { gelaufen: true, ...bericht }
}

/** Der letzte Abschluss — fuer die Oberflaeche und die Gesundheitsauskunft. */
function letzter() {
  try {
    return leseMarker(stateStore.read())
  } catch {
    return null
  }
}

module.exports = { schliesseTag, faellig, letzter, MARKER_KEY, STUNDE, istUeberfaellig, schiebe }
