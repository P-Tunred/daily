// Betriebsquittungen — der Beleg, wie weit eine Veröffentlichung gekommen ist.
//
// WARUM SIE SEPARAT LIEGEN UND NICHT IM ZUSTAND
// Der Zustand (state.json) ist Pauls Daten: Todos, Lernzeit, Briefing. Eine
// Quittung ist Betriebsprotokoll. Beides zu mischen hiesse, dass jeder
// Abgleich mit dem Browser Protokoll hin- und herträgt und jeder
// Schreibvorgang die Datei aufbläht. Deshalb eine eigene, GEDECKELTE Ablage
// unter DAILY_DATA_DIR.
//
// WAS BEWUSST NICHT DRINSTEHT
// Kein Volltext des Briefings, keine Token, keine Zugangsdaten. Nur IDs,
// Hashes, Zeiten und was normalisiert wurde. Eine Quittung soll beweisen,
// nicht verraten — sie wandert in Logs, Telegram-Meldungen und Hermes'
// Abschlussmeldungen und muss überall gefahrlos zitierbar sein.
//
// WARUM "rendered" NIE AUS DEM POST KOMMT
// Der Server kann wissen, dass er geschrieben hat. Ob ein Browser das je
// angezeigt hat, weiss nur der Browser — und der meldet es getrennt zurück
// (siehe markRendered). Ein geschlossenes Daily heisst ehrlich "persistiert,
// Anzeige nicht bestätigt", niemals "angezeigt".

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { dataPath } = require('./dataDir.cjs')

const RECEIPTS_PATH = dataPath('receipts.json')
const MAX_RECEIPTS = 200        // gedeckelt: das ist ein Protokoll, kein Archiv

// Im Speicher gehalten und bei jeder Änderung atomar geschrieben. Die Datei
// ist klein (einige KB), der Dienst hat sie ohnehin ständig in der Hand.
let cache = null

function laden() {
  if (cache) return cache
  try {
    const doc = JSON.parse(fs.readFileSync(RECEIPTS_PATH, 'utf-8'))
    cache = Array.isArray(doc.receipts) ? doc : { receipts: [] }
  } catch {
    // Anders als beim Zustand ist ein Verlust hier verschmerzbar: Quittungen
    // sind Protokoll, keine Nutzdaten. Ein kaputtes Protokoll darf den Dienst
    // nicht anhalten — es wird neu begonnen.
    cache = { receipts: [] }
  }
  return cache
}

function speichern() {
  const doc = laden()
  if (doc.receipts.length > MAX_RECEIPTS) doc.receipts = doc.receipts.slice(-MAX_RECEIPTS)
  try {
    fs.mkdirSync(path.dirname(RECEIPTS_PATH), { recursive: true })
    const tmp = RECEIPTS_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
    fs.renameSync(tmp, RECEIPTS_PATH)   // atomar, wie beim Zustand
  } catch (e) {
    console.warn('[receipts] konnten nicht geschrieben werden:', e.message)
  }
}

/** Legt eine Quittung an. Der Aufrufer hat zu diesem Zeitpunkt bereits
 *  zurückgelesen — hier wird nur festgehalten, was er festgestellt hat. */
function create(input) {
  const doc = laden()
  const receiptId = crypto.randomUUID()
  const eintrag = {
    receiptId,
    requestId: input.requestId ? String(input.requestId) : null,
    operation: input.operation,
    result: input.result,                       // persisted | scheduled
    serverDate: input.serverDate,
    effectiveDate: input.effectiveDate,
    persistedAt: new Date().toISOString(),
    stateUpdatedAt: input.stateUpdatedAt ?? null,
    storedSha256: input.storedSha256,
    transformations: input.transformations ?? [],
    preservedFields: input.preservedFields ?? [],
    discardedAlert: input.discardedAlert ?? null,
    eligibleNow: !!input.eligibleNow,
    // Wird ausschliesslich vom Browser gesetzt, nie vom POST.
    renderedAt: null,
    renderedSurfaces: [],
  }
  doc.receipts.push(eintrag)
  speichern()
  return oeffentlich(eintrag)
}

/** Die Form, die nach aussen geht. */
function oeffentlich(e) {
  return {
    receiptId: e.receiptId,
    requestId: e.requestId,
    operation: e.operation,
    result: e.result,
    serverDate: e.serverDate,
    effectiveDate: e.effectiveDate,
    persistedAt: e.persistedAt,
    stateUpdatedAt: e.stateUpdatedAt,
    storedSha256: e.storedSha256,
    transformations: e.transformations,
    preservedFields: e.preservedFields,
    discardedAlert: e.discardedAlert,
    display: {
      eligibleNow: e.eligibleNow,
      requiredSurfaces: ['card', 'greeting', 'tagline', 'todayLead'],
      renderStatus: e.renderedAt ? 'rendered' : 'pending',
      renderedAt: e.renderedAt,
      renderedSurfaces: e.renderedSurfaces,
    },
    verifyUrl: `/api/hermes/receipts/${e.receiptId}`,
  }
}

function find(receiptId) {
  return laden().receipts.find((r) => r.receiptId === receiptId) ?? null
}

function byRequestId(requestId) {
  const treffer = laden().receipts.filter((r) => r.requestId === requestId)
  return treffer.length ? treffer[treffer.length - 1] : null
}

function refresh(receiptId) {
  const e = find(receiptId)
  return e ? oeffentlich(e) : null
}

/** Prüft eine Quittung GEGEN DEN AKTUELLEN BESTAND — nicht gegen das, was
 *  beim Schreiben galt. Genau darin liegt der Wert: Stunden später sagt sie,
 *  ob das damals Geschriebene immer noch das ist, was dasteht.
 *
 *    current     — der Hash steht so noch im Zustand
 *    superseded  — es steht etwas anderes da (jemand hat überschrieben)
 *    missing     — es steht gar kein Briefing mehr da
 *    rendered    — zusätzlich: ein Browser hat diese Revision bestätigt
 */
function verify(receiptId, aktuelleRevision) {
  const e = find(receiptId)
  if (!e) return null
  let status
  if (aktuelleRevision === null) status = 'missing'
  else if (aktuelleRevision === e.storedSha256) status = e.renderedAt ? 'rendered' : 'current'
  else status = 'superseded'
  return { ...oeffentlich(e), status, currentSha256: aktuelleRevision }
}

/** Der Browser meldet, dass er eine konkrete Revision wirklich gerendert hat.
 *
 *  Kein Vertrauensvorschuss: gemeldet wird der HASH, und zugeordnet wird nur,
 *  wenn eine Quittung mit genau diesem Hash existiert. Ein Browser kann damit
 *  nichts "bestätigen", was nie geschrieben wurde. Der Briefing-Zustand wird
 *  dabei NICHT angefasst — sonst löste jede Anzeige einen neuen Abgleich aus
 *  und der Browser würde sich selbst in einer Schleife bestätigen. */
function markRendered(sha256, surfaces) {
  const doc = laden()
  const erlaubt = ['card', 'greeting', 'tagline', 'todayLead']
  const sauber = Array.isArray(surfaces) ? surfaces.filter((s) => erlaubt.includes(s)) : []
  let getroffen = 0
  for (const e of doc.receipts) {
    if (e.storedSha256 !== sha256) continue
    if (!e.renderedAt) e.renderedAt = new Date().toISOString()
    e.renderedSurfaces = Array.from(new Set([...(e.renderedSurfaces ?? []), ...sauber]))
    getroffen++
  }
  if (getroffen) speichern()
  return { matched: getroffen, surfaces: sauber }
}

/** Für /api/briefing/status: wurde diese Revision schon einmal gerendert? */
function renderStateFor(sha256) {
  const treffer = laden().receipts.filter((r) => r.storedSha256 === sha256 && r.renderedAt)
  if (!treffer.length) return { renderedAt: null, surfaces: [] }
  const letzter = treffer[treffer.length - 1]
  return { renderedAt: letzter.renderedAt, surfaces: letzter.renderedSurfaces ?? [] }
}

/** Nur für Tests: den Zwischenspeicher fallen lassen, damit ein neu gesetztes
 *  DAILY_DATA_DIR wirklich greift. */
function _reset() { cache = null }

module.exports = { create, find, byRequestId, refresh, verify, markRendered, renderStateFor, oeffentlich, _reset, RECEIPTS_PATH }
