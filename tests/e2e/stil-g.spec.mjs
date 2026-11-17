// Browser-E2E: der Stil „G" (Seite G im Design-Canvas) als eigene Einstellung.
// Paul, 2026-11-01: „ich will, dass es so aussieht wie in G — einfach nur als
// Setting für G". Mit „Original" muss alles bleiben, wie es war — auch dann,
// wenn die Startseite „Still" gewählt ist.
//
// Geprüft wird, was man sieht: im Stil G die Startseite Still, die neuen
// G-Karten (Aufgaben, Woche, Horizont, Lernzeit), kein Titel und kein Satz oben,
// Glas mit Weichzeichner — und im Original das Gegenteil.

import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 4870 + Math.floor(Math.random() * 20)
const BASE = `http://127.0.0.1:${PORT}`

let server
let datenDir

test.beforeAll(async () => {
  datenDir = mkdtempSync(join(tmpdir(), 'daily-e2e-g-'))
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

/** Stil und Startseite umstellen wie die Schalter in den Einstellungen. */
async function stelle(page, { stil, intro = 'original' }) {
  await page.evaluate(([s, i]) => {
    localStorage.setItem('morning.stil', s)
    localStorage.setItem('morning.introLayout', i)
    window.dispatchEvent(new Event('morning:stil'))
    window.dispatchEvent(new Event('morning:intro-layout'))
  }, [stil, intro])
  await expect(page.locator('html')).toHaveAttribute('data-stil', stil)
}

const stil = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop)

test('Stil G: Startseite Still, G-Karten, Lernzeit ohne Titel und Satz, Glas weich', async ({ page }) => {
  await page.goto(BASE)
  await stelle(page, { stil: 'g' })
  // G übernimmt die Startseite „Still", auch wenn als Startseite „Original" gewählt ist.
  await expect(page.locator('.still-intro')).toBeVisible()
  await expect(page.locator('#g-aufg-h')).toHaveText('Deine Aufgaben')
  await expect(page.locator('#g-woche-h')).toHaveText('Diese Woche')
  await expect(page.locator('#g-hz-h')).toHaveText('Dein Horizont')
  await expect(page.getByRole('radiogroup', { name: 'Priorität' })).toBeVisible()
  expect(await stil(page.locator('.g-blatt').first(), 'backdropFilter')).toContain('blur')

  // Eine Aufgabe anlegen geht über die G-Eingabe wie im Original.
  await page.getByPlaceholder('Was kommt dazu?').fill('E2E-Aufgabe G')
  await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
  await expect(page.locator('.g-aufgabe', { hasText: 'E2E-Aufgabe G' })).toBeVisible()

  await page.goto(BASE + '/#/lernzeit')
  await expect(page.locator('#g-lz-heute')).toHaveText('Heute gelernt')
  await expect(page.locator('.lz-titel')).toBeHidden()
  await expect(page.locator('.lern-statement')).toHaveCount(0)
})

test('Original mit Startseite Still: alles wie vorher', async ({ page }) => {
  await page.goto(BASE)
  await stelle(page, { stil: 'original', intro: 'still' })
  await expect(page.locator('.still-intro')).toBeVisible()
  await expect(page.locator('.g-blatt')).toHaveCount(0)

  const titel = page.locator('.card-title').first()
  await expect(titel).toBeVisible()
  expect(await stil(titel, 'textTransform')).toBe('uppercase')

  await page.goto(BASE + '/#/lernzeit')
  await expect(page.locator('.lz-titel')).toBeVisible()
  await expect(page.locator('.lern-statement')).toBeVisible()
  const abschnitt = page.locator('.lernzeit-page .flat-section:not(.flat-hero)').first()
  expect(await stil(abschnitt, 'backdropFilter')).toBe('none')
})
