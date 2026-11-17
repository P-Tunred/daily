// Projekte für Hermes: lesen, anlegen, ergänzen, vorschlagen.
//
// WAS HERMES DARF — UND WAS NICHT
// Paul will, dass Hermes Projekte anlegt, wenn er ihm davon erzählt, und
// vorschlägt, wie er weitermacht. Dafür reicht: anlegen, Schritte, Notizen und
// Ideen anhängen, „Wo du aufgehört hast" setzen, solange dort nicht Pauls
// eigener Satz steht, und Vorschläge machen. Löschen, Abhaken und Status
// ändern bleiben bei Paul. So kann ein falscher Lauf nichts zerstören, nur
// etwas hinzufügen, das Paul mit einem Klick wieder entfernt.
//
// Die Regeln selbst stehen in src/lib/projekte.ts, die der Browser genauso
// benutzt. Hier passiert nur Lesen, Anwenden, atomar Schreiben.
//
// LOGS
// Nur Ids, Zahlen und Gründe. Projektnamen und Texte sind Pauls Gedanken und
// gehören nicht ins Journal der VM.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')

const KEY = 'morning.projekte'

function lib() {
  return require('../src/lib/projekte.ts')
}

function fehler(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function liesStand(state) {
  const p = lib()
  const stand = p.lese(state.localStorage[KEY] ?? null)
  if (!stand) throw fehler(500, 'Projekte sind gespeichert, aber nicht lesbar. Nichts wird überschrieben.')
  return stand
}

/** Lesen, ändern, schreiben, ohne `await` dazwischen. Der Server ist ein
 *  einziger Node-Prozess; zwischen read() und write() kann also kein anderer
 *  Schreiber dazwischenkommen. */
function aendere(aenderung) {
  const state = stateStore.read()
  const vorher = liesStand(state)
  const k = { am: new Date().toISOString(), von: 'hermes', neueId: () => crypto.randomUUID() }
  const { stand, ergebnis } = aenderung(vorher, k)
  if (!lib().istGueltig(stand)) throw fehler(500, 'Ergebnis wäre ungültig. Nichts gespeichert.')
  state.localStorage[KEY] = JSON.stringify(stand)
  stateStore.write(state)
  return ergebnis
}

/** Was Hermes zum Arbeiten braucht: jedes Projekt mit nächstem Schritt,
 *  Fortschritt und wann zuletzt etwas passiert ist, dazu Pauls Entscheidungen
 *  über frühere Vorschläge. */
function uebersicht() {
  const p = lib()
  const stand = liesStand(stateStore.read())
  const projekte = p.sortiert(stand.projekte).map((x) => ({
    ...x,
    naechsterSchritt: p.naechsterSchritt(x)?.text ?? null,
    fortschritt: { erledigt: p.erledigtZahl(x), gesamt: x.schritte.length },
    zuletztAktiv: p.zuletztAktiv(x),
  }))
  return {
    projekte,
    vorschlagGewuenscht: projekte.filter((x) => x.vorschlagGewuenscht).map((x) => x.id),
    entscheidungen: stand.entscheidungen,
  }
}

function anlegen(eingabe) {
  return aendere((s, k) => {
    const r = lib().legeAn(s, eingabe || {}, k)
    return { stand: r.stand, ergebnis: r.projekt }
  })
}

const MERK = { notizen: 'notizen', ideen: 'ideen' }

/** POST /projekte/:id/<was> */
function ergaenzen(projektId, was, eingabe) {
  const p = lib()
  const e = eingabe || {}
  return aendere((s, k) => {
    if (was === 'schritte') {
      const stand = p.fuegeSchritteHinzu(s, projektId, e.schritte, k)
      return { stand, ergebnis: p.findeProjekt(stand, projektId) }
    }
    if (MERK[was]) {
      const stand = p.fuegeEintragHinzu(s, projektId, MERK[was], e.text, k)
      return { stand, ergebnis: p.findeProjekt(stand, projektId) }
    }
    if (was === 'zuletzt') {
      const stand = p.setzeZuletzt(s, projektId, e.text, k)
      return { stand, ergebnis: p.findeProjekt(stand, projektId) }
    }
    if (was === 'vorschlaege') {
      const r = p.schlageVor(s, projektId, e, k)
      return { stand: r.stand, ergebnis: r.vorschlag }
    }
    if (was === 'claude') {
      // Vom Mac (deploy/claude-stand/): Schlusszusammenfassung der jüngsten
      // Claude-Sitzung zu diesem Projekt. Ein älterer Stand ändert nichts.
      const r = p.setzeClaudeStand(s, projektId, e)
      return { stand: r.stand, ergebnis: { geaendert: r.geaendert, projekt: p.findeProjekt(r.stand, projektId) } }
    }
    throw fehler(404, `Unbekannt: ${was}. Erlaubt sind schritte, notizen, ideen, zuletzt, vorschlaege, claude.`)
  })
}

const VERBOTEN = 'Hermes löscht, hakt ab und ändert den Status nicht — das macht Paul in Daily. ' +
  'Was weg soll oder anders gehört, als Notiz oder Vorschlag anlegen.'

/** Die Hermes-Weiche für /projekte…; `json` und `readBody` kommen aus
 *  hermesApi.cjs, damit Antworten und Grenzen dort gleich bleiben. */
async function handleHermes(req, res, route, { json, readBody }) {
  const antwortFehler = (e, was) => {
    const status = e.status || 400
    console.warn(`[hermes] Projekte ${was} abgelehnt (${status})`)
    return json(res, status, { ok: false, error: e.message })
  }
  const lies = async () => {
    try { return { input: JSON.parse((await readBody(req)) || '{}') } } catch (e) { return { kaputt: e.message } }
  }

  if (route === '/projekte') {
    if (req.method === 'GET') {
      try { return json(res, 200, uebersicht()) } catch (e) { return antwortFehler(e, 'lesen') }
    }
    if (req.method === 'POST') {
      const { input, kaputt } = await lies()
      if (kaputt) return json(res, 400, { error: 'Ungültiges JSON: ' + kaputt })
      try {
        const projekt = anlegen(input)
        console.log(`[hermes] Projekt ${projekt.id} angelegt (${projekt.schritte.length} Schritte)`)
        return json(res, 201, { ok: true, projekt })
      } catch (e) { return antwortFehler(e, 'anlegen') }
    }
    return json(res, 405, { error: 'GET oder POST erforderlich.' })
  }

  const m = /^\/projekte\/([^/]+)(?:\/([a-z]+))?$/.exec(route)
  if (!m) return json(res, 404, { error: 'Unbekannte Projekt-Route.' })
  const projektId = decodeURIComponent(m[1])
  const was = m[2]
  if (req.method === 'DELETE' || req.method === 'PATCH' || req.method === 'PUT') return json(res, 403, { error: VERBOTEN })
  if (!was) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET erforderlich.' })
    try {
      const x = uebersicht().projekte.find((p) => p.id === projektId || p.name.toLowerCase() === projektId.toLowerCase())
      return x ? json(res, 200, x) : json(res, 404, { error: 'Projekt nicht gefunden.' })
    } catch (e) { return antwortFehler(e, 'lesen') }
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST erforderlich.' })
  const { input, kaputt } = await lies()
  if (kaputt) return json(res, 400, { error: 'Ungültiges JSON: ' + kaputt })
  try {
    const ergebnis = ergaenzen(projektId, was, input)
    if (was === 'claude') {
      console.log(`[hermes] Claude-Stand ${ergebnis.geaendert ? 'übernommen' : 'unverändert (nicht neuer)'}`)
      return json(res, ergebnis.geaendert ? 201 : 200, { ok: true, ...ergebnis })
    }
    console.log(`[hermes] Projekt ergänzt: ${was}`)
    return json(res, 201, { ok: true, [was === 'vorschlaege' ? 'vorschlag' : 'projekt']: ergebnis })
  } catch (e) { return antwortFehler(e, was) }
}

module.exports = { KEY, uebersicht, anlegen, ergaenzen, handleHermes }
