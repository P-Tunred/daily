const { app, BrowserWindow, shell, session, systemPreferences } = require('electron')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

let win = null
let viteProc = null

// Must match the Vite dev server. Vite's default is 5173 (vite.config.ts sets
// no custom port), so Electron has to look there too.
const PORT = 5173

// ── Is something already serving on PORT? ─────────────────────────────────────

function isServerUp(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => { res.destroy(); resolve(true) })
    req.on('error', () => resolve(false))
    req.setTimeout(400, () => { req.destroy(); resolve(false) })
  })
}

// ── Start the Vite dev server ourselves (dev only) ────────────────────────────
// So `npm run electron` is a single command — no need to keep a separate
// `npm run dev` terminal open. If one is already running, we reuse it.

function startViteDev() {
  const root = path.join(__dirname, '..')
  viteProc = spawn('npm run dev', {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: true,
  })
  viteProc.on('error', (e) => console.error('[Daily] Failed to start Vite:', e.message))
}

function killVite() {
  if (viteProc && !viteProc.killed) {
    try { viteProc.kill() } catch { /* already gone */ }
  }
  viteProc = null
}

// ── Wait until Vite is accepting connections ──────────────────────────────────

function waitForServer(retries = 120) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://localhost:${PORT}`, (res) => {
        res.destroy()
        resolve()
      })
      req.on('error', () => {
        if (retries-- > 0) setTimeout(check, 500)
        else reject(new Error('Vite server did not start in time'))
      })
      req.setTimeout(500, () => { req.destroy() })
    }
    check()
  })
}

// ── Create the app window ─────────────────────────────────────────────────────

function createWindow(targetUrl) {
  // DURCHSICHTIGES FENSTER
  // Das Fenster ist IMMER transparent, sichtbar wird das aber nur im Thema
  // "Glas" — alle anderen Themen malen in .stage ein deckendes Foto darueber.
  // So braucht der Wechsel kein neues Fenster: Electron kann `transparent`
  // naemlich nur beim Erzeugen setzen, ein Umschalten zur Laufzeit gibt es
  // nicht. Ein immer transparentes Fenster plus ein Thema, das die Buehne
  // leer laesst, kommt ohne diesen Neustart aus.
  // `vibrancy` laesst macOS den Schreibtisch selbst weichzeichnen — das ist
  // der Apple-Glas-Effekt und deutlich sauberer (und billiger) als ein
  // backdrop-filter, der ohnehin nur Seiteninhalt erfassen wuerde, nicht den
  // Desktop dahinter. Nur macOS; anderswo bleibt es schlicht transparent.
  const mac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    // Voll durchsichtig statt '#0a0a0c' — eine deckende Fensterfarbe wuerde
    // hinter dem leeren .stage stehen und den Schreibtisch verdecken.
    backgroundColor: '#00000000',
    ...(mac ? { vibrancy: REMOTE.vibrancy, visualEffectState: 'active' } : {}),
    title: 'Daily',
    show: false,  // hidden until content is ready — prevents blank flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,  // DevTools in dev only — off in the shipped app
    },
  })

  // EIGENE KENNUNG
  // Die Seite muss wissen, ob sie WIRKLICH in diesem transparenten Fenster
  // laeuft — nur dann darf sie den Untergrund wegnehmen. "Electron" im
  // User-Agent reicht dafuer nicht: andere Electron-Programme (etwa der
  // Vorschau-Browser in Claude Code) bringen dieselbe Kennung mit und wuerden
  // faelschlich mitgezaehlt. Die Seite stuende dort dann hell auf hell.
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' DailyShell/1')

  // Show and steal focus only once the page has finished rendering
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    app.focus({ steal: true })  // takes focus from Safari / whichever app is frontmost
  })

  win.loadURL(targetUrl)

  // Open external links in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => { win = null })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

// ── Fernbetrieb ───────────────────────────────────────────────────────────────
// Ist DAILY_REMOTE_URL gesetzt, startet die App KEINEN eigenen Server, sondern
// zeigt auf einen entfernten (die VM). Das Fenster ist dann nur noch die
// Anzeige, der Zustand lebt auf dem Server — damit gibt es wieder genau eine
// Wahrheit statt zwei, und dasselbe Dashboard steht auf jedem Gerät.
// Gelesen wird aus zwei Quellen, in dieser Reihenfolge:
//   1. Umgebungsvariablen — praktisch beim Ausprobieren aus dem Terminal
//   2. ~/Library/Application Support/Daily/remote.json — für den Alltag
// Der zweite Weg ist der wichtige: eine per Doppelklick im Dock gestartete App
// erbt KEINE Shell-Variablen. Ohne Datei liefe der Fernbetrieb also nur aus dem
// Terminal, und genau das soll er nicht. Die Datei liegt außerhalb des Bundles
// und überlebt damit jedes `npm run dist`.
function readRemoteConfig() {
  const fs = require('fs')
  const os = require('os')
  const cfg = { url: '', user: 'paul', pass: '', vibrancy: 'fullscreen-ui' }
  try {
    const p = path.join(os.homedir(), 'Library', 'Application Support', 'Daily', 'remote.json')
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (typeof raw.url === 'string') cfg.url = raw.url.trim()
    if (typeof raw.user === 'string') cfg.user = raw.user.trim()
    if (typeof raw.pass === 'string') cfg.pass = raw.pass
    // Wie stark macOS den Schreibtisch hinter dem Glas-Thema weichzeichnet.
    // Das ist KEIN Pixelwert, sondern eine Materialauswahl von macOS — mehr
    // Unschaerfe heisst hier: anderes Material. Von zart nach kraeftig etwa
    // 'sidebar' < 'under-window' < 'fullscreen-ui' < 'hud' (hud ist zugleich
    // am dunkelsten). Steht hier, damit ein Wechsel kein Neupacken der App
    // braucht — Datei aendern, Daily neu starten, fertig.
    if (typeof raw.vibrancy === 'string' && raw.vibrancy.trim()) cfg.vibrancy = raw.vibrancy.trim()
  } catch { /* keine Datei — dann eben lokal */ }
  if (process.env.DAILY_REMOTE_URL) cfg.url = process.env.DAILY_REMOTE_URL.trim()
  if (process.env.DAILY_REMOTE_USER) cfg.user = process.env.DAILY_REMOTE_USER.trim()
  if (process.env.DAILY_REMOTE_PASS) cfg.pass = process.env.DAILY_REMOTE_PASS
  return cfg
}

const REMOTE = readRemoteConfig()
const REMOTE_URL = REMOTE.url

// MIKROFON FÜR „MIT HERMES SPRECHEN"
// Chromium gibt getUserMedia nur sicheren Seiten. Die VM wird über Tailscale
// per http angesprochen — verschlüsselt ist die Strecke durch Tailscale, nur
// weiss Chromium das nicht. Genau dieser eine Ursprung gilt deshalb als sicher,
// sonst keiner. Muss vor app.whenReady() stehen.
if (REMOTE_URL) {
  try {
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', new URL(REMOTE_URL).origin)
  } catch (e) {
    console.warn('[Daily] remote-URL unlesbar, Mikrofon bleibt aus:', e.message)
  }
}

// Der entfernte Server verlangt Basic-Auth. Ohne diesen Zuhörer bricht Electron
// die Anfrage stillschweigend ab, statt zu fragen — das Fenster bliebe leer.
app.on('login', (event, _wc, _details, authInfo, callback) => {
  if (!authInfo.isProxy && REMOTE_URL && REMOTE.pass) {
    event.preventDefault()
    callback(REMOTE.user, REMOTE.pass)
    return
  }
  if (!authInfo.isProxy && REMOTE_URL) {
    console.warn('[Daily] Kein Passwort in remote.json — die Anmeldung schlägt fehl.')
  }
})

app.whenReady().then(async () => {
  // Grant geolocation permission so navigator.geolocation works in the renderer.
  // macOS will show its own "Allow location access?" prompt the first time.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    // geolocation → weather; notifications → proactive nudges; media → mic for
    // the spoken "Stopp" interrupt during the voice briefing.
    // Mikrofon: macOS erst fragen, wenn die Seite es wirklich will — beim
    // ersten Tippen auf „Mit Hermes sprechen", nicht beim App-Start.
    if (permission === 'media' && process.platform === 'darwin') {
      systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false))
      return
    }
    callback(permission === 'geolocation' || permission === 'notifications' || permission === 'media')
  })

  // Lock down the renderer in the packaged app: no inline scripts (neutralises
  // XSS payloads), self + https for img/connect (map tiles, weather APIs, the
  // local /api/* endpoints). Skipped in dev — the Vite dev server needs inline
  // scripts, eval and HMR which a strict policy would break.
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
              "script-src 'self'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https:; " +
              "font-src 'self' data:; " +
              // blob: — Hermes' gesprochene Antwort kommt als Blob-URL
              // (src/lib/vorleser.ts); ohne das bliebe sie stumm.
              "media-src 'self' blob:; " +
              "connect-src 'self' https:; " +
              "frame-src 'none'; object-src 'none'; base-uri 'self'",
          ],
        },
      })
    })
  }

  let targetUrl = `http://localhost:${PORT}`

  if (REMOTE_URL) {
    // Fernbetrieb: kein lokaler Server, kein Vite. Nur ein Fenster auf die VM.
    console.log('[Daily] Fernbetrieb →', REMOTE_URL)
    targetUrl = REMOTE_URL
  } else if (app.isPackaged) {
    // Standalone build: run the built-in server (static frontend + calendar
    // API) so the app is fully self-contained — no Vite, no terminal needed.
    // We deliberately use host "localhost" + port 5174 — the SAME origin your
    // existing Daily data was saved under — so the app inherits all of it
    // automatically, and keeps it persistently across launches.
    const STANDALONE_PORT = 5174
    try {
      const { startServer } = require('./server.cjs')
      await startServer(STANDALONE_PORT)
    } catch (e) {
      // Port busy → a previous Daily server is likely already serving it.
      // Reuse it (same origin keeps your data intact) instead of a new port.
      console.warn('[Daily] reusing existing server on', STANDALONE_PORT, '—', e && e.message)
    }
    targetUrl = `http://localhost:${STANDALONE_PORT}`
  } else {
    // Dev: reuse a running Vite dev server, or start one ourselves.
    const alreadyUp = await isServerUp(PORT)
    if (!alreadyUp) startViteDev()
    try {
      await waitForServer()
    } catch (e) {
      console.error('[Daily] Could not reach Vite server on port', PORT, '—', e.message)
      console.error('[Daily] In dev, run "npm run dev" first (or launch via "npm run electron").')
    }
  }

  createWindow(targetUrl)
})

app.on('activate', () => {
  if (win === null) createWindow()
})

app.on('before-quit', killVite)

app.on('window-all-closed', () => {
  killVite()
  if (process.platform !== 'darwin') app.quit()
})
