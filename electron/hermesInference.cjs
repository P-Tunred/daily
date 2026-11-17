// Hermes als Sprachmodell — der zweite Weg neben Anthropic.
//
// WARUM ES DAS GIBT
// Daily bezahlte bisher jede KI-Arbeit aus Pauls Anthropic-Guthaben: die
// Mail-Bewertung, den Wochenplan, Jarvis' Check-in. Ist das Guthaben leer,
// fallen alle drei gleichzeitig aus — genau so passiert, der Rauchtest meldete
// "Your credit balance is too low".
//
// Hermes hat seine eigene Inferenz und laeuft auf derselben Maschine. Die
// Bruecke dorthin existiert seit Langem und ist erprobt (electron/hermesChat.cjs):
//   dieser Aufruf → 127.0.0.1:8644 (HMAC) → daily-webhook-listener.py → hermes -z
// Dieses Modul macht daraus einen allgemein nutzbaren Inferenz-Weg, damit nicht
// nur der Chat, sondern JEDE KI-Arbeit darueber laufen kann.
//
// WAS DABEI ANDERS IST — ehrlich
// 1. LANGSAMER. Ein `hermes -z` braucht 7–20 Sekunden, oft mehr. Anthropic
//    antwortet in ein bis drei. Fuer Hintergrundarbeit (Mail-Bewertung) ist das
//    egal, im Chat merkt man es.
// 2. KEIN ECHTES STREAMING. Der Oneshot liefert den fertigen Text am Stueck.
//    Wer streamt, bekommt ihn hier als EIN Stueck — das Format bleibt gueltig,
//    nur das schrittweise Erscheinen entfaellt. (Im Browser nutzt das derzeit
//    ohnehin niemand.)
// 3. ANDERES MODELL. Hermes waehlt selbst, welches er nimmt. Antworten fallen
//    also anders aus als von einem fest gewaehlten Claude-Modell.
//
// WARUM DER SYSTEM-PROMPT MITGESCHICKT WIRD STATT VERWORFEN
// `hermes -z` kennt keinen getrennten System-Prompt. Er wird deshalb dem Text
// vorangestellt und deutlich abgegrenzt. Ihn wegzulassen waere schlimmer als
// die Naht: die Prompts tragen die ganze Fachlogik (Bewertungsregeln,
// JSON-Schema, Ton).

const crypto = require('crypto')

const LISTENER_URL = 'http://127.0.0.1:8644/webhooks/daily-chat'
// Grosszuegiger als der Chat: die Mail-Bewertung schickt Bloecke von 20 Mails
// und erwartet bis zu 4096 Token JSON zurueck. Das dauert.
const TIMEOUT_MS = 280_000

function getSecret() {
  const v = process.env.HERMES_WEBHOOK_SECRET
  return v && v.trim() ? v.trim() : undefined
}

/** Steht der Weg ueberhaupt zur Verfuegung? Ohne Secret laeuft er nicht —
 *  auf dem Mac etwa gibt es den Listener nicht. */
function verfuegbar() {
  return !!getSecret()
}

/** Baut aus system + messages EINEN Text, den `hermes -z` verarbeiten kann.
 *
 *  Die Rollen bleiben erkennbar: ohne Markierung verschwimmt eine mehrstufige
 *  Unterhaltung zu einem Block, und das Modell weiss nicht mehr, welcher Teil
 *  seine eigene fruehere Antwort war. */
function baueEinText({ system, messages }) {
  const teile = []
  if (system && String(system).trim()) {
    teile.push('=== ANWEISUNG (gilt fuer die ganze Antwort) ===')
    teile.push(String(system).trim())
    teile.push('=== ENDE ANWEISUNG ===')
    teile.push('')
  }
  const liste = Array.isArray(messages) ? messages : []
  if (liste.length === 1 && liste[0] && liste[0].role === 'user') {
    // Der haeufigste Fall: eine einzelne Frage. Keine Rollen-Etiketten noetig,
    // die wuerden hier nur Rauschen im Prompt erzeugen.
    teile.push(String(liste[0].content ?? ''))
  } else {
    for (const m of liste) {
      if (!m || typeof m.content !== 'string') continue
      teile.push(`${m.role === 'assistant' ? 'DU (frueher)' : 'PAUL'}: ${m.content}`)
    }
  }
  return teile.join('\n')
}

/**
 * Eine Anfrage an Hermes. Gibt den Antworttext zurueck.
 * Wirft bei Fehlschlag — die Aufrufer entscheiden ueber den Rueckfall.
 */
async function frageHermes({ system, messages, timeoutMs }) {
  const secret = getSecret()
  if (!secret) throw new Error('hermes_nicht_konfiguriert: HERMES_WEBHOOK_SECRET fehlt')

  const nachricht = baueEinText({ system, messages })
  if (!nachricht.trim()) throw new Error('leere Anfrage')

  const body = JSON.stringify({ message: nachricht })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')

  const upstream = await fetch(LISTENER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig },
    body,
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : TIMEOUT_MS),
  })
  const data = await upstream.json().catch(() => null)
  if (!upstream.ok || !data || typeof data.response !== 'string') {
    const detail = (data && (data.error || data.detail)) || `HTTP ${upstream.status}`
    throw new Error('hermes_fehler: ' + String(detail).slice(0, 200))
  }
  return data.response
}

module.exports = { frageHermes, verfuegbar, baueEinText, LISTENER_URL, TIMEOUT_MS }
