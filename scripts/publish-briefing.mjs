#!/usr/bin/env node
// Der einzige Weg, auf dem Hermes ein Briefing veröffentlichen soll.
//
// WARUM ES DIESES SKRIPT GIBT
// Am 15.08. meldete Hermes "erledigt". Der Server hatte 200 geantwortet, das
// Briefing lag auf der Platte — und im Dashboard stand nichts, weil es auf
// morgen datiert war. Niemand log: ein 2xx bedeutet nur "angenommen", nicht
// "sichtbar". Wer aus einem HTTP-Status auf Erfolg schliesst, wird genau so
// wieder danebenliegen.
//
// Dieses Skript nimmt Hermes diese Schlussfolgerung ab. Es kennt genau fünf
// Aussagen und trifft sie anhand von Belegen, nicht anhand von Statuscodes:
//
//   persisted-and-verified   serverseitig geschrieben UND zurückgelesen
//   scheduled                für später eingeplant, heute nicht sichtbar
//   rendered                 ein Browser hat die Revision bestätigt
//   persisted-not-displayed  geschrieben, Anzeige nicht bestätigt
//   rejected                 abgelehnt, mit Grund
//
// WARUM DIE EINGABE ÜBER stdin KOMMT
// Weder der Briefingtext noch das Token dürfen in der Prozessliste stehen.
// `ps aux` sieht jedes Argument — auf einer Maschine, auf der mehrere Dienste
// laufen, ist das der bequemste Weg, ein Token abzugreifen.
//
// Aufruf:
//   echo '{"text":"…","lines":{…}}' | node scripts/publish-briefing.mjs
//   … | node scripts/publish-briefing.mjs --wait-render 20
//
// Ausgabe: eine Zeile sekretfreies JSON auf stdout. Exit 0 nur, wenn der
// Server das Geschriebene zurückgelesen hat.

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ENV_FILE = '/etc/daily/env'
const TIMEOUT_MS = 20_000

// ── Konfiguration ───────────────────────────────────────────────────────────

let envFile = ''
try { envFile = readFileSync(ENV_FILE, 'utf-8') } catch { /* nicht auf der VM */ }

function conf(name) {
  const v = process.env[name]
  if (v && v.trim()) return v.trim()
  const m = envFile.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim() : undefined
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function baseUrl() {
  const explizit = arg('--url', null)
  if (explizit) return explizit.replace(/\/+$/, '')
  const port = conf('PORT') || '4861'
  const host = conf('DAILY_HOST')
  // Wie im Rauchtest: auf der VM bindet der Dienst an die Tailscale-Adresse
  // und ist unter 127.0.0.1 gar nicht erreichbar.
  if (host && host !== '127.0.0.1' && host !== 'localhost') return `http://${host}:${port}`
  return `http://127.0.0.1:${port}`
}

const BASE = baseUrl()
const TOKEN = conf('HERMES_TOKEN')

// ── Ausgabe ─────────────────────────────────────────────────────────────────

/** Eine Zeile JSON, garantiert ohne Geheimnisse. Was hier steht, darf Hermes
 *  wörtlich in seine Abschlussmeldung übernehmen. */
function raus(outcome, receipt, extra = {}) {
  const zeile = { outcome, ...extra }
  if (receipt) {
    zeile.receipt = {
      receiptId: receipt.receiptId,
      requestId: receipt.requestId,
      operation: receipt.operation,
      result: receipt.result,
      serverDate: receipt.serverDate,
      effectiveDate: receipt.effectiveDate,
      persistedAt: receipt.persistedAt,
      storedSha256: receipt.storedSha256,
      transformations: receipt.transformations,
      preservedFields: receipt.preservedFields,
      discardedAlert: receipt.discardedAlert,
      display: receipt.display,
      status: receipt.status,
      verifyUrl: receipt.verifyUrl,
    }
  }
  process.stdout.write(JSON.stringify(zeile) + '\n')
}

function abbruch(grund, extra = {}) {
  raus('rejected', null, { reason: grund, ...extra })
  process.exit(1)
}

// ── Eingabe ─────────────────────────────────────────────────────────────────

async function lesStdin() {
  if (process.stdin.isTTY) return null
  const teile = []
  for await (const c of process.stdin) teile.push(c)
  const roh = Buffer.concat(teile).toString('utf-8').trim()
  if (!roh) return null
  return JSON.parse(roh)
}

// ── Hauptlauf ───────────────────────────────────────────────────────────────

async function main() {
  if (!TOKEN) abbruch('HERMES_TOKEN ist nicht gesetzt — ohne Token nimmt die Schnittstelle nichts an.')

  let eingabe
  try {
    eingabe = await lesStdin()
  } catch (e) {
    abbruch('Eingabe ist kein gültiges JSON: ' + e.message)
  }
  if (!eingabe) abbruch('Keine Eingabe auf stdin. Erwartet: {"text":"…","lines":{…}} als JSON.')

  // Das Datum setzt der WRAPPER, nicht der Aufrufer — und zwar aus der
  // Serverantwort, nicht aus eigener Rechnung. Genau hier lag der Fehler vom
  // 15.08.: ein selbst gerechnetes Datum, einen Tag daneben. Der Server ist
  // die Autorität; wir fragen ihn.
  let serverDate
  try {
    const res = await fetch(`${BASE}/api/hermes/briefing`, {
      headers: { Authorization: 'Bearer ' + TOKEN },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) abbruch(`Server antwortete beim Datumsabruf ${res.status}.`)
    serverDate = (await res.json()).serverDate
  } catch (e) {
    abbruch('Server nicht erreichbar: ' + e.message, { base: BASE })
  }
  if (!serverDate) abbruch('Server nannte kein serverDate — veraltete Version auf der VM?')

  // Ein ausdrücklich mitgegebenes Datum wird geprüft, nicht übernommen: sonst
  // wäre der Wrapper nur eine bequemere Art, denselben Fehler zu machen.
  if (eingabe.date && eingabe.date !== serverDate && eingabe.mode !== 'scheduled') {
    abbruch(
      `Eingabe ist auf ${eingabe.date} datiert, der Server steht auf ${serverDate}. ` +
      'Für heute das Feld weglassen, für Vorplanung mode:"scheduled" setzen.',
      { serverDate },
    )
  }

  const requestId = eingabe.requestId || `hermes-${serverDate}-${randomUUID().slice(0, 8)}`
  const payload = { ...eingabe, date: eingabe.date || serverDate, requestId }

  // ── Veröffentlichen ──
  let antwort, status
  try {
    const res = await fetch(`${BASE}/api/hermes/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    status = res.status
    antwort = await res.json()
  } catch (e) {
    abbruch('POST fehlgeschlagen: ' + e.message)
  }

  if (status === 202 && antwort.receipt) {
    raus('scheduled', antwort.receipt, { note: 'Für später eingeplant — heute NICHT sichtbar.' })
    process.exit(0)
  }
  if (status !== 200 || !antwort.ok) {
    abbruch(antwort.error || `Server antwortete ${status}.`, { httpStatus: status, steht: antwort.steht })
  }
  const receipt = antwort.receipt
  if (!receipt || !receipt.storedSha256) {
    abbruch('Antwort enthielt keine brauchbare Quittung — veraltete Version auf der VM?')
  }

  // ── NACHPRÜFEN — der Schritt, den ein 2xx nicht ersetzt ──
  // Der Server hat selbst zurückgelesen, bevor er 200 sagte. Wir prüfen ein
  // zweites Mal über einen eigenen Aufruf: erst wenn die Quittung gegen den
  // AKTUELLEN Bestand "current" meldet, ist das Geschriebene auch das, was
  // dasteht — und nicht längst von etwas anderem überschrieben.
  let verify
  try {
    const res = await fetch(`${BASE}${receipt.verifyUrl}`, {
      headers: { Authorization: 'Bearer ' + TOKEN },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    verify = await res.json()
  } catch (e) {
    abbruch('Quittung liess sich nicht nachprüfen: ' + e.message, { receiptId: receipt.receiptId })
  }

  if (verify.status === 'missing') abbruch('Nach dem Schreiben steht gar kein Briefing mehr da.', { receiptId: receipt.receiptId })
  if (verify.status === 'superseded') {
    abbruch('Ein anderes Briefing hat das eben geschriebene bereits ersetzt.',
      { receiptId: receipt.receiptId, storedSha256: receipt.storedSha256, currentSha256: verify.currentSha256 })
  }
  if (verify.currentSha256 !== receipt.storedSha256) {
    abbruch('Der Hash im Bestand weicht ab.', { erwartet: receipt.storedSha256, gelesen: verify.currentSha256 })
  }

  // ── Optional: kurz auf die Browser-Bestätigung warten ──
  // Fehlt sie, ist das KEIN Fehler — ein geschlossenes Daily kann nichts
  // anzeigen. Die Aussage lautet dann ehrlich "persistiert, Anzeige nicht
  // bestätigt" statt fälschlich "erledigt".
  const wartenSek = Number(arg('--wait-render', 0))
  if (wartenSek > 0) {
    const bis = Date.now() + wartenSek * 1000
    while (Date.now() < bis) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const res = await fetch(`${BASE}${receipt.verifyUrl}`, {
          headers: { Authorization: 'Bearer ' + TOKEN },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const v = await res.json()
        if (v.status === 'rendered') { raus('rendered', v); process.exit(0) }
        verify = v
      } catch { /* weiter versuchen */ }
    }
  }

  raus(
    wartenSek > 0 ? 'persisted-not-displayed' : 'persisted-and-verified',
    verify,
    wartenSek > 0
      ? { note: `Kein Browser hat die Revision innerhalb von ${wartenSek}s bestätigt. Gespeichert ist sie.` }
      : {},
  )
  process.exit(0)
}

main().catch((e) => abbruch('Unerwarteter Fehler: ' + (e && e.message)))
