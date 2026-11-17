#!/usr/bin/env node
// Prüft die Typen im Speicher-Register gegen ECHTE gespeicherte Daten.
//
// WARUM DAS NÖTIG IST — MIT BELEG
// Beim Bau des Registers standen zwei Definitionen falsch da:
//   morning.triage.asked    war als string[] notiert, ist aber { id: datum }
//   morning.triage.deferred war als string[] notiert, hält aber ganze Objekte
// Beide hätten beim ersten Lesen den Prüfer nicht bestanden, wären auf die
// Vorgabe zurückgefallen — und hätten damit die Cooldowns bzw. die
// zurückgestellten Mails GELÖSCHT. Kein Absturz, keine Meldung.
//
// Gefunden wurden sie nur, weil die Module vor dem Umstellen gelesen wurden.
// Diese Prüfung macht daraus etwas Wiederholbares: Sie vergleicht jede
// Definition mit dem, was wirklich im Zustand liegt.
//
// Aufruf:
//   node scripts/check-storage-shapes.mjs --datei /pfad/state.json
//   node scripts/check-storage-shapes.mjs --url http://…   (mit HERMES_TOKEN)
//
// Read-only. Schreibt nie, weder lokal noch auf den Server.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTER = join(ROOT, 'src', 'lib', 'store.ts')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function ladeZustand() {
  const datei = arg('--datei')
  if (datei) return JSON.parse(readFileSync(datei, 'utf-8'))
  const url = arg('--url')
  if (!url) {
    console.error('  Weder --datei noch --url angegeben.')
    process.exit(2)
  }
  const token = process.env.HERMES_TOKEN
  if (!token) {
    console.error('  HERMES_TOKEN fehlt — ohne Token gibt der Server nichts heraus.')
    process.exit(2)
  }
  const res = await fetch(url.replace(/\/+$/, '') + '/api/hermes/state', {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    console.error(`  Server antwortete ${res.status}.`)
    process.exit(2)
  }
  return res.json()
}

/** Zieht Feldname + Art + Typ + Schluessel aus dem Register.
 *
 *  WARUM NICHT EIN EINZELNER REGEX UEBER DIE GANZE ZEILE
 *  Der erste Versuch war `(\w+):\s*(json|text)<?([^>]*)>?\(` — und scheiterte
 *  still an verschachtelten Typen: bei `json<Record<string, string>>(` hoert
 *  `[^>]*` beim ersten `>` auf, danach passt die Klammer nicht mehr. Betroffen
 *  war jede Definition mit `Record<…>`, also mehr als die Haelfte. Die Pruefung
 *  meldete trotzdem "alle passen" — sie hatte die Haelfte nie angesehen.
 *
 *  Deshalb umgekehrt: erst die Schluessel-Zeichenkette finden, dann rueckwaerts
 *  die Definition davor lesen. `[^(]*` ueberspringt jeden Generic, weil darin
 *  keine offene Klammer vorkommt. */
function definitionen(text) {
  const out = []
  for (const m of text.matchAll(/"(morning\.[^"]+)"/g)) {
    const davor = text.slice(0, m.index).trimEnd()
    const d = /(\w+)\s*:\s*(json|text|schalter)([^(]*)\(\s*$/.exec(davor)
    if (!d) continue
    out.push({ feld: d[1], art: d[2], typ: d[3].replace(/^</, '').replace(/>$/, '').trim(), name: m[1] })
  }
  return out
}

/** Beschreibt, was tatsächlich unter einem Schlüssel liegt. */
function tatsaechlicheForm(roh) {
  if (roh === undefined) return { art: 'fehlt', text: '— noch nicht gespeichert' }
  let v
  try { v = JSON.parse(roh) } catch { return { art: 'text', text: `Text "${roh.slice(0, 14)}"` } }
  if (Array.isArray(v)) {
    if (v.length === 0) return { art: 'leereListe', text: '[] leer' }
    const inner = typeof v[0] === 'object' && v[0] !== null ? 'Objekt' : typeof v[0]
    return { art: inner === 'Objekt' ? 'objektListe' : 'textListe', text: `${inner}[] (${v.length})` }
  }
  if (v === null) return { art: 'null', text: 'null' }
  if (typeof v === 'object') {
    const werte = [...new Set(Object.values(v).map((x) => (Array.isArray(x) ? 'Liste' : typeof x)))]
    return { art: werte.length === 1 && werte[0] === 'number' ? 'zahlKarte' : 'textKarte',
             text: `Objekt{${Object.keys(v).length}} → ${werte.join('/') || 'leer'}` }
  }
  return { art: typeof v, text: typeof v }
}

/** Passt die Definition zu dem, was da liegt? */
function passt(def, form) {
  if (form.art === 'fehlt') return true            // noch nie geschrieben — in Ordnung
  if (def.art === 'text' || def.art === 'schalter') return true  // roher Text, immer lesbar
  const t = def.typ
  if (t.includes('string[]')) return ['textListe', 'leereListe'].includes(form.art)
  if (t.includes('Record<string, string>')) return ['textKarte', 'zahlKarte'].includes(form.art) && form.text.includes('string') || form.text.includes('{0}')
  if (t.includes('Record<string, number>')) return ['zahlKarte'].includes(form.art) || form.text.includes('{0}')
  if (t.includes('Record<string, unknown>[]')) return ['objektListe', 'leereListe'].includes(form.art)
  if (t.includes('number[]')) return ['textListe', 'leereListe'].includes(form.art) || form.text.startsWith('number[]')
  if (t === 'number') return form.art === 'number'
  if (t === 'boolean') return form.art === 'boolean'
  return true                                       // Objekt/null-Formen: zu frei zum Prüfen
}

const zustand = await ladeZustand()
const ls = zustand.localStorage ?? {}
const defs = definitionen(readFileSync(REGISTER, 'utf-8'))

let geprueft = 0
const abweichungen = []
for (const def of defs) {
  const form = tatsaechlicheForm(ls[def.name])
  if (form.art === 'fehlt') continue
  geprueft++
  if (!passt(def, form)) abweichungen.push({ def, form })
}

console.log('')
console.log(`  Register: ${defs.length} Schlüssel · davon gespeichert: ${geprueft}`)
console.log('')
if (abweichungen.length) {
  console.error('  ✖ ABBRUCH — Definition passt nicht zu den echten Daten:')
  for (const { def, form } of abweichungen) {
    console.error(`      ${def.name}`)
    console.error(`        Register : ${def.art}<${def.typ}>`)
    console.error(`        Wirklich : ${form.text}`)
  }
  console.error('')
  console.error('  Würde so gelesen, faellt der Wert auf die Vorgabe zurueck — und die')
  console.error('  echten Daten waeren beim naechsten Schreiben ueberschrieben.')
  console.error('')
  process.exit(1)
}
console.log(`  ✓ Alle ${geprueft} gespeicherten Schlüssel passen zu ihrer Definition.`)
console.log('')
