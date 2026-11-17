import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { calendarPlugin } from './server/calendarPlugin'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Read VITE_GCAL_ICAL_URL — works regardless of npm --prefix invocation dir */
function getIcalUrl(): string | undefined {
  // 1. Parse .env in the same directory as this config file
  const envPath = resolve(__dirname, '.env')
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf-8')
    const match = raw.match(/^VITE_GCAL_ICAL_URL=(.+)$/m)
    if (match) return match[1].trim()
  }
  // 2. loadEnv from this config's directory
  try {
    const env = loadEnv('development', __dirname, '')
    if (env.VITE_GCAL_ICAL_URL) return env.VITE_GCAL_ICAL_URL
  } catch { /* ignore */ }
  return process.env.VITE_GCAL_ICAL_URL
}

const icalUrl = getIcalUrl()
if (icalUrl) {
  console.log('[vite.config] VITE_GCAL_ICAL_URL found ✓')
} else {
  console.warn('[vite.config] VITE_GCAL_ICAL_URL not set — calendar will use mock data')
}

const yahooHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
}

export default defineConfig({
  plugins: [react(), tailwindcss(), calendarPlugin(icalUrl)],
  build: {
    // WARUM DAS HIER STEHEN MUSS:
    // Ohne Ziel-Angabe schreibt der CSS-Minifier `backdrop-filter` in
    // `-webkit-backdrop-filter` UM, statt es zu ergaenzen. Aktuelle Chromium-
    // Versionen kennen die Praefix-Form aber nicht mehr — Ergebnis: die
    // Glasflaechen der ganzen App hatten in Wahrheit gar keine Unschaerfe,
    // nur eine Tonung. Aufgefallen ist es erst, als die Flaeche transparent
    // genug wurde, dass der fehlende Blur sichtbar wurde. (Beim Kupferstich-
    // Theme wurde der Frost deshalb seinerzeit fest ins Bild gebacken.)
    // Ein modernes Ziel laesst die standardkonforme Eigenschaft stehen.
    cssTarget: ['chrome111', 'safari16', 'firefox121', 'edge111'],
  },
  server: {
    // Honor an externally assigned port (Claude's preview autoPort sets PORT)
    // so two sessions' dev servers don't fight over 5173.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    // localhost-only by default. Opt in to LAN exposure (e.g. phone testing at
    // 192.168.x.x:5173) with: VITE_LAN=1 npm run dev
    host: process.env.VITE_LAN === '1',
    proxy: {
      '/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yahoo/, ''),
        headers: yahooHeaders,
      },
      '/yahoo2': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yahoo2/, ''),
        headers: yahooHeaders,
      },
      '/stooq': {
        target: 'https://stooq.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/stooq/, ''),
      },
    },
  },
})
