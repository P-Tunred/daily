#!/usr/bin/env node
// MCP-Brücke zu Hermes — macht den Agenten auf der VM als Werkzeug verfügbar.
//
// WARUM ZWEI WERKZEUGE STATT EINEM
// Hermes läuft auf der VM als root und hat Zugriff auf Googlekonto, Mailarchiv
// und Kalender. Zwischen "sag mir, wann deine Cron-Jobs laufen" und "lösch die
// Mails von gestern" liegt derselbe Aufruf — nur der Satz dazwischen ist anders.
// Ein einziges Werkzeug könnte das nicht unterscheiden, und ein Modell, das
// gerade eine Aufgabe abarbeitet, würde die Grenze verwischen.
//
// Deshalb: `hermes_ask` fragt, `hermes_do` verändert. `hermes_do` verlangt eine
// Begründung im Aufruf und schreibt Auftrag samt Begründung nach
// ~/.hermes-bridge.log. Das ist keine technische Sperre — beide Wege landen bei
// derselben Binärdatei — sondern eine Trennung, die im Nachhinein beantwortbar
// macht, wer was veranlasst hat. Wer verändert, ohne es zu benennen, muss dafür
// lügen statt nur nachlässig zu sein.
//
// AUFRUFFORM
// Ein nacktes `hermes "<frage>"` funktioniert NICHT — argparse lehnt den
// unbekannten Unterbefehl mit einer Usage-Meldung ab. Richtig ist `-z/--oneshot`:
// laut Hilfe "print ONLY the final response text to stdout … Intended for
// scripts / pipes". Genau das brauchen wir hier.
//
// stdout gehört dem MCP-Protokoll. Alles Diagnostische geht nach stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SSH_TARGET = process.env.HERMES_SSH_TARGET || 'root@your-server.example'
const LOG_PATH = process.env.HERMES_BRIDGE_LOG || join(homedir(), '.hermes-bridge.log')

const ASK_TIMEOUT_MS = 120_000
// Für Aufträge großzügiger: eine Änderung, die Hermes erst recherchieren und
// dann ausführen muss, ist regelmäßig langsamer als eine Auskunft. Über
// HERMES_DO_TIMEOUT_MS anpassbar.
const DO_TIMEOUT_MS = Number(process.env.HERMES_DO_TIMEOUT_MS) || 300_000
const MAX_OUTPUT = 4 * 1024 * 1024

// ── SSH ─────────────────────────────────────────────────────────────────────

/** Bettet beliebigen Text als EIN Argument in eine entfernte Shell-Zeile ein.
 *
 *  Das ist die wichtigste Zeile in dieser Datei. `ssh host cmd a b c` klebt die
 *  restlichen Argumente zusammen und übergibt sie der Shell auf der GEGENSEITE —
 *  ein zweites Mal geparst, egal wie sauber wir hier execFile benutzen. Eine
 *  Frage wie  Was läuft?; rm -rf /  käme dort als zwei Befehle an, ausgeführt
 *  als root. In einfachen Anführungszeichen ist dagegen jedes Zeichen literal;
 *  nur das Anführungszeichen selbst muss ausgebrochen werden ('\''). */
function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'"
}

function runHermes(prompt, timeoutMs) {
  const remote = `hermes -z ${shellQuote(prompt)}`
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(
      'ssh',
      [
        '-o', 'BatchMode=yes',       // nie interaktiv nach einem Passwort fragen
        '-o', 'ConnectTimeout=10',   // toter Host soll sofort scheitern, nicht das ganze Zeitlimit hängen
        SSH_TARGET,
        remote,
      ],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT },
      (err, stdout, stderr) => {
        const dauerMs = Date.now() - started
        if (err) {
          const abgebrochen = err.killed === true || err.signal != null
          const grund = abgebrochen
            ? `Zeitlimit von ${Math.round(timeoutMs / 1000)}s überschritten — Hermes hat nicht rechtzeitig geantwortet.`
            : (String(stderr || '').trim() || err.message)
          resolve({ ok: false, text: grund, dauerMs })
          return
        }
        const text = String(stdout || '').trim()
        // Leeres stdout bei Exit 0 ist kein Erfolg, sondern ein stiller Fehlschlag.
        if (!text) {
          resolve({ ok: false, text: String(stderr || '').trim() || 'Hermes hat nichts zurückgegeben.', dauerMs })
          return
        }
        resolve({ ok: true, text, dauerMs })
      },
    )
  })
}

// ── Protokoll ───────────────────────────────────────────────────────────────

function schreibe(zeilen) {
  try {
    appendFileSync(LOG_PATH, zeilen, 'utf-8')
  } catch (e) {
    // Nicht nach stdout — das gehört dem Protokoll der MCP-Verbindung.
    console.error('[hermes-bridge] Protokoll nicht schreibbar:', e.message)
  }
}

function einrücken(text) {
  return String(text).split('\n').map((z) => '             ' + z).join('\n').trimStart()
}

/** Hält den Auftrag fest, BEVOR er läuft.
 *
 *  Ein Protokoll, das nur fertige Läufe kennt, ist als Nachweis wertlos: genau
 *  der Aufruf, der die VM lahmlegt oder ins Zeitlimit rennt, stünde nicht drin.
 *  Deshalb erst schreiben, dann ausführen — und das Ergebnis danach anhängen. */
function protokolliereAuftrag(auftrag, begruendung) {
  const ts = new Date().toISOString()
  schreibe(
    `\n─── ${ts} ${'─'.repeat(40)}\n` +
    `  AUFTRAG    : ${einrücken(auftrag)}\n` +
    `  BEGRÜNDUNG : ${einrücken(begruendung)}\n` +
    `  ZIEL       : ${SSH_TARGET}\n`,
  )
}

/** Hält auch fest, was NICHT ausgeführt wurde.
 *
 *  Ein abgelehnter Versuch ist die interessantere Zeile von beiden: er zeigt,
 *  dass etwas verändert werden sollte, ohne dass jemand es benennen wollte.
 *  Stünde nur das Gelungene im Protokoll, wäre genau das unsichtbar. */
function protokolliereAblehnung(auftrag, grund) {
  const ts = new Date().toISOString()
  schreibe(
    `\n─── ${ts} ${'─'.repeat(40)}\n` +
    `  ABGELEHNT  : ${einrücken(auftrag || '(kein Auftrag angegeben)')}\n` +
    `  GRUND      : ${grund}\n`,
  )
}

function protokolliereErgebnis(ergebnis) {
  const sek = (ergebnis.dauerMs / 1000).toFixed(1)
  const stand = ergebnis.ok ? `ok (${sek}s, ${ergebnis.text.length} Zeichen)` : `FEHLGESCHLAGEN (${sek}s) — ${ergebnis.text}`
  schreibe(`  ERGEBNIS   : ${einrücken(stand)}\n`)
}

// ── Werkzeuge ───────────────────────────────────────────────────────────────

const WERKZEUGE = [
  {
    name: 'hermes_ask',
    description:
      'Stellt Hermes eine Frage und gibt die Antwort zurück. NUR für Auskünfte — ' +
      'Hermes soll dabei nichts anlegen, ändern oder löschen. Hermes kennt den Server, ' +
      'seine eigenen Cron-Jobs, das Mailarchiv und den Kalender. Zeitlimit 120 Sekunden.',
    inputSchema: {
      type: 'object',
      properties: {
        frage: { type: 'string', description: 'Die Frage an Hermes, in natürlicher Sprache.' },
      },
      required: ['frage'],
      additionalProperties: false,
    },
  },
  {
    name: 'hermes_do',
    description:
      'Lässt Hermes etwas TUN, das einen Zustand verändert (anlegen, ändern, löschen, ' +
      'verschicken, Cron-Jobs anfassen). Hermes läuft als root mit Zugriff auf Googlekonto, ' +
      'Mailarchiv und Kalender. Auftrag und Begründung werden mit Zeitstempel nach ' +
      '~/.hermes-bridge.log protokolliert. Für reine Auskünfte hermes_ask benutzen.',
    inputSchema: {
      type: 'object',
      properties: {
        auftrag: { type: 'string', description: 'Was Hermes tun soll, in natürlicher Sprache.' },
        begruendung: {
          type: 'string',
          description: 'Warum das nötig ist und auf wessen Wunsch. Landet im Protokoll.',
        },
      },
      required: ['auftrag', 'begruendung'],
      additionalProperties: false,
    },
  },
]

function text(inhalt, fehler = false) {
  return { content: [{ type: 'text', text: inhalt }], isError: fehler }
}

function pflichtfeld(args, name) {
  const wert = args?.[name]
  if (typeof wert !== 'string' || !wert.trim()) {
    throw new Error(`Feld "${name}" fehlt oder ist leer.`)
  }
  return wert.trim()
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'hermes-bridge', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: WERKZEUGE }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'hermes_ask') {
    let frage
    try { frage = pflichtfeld(args, 'frage') } catch (e) { return text(e.message, true) }
    const ergebnis = await runHermes(frage, ASK_TIMEOUT_MS)
    return ergebnis.ok ? text(ergebnis.text) : text('Hermes nicht erreichbar: ' + ergebnis.text, true)
  }

  if (name === 'hermes_do') {
    let auftrag, begruendung
    try {
      auftrag = pflichtfeld(args, 'auftrag')
      // Die Begründung ist Pflicht, nicht Zierde: ohne sie wird gar nicht erst
      // ausgeführt, sonst wäre das Protokoll voller namenloser Eingriffe.
      begruendung = pflichtfeld(args, 'begruendung')
    } catch (e) {
      protokolliereAblehnung(args?.auftrag, e.message)
      return text(e.message + ' hermes_do führt ohne Begründung nichts aus.', true)
    }
    protokolliereAuftrag(auftrag, begruendung)
    const ergebnis = await runHermes(auftrag, DO_TIMEOUT_MS)
    protokolliereErgebnis(ergebnis)
    return ergebnis.ok ? text(ergebnis.text) : text('Auftrag fehlgeschlagen: ' + ergebnis.text, true)
  }

  return text(`Unbekanntes Werkzeug: ${name}`, true)
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[hermes-bridge] bereit — Ziel ${SSH_TARGET}, Protokoll ${LOG_PATH}`)
