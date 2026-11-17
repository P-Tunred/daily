// Steht das schon irgendwo? — die Prüfung vor jedem neuen Vorschlag.
//
// WARUM ES DAS BRAUCHT
// Hermes schlug bisher auch dann etwas vor, wenn es längst als Todo dastand,
// als Termin eingetragen war oder als Fokus-Vorgang lief. Für Paul sah das aus,
// als hätte die App vergessen, was er ihr gerade erst gesagt hat — und ein
// Morgen-Dialog, der Bekanntes wiederholt, wird nach zwei Wochen weggeklickt.
//
// WARUM SERVERSEITIG UND NICHT IM PROMPT
// "Prüf vorher nach" hält meistens, und meistens ist bei drei Vorschlägen pro
// Tag zu wenig. Dieselbe Linie wie bei den Briefing-Zeilen und der
// Ein-Alert-Regel: was die Anzeige verdirbt, wird erzwungen.
//
// WARUM DIE ÄHNLICHKEIT VORSICHTIG IST
// "Vertrag unterschreiben" und "Schlüsselübergabe klären" sind ZWEI Vorgänge
// zum selben Thema. Wer großzügig zusammenwirft, verschluckt echte Aufgaben —
// und das fällt niemandem auf, weil der Vorschlag ja nie erscheint. Deshalb
// greift die Prüfung nur bei derselben Quelle oder bei nach Normalisierung
// praktisch gleichem Titel, nicht bei gemeinsamen Schlagwörtern.

const stateStore = require('./stateStore.cjs')
const focusStore = require('./focusStore.cjs')
const brainSource = require('./brainSource.cjs')

const TODOS_KEY = 'morning.todos'
const EVENTS_KEY = 'morning.important.events'

// Ab dieser Ähnlichkeit gelten zwei Titel als derselbe Vorgang. Hoch angesetzt:
// lieber ein Vorschlag zu viel als eine verschluckte Frist.
const GLEICH_AB = 0.86

/** Titel auf das Vergleichbare reduzieren: Kleinschreibung, keine Satzzeichen,
 *  keine Füllwörter, keine Zahlen. Ohne das zählt "Allihoop: 700,95 € prüfen"
 *  als etwas anderes als "Allihoop 700 EUR prüfen". */
const FUELLWOERTER = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'und', 'oder', 'für', 'fuer', 'von', 'vom', 'zu', 'zum', 'zur', 'im', 'in',
  'am', 'an', 'auf', 'bei', 'mit', 'bis', 'ist', 'sind', 'wird', 'werden',
  // Zeit- und Verstaerkungswoerter tragen nichts zur Unterscheidung bei:
  // "Zusatzgepaeck buchen" und "Zusatzgepaeck JETZT buchen" sind dieselbe
  // Sache. Ohne sie in dieser Liste lag die Aehnlichkeit bei 0.75 statt 1.00 —
  // knapp unter der Schwelle, und der Vorschlag waere doppelt gekommen.
  'jetzt', 'noch', 'schon', 'wieder', 'heute', 'morgen', 'bald', 'dann',
  'bitte', 'unbedingt', 'dringend', 'endlich', 'nochmal',
])

function normalisiere(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[€$£]/g, ' ')
    .replace(/[0-9]+([.,][0-9]+)?/g, ' ')      // Beträge und Daten raus
    .replace(/[^\p{L}\s]/gu, ' ')               // Satzzeichen raus
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FUELLWOERTER.has(w))
    .sort()
    .join(' ')
    .trim()
}

/** Anteil gemeinsamer Wörter (Jaccard). Bewusst simpel: eine echte
 *  Ähnlichkeitsrechnung wäre hier Scheingenauigkeit — die Titel sind kurz und
 *  stammen ohnehin aus derselben Feder. */
function aehnlich(a, b) {
  const A = new Set(normalisiere(a).split(' ').filter(Boolean))
  const B = new Set(normalisiere(b).split(' ').filter(Boolean))
  if (A.size === 0 || B.size === 0) return 0
  let schnitt = 0
  for (const w of A) if (B.has(w)) schnitt++

  // ENTHALTENSEIN — der eine Titel ist der andere plus Zusatz.
  // "GRNVS-Note pruefen" steckt vollstaendig in "GRNVS Note in TUMonline
  // pruefen": dieselbe Sache, nur ausfuehrlicher. Ueber den blossen Anteil
  // gemeinsamer Woerter kaeme das auf 0.75 und liefe durch — die Schwelle
  // dafuer zu senken haette aber auch echte Verschiedenheiten zusammengeworfen.
  // Deshalb hier gezielt: Steckt die kuerzere Menge GANZ in der laengeren und
  // hat mindestens zwei tragende Woerter, ist es eine Dublette.
  const kleiner = Math.min(A.size, B.size)
  if (kleiner >= 2 && schnitt === kleiner) return 1

  return schnitt / (A.size + B.size - schnitt)
}

function parseListe(state, key) {
  try {
    const v = JSON.parse(state.localStorage[key] ?? '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

// ── Die einzelnen Quellen ───────────────────────────────────────────────────

function inTodos(state, titel, quelle) {
  const idb = Array.isArray(state.indexedDB.todos) ? state.indexedDB.todos : []
  const liste = idb.length ? idb : parseListe(state, TODOS_KEY)
  for (const t of liste) {
    if (!t || t.done) continue                    // Erledigtes blockiert nicht
    if (quelle && t.quelle === quelle) return { treffer: t, wie: 'dieselbe Quelle' }
    if (aehnlich(t.text, titel) >= GLEICH_AB) return { treffer: t, wie: 'gleicher Titel' }
  }
  return null
}

function inTerminen(state, titel, quelle) {
  const idb = Array.isArray(state.indexedDB.importantEvents) ? state.indexedDB.importantEvents : []
  const liste = idb.length ? idb : parseListe(state, EVENTS_KEY)
  for (const e of liste) {
    if (!e || e.dismissed) continue
    if (quelle && e.quelle === quelle) return { treffer: e, wie: 'dieselbe Quelle' }
    if (aehnlich(e.title, titel) >= GLEICH_AB) return { treffer: e, wie: 'gleicher Titel' }
  }
  return null
}

function imFokus(titel, quelle) {
  let vorgaenge = []
  try { vorgaenge = focusStore.zustand().vorgaenge || [] } catch { return null }
  for (const v of vorgaenge) {
    if (v.zustand === 'erledigt' || v.zustand === 'verfallen') continue
    if (quelle && v.quelle === quelle) return { treffer: v, wie: 'dieselbe Quelle' }
    if (aehnlich(v.titel, titel) >= GLEICH_AB) return { treffer: v, wie: 'gleicher Titel' }
  }
  return null
}

// ── Das Second Brain ────────────────────────────────────────────────────────
// Pauls Entscheidung (22.08.): Führt das Wiki die Sache als erledigt, wird der
// Vorschlag ABGELEHNT und gar nicht erst gezeigt.
//
// MEIN EINWAND, DER DAZUGEHÖRT
// Ein Wiki-Eintrag mit Stand-Datum ist ein Schnappschuss, keine Tatsache — der
// Prompt der Mail-Bewertung sagt das an anderer Stelle selbst. Ist er veraltet
// oder schlicht falsch, verschluckt diese Regel eine echte Frist, und zwar
// lautlos: Der Vorschlag erscheint nie, also fällt auch nie auf, dass er fehlt.
// Deshalb wird JEDE solche Ablehnung protokolliert und nennt Seite und
// Stand-Datum. Das ändert Pauls Entscheidung nicht, macht sie aber auffindbar.

// Wie viel vom Titel steckt in dieser Zeile? 0 bis 1.
//
// BEWUSST KONSERVATIV
// Deutsche Wortformen ("einreichen" gegen "eingereicht") lassen sich mit
// einfachen Mitteln nicht zuverlaessig zusammenfuehren — ein Wortstamm-Verfahren
// waere hier Scheingenauigkeit. Die Folge ist, dass diese Pruefung Faelle
// UEBERSIEHT. Das ist die richtige Richtung zum Irren: uebersehen heisst, der
// Vorschlag erscheint und Paul entscheidet. Ein falscher Treffer dagegen
// verschluckt eine echte Frist, ohne dass es jemandem auffaellt.
function anteilImText(titel, zeile) {
  const T = normalisiere(titel).split(' ').filter(Boolean)
  if (T.length === 0) return 0
  const Z = new Set(normalisiere(zeile).split(' ').filter(Boolean))
  let treffer = 0
  for (const w of T) if (Z.has(w)) treffer++
  return treffer / T.length
}

// Zwei Drittel der Titelwoerter muessen in der Zeile stehen. Niedriger waere
// gefaehrlich: "Stockholm: Adresse melden" faende sonst jede Zeile, in der
// "Stockholm" vorkommt.
const BRAIN_AB = 0.66

const ERLEDIGT_MARKER = /(erledigt|abgeschlossen|eingereicht|bezahlt|unterschrieben|abgegeben|versendet|abgeschickt)/i
const STAND_DATUM = /\(?Stand:\s*(\d{4}-\d{2}-\d{2})/i

function imBrain(titel) {
  let text = null
  try {
    const b = brainSource.readTriageContext()
    text = b && typeof b.text === 'string' ? b.text : null
  } catch { return null }
  if (!text) return null

  for (const zeile of text.split('\n')) {
    if (!ERLEDIGT_MARKER.test(zeile)) continue
    // ENTHALTENSEIN statt Aehnlichkeit — hier wird ein KURZER Titel gegen eine
    // LANGE Wiki-Zeile gehalten. Der Anteil gemeinsamer Woerter ist dabei
    // strukturell niedrig (die Zeile hat viel mehr Woerter), egal wie gut es
    // passt. Richtig ist die Frage: Wie viel vom TITEL steckt in der Zeile?
    if (anteilImText(titel, zeile) < BRAIN_AB) continue
    const m = STAND_DATUM.exec(zeile)
    return {
      treffer: zeile.trim().slice(0, 200),
      stand: m ? m[1] : null,
      wie: 'im Wiki als erledigt geführt',
    }
  }
  return null
}

// ── Die Prüfung ─────────────────────────────────────────────────────────────

/**
 * Gibt null zurück, wenn der Vorschlag durchgehen darf — sonst den Grund.
 * `quelle` ist die Kennung (mail:<id>), falls die Ablagen sie mitführen.
 */
function schonVorhanden(titel, quelle) {
  const state = stateStore.read()

  const t = inTodos(state, titel, quelle)
  if (t) return { wo: 'todo', wie: t.wie, titel: t.treffer.text, id: t.treffer.id }

  const e = inTerminen(state, titel, quelle)
  if (e) return { wo: 'termin', wie: e.wie, titel: e.treffer.title, id: e.treffer.id, datum: e.treffer.date }

  const f = imFokus(titel, quelle)
  if (f) return { wo: 'fokus', wie: f.wie, titel: f.treffer.titel, id: f.treffer.id, zustand: f.treffer.zustand }

  const b = imBrain(titel)
  if (b) return { wo: 'brain', wie: b.wie, zeile: b.treffer, stand: b.stand }

  return null
}

/** Ein Satz, der erklärt, warum nichts kam — für Protokoll und Antwort. */
function grundText(g) {
  if (g.wo === 'todo') return `Steht schon als offenes Todo: "${g.titel}" (${g.wie}).`
  if (g.wo === 'termin') return `Steht schon als Termin am ${g.datum}: "${g.titel}" (${g.wie}).`
  if (g.wo === 'fokus') return `Läuft schon als Vorgang im Fokus (Zustand: ${g.zustand}): "${g.titel}".`
  return `Im Second Brain als erledigt geführt${g.stand ? ` (Stand: ${g.stand})` : ' (ohne Stand-Datum)'}: „${g.zeile}"`
}

module.exports = { schonVorhanden, grundText, aehnlich, anteilImText, normalisiere, GLEICH_AB, BRAIN_AB }
