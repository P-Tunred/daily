// Browser-E2E: der Hörbriefing-Knopf im Intro (seit 2026-11-01 schlicht).
//
// Der Server-Teil (Aufnahme, Regeln) ist in tests/hoerbriefing.test.mjs
// geprüft. Hier geht es um das, was Paul sieht: EIN Knopf mit Dauer, der
// abspielt und pausiert — und gar nichts, wenn es keine Aufnahme gibt.
// Status und Audio werden im Browser vorgespielt (page.route), damit keine
// Stimme gebraucht wird. Eigener Server mit temporärem DAILY_DATA_DIR.

import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 4898
const BASE = `http://127.0.0.1:${PORT}`
const HEUTE = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

let server
let datenDir

test.beforeAll(async () => {
  datenDir = mkdtempSync(join(tmpdir(), 'daily-e2e-hb-'))
  server = spawn(
    process.execPath,
    ['-e', `require('${join(ROOT, 'electron', 'server.cjs')}').startServer(${PORT})`],
    { env: { ...process.env, DAILY_DATA_DIR: datenDir, HERMES_TOKEN: 'e2e-token', AUTH_PASS: '' }, stdio: 'ignore' },
  )
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.status) break } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 500))
  }
})

test.afterAll(() => {
  if (server) server.kill()
  if (datenDir) rmSync(datenDir, { recursive: true, force: true })
})

/** Zwei Sekunden Stille als WAV — reicht, um Abspielen und Pause zu prüfen. */
function stille(sek = 2) {
  const rate = 8000
  const daten = rate * sek
  const b = Buffer.alloc(44 + daten)
  b.write('RIFF', 0); b.writeUInt32LE(36 + daten, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34)
  b.write('data', 36); b.writeUInt32LE(daten, 40); b.fill(128, 44)
  return b
}

async function oeffne(page, stand, { audio = 'ok' } = {}) {
  await page.route('**/api/hoerbriefing', (r) => r.fulfill({ json: stand }))
  await page.route('**/api/hoerbriefing/audio**', (r) =>
    audio === 'ok'
      ? r.fulfill({ status: 200, contentType: 'audio/wav', body: stille() })
      : r.fulfill({ status: 404, json: { error: 'keine Aufnahme' } }))
  await page.goto(BASE)
  const spaeter = page.getByRole('button', { name: 'Später', exact: true })
  if (await spaeter.count()) await spaeter.first().click()
  // Das Intro steht, sobald der Gruss da ist — erst dann ist „kein Knopf" eine Aussage.
  await expect(page.locator('.szl-greet h1')).toBeVisible()
}

const knopf = (page) => page.getByRole('button', { name: /Dein Tag zum Anhören/ })

test('fertige Aufnahme: ein Knopf mit Dauer, Klick spielt, Klick pausiert', async ({ page }) => {
  await oeffne(page, { datum: HEUTE, status: 'fertig', dauerSek: 222, text: 'GEHEIMTEXT-E2E', frage: { id: 'x', frage: 'FRAGE-E2E?' } })
  await expect(knopf(page)).toBeVisible()
  await expect(knopf(page)).toHaveAttribute('aria-pressed', 'false')
  // Kein Text, keine Frage, keine Spulleiste, kein Tempo — nur der Knopf.
  await expect(page.getByText('GEHEIMTEXT-E2E')).toHaveCount(0)
  await expect(page.getByText(/FRAGE-E2E/)).toHaveCount(0)
  await expect(page.locator('.hb input, .hb details')).toHaveCount(0)
  await expect(page.locator('.hb button')).toHaveCount(1)

  await knopf(page).click()
  await expect(knopf(page)).toHaveAttribute('aria-pressed', 'true')
  await knopf(page).click()
  await expect(knopf(page)).toHaveAttribute('aria-pressed', 'false')
})

for (const [fall, stand] of [
  ['noch keine Aufnahme', { datum: null }],
  ['Aufnahme entsteht', { datum: HEUTE, status: 'erzeuge' }],
  ['Aufnahme fehlgeschlagen', { datum: HEUTE, status: 'fehler', fehler: 'Stimme weg' }],
]) {
  test(`${fall}: kein Knopf, kein Hinweis`, async ({ page }) => {
    await oeffne(page, stand)
    await expect(knopf(page)).toHaveCount(0)
    await expect(page.locator('.hb')).toHaveCount(0)
    await expect(page.getByText(/nicht entstanden|wird gerade aufgenommen/)).toHaveCount(0)
  })
}

test('Audio fehlt trotz „fertig": der Knopf verschwindet statt tot herumzustehen', async ({ page }) => {
  await oeffne(page, { datum: HEUTE, status: 'fertig', dauerSek: 60 }, { audio: 'fehlt' })
  await expect(knopf(page)).toHaveCount(0)
})
