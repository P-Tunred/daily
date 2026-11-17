// Was Paul per Stimme getan hat — damit das Second Brain es mitbekommt.
//
// Eine Aufgabe, die per Stimme entsteht, steht ohnehin in der Liste und kommt
// so in den Tagesbericht. Nicht aber, dass Paul einen Termin hat ausfallen
// lassen oder im Brain nach etwas gesucht hat. Das hält dieses Protokoll fest;
// tagesbericht.cjs nimmt den Tag daraus in den Abschnitt „Per Stimme" auf, und
// Hermes legt den Bericht wie jeden Abend ins Brain. Ins Brain selbst schreibt
// weiterhin nur Hermes.
//
// Liegt im Zustand (state.json) wie die Brain-Frage: ein Schreiber, täglicher
// Schnappschuss. Nur der Server liest und schreibt diesen Schlüssel.

const crypto = require('crypto')
const stateStore = require('./stateStore.cjs')

const LOG_KEY = 'morning.stimme.log'
const MAX_EINTRAEGE = 120
const ZONE = 'Europe/Berlin'
const ARTEN = ['todo', 'termin', 'brain', 'antwort', 'streichen', 'erledigt']

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })

function lies(state) {
  try {
    const v = JSON.parse(state.localStorage[LOG_KEY] || '[]')
    return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object') : []
  } catch {
    return []
  }
}

/** { art, text, wo? } festhalten. Gibt die Kennung zurück. */
function merke({ art, text, wo }) {
  if (!ARTEN.includes(art)) throw new Error(`Unbekannte art "${art}"`)
  const state = stateStore.read()
  const eintrag = {
    id: crypto.randomUUID(),
    datum: heute(),
    um: new Date().toISOString(),
    art,
    text: String(text || '').slice(0, 300),
    ...(wo ? { wo: String(wo).slice(0, 40) } : {}),
  }
  state.localStorage[LOG_KEY] = JSON.stringify([...lies(state), eintrag].slice(-MAX_EINTRAEGE))
  stateStore.write(state)
  return eintrag.id
}

/** Paul hat es zurückgenommen: bleibt im Protokoll, aber als zurückgenommen. */
function zurueck(id) {
  const state = stateStore.read()
  const alle = lies(state)
  if (!alle.some((e) => e.id === id)) return false
  state.localStorage[LOG_KEY] = JSON.stringify(alle.map((e) => (e.id === id ? { ...e, zurueck: true } : e)))
  stateStore.write(state)
  return true
}

/** Alle gültigen Einträge eines Tages, aus einem schon gelesenen Zustand. */
function vomTag(state, datum) {
  return lies(state).filter((e) => e.datum === datum && !e.zurueck)
}

module.exports = { merke, zurueck, vomTag, LOG_KEY }
