// Die natürliche Stimme fürs Hörbriefing: Google Gemini TTS.
//
// WARUM GEMINI
// Pauls Wunsch (2026-10-22): natürlicher als Seraphina, aber kostenlos. In der
// blinden Rangliste (Artificial Analysis Speech Arena) liegt Gemini 3.8 Flash
// TTS bei ~1278 Punkten, Seraphina (Azure Neural) bei ~1026 — ein deutlich
// hörbarer Abstand. Die Gratisstufe kostet nichts und braucht keine Karte.
// DER PREIS: In der Gratisstufe darf Google die Texte zum Verbessern seiner
// Produkte nutzen. Paul hat das so entschieden.
//
// WIE
// POST /v1beta/interactions, Doku: ai.google.dev/gemini-api/docs/speech-generation
// - Der Text wird absatzweise gesprochen (Google empfiehlt, lange Texte zu
//   teilen) und mit einer kurzen Pause zusammengesetzt — zwischen zwei Themen
//   klingt eine Pause ohnehin natürlicher als ein durchgesprochener Block.
// - Angefordert wird rohes PCM (audio/l16, 24 kHz, mono, 16 bit), damit sich
//   die Stücke einfach aneinanderhängen lassen; ffmpeg macht daraus eine MP3.
// - Die Sprechweise kommt als natürliche Anweisung (`speech_metadata.style`).
//   Inline-Zeichen wie <short pause> oder <laugh> darf Hermes in den Text
//   setzen; Gemini versteht sie, Seraphina nicht (dort werden sie entfernt).

const { spawn } = require('child_process')

const ENDPUNKT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const RATE = 24000                 // Hz, laut Doku
const PAUSE_SEK = 0.45             // zwischen zwei Stücken
// Die Gratisstufe erlaubt 3 Anfragen pro Minute (Googles 429-Meldung,
// 2026-10-22). Deshalb so WENIGE Anfragen wie möglich: Absätze werden zu
// grossen Stücken gebündelt — ein 5-Minuten-Briefing (~5000 Zeichen) braucht
// zwei. Innerhalb eines Stücks pausiert die Stimme an Absätzen von selbst.
const MAX_STUECK = 3500
const ABSTAND_MS = 21_000          // zwischen zwei Anfragen: unter 3 pro Minute
const MAX_WARTEN_MS = 65_000       // länger wartet ein 429 nicht
const VERSUCHE_BEI_429 = 3
const ZEITLIMIT_MS = 120_000

const modell = () => process.env.DAILY_GEMINI_MODELL || 'gemini-3.8-flash-tts'
const stimme = () => process.env.DAILY_GEMINI_STIMME || 'Sulafat'
const STANDARD_STIL =
  'Sprich warm, ruhig und natürlich, wie eine gute Freundin, die einem morgens beim Kaffee den Tag erzählt. ' +
  'Locker und zugewandt, nicht vorlesend; kleine Pausen zwischen den Themen, die Frage am Ende neugierig.'

/** Den Text in möglichst wenige Stücke teilen: ganze Absätze bündeln, bis
 *  ein Stück voll ist; nur ein einzelner zu langer Absatz wird an Sätzen
 *  geteilt. Nie mitten im Satz — eine Naht im Satz hört man. */
function stuecke(text, max = MAX_STUECK) {
  const absaetze = text.split(/\n{2,}/).map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const teile = []
  for (const a of absaetze) {
    if (a.length <= max) { teile.push(a); continue }
    let akt = ''
    for (const satz of a.match(/[^.!?]+[.!?]+["»«”’)]*\s*|[^.!?]+$/g) || [a]) {
      if (akt && (akt + satz).length > max) { teile.push(akt.trim()); akt = '' }
      akt += satz
    }
    if (akt.trim()) teile.push(akt.trim())
  }
  const out = []
  for (const t of teile) {
    const letzt = out.length - 1
    if (letzt >= 0 && out[letzt].length + 2 + t.length <= max) out[letzt] += '\n\n' + t
    else out.push(t)
  }
  return out
}

/** Die Audiodaten (base64) aus der Antwort — Pfad laut Doku:
 *  steps[type=model_output].content[type=audio].data, das letzte. */
function audioAusAntwort(j) {
  const teile = []
  for (const s of Array.isArray(j?.steps) ? j.steps : []) {
    if (s?.type !== 'model_output') continue
    for (const c of Array.isArray(s.content) ? s.content : []) if (c?.type === 'audio' && typeof c.data === 'string') teile.push(c.data)
  }
  if (!teile.length) return null
  return Buffer.from(teile[teile.length - 1], 'base64')
}

/** WAV-Kopf entfernen, falls Google doch WAV statt rohem PCM schickt. */
function nurPcm(buf) {
  if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    const data = buf.indexOf(Buffer.from('data'), 12)
    if (data > 0) return buf.subarray(data + 8)
  }
  return buf
}

/** Wie lange Google warten lassen will — aus „Please retry in 11s" oder dem
 *  Retry-After-Kopf. Ohne Angabe eine volle Minute (das Fenster der Grenze). */
function warteZeitAus(r, grund) {
  const kopf = Number(r?.headers?.get?.('retry-after'))
  const m = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(grund || '')
  const sek = Number.isFinite(kopf) && kopf > 0 ? kopf : m ? Number(m[1]) : 60
  return Math.min(MAX_WARTEN_MS, Math.ceil(sek * 1000) + 1500)
}

// Wann die letzte Anfrage rausging — über Aufrufe hinweg, damit auch ein
// zweiter Versuch die Grenze nicht reisst.
let letzteAnfrage = 0
let schlafe = (ms) => new Promise((r) => setTimeout(r, ms))
let jetzt = () => Date.now()
/** Nur für Tests: Uhr und Warten ersetzen. */
function _fuerTests({ schlaf, uhr } = {}) {
  if (schlaf) schlafe = schlaf
  if (uhr) jetzt = uhr
  letzteAnfrage = 0
}

async function sprichStueck(text, opt) {
  for (let v = 1; ; v++) {
    const bisher = jetzt() - letzteAnfrage
    if (letzteAnfrage && bisher < ABSTAND_MS) await schlafe(ABSTAND_MS - bisher)
    letzteAnfrage = jetzt()
    try {
      return await einmalSprechen(text, opt)
    } catch (e) {
      // Zu viele Anfragen: warten, wie lange Google sagt, und noch einmal —
      // statt sofort auf die schlichtere Reservestimme zu fallen.
      if (e.status !== 429 || v >= VERSUCHE_BEI_429) throw e
      await schlafe(e.warteMs)
    }
  }
}

async function einmalSprechen(text, { schluessel, stil, fetchFn }) {
  const r = await fetchFn(ENDPUNKT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': schluessel },
    body: JSON.stringify({
      model: modell(),
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: stil }] }] }],
      response_format: { type: 'audio', mime_type: 'audio/l16' },
      generation_config: { speech_config: [{ voice: stimme() }] },
    }),
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
  })
  if (!r.ok) {
    // Den Grund mitnehmen, aber nie den Schlüssel — der steht nur im Kopf.
    // Google schickt den Fehler als Liste ([{ error: … }]) — gefunden am
    // 2026-10-22, als „Schlüssel ungültig" nur als nacktes „400" ankam.
    let grund = ''
    try {
      const j = await r.json()
      const e = Array.isArray(j) ? j[0] : j
      grund = e?.error?.message || ''
    } catch { /* kein JSON */ }
    throw Object.assign(new Error(`Gemini antwortete ${r.status}${grund ? `: ${String(grund).slice(0, 160)}` : ''}`),
      { status: r.status, warteMs: r.status === 429 ? warteZeitAus(r, grund) : 0 })
  }
  const audio = audioAusAntwort(await r.json())
  if (!audio || audio.length < 1000) throw new Error('Gemini lieferte kein Audio')
  return nurPcm(audio)
}

/** Ganzer Text → PCM (16 bit, 24 kHz, mono), Stücke mit Pausen dazwischen. */
async function geminiPcm(text, { stil = STANDARD_STIL, schluessel = process.env.GEMINI_API_KEY, fetchFn = fetch } = {}) {
  if (!schluessel) throw new Error('GEMINI_API_KEY fehlt')
  const pause = Buffer.alloc(Math.round(RATE * PAUSE_SEK) * 2)
  const teile = []
  for (const [i, st] of stuecke(text).entries()) {
    if (i > 0) teile.push(pause)
    teile.push(await sprichStueck(st, { schluessel, stil, fetchFn }))
  }
  return Buffer.concat(teile)
}

/** PCM → MP3 über ffmpeg (auf der VM vorhanden). 64 kbit/s reichen für Sprache. */
function pcmZuMp3(pcm, ziel) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(RATE), '-ac', '1',
      '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', ziel])
    let err = ''
    ff.stderr.on('data', (d) => { err += d })
    ff.on('error', reject)
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`))))
    ff.stdin.end(pcm)
  })
}

/** Text → MP3 mit Gemini. Gibt die Dauer zurück (aus dem PCM, genau). */
async function geminiSprich(text, ziel, { stil } = {}) {
  const pcm = await geminiPcm(text, { stil: stil || STANDARD_STIL })
  await pcmZuMp3(pcm, ziel)
  return { dauerSek: Math.round(pcm.length / 2 / RATE) }
}

module.exports = { geminiSprich, geminiPcm, stuecke, audioAusAntwort, nurPcm, warteZeitAus, STANDARD_STIL, RATE, _fuerTests }
