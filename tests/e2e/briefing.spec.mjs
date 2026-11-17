// Browser-E2E: der Beweis, dass eine konkrete Revision wirklich im DOM steht.
//
// WARUM ES DIESEN TEST BRAUCHT, OBWOHL DER SERVER SCHON ZURÜCKLIEST
// Der Server kann beweisen, dass er geschrieben hat. Ob ein Browser es je
// anzeigt, kann er nicht wissen — und genau dazwischen lag der Fehler vom
// 15.08.: gespeichert, gemeldet, unsichtbar. Dieser Test schliesst die letzte
// Lücke, indem er eindeutige Markierungen veröffentlicht und sie danach im
// gerenderten DOM sucht.
//
// EINMALIGE VORBEREITUNG (lädt ~120 MB Chromium):
//   npx playwright install chromium
// Danach:
//   npm run test:e2e
//
// Der Test startet seinen EIGENEN Server mit einem temporären
// DAILY_DATA_DIR. Er fasst /var/lib/daily nie an.

import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 4897
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'e2e-token'

let server
let datenDir

test.beforeAll(async () => {
  datenDir = mkdtempSync(join(tmpdir(), 'daily-e2e-'))
  server = spawn(
    process.execPath,
    ['-e', `require('${join(ROOT, 'electron', 'server.cjs')}').startServer(${PORT})`],
    {
      // Kein AUTH_PASS: der Testserver ist offen, damit der Browser ohne
      // Basic-Auth-Dialog hineinkommt. Zulässig, weil das Datenverzeichnis
      // frisch und rein synthetisch ist.
      env: { ...process.env, DAILY_DATA_DIR: datenDir, HERMES_TOKEN: TOKEN, AUTH_PASS: '' },
      stdio: 'ignore',
    },
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

/** Veröffentlicht mit eindeutigen Markierungen und gibt die Quittung zurück. */
async function veroeffentliche(marker, extra = {}) {
  const res = await fetch(`${BASE}/api/hermes/briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({
      date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }),
      text: `E2EVOLL-${marker}`,
      lines: {
        headerGreeting: `E2EGRUSS-${marker}`,
        tagline: `E2ETAG-${marker}`,
        todayLead: `E2ELEAD-${marker}`,
      },
      requestId: `e2e-${marker}`,
      ...extra,
    }),
  })
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(200)
  return body.receipt
}

async function quittung(receipt) {
  const r = await fetch(`${BASE}${receipt.verifyUrl}`, { headers: { Authorization: 'Bearer ' + TOKEN } })
  return r.json()
}

test('eine konkrete Revision erscheint auf den sichtbaren Flächen und wird als gerendert quittiert', async ({ page }) => {
  const marker = Date.now()
  const receipt = await veroeffentliche(marker)
  expect(receipt.result).toBe('persisted')
  expect(receipt.display.renderStatus).toBe('pending')   // NIE aus dem POST

  await page.goto(BASE)
  // Die Morgen-Triage legt sich beim ersten Start davor.
  const spaeter = page.getByRole('button', { name: 'Später', exact: true })
  if (await spaeter.count()) await spaeter.first().click()

  // Seit 2026-10-31 zeigt Daily nur noch Gruss und Heute-Zeile. Die
  // Briefing-Karte und die Tagline sind weg (Pauls Entscheidung) — und
  // dürfen dann auch nicht als gerendert gemeldet werden.
  await expect(page.getByText(`E2EGRUSS-${marker}`)).toBeVisible()
  await expect(page.getByText(`E2ELEAD-${marker}`)).toBeVisible()
  await expect(page.getByText(`E2EVOLL-${marker}`)).toHaveCount(0)
  await expect(page.getByText(`E2ETAG-${marker}`)).toHaveCount(0)

  // Und erst jetzt darf die Quittung "rendered" sagen.
  await expect.poll(async () => (await quittung(receipt)).status, { timeout: 15_000 }).toBe('rendered')
  const q = await quittung(receipt)
  for (const flaeche of ['greeting', 'todayLead']) {
    expect(q.display.renderedSurfaces, `Fläche ${flaeche} fehlt`).toContain(flaeche)
  }
  for (const flaeche of ['card', 'tagline']) {
    expect(q.display.renderedSurfaces, `Fläche ${flaeche} ist nicht mehr sichtbar`).not.toContain(flaeche)
  }
})

test('todayLead erscheint AUCH ohne Aufgaben — der Fall, der vorher verworfen wurde', async ({ page }) => {
  const marker = Date.now() + 1
  await veroeffentliche(marker)

  await page.goto(BASE)
  const spaeter = page.getByRole('button', { name: 'Später', exact: true })
  if (await spaeter.count()) await spaeter.first().click()

  // Der Testbestand hat keine Todos. Genau hier stand die Zeile vorher nicht.
  const anzahlTodos = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('morning.todos') || '[]').length } catch { return 0 }
  })
  expect(anzahlTodos, 'Testbestand sollte leer sein').toBe(0)
  await expect(page.getByText(`E2ELEAD-${marker}`)).toBeVisible()
})

test('ohne Briefing zeigt die Herkunftszeile sichtbar, dass die Texte lokal sind', async ({ page }) => {
  // Frischer Server ohne Briefing → Herkunftsmarkierung muss das sagen.
  const res = await fetch(`${BASE}/api/briefing/status`)
  const s = await res.json()
  test.skip(s.state !== 'missing', 'nur sinnvoll ohne Briefing')
  await page.goto(BASE)
  await expect(page.locator('.szl-quelle').getByText(/lokale Texte|kein Hermes-Briefing/)).toBeVisible()
})
