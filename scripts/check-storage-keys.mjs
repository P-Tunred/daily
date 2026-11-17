#!/usr/bin/env node
// Prüft das Speicher-Register gegen den echten Code.
//
// WARUM DIESE PRÜFUNG DIE WICHTIGSTE DES REFAKTORS IST
// Der gefährlichste Fehler beim Umstellen auf ein Register ist ein VERTIPPTER
// Schlüsselname. `morning.tracker.sesions` legt still einen neuen, leeren
// Schlüssel an — die echten Daten bleiben liegen, unerreichbar, und nichts
// meldet sich. Kein Absturz, keine Fehlermeldung: nur eine App, die plötzlich
// keine Lernzeiten mehr kennt.
//
// Zwei Richtungen werden geprüft:
//   1. Jeder Name im Register muss so auch im Code vorkommen (oder ausdrücklich
//      als "nur noch im Register" vermerkt sein). Fängt Tippfehler.
//   2. Namen im Code, die das Register nicht kennt, werden aufgezählt — nicht
//      als Fehler, sondern als Arbeitsvorrat. Die Umstellung darf schrittweise
//      sein, weil Abgleich und Backup über das Präfix laufen, nicht über das
//      Register.
//
// Aufruf:  node scripts/check-storage-keys.mjs [--json]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const REGISTER = join(SRC, 'lib', 'store.ts')
const MUSTER = /"(morning\.[a-zA-Z0-9._-]+)"/g

// Schlüssel, die es NUR noch im Register gibt — etwa weil das letzte lesende
// Modul entfernt wurde, der Wert im Speicher der Nutzer aber weiterlebt.
// Wer hier etwas einträgt, muss begründen warum.
// Schluessel, die im Register stehen, aber von KEINEM Modul unter src/ gelesen
// werden — und zwar mit Absicht. Wer hier etwas eintraegt, muss begruenden,
// warum. Ohne Begruendung ist ein solcher Eintrag von einem Tippfehler nicht
// zu unterscheiden, und genau den soll diese Pruefung ja finden.
const NUR_IM_REGISTER = {
  'morning.focus':
    'Der Zustand lebt auf dem SERVER (electron/focusStore.cjs). Der Browser ' +
    'liest ihn ueber GET /api/focus, nicht aus dem localStorage — dort landet ' +
    'er nur als Nebenprodukt des Abgleichs. Im Register steht er trotzdem, ' +
    'damit check-storage-shapes die Form der echten Daten pruefen kann.',
}

function* dateien(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* dateien(p)
    else if (/\.tsx?$/.test(e)) yield p
  }
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

function namenIn(text) {
  return [...text.matchAll(MUSTER)].map((m) => m[1])
}

const registerText = readFileSync(REGISTER, 'utf-8')
const imRegister = namenIn(registerText)
const doppelt = imRegister.filter((k, i) => imRegister.indexOf(k) !== i)

// Feldname → Schlüsselname, also `triageGesehen` → `morning.triage.seen`.
// Nach der Umstellung eines Moduls verschwindet das Zeichenketten-Literal aus
// dem Code — genau das ist das Ziel. Erreichbar ist der Schlüssel dann über
// `SCHLUESSEL.triageGesehen`. Wer nur nach Literalen sucht, hielte jeden
// umgestellten Schlüssel für tot.
const feldFuer = new Map(definitionen(registerText).map((d) => [d.name, d.feld]))

const imCode = new Map()      // Schlüsselname → [dateien] (rohes Literal)
const feldBenutzt = new Set() // Feldnamen, die über SCHLUESSEL.x gelesen werden
for (const f of dateien(SRC)) {
  if (f === REGISTER) continue
  const rel = relative(ROOT, f)
  const text = readFileSync(f, 'utf-8')
  for (const k of new Set(namenIn(text))) {
    if (!imCode.has(k)) imCode.set(k, [])
    imCode.get(k).push(rel)
  }
  for (const m of text.matchAll(/SCHLUESSEL\.(\w+)/g)) feldBenutzt.add(m[1])
}
// `morning.` allein ist das Präfix aus sync.ts/backup.ts, kein Schlüssel.
imCode.delete('morning.')

/** Ein Schlüssel ist erreichbar, wenn sein Literal noch im Code steht ODER
 *  sein Registerfeld irgendwo benutzt wird. Nur wenn beides fehlt, zeigt er
 *  ins Leere — dann ist es ein Tippfehler oder ein vergessener Rest. */
const erreichbar = (k) => imCode.has(k) || feldBenutzt.has(feldFuer.get(k))
const tippfehler = imRegister.filter((k) => !erreichbar(k) && !NUR_IM_REGISTER[k])
const umgestelltNamen = imRegister.filter((k) => !imCode.has(k) && feldBenutzt.has(feldFuer.get(k)))
const offen = [...imCode.keys()].filter((k) => !imRegister.includes(k))
const umgestellt = imRegister.length - tippfehler.length

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ imRegister: imRegister.length, offen, tippfehler, doppelt }, null, 2))
  process.exit(tippfehler.length || doppelt.length ? 1 : 0)
}

console.log('')
console.log(`  Register: ${imRegister.length} Schlüssel · im Code gefunden: ${imCode.size}`)
console.log('')

if (doppelt.length) {
  console.error('  ✖ Doppelt im Register — zwei Einträge auf denselben Namen:')
  for (const k of new Set(doppelt)) console.error(`      ${k}`)
  console.error('')
  process.exit(1)
}

if (tippfehler.length) {
  console.error('  ✖ ABBRUCH — im Register, aber nirgends im Code:')
  for (const k of tippfehler) console.error(`      ${k}`)
  console.error('')
  console.error('  Entweder ein Tippfehler (dann zeigt der Schlüssel ins Leere und die')
  console.error('  echten Daten sind unerreichbar), oder das letzte lesende Modul ist weg.')
  console.error('  Im zweiten Fall in NUR_IM_REGISTER eintragen — mit Begründung.')
  console.error('')
  process.exit(1)
}

console.log(`  ✓ Alle ${umgestellt} Registerschlüssel sind erreichbar.`)
if (umgestelltNamen.length) {
  console.log('')
  console.log(`  Bereits umgestellt (${umgestelltNamen.length}) — Zugriff nur noch über das Register:`)
  for (const k of umgestelltNamen) console.log(`      ✓ ${k}`)
}
if (offen.length) {
  console.log('')
  console.log(`  Noch mit rohem Literal (${offen.length}) — kein Fehler, nur Arbeitsvorrat:`)
  for (const k of offen) console.log(`      · ${k}  (${imCode.get(k).join(', ')})`)
}
console.log('')
