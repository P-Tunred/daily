// Mit Hermes sprechen — wie seine gestreamte Antwort gelesen wird.
//
// ZWEI TEILE IN EINER ANTWORT
// Hermes antwortet mit gesprochenem Text und, wenn Paul etwas will, am Ende
// mit einem Block für Daily:
//   Steht drauf.<daily>{"todos":[{"text":"Steuer abschicken","wann":"heute"}]}</daily>
// Der Text wird Satz für Satz vorgelesen, sobald ein Satz fertig ist — sonst
// wartet Paul auf die ganze Antwort. Der Block wird nie vorgelesen, sondern
// von Daily ausgeführt (hermesStimme.cjs).
//
// WARUM EIN BLOCK UND NICHT HERMES' EIGENE WERKZEUGE
// Hermes könnte die Aufgabe auch selbst über /api/hermes/todos anlegen. Das
// kostet ihn aber einen Werkzeug-Aufruf — eine ganze weitere Modellrunde, die
// Paul schweigend abwartet. Der Block kommt in derselben Antwort mit, und
// Daily prüft ihn, bevor etwas passiert: die Grenzen hier (Anzahl, Länge,
// Antwort nur bei offener Frage) sind die eigentliche Sicherung.

const START = '<daily>'
const ENDE = '</daily>'
// Kürzere Stücke werden mit dem nächsten Satz zusammen gesprochen: „Ja." als
// eigene Aufnahme klingt abgehackt und kostet eine Anfrage an die Stimme.
const MIN_SATZ = 15
// Punkt nach diesen Wörtern beendet keinen Satz.
const ABKUERZUNGEN = new Set(['ca', 'bzw', 'nr', 'dr', 'prof', 'vgl', 'ggf', 'evtl', 'inkl', 'zb', 'mio', 'std', 'min'])
const SATZENDE = /[.!?…]+["“”»)]*\s+/g

const MAX_TODOS = 3
const MAX_TODO_TEXT = 200
const MAX_ANTWORT = 4000
const WANN = /^(heute|woche|\d{4}-\d{2}-\d{2})$/

/** Endet der Text vor diesem Punkt mit einer Abkürzung oder Zahl? */
function istAbkuerzung(vorher) {
  const wort = (/(\S+)$/.exec(vorher) || [])[1] || ''
  const kern = wort.replace(/[.(]/g, '').toLowerCase()
  if (/^\d+$/.test(kern)) return true        // „am 3. November"
  if (/^\p{L}$/u.test(kern)) return true     // „z. B.", „d. h."
  return ABKUERZUNGEN.has(kern)
}

/** Fertige Sätze vorne abschneiden. Gibt { saetze, rest } zurück. */
function schneide(text) {
  const saetze = []
  let start = 0
  for (const m of text.matchAll(SATZENDE)) {
    const ende = m.index + m[0].length
    if (istAbkuerzung(text.slice(start, m.index))) continue
    const satz = text.slice(start, ende).trim()
    if (satz.length < MIN_SATZ) continue
    saetze.push(satz)
    start = ende
  }
  return { saetze, rest: text.slice(start) }
}

/** Sammelt die Text-Bröckchen eines Streams. `dazu()` gibt die Sätze zurück,
 *  die mit diesem Bröckchen fertig wurden; `ende()` den Rest und den Block. */
function satzSammler() {
  let puffer = ''
  let block = null

  function dazu(stueck) {
    if (block !== null) { block += stueck; return [] }
    puffer += stueck
    const i = puffer.indexOf(START)
    if (i >= 0) {
      block = puffer.slice(i + START.length)
      const vorher = puffer.slice(0, i)
      puffer = ''
      const { saetze, rest } = schneide(vorher)
      return rest.trim() ? [...saetze, rest.trim()] : saetze
    }
    // Ein „<" am Ende könnte der Anfang des Blocks sein — zurückhalten, bis
    // klar ist, ob er es wird.
    const lt = puffer.lastIndexOf('<')
    const halten = lt >= 0 && START.startsWith(puffer.slice(lt)) ? puffer.slice(lt) : ''
    const { saetze, rest } = schneide(puffer.slice(0, puffer.length - halten.length))
    puffer = rest + halten
    return saetze
  }

  function ende() {
    const rest = puffer.trim()
    puffer = ''
    const roh = block === null ? null : block.split(ENDE)[0].trim()
    return { saetze: rest ? [rest] : [], block: roh }
  }

  return { dazu, ende }
}

/** Text so, wie man ihn vorlesen kann: ohne Markdown, Links und Emoji. */
function fuersOhr(text) {
  return String(text || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const glatt = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

function leseTodos(liste, fehler) {
  if (liste === undefined) return []
  if (!Array.isArray(liste)) { fehler.push('"todos" ist keine Liste.'); return [] }
  const gut = []
  liste.forEach((t, i) => {
    if (!t || typeof t !== 'object') return fehler.push(`Aufgabe ${i + 1} ist kein Objekt.`)
    const text = glatt(t.text)
    if (!text) return fehler.push(`Aufgabe ${i + 1} hat keinen Text.`)
    if (text.length > MAX_TODO_TEXT) return fehler.push(`Aufgabe ${i + 1} ist länger als ${MAX_TODO_TEXT} Zeichen.`)
    const wann = t.wann === undefined ? 'heute' : String(t.wann)
    if (!WANN.test(wann)) return fehler.push(`Aufgabe „${text}": "wann" muss heute, woche oder JJJJ-MM-TT sein.`)
    gut.push({ text, wann })
  })
  if (gut.length > MAX_TODOS) fehler.push(`Pro Antwort höchstens ${MAX_TODOS} Aufgaben — ${gut.length - MAX_TODOS} weggelassen.`)
  return gut.slice(0, MAX_TODOS)
}

// Die Antwort muss die id der Frage tragen, die Hermes gezeigt bekam. Sonst
// landete sie bei der Frage, die gerade zufällig offen ist — etwa einer, die
// während des Gesprächs neu gestellt wurde.
function leseAntwort(roh, frage, frageId, fehler) {
  if (roh === undefined || roh === null) return null
  const antwort = glatt(roh)
  if (!frageId) { fehler.push('Antwort weggelassen: es ist keine Frage offen.'); return null }
  if (frage !== frageId) { fehler.push('Antwort weggelassen: sie gehört zu einer anderen Frage als der offenen.'); return null }
  if (antwort.length < 2) { fehler.push('Antwort ist leer.'); return null }
  if (antwort.length > MAX_ANTWORT) { fehler.push(`Antwort ist länger als ${MAX_ANTWORT} Zeichen.`); return null }
  return antwort
}

/** Block prüfen. `frageId`: die offene Frage, die Hermes gezeigt bekam (oder
 *  null). Gibt { todos, antwort, fehler } zurück — was durchkommt, darf Daily
 *  ausführen; `fehler` sagt, was warum nicht. */
function leseAktionen(block, { frageId }) {
  if (!block) return { todos: [], antwort: null, fehler: [] }
  let v
  try { v = JSON.parse(block) } catch (e) {
    return { todos: [], antwort: null, fehler: [`Aktionsblock ist kein gültiges JSON: ${e.message}`.slice(0, 200)] }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { todos: [], antwort: null, fehler: ['Aktionsblock ist kein Objekt.'] }
  }
  const fehler = []
  const todos = leseTodos(v.todos, fehler)
  const antwort = leseAntwort(v.antwort, v.frage, frageId, fehler)
  return { todos, antwort, fehler }
}

module.exports = { satzSammler, fuersOhr, leseAktionen, MAX_TODOS, START, ENDE }
