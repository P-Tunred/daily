// Die natürlichere Stimme für kurze Antworten: ElevenLabs.
//
// WARUM
// Paul (2026-11-03): Seraphina klingt ihm nicht natürlich genug. Gemini wäre
// es, schafft gratis aber nur drei Anfragen pro Minute — und die braucht das
// Hörbriefing. ElevenLabs Flash v2.5 klingt natürlich, antwortet in einem
// Bruchteil einer Sekunde und hat eine Gratisstufe: 10 000 Zeichen im Monat,
// das sind gut 200 kurze Bestätigungen („Steht drauf: …"). Gratisstufe heisst:
// nur privat, mit Namensnennung — passt für ein persönliches Dashboard.
//
// WENN ES NICHT GEHT
// Kein Schlüssel → gar nicht erst versuchen. Monatskontingent leer oder
// Schlüssel abgelehnt → für ein paar Stunden pausieren; antwortet ElevenLabs
// zu langsam oder mit Fehler → zwei Minuten. Solange spricht wieder Seraphina
// (stimmeKurz.cjs) — keine Antwort soll auf einen hängenden Dienst warten.
// Der Text geht dafür an ElevenLabs.
//
// Den Schlüssel trägt Paul selbst ein: ELEVENLABS_API_KEY in /etc/daily/env.
// Die Stimme lässt sich mit ELEVENLABS_STIMME (eine voice_id) wechseln.

const URL_BASIS = 'https://api.elevenlabs.io/v1/text-to-speech'
const MODELL = () => process.env.ELEVENLABS_MODELL || 'eleven_flash_v2_5'
// „Sarah" aus den Standardstimmen — spricht Deutsch ohne starken Akzent.
const STIMME = () => process.env.ELEVENLABS_STIMME || 'EXAVITQu4vr4xnSDxMaL'
const ZEITLIMIT_MS = 4000
const PAUSE_MS = 6 * 3600_000          // Kontingent leer / Schlüssel abgelehnt
const KURZE_PAUSE_MS = 2 * 60_000      // langsam, überlastet, nicht erreichbar

let pausiertBis = 0

const schluessel = () => (process.env.ELEVENLABS_API_KEY || '').trim()

/** Nur für Tests. */
function _fuerTests() { pausiertBis = 0 }

function verfuegbar(jetzt = Date.now()) {
  return !!schluessel() && jetzt >= pausiertBis
}

/** Text → MP3 (Buffer). Wirft bei jedem Fehler; der Aufrufer fällt zurück. */
async function sprich(text, { fetchFn = fetch, jetzt = Date.now() } = {}) {
  if (!verfuegbar(jetzt)) throw new Error('ElevenLabs nicht verfügbar')
  try {
    return await anfrage(text, fetchFn, jetzt)
  } catch (e) {
    if (pausiertBis < jetzt) pausiertBis = jetzt + KURZE_PAUSE_MS
    throw e
  }
}

async function anfrage(text, fetchFn, jetzt) {
  const res = await fetchFn(`${URL_BASIS}/${encodeURIComponent(STIMME())}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', 'xi-api-key': schluessel() },
    body: JSON.stringify({
      text,
      model_id: MODELL(),
      language_code: 'de',
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    }),
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    // 401: Schlüssel falsch ODER Kontingent leer (quota_exceeded); 429: zu viel auf einmal.
    if (res.status === 401 || res.status === 402 || /quota/i.test(detail)) pausiertBis = jetzt + PAUSE_MS
    throw new Error(`ElevenLabs HTTP ${res.status}${/quota/i.test(detail) ? ' (Kontingent leer)' : ''}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 500) throw new Error(`ElevenLabs lieferte nur ${buf.length} Bytes`)
  return buf
}

module.exports = { sprich, verfuegbar, _fuerTests, STIMME }
