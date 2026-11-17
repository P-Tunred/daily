// Mit Hermes sprechen: was Paul sagt, als Text — POST /api/stimme/hoeren.
//
// WARUM faster-whisper AUF DER VM
// Hermes bringt es schon mit (für Sprachnachrichten in Telegram), samt ffmpeg:
// kein Schlüssel, keine Kosten, nichts verlässt die Maschine. Gemessen am
// 2026-11-02 auf den zwei Kernen der VM: Modell „base", elf Sekunden deutscher
// Sprache in 1,3 Sekunden, fehlerfrei. Die Spracherkennung des Browsers fällt
// aus: in Electron gibt es sie nicht, und im Browser ginge der Ton zu Google.
//
// WARUM EIN DAUERHAFTER PROZESS
// Das Modell zu laden dauert 3–14 Sekunden — bei jeder Anfrage neu wäre das
// länger als die Erkennung selbst. Der Prozess startet beim ersten Bedarf
// (GET /api/stimme beim Öffnen des Intros wärmt ihn an) und bleibt. Stirbt
// er, startet der nächste Auftrag ihn neu.
//
// PROTOKOLL (deploy/stimme/hoeren.py): eine JSON-Zeile je Auftrag hinein
// ({id, pfad}), eine JSON-Zeile je Ergebnis heraus ({id, text, sek} oder
// {id, fehler}). Die erste Zeile heraus ist {bereit: true}.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { dataDir } = require('./dataDir.cjs')

const PYTHON = () => process.env.DAILY_WHISPER_PYTHON || '/usr/local/lib/hermes-agent/venv/bin/python3'
const SKRIPT = () => process.env.DAILY_WHISPER_SKRIPT || path.join(__dirname, '..', 'deploy', 'stimme', 'hoeren.py')
const MODELL = () => process.env.DAILY_WHISPER_MODELL || 'base'
// Zwei Minuten Opus sind gut 1 MB; das Doppelte als Spielraum, mehr nicht.
const MAX_BYTES = 3 * 1024 * 1024
const ZEITLIMIT_MS = 60_000
const ENDUNG = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }

let prozess = null
let offen = new Map()   // id → { ok, nein, timer }
let letzterPfad = null

function bereit() {
  return fs.existsSync(PYTHON()) && fs.existsSync(SKRIPT())
}

function alleAbbrechen(grund) {
  for (const { nein, timer } of offen.values()) { clearTimeout(timer); nein(new Error(grund)) }
  offen = new Map()
}

function beiZeile(zeile) {
  let v
  try { v = JSON.parse(zeile) } catch { return }
  if (v.bereit) return console.log(`[stimme] Erkennung bereit (Modell ${MODELL()})`)
  const auftrag = offen.get(v.id)
  if (!auftrag) return
  offen.delete(v.id)
  clearTimeout(auftrag.timer)
  if (typeof v.text === 'string') auftrag.ok({ text: v.text.trim(), sek: Number(v.sek) || 0 })
  else auftrag.nein(new Error(String(v.fehler || 'Erkennung ohne Ergebnis').slice(0, 200)))
}

/** Startet den Erkenner, falls er nicht läuft. */
function starte() {
  if (prozess) return prozess
  const p = spawn(PYTHON(), [SKRIPT()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // HF_HOME mit in den Datenordner: huggingface_hub legt beim Laden seinen
    // Zwischenspeicher sonst unter ~/.cache an — und auf der VM ist ausser
    // /var/lib/daily alles schreibgeschützt (ProtectSystem/ProtectHome).
    env: {
      ...process.env,
      WHISPER_MODELL: MODELL(),
      WHISPER_DIR: path.join(dataDir(), 'whisper'),
      HF_HOME: path.join(dataDir(), 'whisper', 'hf'),
    },
  })
  let rest = ''
  // Als Text lesen, sonst zerfällt ein Umlaut, der auf zwei Pakete fällt.
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (c) => {
    rest += c
    let nl
    while ((nl = rest.indexOf('\n')) >= 0) { beiZeile(rest.slice(0, nl)); rest = rest.slice(nl + 1) }
  })
  p.stderr.on('data', (c) => {
    const s = String(c).trim()
    if (s && !/warn/i.test(s)) console.warn('[stimme] Erkenner:', s.slice(0, 200))
  })
  const weg = (grund) => {
    if (prozess !== p) return
    prozess = null
    alleAbbrechen(grund)
  }
  // Schreiben in einen gerade gestorbenen Prozess (EPIPE) darf Daily nicht
  // mitreissen — der Auftrag scheitert ohnehin über 'exit'.
  p.stdin.on('error', () => {})
  p.on('exit', (code) => weg(`Erkenner beendet (Code ${code}).`))
  p.on('error', (e) => weg(`Erkenner liess sich nicht starten: ${e.message}`))
  prozess = p
  return p
}

/** Aufnahme → { text, sek }. */
async function erkenne(audio, mime) {
  if (!audio || !audio.length) throw Object.assign(new Error('Aufnahme ist leer.'), { status: 400 })
  if (audio.length > MAX_BYTES) throw Object.assign(new Error('Aufnahme ist zu gross.'), { status: 413 })
  if (!bereit()) throw Object.assign(new Error('Spracherkennung gibt es nur auf der VM.'), { status: 503 })
  const id = crypto.randomUUID()
  const endung = ENDUNG[String(mime || '').split(';')[0].trim()] || 'webm'
  const pfad = path.join(os.tmpdir(), `daily-hoeren-${id}.${endung}`)
  letzterPfad = pfad
  fs.writeFileSync(pfad, audio, { mode: 0o600 })
  try {
    const p = starte()
    return await new Promise((ok, nein) => {
      // Hängt der Erkenner, hilft nur ein neuer: sonst warten alle folgenden
      // Aufträge hinter dem hängenden. 'exit' bricht die übrigen ab.
      const timer = setTimeout(() => {
        offen.delete(id)
        nein(new Error('Erkennung dauerte zu lange.'))
        p.kill()
      }, ZEITLIMIT_MS)
      offen.set(id, { ok, nein, timer })
      p.stdin.write(JSON.stringify({ id, pfad }) + '\n')
    })
  } finally {
    try { fs.unlinkSync(pfad) } catch { /* schon weg */ }
  }
}

async function handle(req, res) {
  const antworte = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(obj))
  }
  if (req.method !== 'POST') return antworte(405, { error: 'Nur POST.' })
  try {
    // Im try: bricht der Browser den Upload ab (Netz weg, Fenster zu), wirft
    // der Lesevorgang ECONNRESET — unbehandelt risse das den Server mit.
    const teile = []
    let laenge = 0
    for await (const c of req) {
      laenge += c.length
      if (laenge > MAX_BYTES) return antworte(413, { error: 'Aufnahme ist zu gross.' })
      teile.push(c)
    }
    const start = Date.now()
    const r = await erkenne(Buffer.concat(teile), req.headers['content-type'])
    // Nur Dauer, nie der Text: so lässt sich messen, wo eine Antwort Zeit verliert.
    console.info(`[stimme] erkannt in ${Date.now() - start} ms (${r.sek} s Aufnahme)`)
    return antworte(200, r)
  } catch (e) {
    console.warn('[stimme] Erkennung:', String((e && e.message) || e).slice(0, 160))
    return antworte(e.status || 502, { error: String((e && e.message) || e).slice(0, 160) })
  }
}

/** Nur für Tests. */
function _beenden() { if (prozess) prozess.kill(); prozess = null }

module.exports = { handle, erkenne, bereit, starte, MAX_BYTES, _beenden, _letzterPfad: () => letzterPfad }
