// Der Postausgang zum echten Kalender.
//
// WARUM ES IHN GIBT
// Daily liest den Kalender, schrieb aber nie hinein. Termine, die Paul hier
// anlegt, landeten in `important.events` — einer eigenen Ablage, von der sein
// iPhone nichts weiss. Zwei Paralleluniversen, und man merkt es erst, wenn man
// vor einem Termin steht, den das Telefon nicht kennt.
//
// WARUM DAILY NICHT SELBST CalDAV SPRICHT
// Es hat die Zugangsdaten nicht und soll sie nicht bekommen. Sie gehoeren
// Hermes, der ohnehin taeglich exportiert. Daily legt den Termin also lokal ab
// und markiert ihn als "offen"; Hermes holt den Postausgang ab, legt ihn per
// CalDAV an und meldet die echte UID zurueck. Ein Postausgang statt eines
// zweiten CalDAV-Zugangs — weniger Stellen, an denen ein Passwort liegt.
//
// WARUM FEHLER SICHTBAR BLEIBEN MUESSEN
// Das ist der wichtigste Teil. Wer glaubt, ein Termin stehe im Kalender,
// obwohl er es nicht tut, ist SCHLECHTER dran als vorher — er verlaesst sich
// auf etwas, das nicht existiert. Deshalb bleibt `syncState` auf "offen", bis
// eine echte UID zurueckkommt, und die Karte sagt das auch. Nach drei
// Fehlversuchen wird daraus "fehlgeschlagen", damit ein kaputter Eintrag nicht
// ewig im Postausgang kreist und die Meldung nicht zur Tapete wird.
//
// WARUM DER ZIELKALENDER AUS DER UMGEBUNG KOMMT
// Paul hat zehn Kalender, zwei davon geteilt ("Familie shared"). Schriebe Daily
// dorthin, laese die ganze Familie seine Uni-Fristen mit. Ein Vorgabewert waere
// hier gefaehrlich: er waere genau einmal falsch, und dann steht es auf fremden
// Telefonen. Ohne CALDAV_TARGET_CALENDAR wird deshalb NICHTS geschrieben — der
// Postausgang bleibt offen und sagt, warum.

const stateStore = require('./stateStore.cjs')

const EVENTS_KEY = 'morning.important.events'
const ZONE = 'Europe/Berlin'
const MAX_VERSUCHE = 3

/** Zustaende, die Hermes abarbeiten soll. "fehlgeschlagen" ist bewusst NICHT
 *  dabei: dort hat es dreimal nicht geklappt, ein vierter Versuch im selben
 *  Takt bringt nichts ausser Last. */
const OFFEN = ['offen', 'loeschen-offen']

function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function fehler(status, message, extra) {
  const e = new Error(message)
  e.status = status
  if (extra) Object.assign(e, extra)
  return e
}

/** Der eingestellte Zielkalender, oder null.
 *  Wird bei JEDEM Abruf frisch gelesen: so wirkt eine Aenderung in
 *  /etc/daily/env nach einem Neustart des Dienstes, ohne dass hier etwas
 *  zwischengespeichert veraltet. */
function zielKalender() {
  const v = (process.env.CALDAV_TARGET_CALENDAR || '').trim()
  return v || null
}

// ── Lesen und Schreiben der Termin-Liste ────────────────────────────────────
// Termine liegen in ZWEI Ablagen (IndexedDB-Liste + localStorage-Spiegel),
// siehe hermesApi.cjs. Wer nur eine anfasst, erzeugt Eintraege, die je nach
// Ansicht da sind oder nicht.

function leseTermine(state) {
  const idb = Array.isArray(state.indexedDB.importantEvents) ? state.indexedDB.importantEvents : []
  if (idb.length) return idb
  try {
    const v = JSON.parse(state.localStorage[EVENTS_KEY] ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function schreibeTermine(state, liste) {
  state.indexedDB.importantEvents = liste
  state.localStorage[EVENTS_KEY] = JSON.stringify(liste)
}

// ── Was Hermes abzuarbeiten hat ─────────────────────────────────────────────

/** Ein Auftrag, wie Hermes ihn sieht. Bewusst flach und ohne die internen
 *  Felder: er soll anlegen oder loeschen, nicht unseren Zustand interpretieren. */
function alsAuftrag(e) {
  const loeschen = e.syncState === 'loeschen-offen'
  return {
    id: e.id,
    art: loeschen ? 'loeschen' : 'anlegen',
    titel: e.title,
    datum: e.date,
    // Uhrzeiten sind ZUSAETZLICH zu `datum`, nicht statt dessen. Hermes' Worker
    // laeuft seit 1.414 Auftraegen fehlerfrei; ein Feld zu ERSETZEN haette ihn
    // gebrochen. Kennt er die neuen Felder nicht, legt er wie bisher einen
    // Ganztagseintrag an — schlechter als gewollt, aber nichts geht kaputt.
    startZeit: e.startZeit,
    endZeit: e.endZeit,
    kind: e.kind,
    notiz: e.note,
    // Beim Loeschen ist die UID das Einzige, was zaehlt.
    calUid: e.calUid,
    versuche: e.syncVersuche ?? 0,
    letzterFehler: e.syncFehler,
  }
}

function postausgang() {
  const ziel = zielKalender()
  const state = stateStore.read()
  const auftraege = leseTermine(state)
    .filter((e) => OFFEN.includes(e.syncState))
    // Loeschauftraege ohne UID sind unausfuehrbar — der Termin stand nie im
    // Kalender. Sie hier auszuliefern hiesse, Hermes zu einem Auftrag zu
    // schicken, den er nicht erfuellen kann.
    .filter((e) => e.syncState !== 'loeschen-offen' || !!e.calUid)
    .map(alsAuftrag)

  return {
    serverDate: serverDate(),
    // Ohne Zielkalender wird NICHTS geschrieben. Die Auftraege werden trotzdem
    // gezeigt — Hermes soll sehen, was aufliefe, und den Grund melden koennen.
    zielKalender: ziel,
    schreibbereit: !!ziel,
    hinweis: ziel
      ? null
      : 'CALDAV_TARGET_CALENDAR ist auf dem Server nicht gesetzt — es wird NICHTS in den Kalender geschrieben. ' +
        'Ohne Zielkalender waere die Vorgabe irgendein Kalender, und bei einem geteilten ("Familie shared") ' +
        'laese die ganze Familie mit. Erst setzen, dann abarbeiten.',
    auftraege,
    offen: auftraege.length,
  }
}

// ── Rueckmeldung von Hermes ─────────────────────────────────────────────────

/**
 * Hermes meldet das Ergebnis eines Auftrags.
 *   ok + calUid  → angelegt, Zustand "im-kalender"
 *   ok bei Loeschen → der Eintrag verschwindet ganz
 *   ok:false + fehler → Versuch zaehlen, ab 3 "fehlgeschlagen"
 */
function melde(id, input) {
  const state = stateStore.read()
  const liste = leseTermine(state)
  const i = liste.findIndex((e) => e && e.id === id)
  if (i < 0) throw fehler(404, `Kein Termin mit der id ${id}.`)

  const alt = liste[i]
  if (!OFFEN.includes(alt.syncState)) {
    throw fehler(409,
      `Der Termin ${id} steht nicht im Postausgang (Zustand: ${alt.syncState ?? 'keiner'}). ` +
      'Vermutlich hat ihn ein paralleler Durchgang schon erledigt.',
      { syncState: alt.syncState ?? null })
  }

  const geloeschtGemeint = alt.syncState === 'loeschen-offen'
  const ok = input.ok !== false

  if (!ok) {
    const versuche = (alt.syncVersuche ?? 0) + 1
    const grund = typeof input.fehler === 'string' && input.fehler.trim()
      ? input.fehler.trim().slice(0, 300)
      : 'ohne Begruendung gemeldet'
    const neu = {
      ...alt,
      syncVersuche: versuche,
      syncFehler: grund,
      // Nach drei Versuchen aus dem Kreislauf nehmen — aber SICHTBAR, nicht
      // still. Der Eintrag bleibt stehen und die Karte sagt, dass er nicht im
      // Kalender ist.
      syncState: versuche >= MAX_VERSUCHE
        ? 'fehlgeschlagen'
        : alt.syncState,
    }
    liste[i] = neu
    schreibeTermine(state, liste)
    stateStore.write(state)
    return { id, ok: false, syncState: neu.syncState, versuche, fehler: grund }
  }

  if (geloeschtGemeint) {
    // Jetzt ist er auch im echten Kalender weg — der lokale Beleg kann gehen.
    const weg = liste[i]
    schreibeTermine(state, liste.filter((_, k) => k !== i))
    stateStore.write(state)
    return { id, ok: true, art: 'loeschen', entfernt: true, titel: weg.title }
  }

  const calUid = typeof input.calUid === 'string' ? input.calUid.trim() : ''
  if (!calUid) {
    throw fehler(400,
      'Ein erfolgreiches Anlegen braucht die echte "calUid" zurueck. Ohne sie liesse sich der Termin ' +
      'weder wiedererkennen (er stuende doppelt im Horizont) noch spaeter loeschen.')
  }

  const neu = { ...alt, calUid, syncState: 'im-kalender', syncVersuche: 0 }
  delete neu.syncFehler
  liste[i] = neu
  schreibeTermine(state, liste)
  stateStore.write(state)
  return { id, ok: true, art: 'anlegen', calUid, syncState: 'im-kalender' }
}

// ── Von Daily aus ───────────────────────────────────────────────────────────

/** Einen bestehenden Termin in den Postausgang legen (oder neu anlegen, wenn
 *  `titel`/`datum` mitkommen). Ohne Zielkalender wird er trotzdem eingereiht —
 *  er bleibt dann sichtbar "offen", statt still zu verschwinden. */
function inKalender(id) {
  const state = stateStore.read()
  const liste = leseTermine(state)
  const i = liste.findIndex((e) => e && e.id === id)
  if (i < 0) throw fehler(404, `Kein Termin mit der id ${id}.`)
  if (liste[i].calUid) {
    throw fehler(409, `Der Termin steht bereits im Kalender (UID ${liste[i].calUid}).`)
  }
  liste[i] = { ...liste[i], syncState: 'offen', syncVersuche: 0 }
  delete liste[i].syncFehler
  schreibeTermine(state, liste)
  stateStore.write(state)
  return liste[i]
}

/** Loeschen — mit Umweg ueber den Kalender, falls der Termin dort steht.
 *
 *  WARUM NICHT EINFACH WEG
 *  Stuende er nur lokal, waere Loeschen trivial. Steht er aber im echten
 *  Kalender, muss er auch dort verschwinden — sonst waere jeder Fehlgriff
 *  dauerhaft auf Pauls Telefon, und dann traut er sich nicht mehr, ueberhaupt
 *  Termine in Daily anzulegen. Deshalb: mit UID → Loeschauftrag, ohne UID →
 *  sofort weg. */
function loesche(id) {
  const state = stateStore.read()
  const liste = leseTermine(state)
  const i = liste.findIndex((e) => e && e.id === id)
  if (i < 0) throw fehler(404, `Kein Termin mit der id ${id}.`)

  if (!liste[i].calUid) {
    const weg = liste[i]
    schreibeTermine(state, liste.filter((_, k) => k !== i))
    stateStore.write(state)
    return { id, sofortWeg: true, titel: weg.title }
  }

  liste[i] = { ...liste[i], syncState: 'loeschen-offen', syncVersuche: 0 }
  delete liste[i].syncFehler
  schreibeTermine(state, liste)
  stateStore.write(state)
  return { id, sofortWeg: false, syncState: 'loeschen-offen', calUid: liste[i].calUid }
}

module.exports = {
  EVENTS_KEY, MAX_VERSUCHE, OFFEN,
  postausgang, melde, inKalender, loesche, zielKalender, serverDate,
  leseTermine, schreibeTermine,
}
