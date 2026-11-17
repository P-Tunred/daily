// Browser-E2E: „Mit Hermes sprechen" im Intro, einmal ganz durch.
//
// Echt sind: die Aufnahme (lib/mikrofon.ts) mit Stille- und Dazwischen-Erkennung an einem
// Ersatzmikrofon aus Ton und Stille, der Daily-Server
// mit eigenem Datenverzeichnis und alle Routen dazwischen. Nachgebaut sind nur
// die beiden Dinge ausserhalb von Daily: Hermes' API-Server (gibt eine feste
// SSE-Antwort) und die Spracherkennung (gibt einen festen Satz). Die Stimme
// fürs Vorlesen wird im Browser durch eine stille WAV ersetzt.

import { test, expect, chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 4897
const HERMES_PORT = 4896
const BASE = `http://127.0.0.1:${PORT}`
const SATZ = 'Schreib auf, dass ich morgen die Steuererklärung abschicke. Und ja, ich mache das Tutorium weiter.'
const ANTWORT = 'Steht drauf, für morgen. Und dein Ja zum Tutorium habe ich mir notiert.' +
  '<daily>{"todos":[{"text":"Steuererklärung abschicken","wann":"woche"}],"frage":"brain:tutorium#1","antwort":"Ja, ich mache das Tutorium weiter."}</daily>'
const FRAGE = { id: 'brain:tutorium#1', frage: 'Machst du das Statistik-Tutorium weiter?', warum: 'offen seit Wochen', quelle: 'brain', seite: 'wiki/statistik.md' }

let server, hermes, datenDir, browser
const anHermes = []

/** WAV: `ton` Sekunden 440 Hz, dann `still` Sekunden Stille. */
function wav(ton, still) {
  const rate = 16000
  const n = Math.round(rate * (ton + still))
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = i < rate * ton ? Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 9000) : 0
    b.writeInt16LE(s, 44 + i * 2)
  }
  return b
}

test.beforeAll(async () => {
  datenDir = mkdtempSync(join(tmpdir(), 'daily-e2e-stimme-'))
  mkdirSync(join(datenDir, 'leeres-brain'))
  const erkenner = join(datenDir, 'erkenner.mjs')
  // Was „erkannt" wird, steht in erkannt.txt — ein Test kann es umstellen.
  writeFileSync(join(datenDir, 'erkannt.txt'), SATZ)
  writeFileSync(erkenner, `
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
console.log(JSON.stringify({ bereit: true }))
for await (const z of createInterface({ input: process.stdin })) {
  const a = JSON.parse(z)
  console.log(JSON.stringify({ id: a.id, text: readFileSync(${JSON.stringify(join(datenDir, 'erkannt.txt'))}, 'utf8'), sek: 3 }))
}`)

  hermes = createServer((req, res) => {
    let roh = ''
    req.on('data', (c) => { roh += c })
    req.on('end', () => {
      anHermes.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(roh) })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (let i = 0; i < ANTWORT.length; i += 9) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ANTWORT.slice(i, i + 9) } }] })}\n\n`)
      }
      res.end('data: [DONE]\n\n')
    })
  }).listen(HERMES_PORT)

  server = spawn(process.execPath, ['-e', `require('${join(ROOT, 'electron', 'server.cjs')}').startServer(${PORT})`], {
    env: {
      ...process.env, DAILY_DATA_DIR: datenDir, HERMES_TOKEN: 'e2e-token', AUTH_PASS: '',
      HERMES_API_URL: `http://127.0.0.1:${HERMES_PORT}`, HERMES_API_KEY: 'e2e-schluessel',
      DAILY_WHISPER_PYTHON: process.execPath, DAILY_WHISPER_SKRIPT: erkenner,
      SECOND_BRAIN_PATH: join(datenDir, 'leeres-brain'),
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.status) break } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  // Die offene Frage, mit der das Hörbriefing endete.
  const r = await fetch(`${BASE}/api/hermes/question`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-token' }, body: JSON.stringify(FRAGE),
  })
  if (!r.ok) throw new Error(`Frage nicht gestellt: ${r.status} ${await r.text()}`)

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
})

// Ein Mikrofon aus dem Browser selbst: 1,5 s Ton, dann Stille — ein echter
// MediaStream, den MediaRecorder und AnalyserNode wie ein Gerät behandeln.
// (Chromiums eigenes Ersatzgerät hängt auf macOS ohne Mikrofonfreigabe.)
const ERSATZ_MIKROFON = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext()
    const ton = ctx.createOscillator()
    const laut = ctx.createGain()
    laut.gain.setValueAtTime(0.3, ctx.currentTime)
    laut.gain.setValueAtTime(0, ctx.currentTime + 1.5)
    const ziel = ctx.createMediaStreamDestination()
    ton.connect(laut).connect(ziel)
    ton.start()
    return ziel.stream
  }
}

test.afterAll(async () => {
  if (browser) await browser.close()
  if (server) server.kill()
  if (hermes) hermes.close()
  if (datenDir) rmSync(datenDir, { recursive: true, force: true })
})

async function hermesTodos() {
  const r = await fetch(`${BASE}/api/hermes/todos`, { headers: { Authorization: 'Bearer e2e-token' } })
  return (await r.json()).todos
}

test('reden → Hermes antwortet → Aufgabe und Antwort landen in der App, beides zurücknehmbar', async () => {
  const page = await browser.newPage()
  await page.addInitScript(ERSATZ_MIKROFON)
  await page.route('**/api/stimme/vorlesen', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav(0, 0.4) }))
  await page.goto(BASE)
  const spaeter = page.getByRole('button', { name: 'Später', exact: true })
  if (await spaeter.count()) await spaeter.first().click()

  const knopf = page.getByRole('button', { name: /^(Sprechen|Sprich einfach los|Ich höre zu|Verstehe|Moment|Antwortet)/ }).first()
  await expect(knopf).toBeEnabled()
  await knopf.click()
  await expect(knopf).toHaveAttribute('aria-pressed', 'true')

  // Das Ersatzmikrofon spielt Ton, dann Stille → Aufnahme endet von selbst.
  await expect(page.getByText(`„${SATZ}"`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Auf der Liste: Steuererklärung abschicken')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Antwort gespeichert: Ja, ich mache das Tutorium weiter.')).toBeVisible()

  // Hermes bekam Pauls Satz, den Schlüssel und die Frage vom Morgen.
  const a = anHermes[0]
  assert(a.url === '/v1/chat/completions', a.url)
  assert(a.auth === 'Bearer e2e-schluessel', 'Schlüssel')
  assert(a.body.messages[0].content.includes(FRAGE.frage), 'Frage im System-Text')
  assert(a.body.messages.at(-1).content === SATZ, 'Satz')

  const todos = await hermesTodos()
  expect(todos.map((t) => t.text)).toEqual(['Steuererklärung abschicken'])
  const frage = await (await fetch(`${BASE}/api/question`)).json()
  expect(frage.offen).toBeNull()
  expect(frage.antwort.antwort).toBe('Ja, ich mache das Tutorium weiter.')

  // Beenden, dann beides zurücknehmen.
  await page.keyboard.press('Escape')
  await expect(knopf).toHaveAttribute('aria-pressed', 'false')
  for (const b of await page.getByRole('button', { name: 'zurücknehmen' }).all()) await b.click()
  await expect(page.getByText(/^Zurückgenommen:/)).toHaveCount(2)
  expect(await hermesTodos()).toEqual([])
  const danach = await (await fetch(`${BASE}/api/question`)).json()
  expect(danach.offen.id).toBe(FRAGE.id)
  await page.close()
})

// Paul hört das Briefing und redet nach gut zwei Sekunden einfach los —
// ohne zu tippen. Das Ersatzmikrofon schweigt erst, dann 1,5 s Ton, dann Stille.
const SPAETER_REDEN = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext()
    const ton = ctx.createOscillator()
    const laut = ctx.createGain()
    laut.gain.setValueAtTime(0, ctx.currentTime)
    laut.gain.setValueAtTime(0.3, ctx.currentTime + 2.5)
    laut.gain.setValueAtTime(0, ctx.currentTime + 4)
    const ziel = ctx.createMediaStreamDestination()
    ton.connect(laut).connect(ziel)
    ton.start()
    return ziel.stream
  }
}

test('dazwischenreden: Briefing hält an, Hermes kennt die Stelle, danach läuft es weiter', async () => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const page = await browser.newPage()
  await page.addInitScript(SPAETER_REDEN)
  await page.route('**/api/stimme/vorlesen', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav(0, 0.4) }))
  await page.route('**/api/hoerbriefing', (r) => r.fulfill({ json: { datum: heute, status: 'fertig', dauerSek: 30 } }))
  await page.route('**/api/hoerbriefing/audio**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav(0, 30) }))
  const anfragen = []
  page.on('request', (r) => { if (r.url().endsWith('/api/stimme/sag')) anfragen.push(r.postDataJSON()) })
  await page.goto(BASE)
  const spaeter = page.getByRole('button', { name: 'Später', exact: true })
  if (await spaeter.count()) await spaeter.first().click()

  const briefing = page.getByRole('button', { name: /Dein Tag zum Anhören/ })
  const stimme = page.locator('.hs-knopf')
  await briefing.click()
  await expect(briefing).toHaveAttribute('aria-pressed', 'true')
  // Ohne Tippen: der Knopf hört mit.
  await expect(stimme).toContainText('Sprich einfach los')

  // Paul redet → das Briefing hält an, das Gespräch läuft.
  await expect(briefing).toHaveAttribute('aria-pressed', 'false', { timeout: 8_000 })
  await expect(stimme).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Auf der Liste: Steuererklärung abschicken')).toBeVisible({ timeout: 15_000 })

  // Hermes bekam die Stelle im Briefing.
  const b = anfragen.at(-1).briefing
  assert(b && b.gesamt === 30 && b.sek > 1 && b.sek < 10, `Stelle ${JSON.stringify(b)}`)

  // Paul sagt nichts mehr → Gespräch zu Ende → Briefing läuft weiter, Knopf hört wieder mit.
  await expect(briefing).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  await expect(stimme).toContainText('Sprich einfach los')
  await page.close()
})

test('dazwischenreden, schneller Weg: „Schreib auf …" ohne Hermes, Briefing läuft weiter', async () => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  writeFileSync(join(datenDir, 'erkannt.txt'), 'Schreib auf: Milch kaufen.')
  const page = await browser.newPage()
  await page.addInitScript(SPAETER_REDEN)
  await page.route('**/api/stimme/vorlesen', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav(0, 0.4) }))
  await page.route('**/api/hoerbriefing', (r) => r.fulfill({ json: { datum: heute, status: 'fertig', dauerSek: 30 } }))
  await page.route('**/api/hoerbriefing/audio**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav(0, 30) }))
  const hermesVorher = anHermes.length
  await page.goto(BASE)
  const spaeter = page.getByRole('button', { name: 'Später', exact: true })
  if (await spaeter.count()) await spaeter.first().click()

  const briefing = page.getByRole('button', { name: /Dein Tag zum Anhören/ })
  const stimme = page.locator('.hs-knopf')
  await briefing.click()
  await expect(stimme).toContainText('Sprich einfach los')
  await expect(briefing).toHaveAttribute('aria-pressed', 'false', { timeout: 8_000 })
  await expect(page.getByText('Auf der Liste: Milch kaufen')).toBeVisible({ timeout: 15_000 })
  expect((await hermesTodos()).map((t) => t.text)).toContain('Milch kaufen')
  // Nach der kurzen Nachfrage-Frist läuft das Briefing weiter.
  await expect(briefing).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  expect(anHermes.length).toBe(hermesVorher)
  writeFileSync(join(datenDir, 'erkannt.txt'), SATZ)
  await page.close()
})

function assert(ok, was) { if (!ok) throw new Error(`Erwartung verfehlt: ${was}`) }
