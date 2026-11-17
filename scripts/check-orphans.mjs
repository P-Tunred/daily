#!/usr/bin/env node
// Was von den Einstiegspunkten aus NICHT erreichbar ist.
//
// WARUM ES DIESES SKRIPT GIBT
// Toter Code kostet hier doppelt. Er wird nicht ausgeliefert — der Bundler
// wirft ihn weg —, aber er liegt im Repo, und alles, was das Repo liest,
// bezahlt ihn: jede Suche, jeder Überblick, jede KI-Sitzung, die sich
// orientieren will. Beim Schreiben dieses Skripts waren 4082 Zeilen
// unerreichbar, 13 % des Quelltexts. Gefunden wurden sie durch Zufall.
//
// WARUM NICHT EINFACH GREP
// Ein grep über Dateinamen findet Erwähnungen, keine Erreichbarkeit. Es
// übersieht Ketten (A ist tot, importiert aber B — also ist B auch tot) und
// meldet Kommentare als Treffer. Beides ist hier passiert: ein grep-Versuch
// hielt die halbe Anwendung für verwaist. Deshalb ein echter Graph vom
// Einstiegspunkt aus, transitiv verfolgt.
//
// Aufruf:  node scripts/check-orphans.mjs [--json]
// Exit 1, wenn Verwaistes gefunden wird — damit ein Hook oder CI es sieht.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

// Von hier aus wird gesucht. `main.tsx` ist der einzige echte Einstieg der
// Anwendung; alles andere muss von dort aus erreichbar sein, sonst läuft es nie.
const EINSTIEGE = ['src/main.tsx']

const ENDUNGEN = ['.ts', '.tsx', '.js', '.jsx']

// ABSICHTLICH NICHT IMPORTIERT — kein toter Code.
// Wer hier etwas einträgt, muss begründen, warum die Datei existiert, ohne
// gebraucht zu werden. Ohne diese Liste meldet sich jede solche Datei bei
// jedem Lauf erneut, und irgendwann sieht niemand mehr hin.
const GEWOLLT = {
  'src/lib/photoThemes.ts':
    'Referenz: dokumentiert, wie die Farbpaletten aus den Hintergrundfotos ' +
    'hergeleitet wurden (zuletzt "glas", gemessen am Bergbild). Wird gelesen, ' +
    'wenn ein neues Thema entsteht — nicht zur Laufzeit.',
}

function alleQuellen(dir, treffer = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) alleQuellen(p, treffer)
    else if (ENDUNGEN.includes(extname(e))) treffer.push(p)
  }
  return treffer
}

/** Löst einen Import-Pfad auf eine Datei auf — mit denselben Regeln, die auch
 *  der Bundler anwendet: erst die Datei selbst, dann mit Endung, dann als
 *  Ordner mit index. Ohne das gälte jeder Ordner-Import als unauflösbar und
 *  ganze Zweige fielen fälschlich als tot heraus. */
function aufloesen(vonDatei, spez) {
  if (!spez.startsWith('.')) return null      // Paket aus node_modules
  const basis = resolve(dirname(vonDatei), spez)
  const kandidaten = [
    basis,
    ...ENDUNGEN.map((e) => basis + e),
    ...ENDUNGEN.map((e) => join(basis, 'index' + e)),
  ]
  for (const k of kandidaten) {
    if (existsSync(k) && statSync(k).isFile()) return k
  }
  return null
}

/** Alle Import-Ziele einer Datei. Erfasst statische Importe, Re-Exporte und
 *  dynamisches import() — letzteres, weil ein lazy geladener Zweig sonst
 *  fälschlich als tot gälte. Typ-Importe zählen mit: eine Datei, die nur Typen
 *  liefert, ist nicht tot, sie wird nur zur Bauzeit gebraucht. */
function importe(datei) {
  const text = readFileSync(datei, 'utf-8')
  const ziele = []
  const muster = [
    /\bfrom\s+['"]([^'"]+)['"]/g,          // import … from '…'  /  export … from '…'
    /\bimport\s+['"]([^'"]+)['"]/g,        // import '…'  (Nebenwirkung, z. B. CSS)
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamisches import('…')
  ]
  for (const m of muster) {
    for (const treffer of text.matchAll(m)) ziele.push(treffer[1])
  }
  return ziele
}

// ── Graph vom Einstieg aus aufspannen ───────────────────────────────────────

const erreichbar = new Set()
const stapel = EINSTIEGE.map((e) => join(ROOT, e)).filter(existsSync)
if (!stapel.length) {
  console.error('Kein Einstiegspunkt gefunden:', EINSTIEGE.join(', '))
  process.exit(2)
}

while (stapel.length) {
  const datei = stapel.pop()
  if (erreichbar.has(datei)) continue
  erreichbar.add(datei)
  for (const spez of importe(datei)) {
    const ziel = aufloesen(datei, spez)
    if (ziel && !erreichbar.has(ziel)) stapel.push(ziel)
  }
}

const alle = alleQuellen(SRC)
const unerreichbar = alle
  .filter((f) => !erreichbar.has(f))
  .map((f) => ({ datei: relative(ROOT, f), zeilen: readFileSync(f, 'utf-8').split('\n').length }))
  .sort((a, b) => b.zeilen - a.zeilen)

const gewollt = unerreichbar.filter((v) => GEWOLLT[v.datei])
const verwaist = unerreichbar.filter((v) => !GEWOLLT[v.datei])

const summe = verwaist.reduce((a, v) => a + v.zeilen, 0)
const gesamt = alle.reduce((a, f) => a + readFileSync(f, 'utf-8').split('\n').length, 0)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ verwaist, gewollt, summe, gesamt }, null, 2))
  process.exit(verwaist.length ? 1 : 0)
}

console.log('')
// Nur Dateien unter src/ vergleichen. `erreichbar` enthält auch CSS und
// electron/tone.json — die zusammenzuzählen ergab "86 erreichbar, 83
// vorhanden", also mehr Erreichbares als Vorhandenes. Eine Zahl, die sich
// selbst widerspricht, ist schlimmer als keine.
const erreichbarInSrc = alle.filter((f) => erreichbar.has(f)).length
console.log(`  Einstieg: ${EINSTIEGE.join(', ')}`)
console.log(`  ${erreichbarInSrc} von ${alle.length} Dateien unter src/ sind erreichbar.`)
console.log('')
for (const g of gewollt) {
  console.log(`  · ${g.datei} (${g.zeilen} Zeilen) — gewollt unerreichbar:`)
  console.log(`      ${GEWOLLT[g.datei]}`)
}
if (gewollt.length) console.log('')
if (!verwaist.length) {
  console.log('  ✓ Nichts Verwaistes. Alles unter src/ ist erreichbar oder ausdrücklich als gewollt vermerkt.')
  console.log('')
  process.exit(0)
}
const breite = Math.max(...verwaist.map((v) => v.datei.length))
for (const v of verwaist) {
  console.log(`  ✖ ${v.datei.padEnd(breite)}  ${String(v.zeilen).padStart(5)} Zeilen`)
}
console.log('')
console.log(`  ${verwaist.length} Datei(en), ${summe} Zeilen — ${(100 * summe / gesamt).toFixed(1)} % des Quelltexts unter src/.`)
console.log('  Wird nicht ausgeliefert, kostet aber jede Suche und jeden Überblick.')
console.log('')
process.exit(1)
