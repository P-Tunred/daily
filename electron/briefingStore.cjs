// Der Briefing-Vertrag — und der Beweis, dass er eingehalten wurde.
//
// WARUM ES DIESE DATEI GIBT
// Am 15.08. meldete Hermes "erledigt", der Server antwortete 200 — und im
// Dashboard stand nichts. Er hatte auf den 16. datiert, die Oberfläche zeigt
// aber nur Heutiges. Niemand log: der Schreibvorgang war echt, die Anzeige
// unmöglich. Zwischen "angenommen" und "sichtbar" lag kein Prüfpunkt.
//
// Die Antwort darauf ist nicht "besser aufpassen", sondern eine Kette, deren
// Glieder einzeln beweisbar sind:
//
//   angenommen → atomar geschrieben → ZURÜCKGELESEN → heute anzeigbar
//                → vom Browser übernommen → als Revision gerendert
//
// Jeder Schritt hat eine eigene Aussage. "persisted" heisst nicht "rendered",
// und ein 2xx heisst gar nichts, solange nicht zurückgelesen wurde. Deshalb
// gibt jede Veröffentlichung eine QUITTUNG zurück, die genau sagt, wie weit
// die Kette gekommen ist — und eine Adresse, unter der sich das jederzeit
// nachprüfen lässt, auch Stunden später.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')
const receipts = require('./receipts.cjs')

const BRIEFING_KEY = 'morning.briefing'
const ACK_KEY = 'morning.assistant.acknowledgedEvents'
const ZONE = 'Europe/Berlin'

// Grenzen der kurzen Zeilen. Ein zu langer Header bricht um und zerlegt das
// Layout — lautlos, denn es ist kein Fehler, es sieht nur kaputt aus.
const ZEILEN_GRENZEN = { headerGreeting: 40, tagline: 70, todayLead: 120 }
const ZEILEN_FELDER = Object.keys(ZEILEN_GRENZEN)
const MAX_TEXT = 4000

// ── Datum ───────────────────────────────────────────────────────────────────

/** Der Server ist die Autorität für "heute". Nicht der Aufrufer, nicht die
 *  Systemzeitzone der Maschine (die VM läuft auf UTC) — immer Berlin. */
function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

/** Prüft ein ECHTES Kalenderdatum, nicht nur die Form.
 *  `2026-02-31` passt auf die Regex und ist trotzdem kein Tag; `new Date()`
 *  rollt es still auf den 3. März weiter. Ein Briefing, das auf einen Tag
 *  datiert ist, den es nicht gibt, wäre nie anzeigbar. */
function istEchtesDatum(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

// ── Fehler mit HTTP-Absicht ─────────────────────────────────────────────────

function fehler(status, message, extra) {
  const e = new Error(message)
  e.status = status
  if (extra) Object.assign(e, extra)
  return e
}

// ── Zeilen ──────────────────────────────────────────────────────────────────

function kuerze(text, max) {
  const eine = String(text).replace(/\s+/g, ' ').trim()
  if (!eine) return null
  if (eine.length <= max) return { wert: eine, gekuerzt: false }
  const roh = eine.slice(0, max - 1)
  const luecke = roh.lastIndexOf(' ')
  const kurz = luecke > max * 0.6 ? roh.slice(0, luecke) : roh
  return { wert: kurz.replace(/[,;:–-]$/, '') + '…', gekuerzt: true, vorher: eine.length }
}

/** Prüft die Zeilen und meldet JEDE Abweichung zurück.
 *
 *  Früher wurden ungültige Typen und Leerstrings still verworfen und der
 *  Aufruf als Erfolg quittiert — der Aufrufer hielt eine Zeile für gesetzt,
 *  die nie ankam. Jetzt gilt: falscher Typ ist ein Fehler (400), Kürzung wird
 *  in der Quittung ausgewiesen. Stillschweigend passiert nichts mehr. */
function pruefeZeilen(roh, pflicht) {
  if (roh === undefined || roh === null) {
    if (pflicht) throw fehler(400, 'Ein vollständiger Publish braucht "lines" mit headerGreeting, tagline und todayLead.')
    return { zeilen: null, transformations: [] }
  }
  if (typeof roh !== 'object' || Array.isArray(roh)) {
    throw fehler(400, 'Feld "lines" muss ein Objekt sein.')
  }
  const unbekannt = Object.keys(roh).filter((k) => !ZEILEN_FELDER.includes(k))
  if (unbekannt.length) {
    throw fehler(400, `Unbekannte Felder in "lines": ${unbekannt.join(', ')}. Erlaubt: ${ZEILEN_FELDER.join(', ')}.`)
  }

  const zeilen = {}
  const transformations = []
  for (const feld of ZEILEN_FELDER) {
    const wert = roh[feld]
    if (wert === undefined) {
      if (pflicht) throw fehler(400, `Ein vollständiger Publish braucht "lines.${feld}".`)
      continue
    }
    if (typeof wert !== 'string') {
      throw fehler(400, `"lines.${feld}" muss eine Zeichenkette sein, ist aber ${Array.isArray(wert) ? 'array' : typeof wert}.`)
    }
    if (!wert.trim()) {
      throw fehler(400, `"lines.${feld}" ist leer. Ein Leerstring würde im Browser gegen den lokalen Rückfall gewinnen und die Zeile leer stehen lassen — deshalb abgelehnt statt still verworfen.`)
    }
    const k = kuerze(wert, ZEILEN_GRENZEN[feld])
    zeilen[feld] = k.wert
    if (k.gekuerzt) {
      transformations.push({ field: `lines.${feld}`, kind: 'truncated', from: k.vorher, to: k.wert.length, limit: ZEILEN_GRENZEN[feld] })
    }
  }
  return { zeilen: Object.keys(zeilen).length ? zeilen : null, transformations }
}

// ── Alert ───────────────────────────────────────────────────────────────────

/** Dreiwertig, und das ist Absicht:
 *    fehlt        → nicht anfassen (eine Textkorrektur am Mittag darf das
 *                   Warnsignal vom Morgen nicht löschen)
 *    null         → entfernen (ausdrücklicher Wunsch)
 *    Objekt       → setzen
 *  Vorher war "fehlt" und "entfernen" nicht unterscheidbar. */
function pruefeAlert(raw) {
  if (raw === undefined) return { modus: 'behalten', alert: null }
  if (raw === null) return { modus: 'entfernen', alert: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fehler(400, 'Feld "alert" muss ein Objekt, null oder abwesend sein.')
  const id = String(raw.id || '').trim()
  const title = String(raw.title || '').trim()
  if (!id) throw fehler(400, 'alert.id fehlt — ohne id lässt sich das Pop-up nie quittieren.')
  if (!title) throw fehler(400, 'alert.title fehlt.')
  const alert = { id, title }
  if (typeof raw.why === 'string' && raw.why.trim()) alert.why = raw.why.trim()
  if (raw.deadline !== undefined && raw.deadline !== null) {
    const d = String(raw.deadline).trim()
    if (!istEchtesDatum(d)) throw fehler(400, `alert.deadline "${d}" ist kein gültiges Kalenderdatum.`)
    alert.deadline = d
  }
  return { modus: 'setzen', alert }
}

// ── Lesen ───────────────────────────────────────────────────────────────────

function readBriefing(state) {
  const roh = state.localStorage[BRIEFING_KEY]
  if (typeof roh !== 'string') return null
  try {
    const v = JSON.parse(roh)
    if (v && typeof v === 'object' && typeof v.text === 'string') return v
  } catch { /* kaputt → wie nicht vorhanden; der Zustand selbst ist ja lesbar */ }
  return null
}

/** Die Revision eines Briefings: Hash über den INHALT, nicht über den
 *  Zeitstempel. Zwei identische Veröffentlichungen ergeben denselben Hash —
 *  genau das braucht die Idempotenz-Prüfung. */
function revision(doc) {
  if (!doc) return null
  const kanonisch = JSON.stringify({
    date: doc.date,
    text: doc.text,
    lines: doc.lines ?? null,
    alert: doc.alert ?? null,
  })
  return crypto.createHash('sha256').update(kanonisch).digest('hex')
}

// ── Schreiben ───────────────────────────────────────────────────────────────

/** Veröffentlicht ein Briefing und BEWEIST es.
 *
 *  `mode` ist ausdrücklich:
 *    "publish"   — vollständig: text + alle drei Zeilen. Der Normalfall.
 *    "patch"     — Teiländerung. Was fehlt, bleibt stehen und wird in der
 *                  Quittung unter preservedFields ausgewiesen.
 *    "scheduled" — für später. Wird SEPARAT abgelegt und ersetzt das aktuelle
 *                  Briefing nie; Antwort 202 mit eligibleNow:false.
 */
function publish(input, opts = {}) {
  const heute = serverDate()
  const mode = input.mode === undefined ? 'publish' : String(input.mode)
  if (!['publish', 'patch', 'scheduled'].includes(mode)) {
    throw fehler(400, `Unbekannter mode "${mode}". Erlaubt: publish, patch, scheduled.`)
  }

  const date = String(input.date || '').trim()
  if (!istEchtesDatum(date)) {
    throw fehler(400, `Feld "date" ist kein gültiges Kalenderdatum: "${date}". Erwartet JJJJ-MM-TT.`)
  }

  // ── DIE REGEL, DIE DEN FEHLER VOM 15.08. UNMÖGLICH MACHT ──
  // Es gibt keine "Morgen ist auch okay"-Ausnahme mehr. Ein Briefing, das
  // nicht auf HEUTE datiert ist, kann die Oberfläche nicht zeigen — also
  // nimmt der Server es gar nicht erst an. Wer vorplanen will, sagt das
  // ausdrücklich über mode:"scheduled" und bekommt 202 statt 200, damit der
  // Unterschied im Aufrufer ankommt und nicht in einer Fussnote verschwindet.
  if (mode !== 'scheduled' && date !== heute) {
    throw fehler(400,
      `Das Briefing ist auf ${date} datiert, der Server steht auf ${heute} (${ZONE}). ` +
      'Nur ein Briefing von HEUTE ist anzeigbar; ein anderes wäre gespeichert und trotzdem unsichtbar. ' +
      'Für Vorplanung ausdrücklich mode:"scheduled" verwenden.',
      { serverDate: heute },
    )
  }
  if (mode === 'scheduled' && date <= heute) {
    throw fehler(400, `mode:"scheduled" ist für die Zukunft gedacht, ${date} liegt aber nicht nach ${heute}.`)
  }

  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (mode !== 'patch' && !text) throw fehler(400, 'Feld "text" fehlt.')
  if (text.length > MAX_TEXT) throw fehler(400, `"text" ist ${text.length} Zeichen lang, erlaubt sind ${MAX_TEXT}.`)

  const { zeilen, transformations } = pruefeZeilen(input.lines, mode === 'publish')
  const alertWunsch = pruefeAlert(input.alert)

  const state = stateStore.read()
  const vorher = readBriefing(state)
  const quittiert = new Set(
    (() => {
      try { const v = JSON.parse(state.localStorage[ACK_KEY] ?? '[]'); return Array.isArray(v) ? v : [] }
      catch { return [] }
    })().filter((x) => typeof x === 'string'),
  )

  // ── Vorplanung: eigene Ablage, das Heutige bleibt unberührt ──
  if (mode === 'scheduled') {
    const geplant = { date, text, updatedAt: new Date().toISOString() }
    if (zeilen) geplant.lines = zeilen
    if (alertWunsch.modus === 'setzen') geplant.alert = alertWunsch.alert
    state.localStorage['morning.briefing.scheduled'] = JSON.stringify(geplant)
    stateStore.write(state)
    return {
      status: 202,
      briefing: geplant,
      receipt: receipts.create({
        operation: 'briefing.schedule',
        requestId: input.requestId,
        result: 'scheduled',
        serverDate: heute,
        effectiveDate: date,
        storedSha256: revision(geplant),
        stateUpdatedAt: stateStore.read().updatedAt,
        transformations,
        preservedFields: [],
        eligibleNow: false,
      }),
    }
  }

  // ── Alert-Regeln (unverändert erhalten) ──
  let alert = null
  let verworfen = null
  const preservedFields = []

  if (alertWunsch.modus === 'setzen') {
    alert = alertWunsch.alert
    if (quittiert.has(alert.id)) { verworfen = alert.id; alert = null }        // Regel 2
    else if (vorher && vorher.date === date && vorher.alert && vorher.alert.id !== alert.id) {
      throw fehler(409,                                                          // Regel 1
        `Für ${date} steht bereits ein Alert: "${vorher.alert.title}" (id ${vorher.alert.id}). ` +
        'Pro Tag ist genau eins vorgesehen — das zweite wurde nicht gespeichert.',
        { steht: vorher.alert },
      )
    }
  } else if (alertWunsch.modus === 'behalten') {
    if (vorher && vorher.date === date && vorher.alert) { alert = vorher.alert; preservedFields.push('alert') }
  }
  // modus === 'entfernen' → alert bleibt null

  // ── Patch: was nicht mitkam, bleibt stehen — und wird ausgewiesen ──
  let endText = text
  let endZeilen = zeilen
  if (mode === 'patch' && vorher && vorher.date === date) {
    if (!text) { endText = vorher.text; preservedFields.push('text') }
    if (vorher.lines) {
      const zusammen = { ...vorher.lines }
      for (const feld of ZEILEN_FELDER) {
        if (zeilen && zeilen[feld] !== undefined) zusammen[feld] = zeilen[feld]
        else if (vorher.lines[feld] !== undefined) preservedFields.push(`lines.${feld}`)
      }
      endZeilen = zusammen
    }
  }
  if (mode === 'patch' && !endText) {
    throw fehler(400, 'Patch ohne "text" und ohne bestehendes Briefing für heute — es gibt nichts zu bewahren.')
  }

  const doc = { date, text: endText, updatedAt: new Date().toISOString() }
  if (alert) doc.alert = alert
  if (endZeilen) doc.lines = endZeilen

  const erwarteteRevision = revision(doc)

  // ── Idempotenz ──
  // Gleicher Schlüssel + gleicher Inhalt → dieselbe Quittung, KEIN zweiter
  // Schreibvorgang (ein Wiederholungslauf nach Netzabbruch darf nicht als
  // Änderung zählen). Gleicher Schlüssel + anderer Inhalt → 409, denn dann
  // meint der Aufrufer etwas anderes als beim ersten Mal.
  if (input.requestId) {
    const frueher = receipts.byRequestId(String(input.requestId))
    if (frueher) {
      if (frueher.storedSha256 === erwarteteRevision) {
        return { status: 200, briefing: doc, receipt: receipts.refresh(frueher.receiptId), wiederholung: true }
      }
      throw fehler(409,
        `requestId "${input.requestId}" wurde bereits mit einem anderen Inhalt verwendet ` +
        `(damals ${frueher.storedSha256.slice(0, 12)}…, jetzt ${erwarteteRevision.slice(0, 12)}…). ` +
        'Für eine inhaltliche Änderung einen neuen Schlüssel verwenden.',
        { frueher: { receiptId: frueher.receiptId, storedSha256: frueher.storedSha256 } },
      )
    }
  }

  state.localStorage[BRIEFING_KEY] = JSON.stringify(doc)
  stateStore.write(state)

  // ── READ-AFTER-WRITE — das Glied, das vorher fehlte ──
  // Erst jetzt darf überhaupt von Erfolg die Rede sein: frisch von der Platte
  // lesen und den Hash vergleichen. Ohne das ist "gespeichert" nur eine
  // Behauptung über den eigenen Programmablauf, keine Aussage über die Datei.
  const frisch = stateStore.read()
  const zurueck = readBriefing(frisch)
  const istRevision = revision(zurueck)
  if (!zurueck || istRevision !== erwarteteRevision) {
    throw fehler(500,
      'Nach dem Schreiben stand nicht dasselbe auf der Platte wie erwartet ' +
      `(erwartet ${erwarteteRevision.slice(0, 12)}…, gelesen ${istRevision ? istRevision.slice(0, 12) + '…' : 'nichts'}). ` +
      'Nicht als Erfolg gemeldet.',
    )
  }

  return {
    status: 200,
    briefing: zurueck,
    verworfen,
    receipt: receipts.create({
      operation: 'briefing.publish',
      requestId: input.requestId,
      result: 'persisted',
      serverDate: heute,
      effectiveDate: date,
      storedSha256: istRevision,
      stateUpdatedAt: frisch.updatedAt,
      transformations,
      preservedFields,
      discardedAlert: verworfen,
      eligibleNow: date === heute,
    }),
  }
}

// ── Status für die Oberfläche ───────────────────────────────────────────────

function status() {
  const heute = serverDate()
  let state
  try {
    state = stateStore.read()
  } catch (e) {
    return { serverDate: heute, state: 'error', reason: e.message, eligibleNow: false }
  }
  const b = readBriefing(state)
  if (!b) {
    return {
      serverDate: heute, state: 'missing', eligibleNow: false,
      revision: null, persistedAt: null,
      hermesFields: [], fallbackFields: ['text', ...ZEILEN_FELDER],
    }
  }
  const rev = revision(b)
  const frisch = b.date === heute
  const hermesFields = ['text', ...ZEILEN_FELDER.filter((f) => b.lines && b.lines[f])]
  const fallbackFields = ZEILEN_FELDER.filter((f) => !(b.lines && b.lines[f]))
  const render = receipts.renderStateFor(rev)
  return {
    serverDate: heute,
    state: frisch ? 'fresh' : 'stale',
    briefingDate: b.date,
    revision: rev,
    persistedAt: b.updatedAt ?? null,
    eligibleNow: frisch,
    renderedAt: render.renderedAt,
    renderedSurfaces: render.surfaces,
    hermesFields: frisch ? hermesFields : [],
    fallbackFields: frisch ? fallbackFields : ['text', ...ZEILEN_FELDER],
    hasAlert: !!b.alert,
  }
}

module.exports = {
  publish, status, readBriefing, revision, serverDate, istEchtesDatum,
  BRIEFING_KEY, ACK_KEY, ZEILEN_GRENZEN,
}
