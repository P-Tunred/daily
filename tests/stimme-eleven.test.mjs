// Die Stimme für kurze Antworten: ElevenLabs zuerst, Seraphina als Reserve.
//
// WARUM DIESE TESTS EXISTIEREN
// Seit 2026-11-03 liest ElevenLabs die Antworten vor (natürlicher als
// Seraphina, gratis bis 10 000 Zeichen im Monat). Geprüft wird, dass der
// Schlüssel im Kopf und nie in der Adresse steht, dass ein leeres Kontingent
// die Stimme für eine Weile pausiert statt jede Antwort zu verzögern, und
// dass dann Seraphina spricht — eine Antwort ohne Ton gibt es nicht.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
process.env.ELEVENLABS_API_KEY = 'eleven-test'
const eleven = require('../electron/stimmeEleven.cjs')
const kurz = require('../electron/stimmeKurz.cjs')

const MP3 = Buffer.alloc(2000, 7)

beforeEach(() => eleven._fuerTests())

describe('ElevenLabs', () => {
  test('Anfrage: Schlüssel im Kopf, Flash v2.5, Deutsch', async () => {
    const anfragen = []
    const buf = await eleven.sprich('Steht drauf.', {
      fetchFn: async (url, opt) => { anfragen.push({ url, opt }); return new Response(MP3, { status: 200 }) },
    })
    assert.equal(buf.length, MP3.length)
    const [a] = anfragen
    assert.match(a.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/[A-Za-z0-9]+\?/)
    assert.ok(!a.url.includes('eleven-test'))
    assert.equal(a.opt.headers['xi-api-key'], 'eleven-test')
    const body = JSON.parse(a.opt.body)
    assert.equal(body.model_id, 'eleven_flash_v2_5')
    assert.equal(body.language_code, 'de')
    assert.equal(body.text, 'Steht drauf.')
  })

  test('leeres Kontingent: pausiert, fragt nicht bei jeder Antwort neu', async () => {
    let n = 0
    const fetchFn = async () => { n++; return new Response('{"detail":{"status":"quota_exceeded"}}', { status: 401 }) }
    await assert.rejects(eleven.sprich('Eins.', { fetchFn, jetzt: 1000 }), /Kontingent leer/)
    assert.equal(eleven.verfuegbar(2000), false)
    await assert.rejects(eleven.sprich('Zwei.', { fetchFn, jetzt: 2000 }), /nicht verfügbar/)
    assert.equal(n, 1)
    assert.equal(eleven.verfuegbar(1000 + 7 * 3600_000), true, 'nach ein paar Stunden wieder versuchen')
  })

  test('Zeitüberschreitung oder Serverfehler: kurze Pause, nicht jede Antwort 8 s warten', async () => {
    const fetchFn = async () => new Response('down', { status: 503 })
    await assert.rejects(eleven.sprich('Eins.', { fetchFn, jetzt: 1000 }), /503/)
    assert.equal(eleven.verfuegbar(1000 + 30_000), false)
    assert.equal(eleven.verfuegbar(1000 + 5 * 60_000), true)
  })

  test('ohne Schlüssel nicht verfügbar', () => {
    const alt = process.env.ELEVENLABS_API_KEY
    delete process.env.ELEVENLABS_API_KEY
    assert.equal(eleven.verfuegbar(), false)
    process.env.ELEVENLABS_API_KEY = alt
  })
})

describe('stimmeKurz wählt die Stimme', () => {
  test('ElevenLabs, wenn verfügbar', async () => {
    let seraphina = 0
    kurz._fuerTests({ elevenVerfuegbar: () => true, elevenSprich: async () => MP3, sprich: async () => { seraphina++ } })
    assert.equal((await kurz.aufnahme('Hallo Paul.')).length, MP3.length)
    assert.equal(seraphina, 0)
  })

  test('scheitert ElevenLabs, spricht Seraphina', async () => {
    const { writeFileSync } = await import('node:fs')
    kurz._fuerTests({
      elevenVerfuegbar: () => true,
      elevenSprich: async () => { throw new Error('HTTP 500') },
      sprich: async (_text, ziel) => writeFileSync(ziel, Buffer.alloc(900, 1)),
    })
    assert.equal((await kurz.aufnahme('Hallo Paul.')).length, 900)
  })
})
