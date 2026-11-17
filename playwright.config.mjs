// Playwright nur fuer die Browser-Nachweise. Der Rest laeuft ueber node:test
// (keine Abhaengigkeit noetig) — siehe tests/briefing-contract.test.mjs.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Ein Arbeiter: die Tests teilen sich einen Server mit einem Datenverzeichnis.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { headless: true },
})
