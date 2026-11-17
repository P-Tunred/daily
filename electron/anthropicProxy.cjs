// Server-side Anthropic proxy. Keeps the API key OUT of the browser bundle:
// the renderer POSTs to /api/anthropic and the key lives ONLY here, read from
// the environment / .env at runtime. Shared by the packaged server (server.cjs)
// and the Vite dev middleware (server/calendarPlugin.ts).
const fs = require('fs')
const path = require('path')
const { StringDecoder } = require('string_decoder')

// Hermes als zweiter Inferenz-Weg — siehe hermesInference.cjs fuer das Warum.
const hermesInference = require('./hermesInference.cjs')

// WELCHER WEG? — aus /etc/daily/env, bei jedem Aufruf frisch gelesen.
//
//   auto      (Vorgabe) Anthropic zuerst, bei Ausfall Hermes. Selbstheilend:
//             sobald wieder Guthaben da ist, laeuft es ohne Zutun zurueck.
//   hermes    immer Hermes. Kostet nichts vom Anthropic-Guthaben.
//   anthropic nur Anthropic, kein Rueckfall (das Verhalten von frueher).
//
// WARUM "auto" die Vorgabe ist
// Am 30.08. war Pauls Guthaben leer und ALLE KI-Funktionen fielen gleichzeitig
// aus — Mail-Bewertung, Wochenplan, Jarvis. Hermes lief die ganze Zeit weiter.
// Ein Ausfall, gegen den ein zweiter Weg direkt danebensteht, sollte kein
// Ausfall sein.
function backend() {
  const v = (process.env.AI_BACKEND || 'auto').trim().toLowerCase()
  return ['auto', 'hermes', 'anthropic'].includes(v) ? v : 'auto'
}

// Fehler, bei denen ein zweiter Anthropic-Versuch zwecklos ist und der Wechsel
// zu Hermes sinnvoll: kein Schluessel, kein Geld, gesperrt, ueberlastet.
// Ein 500er bleibt aussen vor — der kann voruebergehend sein.
function lohntRueckfall(fehlerText) {
  return /no_api_key|anthropic_40[0139]|anthropic_429|credit balance|rate_limit/i.test(String(fehlerText))
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_BODY = 256 * 1024 // 256 KB cap on the request body
const UPSTREAM_TIMEOUT_MS = 30_000

// Key resolution: real env var first, then the project .env. Prefers the
// non-VITE name (server-only, never inlined into the bundle); falls back to the
// legacy VITE_ name during migration. The value is never logged.
function getApiKey() {
  const fromEnv = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
    const m = raw.match(/^(?:ANTHROPIC_API_KEY|VITE_ANTHROPIC_API_KEY)=(.+)$/m)
    if (m) return m[1].trim()
  } catch { /* no .env — AI just stays disabled */ }
  return undefined
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) { reject(new Error('body too large')); req.destroy() }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// Allowlist exactly the fields we forward — nothing else reaches Anthropic.
function sanitizePayload(raw) {
  const o = JSON.parse(raw)
  const model = typeof o.model === 'string' ? o.model : null
  const max_tokens = Number.isFinite(o.max_tokens)
    ? Math.min(4096, Math.max(1, Math.floor(o.max_tokens)))
    : 1024
  const system = typeof o.system === 'string' ? o.system : undefined
  const messages = Array.isArray(o.messages)
    ? o.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content }))
    : []
  if (!model || messages.length === 0) throw new Error('invalid payload')
  const payload = { model, max_tokens, messages }
  if (system) payload.system = system
  // `stream` ist das einzige durchgelassene Feld, das die FORM der Antwort
  // ändert (Ereignisstrom statt JSON). Deshalb nur als echtes `true` — ein
  // "truthy" Wert aus dem Browser soll nicht versehentlich umschalten.
  if (o.stream === true) payload.stream = true
  return payload
}

// ── Tokenverbrauch aus der Antwort lesen ─────────────────────────────────────
// Beides hier, weil nur der Proxy die Antwort in Rohform sieht. Vorher hing das
// an einem überschriebenen res.end() in server.cjs — das bekommt bei einem
// Datenstrom nie den ganzen Text zu sehen und hätte den Verbrauch still
// verschluckt.

function reportJsonUsage(text, onUsage) {
  try {
    const parsed = JSON.parse(text)
    if (parsed && parsed.usage) {
      onUsage(parsed.model || 'unknown', parsed.usage.input_tokens || 0, parsed.usage.output_tokens || 0)
    }
  } catch { /* kein JSON — dann eben kein Verbrauch */ }
}

/** Zählt den Verbrauch im laufenden Ereignisstrom mit.
 *
 *  Anthropic verteilt die Zahlen: `message_start` bringt Modell und
 *  Eingabe-Tokens, `message_delta` die fortlaufende Ausgabe-Summe. Endgültig
 *  ist das erst am Schluss — deshalb sammeln und einmal am Ende melden.
 *  Der StringDecoder ist nötig, weil ein Umlaut zwischen zwei Paketen
 *  auseinandergeschnitten sein kann; ein rohes toString() macht daraus Müll. */
function streamMeter(onUsage) {
  const decoder = new StringDecoder('utf8')
  let rest = ''
  let model = 'unknown'
  let input = 0
  let output = 0
  let seen = false
  return {
    eat(chunk) {
      rest += decoder.write(chunk)
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        let ev
        try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }
        if (ev.type === 'message_start' && ev.message) {
          model = ev.message.model || model
          input = (ev.message.usage && ev.message.usage.input_tokens) || 0
          seen = true
        } else if (ev.type === 'message_delta' && ev.usage) {
          output = ev.usage.output_tokens || output
          seen = true
        }
      }
    },
    done() { if (seen) onUsage(model, input, output) },
  }
}

// Handle a POST /api/anthropic request. `req`/`res` are Node http objects.
// `onUsage(model, input, output)` ist optional und wird einmal pro Antwort
// gerufen — auch bei Streaming, wo der Aufrufer die Zahlen sonst nie sähe.
/** Giesst einen Hermes-Text in die Form, die der Browser erwartet.
 *
 *  Beim Streamen kommt der Text als EIN Stueck statt vieler — `hermes -z`
 *  liefert erst am Ende. Das Format bleibt gueltig (dieselben SSE-Ereignisse,
 *  dieselbe Reihenfolge), nur das schrittweise Erscheinen entfaellt. Der
 *  Browser-Code merkt davon nichts; er summiert die Stuecke ohnehin. */
function antwortAlsAnthropic(res, json, text, payload, streamen) {
  if (!streamen) {
    return json(200, {
      id: 'msg_hermes',
      type: 'message',
      role: 'assistant',
      model: 'hermes',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    })
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'keep-alive')
  const ereignis = (typ, daten) => res.write(`event: ${typ}\ndata: ${JSON.stringify(daten)}\n\n`)
  ereignis('message_start', { type: 'message_start', message: { id: 'msg_hermes', type: 'message', role: 'assistant', model: 'hermes', content: [], usage: { input_tokens: 0, output_tokens: 0 } } })
  ereignis('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  ereignis('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  ereignis('content_block_stop', { type: 'content_block_stop', index: 0 })
  ereignis('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })
  ereignis('message_stop', { type: 'message_stop' })
  res.end()
}

async function handleAnthropic(req, res, onUsage) {
  const json = (code, obj) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(obj))
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const key = getApiKey()
  // KEIN vorzeitiges 503 mehr: fehlt der Schluessel, uebernimmt weiter unten
  // Hermes. Frueher fiel hier alles aus, obwohl ein zweiter Weg bereitstand.

  let payload
  try {
    payload = sanitizePayload(await readBody(req, MAX_BODY))
  } catch (e) {
    return json(400, { error: 'bad_request', detail: String((e && e.message) || e).slice(0, 120) })
  }

  // ── Hermes-Weg fuer den Browser ────────────────────────────────────────────
  // Dieselbe Weiche wie serverseitig, nur muss die Antwort hier die FORM einer
  // Anthropic-Antwort haben — der Browser-Code (src/lib/anthropic.ts) liest
  // `content[0].text` bzw. den SSE-Strom. Wuerde hier etwas anderes kommen,
  // muessten alle Aufrufstellen angefasst werden; so merkt keine davon etwas.
  const wegBrowser = backend()
  const nurHermes = wegBrowser === 'hermes'
  if (nurHermes || !key) {
    if (!hermesInference.verfuegbar()) return json(503, { error: 'no_api_key' })
    try {
      const text = await hermesInference.frageHermes({ system: payload.system, messages: payload.messages })
      return antwortAlsAnthropic(res, json, text, payload, !!payload.stream)
    } catch (e) {
      return json(502, { error: 'hermes_fehler', detail: String((e && e.message) || e).slice(0, 160) })
    }
  }

  // Die Zeitgrenze gilt bis zu den Kopfzeilen, nicht für den ganzen Strom: eine
  // gestreamte Antwort darf legitim länger als 30s laufen, ein Gegenüber das
  // gar nicht erst antwortet nicht. Und bricht der Browser ab, brechen wir nach
  // oben mit ab — sonst laufen Tokens weiter, die niemand mehr liest.
  const ac = new AbortController()
  const headerTimer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
  res.on('close', () => ac.abort())

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    })
    clearTimeout(headerTimer)

    // Auch eine Streaming-Anfrage bekommt im Fehlerfall JSON zurück. Das dann
    // unverändert durchreichen, statt es als Ereignisstrom auszugeben — sonst
    // sieht der Browser einen leeren Strom statt der Fehlermeldung.
    if (payload.stream !== true || !upstream.ok || !upstream.body) {
      const text = await upstream.text()

      // HIER greift der Rueckfall im Alltag: Anthropic antwortet mit 400 und
      // "credit balance is too low". Frueher landete das unveraendert im
      // Browser und Jarvis meldete einen Fehler — obwohl Hermes danebensteht
      // und antworten koennte. Nur bei "auto" und nur bei Fehlern, bei denen
      // ein zweiter Versuch ohnehin zwecklos waere.
      if (!upstream.ok && wegBrowser === 'auto' && hermesInference.verfuegbar()
          && lohntRueckfall(`anthropic_${upstream.status} ${text}`)) {
        console.warn(`[ki] Anthropic lehnte ab (${upstream.status}) — weiche auf Hermes aus.`)
        try {
          const hTxt = await hermesInference.frageHermes({ system: payload.system, messages: payload.messages })
          return antwortAlsAnthropic(res, json, hTxt, payload, payload.stream === true)
        } catch (he) {
          // Beide Wege tot — dann die URSPRUENGLICHE Meldung zeigen, nicht die
          // vom Rueckfall. Sie nennt den eigentlichen Grund.
          console.warn('[ki] Rueckfall auf Hermes ebenfalls fehlgeschlagen:', String((he && he.message) || he).slice(0, 120))
        }
      }

      res.statusCode = upstream.status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(text)
      if (upstream.ok && onUsage) reportJsonUsage(text, onUsage)
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })
    const meter = onUsage ? streamMeter(onUsage) : null
    for await (const chunk of upstream.body) {
      if (meter) meter.eat(chunk)
      res.write(chunk)
    }
    if (meter) meter.done()
    res.end()
  } catch (e) {
    clearTimeout(headerTimer)
    // Steht der Kopf schon, ist der Statuscode vergeben — dann bleibt nur, den
    // Strom sauber zu schließen. Der Client merkt am fehlenden Abschluss, dass
    // es schiefging.
    if (res.headersSent) { res.end(); return }
    return json(502, { error: 'upstream_error', detail: String((e && e.message) || e).slice(0, 120) })
  }
}

// Direct, non-HTTP call for server-internal use (e.g. mailTriage.cjs classifying
// the mail report). Same key resolution + upstream call as handleAnthropic, just
// without the req/res plumbing. Throws on failure — callers decide the fallback.
// `timeoutMs` lets heavier background jobs (the once-a-day mail digest reasons
// over the whole relevant set in one shot) exceed the browser-facing 30s cap.
async function callAnthropicDirekt({ model, max_tokens, system, messages, timeoutMs }) {
  const key = getApiKey()
  if (!key) throw new Error('no_api_key')
  const payload = sanitizePayload(JSON.stringify({ model, max_tokens, system, messages }))
  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : UPSTREAM_TIMEOUT_MS),
  })
  if (!upstream.ok) throw new Error(`anthropic_${upstream.status}`)
  const data = await upstream.json()
  const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
  if (!block || typeof block.text !== 'string') throw new Error('anthropic_no_text')
  return block.text
}

/**
 * Der Weg nach aussen fuer serverseitige Aufrufer (mailTriage & Co).
 * Waehlt Anthropic oder Hermes nach AI_BACKEND und faellt bei Bedarf zurueck.
 */
async function callAnthropic(opts) {
  const weg = backend()

  if (weg === 'hermes') {
    return hermesInference.frageHermes({ system: opts.system, messages: opts.messages, timeoutMs: opts.timeoutMs })
  }

  try {
    return await callAnthropicDirekt(opts)
  } catch (e) {
    const grund = String((e && e.message) || e)
    // Kein Rueckfall, wenn er nicht ausdruecklich erlaubt ist oder nicht hilft —
    // sonst verdeckt Hermes einen echten Fehler und niemand merkt, dass der
    // eigentliche Weg kaputt ist.
    if (weg !== 'auto' || !lohntRueckfall(grund) || !hermesInference.verfuegbar()) throw e
    console.warn(`[ki] Anthropic nicht nutzbar (${grund.slice(0, 80)}) — weiche auf Hermes aus.`)
    return hermesInference.frageHermes({ system: opts.system, messages: opts.messages, timeoutMs: opts.timeoutMs })
  }
}

module.exports = { handleAnthropic, callAnthropic, callAnthropicDirekt, backend, hasApiKey: () => !!getApiKey() }
