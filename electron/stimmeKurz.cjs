// Die Stimme für kurze Antworten — POST /api/stimme/vorlesen { text } → MP3.
// Seit 2026-11-02 liest sie Hermes' Antworten im Gespräch vor
// (components/HermesStimme.tsx), Satz für Satz.
//
// WARUM NICHT GEMINI WIE BEIM HÖRBRIEFING
// Gemini klingt natürlicher, aber die Gratisstufe erlaubt drei Anfragen pro
// Minute — und die braucht das Hörbriefing am Morgen selbst. Eine Antwort im
// Gespräch muss in ein, zwei Sekunden da sein, nicht nach einer Minute
// Wartezeit. Deshalb hier Seraphina (Microsoft Edge), dieselbe Stimme, die
// beim Hörbriefing als Reserve spricht: kein Schlüssel, keine Kosten, schnell.
// Der Text geht dafür an Microsofts Sprachdienst — wie beim Hörbriefing.
//
// SEIT 2026-11-03 ZUERST ELEVENLABS
// Natürlicher, ebenfalls gratis (10 000 Zeichen im Monat), siehe
// stimmeEleven.cjs. Ohne Schlüssel oder mit leerem Kontingent spricht wie
// bisher Seraphina.
//
// Klappt es nicht, antwortet der Endpunkt mit einem Fehler und der Browser
// spricht selbst (speechSynthesis). Eine Antwort ohne Ton ist kein Ausfall.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const stimmeEleven = require('./stimmeEleven.cjs')

const MAX_ZEICHEN = 1500
const STIMME = () => process.env.DAILY_STIMME || 'de-DE-SeraphinaMultilingualNeural'
const ZEITLIMIT_MS = 20_000
// Die letzten Antworten im Speicher — „nochmal abspielen" soll nicht neu
// aufnehmen. Klein gehalten: es sind Sekunden-Schnipsel.
const CACHE_MAX = 12
const cache = new Map()

let sprecher = async (text, ziel) => {
  const { EdgeTTS } = require('node-edge-tts')
  await new EdgeTTS({
    voice: STIMME(), lang: 'de-DE', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', timeout: ZEITLIMIT_MS,
  }).ttsPromise(text, ziel)
}
let eleven = (text) => stimmeEleven.sprich(text)
let elevenDa = () => stimmeEleven.verfuegbar()
/** Nur für Tests: die Aufnahmen ersetzen. */
function _fuerTests({ sprich, elevenSprich, elevenVerfuegbar } = {}) {
  if (sprich) sprecher = sprich
  if (elevenSprich) eleven = elevenSprich
  if (elevenVerfuegbar) elevenDa = elevenVerfuegbar
  cache.clear()
}

/** Text fürs Ohr säubern: keine Markierungen, keine Regieanweisungen. */
function saeubere(text) {
  return String(text || '')
    .replace(/<[^>]{1,60}>/g, ' ')
    .replace(/[*_#`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ZEICHEN)
}

function merkeImCache(key, buf) {
  cache.set(key, buf)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

async function aufnahme(text) {
  const sauber = saeubere(text)
  if (sauber.length < 2) throw Object.assign(new Error('Kein Text zum Sprechen.'), { status: 400 })
  const schluesselFuer = (stimme) => crypto.createHash('sha256').update(stimme + '\n' + sauber).digest('hex')
  if (elevenDa()) {
    const ek = schluesselFuer(`eleven:${stimmeEleven.STIMME()}`)
    if (cache.has(ek)) return cache.get(ek)
    try {
      const buf = await eleven(sauber)
      merkeImCache(ek, buf)
      return buf
    } catch (e) {
      console.warn('[stimme] ElevenLabs, nehme Seraphina:', String((e && e.message) || e).slice(0, 160))
    }
  }
  const key = schluesselFuer(STIMME())
  if (cache.has(key)) return cache.get(key)
  const ziel = path.join(os.tmpdir(), `daily-stimme-${key.slice(0, 16)}-${crypto.randomUUID()}.mp3`)
  try {
    await sprecher(sauber, ziel)
    const buf = fs.readFileSync(ziel)
    if (buf.length < 500) throw new Error(`Aufnahme ist nur ${buf.length} Bytes groß`)
    merkeImCache(key, buf)
    return buf
  } finally {
    try { fs.unlinkSync(ziel) } catch { /* nichts da */ }
  }
}

async function handle(req, res) {
  const antworte = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(obj))
  }
  if (req.method !== 'POST') return antworte(405, { error: 'Nur POST.' })
  let roh = ''
  let input
  try {
    // Abgebrochener Upload wirft hier ECONNRESET — nicht den Server mitreissen.
    for await (const c of req) { roh += c; if (roh.length > 16_384) return antworte(413, { error: 'Zu lang.' }) }
    input = JSON.parse(roh)
  } catch { return antworte(400, { error: 'Ungültiges JSON oder Abbruch' }) }
  try {
    const buf = await aufnahme(input.text)
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
    res.end(buf)
  } catch (e) {
    console.warn('[stimme] Aufnahme fehlgeschlagen:', String((e && e.message) || e).slice(0, 160))
    antworte(e.status || 502, { error: String((e && e.message) || e).slice(0, 160) })
  }
}

module.exports = { handle, aufnahme, saeubere, MAX_ZEICHEN, _fuerTests }
