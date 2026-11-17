#!/usr/bin/env node
// Schiebt die Claude-Abo-Quote vom Mac auf den Daily-Server.
//
// WARUM ES DIESES SKRIPT GIBT
// Daily läuft produktiv auf der Linux-VM, die echte Quote hängt aber am
// OAuth-Login von Claude Code — und der liegt im macOS-Schlüsselbund. Die VM
// kommt da nicht heran, die Anzeige blieb deshalb dauerhaft leer.
//
// WARUM NICHT DEN TOKEN AUF DIE VM LEGEN
// Weil er ROTIERT. Erneuert ihn die VM, ist die Kopie auf dem Mac tot und
// Claude Code dort ausgeloggt. Zwei Maschinen an einem rotierenden Token
// schließen sich gegenseitig aus. Also rechnet der Mac die Prozentzahlen hier
// selbst aus und überträgt NUR das Ergebnis — der Token bleibt, wo er hingehört.
//
// WAS ES SONST NOCH SCHIEBT
// Dasselbe Problem hat das Codex-Abo: Plan und Laufzeit stehen im Anmeldetoken
// unter ~/.codex/auth.json, den es auf der VM nicht gibt. Der Verbrauch ist bei
// OpenAI gar nicht abrufbar (403 hinter Cloudflares Botabwehr), Plan und
// Laufzeit dagegen ohne jede Netzanfrage — sie stehen im Token selbst.
//
// WARUM BEIDE HÄLFTEN GETRENNT LAUFEN
// Vorher warf ein fehlender Claude-Login sofort, und damit wurde auch alles
// andere nicht mehr geschickt. Genau so ist es passiert: seit dem 22.08. war
// die Claude-Anmeldung tot, und acht Tage lang kam gar nichts mehr an. Jede
// Hälfte scheitert deshalb für sich allein.
//
// Aufruf:  node scripts/push-claude-usage.mjs [--url http://…] [--einmal]
// Ohne --einmal läuft es dauerhaft und schiebt alle 15 Minuten.

import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { getClaudePlanUsage } = require(join(ROOT, 'electron', 'usageStats.cjs'))

const INTERVAL_MS = 15 * 60 * 1000

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Zieladresse und Token: erst Umgebung, dann remote.json (dieselbe Datei, aus
 *  der die Mac-App weiß, welchen Server sie anzeigt), dann die lokale .env. */
function ziel() {
  let url = arg('--url') || process.env.DAILY_REMOTE_URL || ''
  if (!url) {
    try {
      const p = join(homedir(), 'Library', 'Application Support', 'Daily', 'remote.json')
      const raw = JSON.parse(readFileSync(p, 'utf-8'))
      if (typeof raw.url === 'string') url = raw.url.trim()
    } catch { /* keine Datei — dann muss --url her */ }
  }
  let token = process.env.HERMES_TOKEN || ''
  if (!token) {
    try {
      const m = readFileSync(join(ROOT, '.env'), 'utf-8').match(/^HERMES_TOKEN=(.+)$/m)
      if (m) token = m[1].trim()
    } catch { /* dito */ }
  }
  return { url: url.replace(/\/+$/, ''), token }
}

async function put(url, token, pfad, nutzlast) {
  const res = await fetch(url + pfad, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(nutzlast),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Server antwortete ${res.status}: ${(await res.text()).slice(0, 120)}`)
}

async function schiebeClaude(url, token) {
  const plan = await getClaudePlanUsage()
  if (!plan) throw new Error('Keine Quote lesbar — Anmeldung abgelaufen? Im Terminal: claude, dann /login.')
  await put(url, token, '/api/hermes/claude-usage', {
    usedPct: plan.usedPct,
    resetAt: plan.resetAt,
    fiveHourUsedPct: plan.fiveHourUsedPct,
    planName: plan.planName,
  })
  return `Claude ${plan.usedPct}%` + (plan.fiveHourUsedPct != null ? ` (5h ${plan.fiveHourUsedPct}%)` : '')
}

/** Nutzlast eines JWT lesen. Rein lokal — keine Prüfung der Signatur, weil hier
 *  nichts autorisiert wird: die Angaben stammen aus einer Datei, die ohnehin
 *  nur Paul lesen kann, und werden nur angezeigt. */
function jwtNutzlast(t) {
  const teil = String(t).split('.')[1]
  if (!teil) throw new Error('kein JWT')
  return JSON.parse(Buffer.from(teil.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'))
}

const CODEX_PFAD = join(homedir(), '.codex', 'auth.json')
// Die Abo-Angaben liegen im Token unter einem Namensraum-Schlüssel. Der ist
// je nach Ausgabe entweder ein verschachteltes Objekt ODER flach mit Punkt im
// Schlüsselnamen — beides kommt vor, also beides lesen.
const OAI = 'https://api.openai.com/auth'

function oai(nutzlast, feld) {
  const raum = nutzlast[OAI]
  if (raum && typeof raum === 'object' && raum[feld] !== undefined) return raum[feld]
  return nutzlast[`${OAI}.${feld}`]
}

// ── Codex-Verbrauch aus den Sitzungsprotokollen ─────────────────────────────
// Über die API geht es nicht (403 hinter Cloudflare). Die Codex-CLI bekommt die
// Werte aber bei JEDER Anfrage mitgeliefert und schreibt sie in ihr
// Sitzungsprotokoll. Von dort zu lesen ist kein Umweg, sondern die einzige
// ehrliche Quelle — sie stammt aus derselben Antwort, die auch die CLI sieht.
//
// WAS DAS KOSTET: die Zahl ist so frisch wie die letzte Codex-Nutzung. Wer eine
// Woche nicht mit Codex arbeitet, hat einen wochenalten Stand. Deshalb geht der
// Zeitpunkt der Messung ausdrücklich mit — ohne ihn wäre die Zahl eine
// Behauptung über heute, die in Wahrheit von letztem Dienstag stammt.
const SITZUNGEN = join(homedir(), '.codex', 'sessions')
const TAIL_BYTES = 512 * 1024
const MAX_DATEIEN = 5

function sitzungsDateien(dir, tiefe = 0) {
  let eintraege
  try { eintraege = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  const treffer = []
  for (const e of eintraege) {
    const p = join(dir, e.name)
    if (e.isDirectory() && tiefe < 3) treffer.push(...sitzungsDateien(p, tiefe + 1))
    else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
      try { treffer.push({ p, m: statSync(p).mtimeMs }) } catch { /* weg */ }
    }
  }
  return treffer
}

/** Nur das Ende der Datei lesen — die letzten Ereignisse stehen hinten, und
 *  ein Sitzungsprotokoll kann etliche Megabyte gross werden. */
function schwanz(pfad) {
  const fd = openSync(pfad, 'r')
  try {
    const groesse = fstatSync(fd).size
    const laenge = Math.min(groesse, TAIL_BYTES)
    const puffer = Buffer.alloc(laenge)
    readSync(fd, puffer, 0, laenge, groesse - laenge)
    return puffer.toString('utf-8')
  } finally { closeSync(fd) }
}

function findeGrenzwerte(o) {
  if (!o || typeof o !== 'object') return null
  if (o.rate_limits && o.rate_limits.secondary) return o.rate_limits
  for (const v of Object.values(o)) { const r = findeGrenzwerte(v); if (r) return r }
  return null
}

function codexVerbrauch() {
  const dateien = sitzungsDateien(SITZUNGEN).sort((a, b) => b.m - a.m).slice(0, MAX_DATEIEN)
  for (const f of dateien) {
    let letzte = null
    let gemessenAm = null
    for (const zeile of schwanz(f.p).split('\n')) {
      if (!zeile.includes('rate_limits')) continue
      try {
        const o = JSON.parse(zeile)
        const r = findeGrenzwerte(o)
        if (r) { letzte = r; gemessenAm = typeof o.timestamp === 'string' ? o.timestamp : null }
      } catch { /* halbe Zeile am Schnittrand — erwartbar */ }
    }
    if (letzte) {
      return {
        wocheProzent: letzte.secondary?.used_percent ?? null,
        fuenfStundenProzent: letzte.primary?.used_percent ?? null,
        resetAt: letzte.secondary?.resets_at ? new Date(letzte.secondary.resets_at * 1000).toISOString() : null,
        gemessenAm: gemessenAm || new Date(f.m).toISOString(),
      }
    }
  }
  return null
}

async function schiebeCodex(url, token) {
  let doc
  try { doc = JSON.parse(readFileSync(CODEX_PFAD, 'utf-8')) } catch {
    throw new Error('~/.codex/auth.json nicht lesbar — ist Codex hier angemeldet?')
  }
  const roh = doc && doc.tokens && doc.tokens.id_token
  if (!roh) throw new Error('~/.codex/auth.json enthält kein id_token.')
  const p = jwtNutzlast(roh)
  const plan = oai(p, 'chatgpt_plan_type')
  if (!plan) throw new Error('Im Codex-Token steht kein Plan.')
  const verbrauch = codexVerbrauch()
  await put(url, token, '/api/hermes/codex-abo', {
    plan,
    laufzeitAb: oai(p, 'chatgpt_subscription_active_start') || null,
    laufzeitBis: oai(p, 'chatgpt_subscription_active_until') || null,
    standVon: doc.last_refresh || null,
    verbrauch,
  })
  return `Codex ${plan}` + (verbrauch ? ` ${verbrauch.wocheProzent}%` : ' (kein Verbrauch gemessen)')
}

async function einmal() {
  const zeit = new Date().toLocaleTimeString('de-DE')
  const { url, token } = ziel()
  if (!url || !token) {
    console.error(`  ${zeit}  ✖ ${!url ? 'Keine Zieladresse — --url setzen oder remote.json anlegen.' : 'Kein HERMES_TOKEN — in die Umgebung oder .env legen.'}`)
    return false
  }
  // Beide Hälften unabhängig: eine tote Claude-Anmeldung darf das Codex-Abo
  // nicht mit verstummen lassen.
  const ergebnisse = await Promise.allSettled([schiebeClaude(url, token), schiebeCodex(url, token)])
  const gut = ergebnisse.filter((r) => r.status === 'fulfilled')
  const schlecht = ergebnisse.filter((r) => r.status === 'rejected')
  if (gut.length) console.log(`  ${zeit}  ✓ ${gut.map((r) => r.value).join(' · ')}`)
  for (const r of schlecht) console.error(`  ${zeit}  ✖ ${r.reason.message}`)
  return schlecht.length === 0
}

const ok = await einmal()
if (process.argv.includes('--einmal')) {
  process.exit(ok ? 0 : 1)
}
// Dauerbetrieb: ein Fehlschlag beendet nichts — der Mac schläft nun mal
// zwischendurch, und beim nächsten Durchlauf klappt es wieder.
setInterval(() => { void einmal() }, INTERVAL_MS)
