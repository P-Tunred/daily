// Das Hörbriefing — der Tag in bis zu fünf Minuten, zum Anhören.
//
// WAS ES IST
// Hermes schreibt jeden Morgen einen Sprechtext: was zählt, was gestern war,
// was heute und in den nächsten Tagen ansteht — aus Kalender, Second Brain und
// Daily. Daily macht daraus eine Aufnahme, spielt sie im Morgendialog ab und
// gibt sie Hermes für Telegram heraus. Pauls Wunsch vom 2026-10-22.
//
// WARUM DIE STIMME HIER ENTSTEHT UND NICHT BEI HERMES
// Hermes' eigene Sprachausgabe ist auf OpenAI eingestellt — ohne Schlüssel
// (geprüft 2026-10-22). Und ein Agent, der „erledigt" meldet, wenn nichts
// ankam, ist schon einmal vorgekommen (CONTEXT.md, Regel 6). Hier ist es
// gewöhnlicher Code: prüfbar, mit Wiederholungen, mit einem Status, der
// sagt, ob die Aufnahme wirklich da ist.
//
// DIE STIMME
// Microsoft-Edge-Neural (node-edge-tts), Standard „Seraphina" — weiblich,
// mehrsprachig, natürlich, ohne Schlüssel und Kosten. Abweichend über
// DAILY_STIMME, etwa en-US-AvaMultilingualNeural. Der Text geht dafür an
// Microsofts Sprachdienst; das war Teil der Entscheidung.
//
// DREI REGELN, DIE DER SERVER ERZWINGT
// 1. Nur für heute — wie beim Textbriefing (ADR 0003).
// 2. Höchstens fünf Minuten (740 Wörter). Kürzer ist ausdrücklich erlaubt.
// 3. Jeden Tag anders: ein Einstieg, der einem der letzten sieben fast gleicht,
//    wird abgelehnt. Paul: „ich will nicht jeden Morgen das Gleiche hören".
// Und: am Ende steht immer eine Frage fürs Second Brain. Sie läuft über die
// bestehende Brain-Frage (questionStore.cjs) — gleiche Regeln, gleiche
// Antwortkarte, die Antwort trägt Hermes ins Brain ein.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { dataPath } = require('./dataDir.cjs')
const questionStore = require('./questionStore.cjs')
const { geminiSprich } = require('./stimmeGemini.cjs')

const ZONE = 'Europe/Berlin'
// Gemessen an der echten Stimme (Seraphina, 2026-10-22): 343 Wörter = 2:19,
// also gut 148 Wörter pro Minute. 740 Wörter sind damit fünf Minuten.
const MAX_WOERTER = 740
const WOERTER_PRO_MIN = 148
const MIN_ZEICHEN = 200
const MAX_ZEICHEN = 6500
const BEHALTEN_TAGE = 14
const VERGLEICH_TAGE = 7
/** Ab diesem Anteil gemeinsamer Wörter gilt ein Einstieg als „derselbe". */
const AEHNLICH_AB = 0.6
const BYTES_PRO_SEK = 6000     // 48 kbit/s MP3
const VERSUCHE = 3
const STIMME = () => process.env.DAILY_STIMME || 'de-DE-SeraphinaMultilingualNeural'
const ISO = /^\d{4}-\d{2}-\d{2}$/

const ordner = () => dataPath('hoerbriefing')
const jsonPfad = (datum) => path.join(ordner(), `${datum}.json`)
const mp3Pfad = (datum) => path.join(ordner(), `${datum}.mp3`)

function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

function fehler(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {})
}

// ── Stimme (für Tests austauschbar) ─────────────────────────────────────────

/** Inline-Zeichen wie <short pause> oder <laugh>: Gemini versteht sie,
 *  Seraphina würde sie vorlesen — also für sie und fürs Wörterzählen weg. */
const ohneZeichen = (t) => t.replace(/<[^<>\n]{1,40}>/g, ' ').replace(/[ \t]{2,}/g, ' ')

async function edgeSprich(text, ziel) {
  const { EdgeTTS } = require('node-edge-tts')
  await new EdgeTTS({
    voice: STIMME(), lang: 'de-DE', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', timeout: 90000,
  }).ttsPromise(ohneZeichen(text), ziel)
  return { dauerSek: Math.round(fs.statSync(ziel).size / BYTES_PRO_SEK) }
}

/** Die Stimmen in der Reihenfolge, in der sie versucht werden: die natürliche
 *  (Gemini, nur mit Schlüssel) zuerst, Seraphina als Reserve. So fehlt das
 *  Briefing nie, nur weil Google gerade nicht will — es klingt dann eben
 *  schlichter, und der Player sagt das. */
let stimmen = () => [
  ...(process.env.GEMINI_API_KEY
    // Ein Durchgang: „zu viele Anfragen" fängt stimmeGemini.cjs selbst ab
    // (wartet, wie Google sagt). Andere Fehler (Schlüssel ungültig) gehen
    // durch Wiederholen nicht weg — dann gleich die Reserve.
    ? [{ name: `gemini:${process.env.DAILY_GEMINI_STIMME || 'Sulafat'}`, sprich: geminiSprich, versuche: 1 }]
    : []),
  { name: `edge:${STIMME()}`, sprich: edgeSprich, versuche: VERSUCHE },
]
let warteMs = (versuch) => 3000 * versuch
/** Nur für Tests: Stimme(n) und Wartezeit ersetzen. */
function _fuerTests({ sprecher, stimmen: liste, warte } = {}) {
  if (sprecher) stimmen = () => [{ name: 'test', sprich: sprecher, versuche: VERSUCHE }]
  if (liste) stimmen = () => liste
  if (warte) warteMs = warte
}

// ── Text ────────────────────────────────────────────────────────────────────

const woerter = (t) => (t.match(/\S+/g) || []).length

/** Der erste Satz — dort wiederholt sich ein Sprechtext am ehesten. */
function ersterSatz(t) {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t.trim())
  return (m ? m[0] : t.trim().slice(0, 160)).trim()
}

function wortMenge(t) {
  return new Set(t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ß]+/).filter((w) => w.length >= 3))
}

/** Anteil gemeinsamer Wörter (Jaccard). 1 = gleich, 0 = nichts gemeinsam. */
function aehnlichkeit(a, b) {
  const A = wortMenge(a)
  const B = wortMenge(b)
  if (A.size === 0 || B.size === 0) return 0
  let gemeinsam = 0
  for (const w of A) if (B.has(w)) gemeinsam++
  return gemeinsam / (A.size + B.size - gemeinsam)
}

function feld(v, max, name) {
  if (typeof v !== 'string' || !v.trim()) throw fehler(400, `Feld "${name}" fehlt oder ist leer`)
  const s = v.replace(/\s+/g, ' ').trim()
  if (s.length > max) throw fehler(400, `Feld "${name}" ist ${s.length} Zeichen lang, erlaubt sind ${max}`)
  return s
}

// ── Ablage ──────────────────────────────────────────────────────────────────

function lies(datum) {
  try { return JSON.parse(fs.readFileSync(jsonPfad(datum), 'utf8')) } catch { return null }
}

function schreibe(datum, doc) {
  fs.mkdirSync(ordner(), { recursive: true })
  const tmp = `${jsonPfad(datum)}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  fs.renameSync(tmp, jsonPfad(datum))
}

function tage() {
  try {
    return fs.readdirSync(ordner()).map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean).sort().reverse()
  } catch {
    return []
  }
}

/** Die letzten Sprechtexte, neueste zuerst — für Hermes, damit er sieht, was
 *  er schon gesagt hat, und für die Prüfung auf denselben Einstieg. */
function verlauf(n = VERGLEICH_TAGE, ausser = null) {
  return tage().filter((d) => d !== ausser).slice(0, n)
    .map((d) => lies(d)).filter((d) => d && typeof d.text === 'string')
    .map((d) => ({ datum: d.datum, einstieg: ersterSatz(d.text), text: d.text }))
}

function aufraeumen() {
  const grenze = new Date(Date.now() - BEHALTEN_TAGE * 86_400_000).toISOString().slice(0, 10)
  for (const d of tage()) {
    if (d >= grenze) continue
    for (const p of [jsonPfad(d), mp3Pfad(d)]) { try { fs.unlinkSync(p) } catch { /* schon weg */ } }
  }
}

// ── Veröffentlichen ─────────────────────────────────────────────────────────

/**
 * Nimmt den Sprechtext an, stellt die Frage am Ende und stösst die Aufnahme
 * an. Die Aufnahme läuft danach im Hintergrund; ob sie da ist, sagt `status`
 * (GET), nicht diese Antwort.
 */
function veroeffentliche(input = {}) {
  const heute = serverDate()
  if (input.datum !== heute) {
    throw fehler(400, `Feld "datum" muss heute sein (${heute}) — ein Hörbriefing gilt nur für den Tag, an dem es gehört wird.`, { serverDate: heute })
  }
  if (typeof input.text !== 'string') throw fehler(400, 'Feld "text" fehlt')
  const text = input.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < MIN_ZEICHEN) throw fehler(400, `Der Text hat ${text.length} Zeichen — unter ${MIN_ZEICHEN} ist das kein Briefing.`)
  if (text.length > MAX_ZEICHEN) throw fehler(400, `Der Text hat ${text.length} Zeichen, erlaubt sind ${MAX_ZEICHEN}.`)
  const anzahl = woerter(ohneZeichen(text))
  if (anzahl > MAX_WOERTER) {
    throw fehler(400, `${anzahl} Wörter sind über fünf Minuten — höchstens ${MAX_WOERTER}. Kürzen, nicht schneller sprechen.`)
  }
  if (!/\?["»«”’)]*\s*$/.test(text)) {
    throw fehler(400, 'Der Text muss mit der Frage fürs Second Brain enden (letzter Satz mit „?").')
  }

  const f = input.frage
  if (!f || typeof f !== 'object') throw fehler(400, 'Feld "frage" fehlt — am Ende steht immer eine Frage fürs Second Brain.')
  const frage = {
    id: feld(f.id, 120, 'frage.id'),
    frage: feld(f.frage, 280, 'frage.frage'),
    warum: feld(f.warum, 400, 'frage.warum'),
    seite: feld(f.seite, 200, 'frage.seite'),
  }

  // Jeden Tag anders — geprüft, nicht erhofft.
  const einstieg = ersterSatz(ohneZeichen(text))
  for (const alt of verlauf(VERGLEICH_TAGE, heute)) {
    const a = aehnlichkeit(einstieg, alt.einstieg)
    if (a >= AEHNLICH_AB) {
      throw fehler(409,
        `Der Einstieg gleicht dem vom ${alt.datum} (${Math.round(a * 100)} % gleiche Wörter): „${alt.einstieg}". Anders anfangen.`,
        { gleichWie: alt.datum })
    }
  }

  // Die Frage über den bestehenden Weg. Steht schon eine andere offen, wird
  // DIE gestellt — höchstens eine offene Frage gilt auch hier.
  const zustand = questionStore.zustand()
  if (zustand.offen && zustand.offen.id !== frage.id) {
    throw fehler(409,
      `Es steht schon eine offene Brain-Frage (${zustand.offen.id}): „${zustand.offen.frage}" — die gehört ans Ende.`,
      { steht: { id: zustand.offen.id, frage: zustand.offen.frage, seite: zustand.offen.seite } })
  }
  if (!zustand.offen) questionStore.stelle({ ...frage, quelle: 'brain' })

  const rev = crypto.randomUUID()
  // Die Sprechweise darf Hermes pro Tag mitgeben („heute etwas munterer") —
  // auch der Ton soll nicht jeden Morgen gleich sein. Ohne Angabe gilt die
  // Grundhaltung aus stimmeGemini.cjs.
  const stil = input.stil === undefined || input.stil === null || input.stil === '' ? undefined : feld(input.stil, 300, 'stil')
  const doc = {
    datum: heute, text, woerter: anzahl, frage, ...(stil ? { stil } : {}), stimme: stimmen()[0]?.name ?? null,
    status: 'erzeuge', rev, veroeffentlichtUm: new Date().toISOString(),
  }
  schreibe(heute, doc)
  aufraeumen()
  void erzeugeAudio(heute, rev)
  return { ok: true, datum: heute, status: doc.status, rev, woerter: anzahl, geschaetztMin: Math.round((anzahl / WOERTER_PRO_MIN) * 10) / 10 }
}

/** Die Aufnahme erzeugen. Wiederholt bei Fehlern (Microsofts Dienst antwortet
 *  gelegentlich mit 429), schreibt am Ende IMMER einen Status — „fertig" oder
 *  „fehler" mit Grund. Ein Hörbriefing, das still nie fertig wird, sähe aus
 *  wie eines, das noch lädt. */
async function erzeugeAudio(datum, rev) {
  const doc = lies(datum)
  if (!doc || doc.rev !== rev) return
  const tmp = `${mp3Pfad(datum)}.${rev}.tmp`
  const gruende = []
  let ergebnis = null
  const liste = stimmen()
  suche: for (const [i, st] of liste.entries()) {
    for (let v = 1; v <= st.versuche; v++) {
      try {
        const r = (await st.sprich(doc.text, tmp, { stil: doc.stil })) || {}
        const groesse = fs.statSync(tmp).size
        if (groesse < 1000) throw new Error(`Aufnahme ist nur ${groesse} Bytes groß`)
        ergebnis = { stimme: st.name, ersatz: i > 0, dauerSek: r.dauerSek ?? Math.round(groesse / BYTES_PRO_SEK) }
        break suche
      } catch (e) {
        gruende.push(`${st.name}: ${String((e && e.message) || e).slice(0, 160)}`)
        try { fs.unlinkSync(tmp) } catch { /* nichts da */ }
        if (v < st.versuche) await new Promise((r) => setTimeout(r, warteMs(v)))
      }
    }
  }
  const jetzt = lies(datum)
  if (!jetzt || jetzt.rev !== rev) {
    // Inzwischen kam ein neuerer Text — diese Aufnahme gehört zu keinem mehr.
    try { fs.unlinkSync(tmp) } catch { /* nichts da */ }
    return
  }
  if (!ergebnis) {
    console.warn(`[hoerbriefing] ${datum}: keine Stimme hat geklappt — ${gruende.join(' | ')}`)
    schreibe(datum, { ...jetzt, status: 'fehler', fehler: gruende.at(-1) ?? 'unbekannt', gruende, fehlerUm: new Date().toISOString() })
    return
  }
  fs.renameSync(tmp, mp3Pfad(datum))
  const bytes = fs.statSync(mp3Pfad(datum)).size
  // Ist die Reserve eingesprungen, steht der Grund mit dabei — sonst wüsste
  // niemand, dass die natürliche Stimme seit Tagen ausfällt.
  schreibe(datum, {
    ...jetzt, status: 'fertig', bytes, ...ergebnis, ...(ergebnis.ersatz ? { gruende } : {}), fertigUm: new Date().toISOString(),
  })
  console.log(`[hoerbriefing] ${datum}: Aufnahme fertig — ${ergebnis.dauerSek} s, ${ergebnis.stimme}${ergebnis.ersatz ? ` (Ersatz; ${gruende.join(' | ')})` : ''}`)
}

// ── Lesen ───────────────────────────────────────────────────────────────────

/** Was der Browser braucht: Status, Dauer, Text, Frage. */
function heuteFuerAnzeige() {
  const d = lies(serverDate())
  if (!d) return { datum: null }
  // `rev` ist interne Buchhaltung der Aufnahme, nichts für den Browser.
  return Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'rev'))
}

/** Pfad zur fertigen Aufnahme eines Tages, oder null. */
function audioPfad(datum) {
  if (typeof datum !== 'string' || !ISO.test(datum)) return null
  const d = lies(datum)
  if (!d || d.status !== 'fertig') return null
  return fs.existsSync(mp3Pfad(datum)) ? mp3Pfad(datum) : null
}

/** MP3 ausliefern — mit Range, sonst lässt sich im Player nicht spulen. */
function sendeAudio(req, res, datei) {
  const groesse = fs.statSync(datei).size
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  const kopf = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300' }
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : groesse - Number(range[2])
    let ende = range[1] && range[2] ? Number(range[2]) : groesse - 1
    start = Math.max(0, start)
    ende = Math.min(groesse - 1, ende)
    if (start > ende) {
      res.writeHead(416, { 'Content-Range': `bytes */${groesse}` })
      return res.end()
    }
    res.writeHead(206, { ...kopf, 'Content-Range': `bytes ${start}-${ende}/${groesse}`, 'Content-Length': ende - start + 1 })
    return fs.createReadStream(datei, { start, end: ende }).pipe(res)
  }
  res.writeHead(200, { ...kopf, 'Content-Length': groesse })
  fs.createReadStream(datei).pipe(res)
}

module.exports = {
  veroeffentliche, verlauf, heuteFuerAnzeige, audioPfad, sendeAudio, lies, serverDate,
  ersterSatz, aehnlichkeit, erzeugeAudio, _fuerTests, MAX_WOERTER, AEHNLICH_AB,
}
