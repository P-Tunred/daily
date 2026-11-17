// Der Zustand der App als Datei: Todos, Lernzeit, Score, Einstellungen.
//
// WARUM ES DIESE DATEI GIBT
// Bisher lebte all das im localStorage und IndexedDB des Browsers. Dieser
// Speicher hängt an der Adresse des Fensters ("Origin"). Eine neue Adresse —
// etwa die VM statt localhost — bekommt einen frischen, leeren Speicher. Beim
// Umzug wären damit 671 Lernzeit-Einträge lautlos verschwunden.
// Hier liegt der Zustand stattdessen auf der Platte, unter DAILY_DATA_DIR.
// Damit übersteht er Adresswechsel, Geräte und Neuinstallationen — und Hermes
// kann ihn lesen, was in einen Browserspeicher nicht möglich wäre.
//
// SCHREIBEN IST IMMER ATOMAR
// Erst in eine .tmp-Datei, dann umbenennen. `rename` ist auf einem Dateisystem
// unteilbar: entweder die alte oder die neue Datei ist da, nie eine halbe.
// Ein Absturz oder Stromausfall mitten im Schreiben kann den Zustand also
// nicht zerreißen.
//
// TÄGLICHER SCHNAPPSCHUSS
// Vor dem ersten Schreiben eines Tages wandert eine Kopie nach snapshots/.
// 30 Tage werden aufgehoben. Das ist die Rückfallebene, wenn ein Fehler den
// Zustand beschädigt und es erst später auffällt.

const fs = require('fs')
const path = require('path')
const { dataPath, dataDir } = require('./dataDir.cjs')

const STATE_PATH = dataPath('state.json')
const SNAPSHOT_DIR = path.join(dataDir(), 'snapshots')
const KEEP_SNAPSHOTS = 30
const MAX_BODY = 12 * 1024 * 1024 // 12 MB — das Backup vom 13.08. war 0,18 MB

const EMPTY = () => ({
  _app: 'daily-dashboard',
  _version: 1,
  updatedAt: null,
  localStorage: {},
  indexedDB: { todos: [], importantEvents: [], aiMessages: [] },
})

// ── Lesen ────────────────────────────────────────────────────────────────────

/** Wird geworfen, wenn der Zustand DA ist, aber nicht gelesen werden kann.
 *  Eigener Typ, damit die Routen ihn von einem gewöhnlichen Fehler
 *  unterscheiden und mit 500 statt 400 antworten können. */
class StateUnreadableError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'StateUnreadableError'
    this.code = 'STATE_UNREADABLE'
    this.cause = cause
  }
}

/** Liest den Zustand.
 *
 *  FAIL-CLOSED — DER WICHTIGSTE PUNKT DIESER DATEI
 *  Früher fing ein einziges `catch` ALLES ab und gab EMPTY() zurück: fehlende
 *  Datei, kaputtes JSON, fehlende Rechte, halber Plattenausfall. Für die
 *  fehlende Datei ist das richtig — beim ersten Start gibt es noch nichts.
 *  Für alles andere ist es die gefährlichste Zeile im Projekt: der nächste
 *  Schreibvorgang hätte einen LEEREN Ausgangszustand genommen und die
 *  vorhandene Datei damit überschrieben. Ein Tippfehler im JSON oder ein
 *  falsch gesetztes chown hätte 671 Lernzeit-Einträge gelöscht, ohne dass
 *  irgendwo ein Fehler erschienen wäre.
 *
 *  Deshalb: nur ENOENT heisst "noch nichts da". Alles andere wirft, blockiert
 *  damit jeden Schreibvorgang und macht sich über /api/health als 503
 *  bemerkbar. Lieber ein Dienst, der laut steht, als einer, der leise löscht. */
function read() {
  let raw
  try {
    raw = fs.readFileSync(STATE_PATH, 'utf-8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return EMPTY()   // erster Start — legitim
    throw new StateUnreadableError(
      `Zustand unter ${STATE_PATH} ist nicht lesbar (${e.code || e.message}). ` +
      'Schreibvorgänge sind gesperrt, damit der vorhandene Stand nicht überschrieben wird.',
      e,
    )
  }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    throw new StateUnreadableError(
      `Zustand unter ${STATE_PATH} enthält kein gültiges JSON (${e.message}). ` +
      'Schreibvorgänge sind gesperrt. Der letzte Schnappschuss liegt in ' + SNAPSHOT_DIR + '.',
      e,
    )
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new StateUnreadableError(
      `Zustand unter ${STATE_PATH} hat nicht die erwartete Form (${Array.isArray(doc) ? 'Array' : typeof doc}). ` +
      'Schreibvorgänge sind gesperrt.',
    )
  }
  return normalise(doc)
}

/** Für Health-Prüfungen: sagt, ob der Zustand lesbar ist, ohne zu werfen. */
function readiness() {
  try {
    const doc = read()
    return { ok: true, keys: Object.keys(doc.localStorage).length, updatedAt: doc.updatedAt }
  } catch (e) {
    return { ok: false, code: e.code || 'UNKNOWN', message: e.message }
  }
}

/** Bringt einen gelesenen oder empfangenen Zustand auf die erwartete Form.
 *  Fremde localStorage-Schlüssel werden verworfen: gespeichert wird nur, was
 *  mit "morning." beginnt — genau die Regel, die auch src/lib/backup.ts nutzt. */
function normalise(doc) {
  const out = EMPTY()
  if (doc.updatedAt && typeof doc.updatedAt === 'string') out.updatedAt = doc.updatedAt
  const ls = doc.localStorage
  if (ls && typeof ls === 'object') {
    for (const [k, v] of Object.entries(ls)) {
      if (typeof k === 'string' && k.startsWith('morning.') && typeof v === 'string') out.localStorage[k] = v
    }
  }
  const idb = doc.indexedDB
  if (idb && typeof idb === 'object') {
    for (const store of ['todos', 'importantEvents', 'aiMessages']) {
      if (Array.isArray(idb[store])) out.indexedDB[store] = idb[store]
    }
  }
  return out
}

// ── Schreiben ────────────────────────────────────────────────────────────────

function snapshotIfNewDay() {
  let previous
  try { previous = fs.readFileSync(STATE_PATH) } catch { return } // erster Lauf
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const target = path.join(SNAPSHOT_DIR, `state-${day}.json`)
  if (fs.existsSync(target)) return // heute schon gesichert
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    fs.writeFileSync(target, previous)
    prune()
  } catch (e) {
    console.warn('[state] Schnappschuss fehlgeschlagen:', e.message)
  }
}

function prune() {
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR).filter((f) => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
      fs.unlinkSync(path.join(SNAPSHOT_DIR, f))
    }
  } catch { /* egal */ }
}

function write(incoming) {
  // Vor JEDEM Schreiben nachsehen, ob der vorhandene Stand lesbar ist. Wirft
  // read(), bricht der Schreibvorgang hier ab — genau die Sperre, die einen
  // beschädigten Zustand vor dem Überschreiben schützt. Das Ergebnis wird
  // verworfen; es geht nur um den Wurf.
  read()
  const doc = normalise(incoming)
  doc.updatedAt = new Date().toISOString()
  snapshotIfNewDay()
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  const tmp = STATE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  fs.renameSync(tmp, STATE_PATH) // <- der unteilbare Moment
  return doc
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function json(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > MAX_BODY) { reject(new Error('Zustand zu groß')); req.destroy() }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/** GET  /api/state → aktueller Zustand
 *  PUT  /api/state → Zustand ersetzen.
 *
 *  Schickt der Aufrufer `baseUpdatedAt` mit, muss das dem serverseitigen
 *  `updatedAt` entsprechen. Tut es das nicht, hat jemand anderes inzwischen
 *  geschrieben — dann kommt 409 mit dem aktuellen Stand zurück, statt fremde
 *  Änderungen zu überschreiben. Das ist der Schutz gegen ein altes Fenster,
 *  das neuere Daten plattmacht. */
async function handle(req, res) {
  // Ein unlesbarer Zustand darf nicht als unbehandelte Promise-Rejection den
  // Prozess mitnehmen — er wird zu einer klaren 500 mit Grund.
  try {
    return await handleInner(req, res)
  } catch (e) {
    if (e && e.code === 'STATE_UNREADABLE') {
      console.error('[state] FAIL-CLOSED:', e.message)
      return json(res, 500, { error: e.message, code: e.code })
    }
    console.error('[state] unerwarteter Fehler:', e && e.message)
    return json(res, 500, { error: 'Interner Fehler beim Zustand.' })
  }
}

/** Schlüssel mit eigener Versionsprüfung. Für sie gilt: Schreiben nur über die
 *  eigene Route, mit dem Stand, den der Schreiber kannte. Ein Gesamt-Upload
 *  des Browsers darf sie weder überschreiben noch löschen.
 *  „Zeit für dich" war der erste; Projekte kamen 2026-11 dazu, weil dort
 *  ebenfalls Browser und Hermes in denselben Wert schreiben. */
const CAS = {
  '/api/bewusst': {
    key: 'morning.bewusst.v1',
    name: 'Bewusst-leben-Zustand',
    gueltig: async (v) => (await import('./bewusstSchema.mjs')).validState(v),
  },
  '/api/projekte': {
    key: 'morning.projekte',
    name: 'Projekte-Zustand',
    gueltig: async (v) => require('../src/lib/projekte.ts').istGueltig(v),
  },
}
const CAS_KEYS = Object.values(CAS).map((c) => c.key)

async function handleInner(req, res) {
  // Feature-local compare-and-swap: a stale phone must not discard a check
  // merely because another tab changed an unrelated todo. Same atomic store,
  // same authentication; no second data file or writer.
  const cas = CAS[req.url.split('?')[0]]
  if (cas) {
    const casKey = cas.key
    if (req.method === 'GET') return json(res, 200, { value: read().localStorage[casKey] ?? null })
    if (req.method !== 'PUT') return json(res, 405, { error: 'GET oder PUT erforderlich' })
    let body, parsed
    try {
      body = JSON.parse(await readBody(req))
      if (typeof body.value !== 'string' || body.value.length > 512000) throw new Error('Ungültige Größe')
      parsed = JSON.parse(body.value)
      if (!(await cas.gueltig(parsed))) throw new Error('Ungültiges Format')
    } catch { return json(res, 400, { error: `Ungültiger ${cas.name}` }) }
    const current = read()
    if (body.base !== (current.localStorage[casKey] ?? null)) return json(res, 409, { error: 'Zwischenzeitlich geändert' })
    // Dieses Schreiben setzt `updatedAt` weiter. Der Browser kennt danach eine
    // veraltete Marke — sein nächster Gesamt-Upload bekäme 409, und src/lib/sync.ts
    // übernähme den Serverstand ERSETZEND: alles, was er seit dem letzten Upload
    // geändert hat, wäre still weg (gefunden 2026-10-13: ein Routine-Haken, dann
    // eine abgehakte Aufgabe — die Aufgabe kam zurück). Deshalb melden wir, von
    // welcher Marke auf welche gesprungen wurde; der Browser zieht nur nach,
    // wenn er genau `vorher` kannte (src/lib/syncBasis.ts).
    const vorher = current.updatedAt ?? null
    current.localStorage[casKey] = body.value
    const saved = write(current)
    const verified = read().localStorage[casKey]
    if (verified !== body.value) return json(res, 500, { error: 'Rückleseprüfung fehlgeschlagen' })
    return json(res, 200, { value: verified, vorher, updatedAt: saved.updatedAt })
  }
  if (req.method === 'GET') return json(res, 200, read())

  if (req.method === 'PUT' || req.method === 'POST') {
    let incoming
    try {
      incoming = JSON.parse(await readBody(req))
    } catch (e) {
      return json(res, 400, { error: 'Ungültiger Inhalt: ' + e.message })
    }
    const current = read()
    // Der Schutz greift, sobald hier überhaupt etwas steht: wer schreiben will,
    // muss beweisen, dass er den aktuellen Stand kennt. Ein fehlendes oder
    // null-wertiges `baseUpdatedAt` zählt NICHT als Beweis — genau darüber
    // könnte sonst ein frisch geöffnetes, leeres Fenster einen vollen Zustand
    // überschreiben. Nur wenn der Server noch leer ist, darf ohne Nachweis
    // geschrieben werden (die einmalige Erstbefüllung).
    if (current.updatedAt && incoming.baseUpdatedAt !== current.updatedAt) {
      const n = Object.keys(current.localStorage).length
      console.warn(`[state] Schreibversuch abgewiesen — Aufrufer kennt Stand ${incoming.baseUpdatedAt ?? '(keiner)'}, hier steht ${current.updatedAt} mit ${n} Schlüsseln.`)
      return json(res, 409, { error: 'Zwischenzeitlich geändert', current })
    }
    try {
      // Whole-browser snapshots are not allowed to erase or overwrite the
      // feature-local CAS value, including snapshots from older app versions.
      incoming.localStorage = { ...incoming.localStorage }
      for (const k of CAS_KEYS) {
        if (current.localStorage[k] !== undefined) incoming.localStorage[k] = current.localStorage[k]
        else delete incoming.localStorage[k]
      }
      const saved = write(incoming)
      const n = Object.keys(saved.localStorage).length
      console.log(`[state] gespeichert — ${n} Schlüssel, ${saved.indexedDB.todos.length} Todos`)
      return json(res, 200, { ok: true, updatedAt: saved.updatedAt, keys: n })
    } catch (e) {
      console.error('[state] Schreiben fehlgeschlagen:', e.message)
      return json(res, 500, { error: e.message })
    }
  }

  res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, PUT' })
  res.end('405')
}

module.exports = { read, write, handle, readiness, StateUnreadableError, STATE_PATH, SNAPSHOT_DIR }
