// Daily-Widget für Scriptable (iPhone, und über das iPhone auch der Mac).
//
// Zeigt den Score von heute und die offenen Aufgaben. Nur lesen: Abhaken geht
// weiter in Daily oder per Stimme. Antippen öffnet Daily.
//
// EINRICHTEN
// 1. Scriptable aus dem App Store laden (kostenlos).
// 2. Neues Skript anlegen, diesen Text hineinkopieren, „Daily" nennen.
// 3. Einmal in der App starten: Es fragt nach dem Widget-Schlüssel
//    (DAILY_WIDGET_TOKEN vom Server). Der landet in der Keychain des iPhones.
// 4. Widget hinzufügen: Scriptable, klein, mittel oder groß (oder auf dem
//    Sperrbildschirm), lange drücken → „Widget bearbeiten" → Skript „Daily".
// 5. Tailscale auf dem iPhone an lassen („VPN bei Bedarf"), sonst erreicht
//    das Widget den Server nicht und zeigt den letzten Stand.
// Mac: Widgets bearbeiten → „iPhone-Widgets" → Scriptable. Läuft auf dem
// iPhone und wird auf den Mac gespiegelt.
//
// DURCHSICHTIG WIE DAS GLAS-THEMA
// Ein Widget kann sich nicht selbst durchsichtig machen — das macht das System:
//   iPhone: Startbildschirm lange drücken → Bearbeiten → Anpassen → „Klar".
//   Mac:    Systemeinstellungen → Schreibtisch & Dock → Widget-Stil „Monochrom".
// Dann ersetzt das System den Hintergrund durch Glas und färbt den Inhalt
// selbst. Deshalb trägt hier nichts seine Bedeutung nur über die Farbe:
// Rangfolge über Helligkeit (weiß, halb, kaum), nie über Blau gegen Grau.
// Der Nachtblau-Grund ist nur für den normalen, farbigen Modus.
//
// VERBINDET NICHT?
// Skript in der Scriptable-App starten — dann steht der genaue Fehler da.

const SERVER = 'http://your-server.example:4861'
const SCHLUESSEL = 'daily.widget.token'
const ABLAGE = 'daily-widget-stand.json'
const AUFFRISCHEN_MIN = 15

// Stil G, Thema Glas: Nachtblau wie die Glasscheibe über dunklem Grund, ein Akzent.
const FARBE = {
  grund: new Color('#16222F'),
  grundUnten: new Color('#0B141F'),
  text1: new Color('#EDEDF4'),
  text2: new Color('#EDEDF4', 0.68),
  text3: new Color('#EDEDF4', 0.44),
  spur: new Color('#EDEDF4', 0.12),
  akzent: new Color('#4497E4'),
  warn: new Color('#DCBA6A'),
}

// ---------- Schlüssel ----------

async function frageSchluessel() {
  const a = new Alert()
  a.title = 'Daily-Widget'
  a.message = 'Widget-Schlüssel vom Server (DAILY_WIDGET_TOKEN).'
  a.addSecureTextField('Schlüssel', '')
  a.addAction('Speichern')
  a.addCancelAction('Abbrechen')
  if ((await a.presentAlert()) === -1) return null
  const wert = a.textFieldValue(0).trim()
  if (!wert) return null
  Keychain.set(SCHLUESSEL, wert)
  return wert
}

function schluessel() {
  return Keychain.contains(SCHLUESSEL) ? Keychain.get(SCHLUESSEL) : null
}

// ---------- Stand holen, letzten guten merken ----------

const fm = FileManager.local()
const ablagePfad = fm.joinPath(fm.documentsDirectory(), ABLAGE)

function letzterStand() {
  try { return fm.fileExists(ablagePfad) ? JSON.parse(fm.readString(ablagePfad)) : null } catch { return null }
}

async function holeStand(token) {
  const req = new Request(SERVER + '/api/widget')
  req.headers = { Authorization: 'Bearer ' + token }
  req.timeoutInterval = 10
  try {
    const body = await req.loadJSON()
    const code = (req.response && req.response.statusCode) || 0
    if (code === 200 && body && body.aufgaben) {
      fm.writeString(ablagePfad, JSON.stringify(body))
      return { stand: body, frisch: true }
    }
    const hinweis = code === 401 ? 'Schlüssel passt nicht' : code === 403 ? 'Widget auf dem Server aus' : 'Server antwortet nicht'
    const detail = `HTTP ${code}${body && body.error ? ' — ' + body.error : ''}`
    return { stand: letzterStand(), frisch: false, hinweis, detail }
  } catch (e) {
    const detail = String((e && e.message) || e)
    const hinweis = /secure connection|Transport Security|ATS/i.test(detail) ? 'iOS verlangt HTTPS' : 'Nicht erreichbar · Tailscale an?'
    return { stand: letzterStand(), frisch: false, hinweis, detail }
  }
}

/** In der App: sagen, was genau schiefging, statt nur „offline". */
async function zeigeFehler(ergebnis) {
  const a = new Alert()
  a.title = ergebnis.hinweis
  a.message = `${ergebnis.detail}\n\nServer: ${SERVER}`
  a.addAction('Vorschau trotzdem')
  a.addAction('Schlüssel neu eingeben')
  a.addCancelAction('Schließen')
  return a.presentAlert()
}

// ---------- Bausteine ----------

function text(stack, inhalt, groesse, farbe, gewicht = 'regular') {
  const t = stack.addText(inhalt)
  t.font = gewicht === 'medium' ? Font.mediumSystemFont(groesse) : Font.systemFont(groesse)
  t.textColor = farbe
  return t
}

function uhrzeit(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function stunden(min) {
  return (min / 60).toFixed(1).replace('.', ',').replace(/,0$/, '') + ' h'
}

/** Dünne Leiste: Anteil des Scores an 100. */
function leiste(stack, anteil, breite) {
  const hoehe = 4
  const dc = new DrawContext()
  dc.size = new Size(breite, hoehe)
  dc.opaque = false
  dc.respectScreenScale = true
  const rund = (w) => { const p = new Path(); p.addRoundedRect(new Rect(0, 0, w, hoehe), 2, 2); return p }
  dc.addPath(rund(breite)); dc.setFillColor(FARBE.spur); dc.fillPath()
  const w = Math.max(0, Math.min(1, anteil)) * breite
  if (w > 0) { dc.addPath(rund(Math.max(w, hoehe))); dc.setFillColor(FARBE.akzent); dc.fillPath() }
  const bild = stack.addImage(dc.getImage())
  bild.imageSize = new Size(breite, hoehe)
}

function scoreZahl(stand) {
  return stand && Number.isFinite(stand.score) ? String(Math.round(stand.score)) : '–'
}

function fussZeile(stack, ergebnis) {
  const { stand, frisch, hinweis } = ergebnis
  const zeile = frisch ? `Stand ${uhrzeit(stand.stand)}` : `${hinweis}${stand ? ' · ' + uhrzeit(stand.stand) : ''}`
  text(stack, zeile, 11, frisch ? FARBE.text3 : FARBE.warn).lineLimit = 1
}

// ---------- Größen ----------

function scoreBlock(stack, stand, breite) {
  text(stack, 'Heute', 13, FARBE.text2)
  stack.addSpacer(4)
  const zeile = stack.addStack()
  zeile.bottomAlignContent()
  text(zeile, scoreZahl(stand), 44, FARBE.text1, 'medium')
  zeile.addSpacer(4)
  const rest = zeile.addStack(); rest.layoutVertically()
  text(rest, '/100', 13, FARBE.text3)
  rest.addSpacer(8)
  stack.addSpacer(8)
  leiste(stack, (stand && stand.score ? stand.score : 0) / 100, breite)
  stack.addSpacer(8)
  const lern = stand ? `${stunden(stand.lernMin)} von ${stunden(stand.zielMin)}` : ''
  if (lern) text(stack, lern, 12, FARBE.text2).lineLimit = 1
  if (stand && Number.isFinite(stand.gestern)) text(stack, `gestern ${stand.gestern}`, 12, FARBE.text3)
}

function aufgabenBlock(stack, stand, anzahl) {
  const a = stand ? stand.aufgaben : { offen: 0, erledigt: 0, liste: [] }
  text(stack, a.offen === 0 ? 'Alles erledigt' : `${a.offen} offen · ${a.erledigt} erledigt`, 13, FARBE.text2)
  stack.addSpacer(8)
  for (const t of a.liste.slice(0, anzahl)) {
    const zeile = stack.addStack()
    zeile.centerAlignContent()
    const strich = zeile.addStack()
    strich.size = new Size(3, 14)
    strich.cornerRadius = 1.5
    strich.backgroundColor = t.prio === 'dringend' ? FARBE.akzent : t.prio === 'wichtig' ? FARBE.text3 : FARBE.spur
    zeile.addSpacer(8)
    text(zeile, t.text, 14, FARBE.text1).lineLimit = 1
    stack.addSpacer(8)
  }
  const mehr = a.offen - Math.min(anzahl, a.liste.length)
  if (mehr > 0) text(stack, `+ ${mehr} weitere`, 12, FARBE.text3)
}

function grundWidget() {
  const w = new ListWidget()
  const g = new LinearGradient()
  g.colors = [FARBE.grund, FARBE.grundUnten]
  g.locations = [0, 1]
  w.backgroundGradient = g
  w.setPadding(16, 16, 16, 16)
  w.url = SERVER
  w.refreshAfterDate = new Date(Date.now() + AUFFRISCHEN_MIN * 60_000)
  return w
}

function baueWidget(familie, ergebnis) {
  const { stand } = ergebnis

  // Sperrbildschirm: das System färbt selbst.
  if (familie === 'accessoryCircular') {
    const w = new ListWidget()
    w.url = SERVER
    const t = w.addText(scoreZahl(stand)); t.font = Font.mediumSystemFont(22); t.centerAlignText()
    const u = w.addText('Score'); u.font = Font.systemFont(10); u.centerAlignText()
    return w
  }
  if (familie === 'accessoryRectangular' || familie === 'accessoryInline') {
    const w = new ListWidget()
    w.url = SERVER
    const offen = stand ? stand.aufgaben.offen : 0
    const t = w.addText(`Score ${scoreZahl(stand)} · ${offen} offen`); t.font = Font.mediumSystemFont(14)
    if (familie === 'accessoryRectangular' && stand && stand.aufgaben.liste[0]) {
      const n = w.addText(stand.aufgaben.liste[0].text); n.font = Font.systemFont(12); n.lineLimit = 2
    }
    return w
  }

  const w = grundWidget()
  if (familie === 'small') {
    scoreBlock(w, stand, 120)
    w.addSpacer()
    fussZeile(w, ergebnis)
    return w
  }

  const oben = w.addStack()
  oben.topAlignContent()
  const links = oben.addStack(); links.layoutVertically(); links.size = new Size(120, 0)
  scoreBlock(links, stand, 112)
  oben.addSpacer(16)
  const rechts = oben.addStack(); rechts.layoutVertically()
  aufgabenBlock(rechts, stand, familie === 'large' ? 5 : 3)
  if (familie === 'large' && stand && stand.teile) {
    w.addSpacer(16)
    const t = stand.teile
    text(w, `Lernzeit ${t.lernzeit} · Aufgaben ${t.aufgaben}${t.routinen ? ' · Routinen ' + t.routinen : ''}${t.altlasten ? ' · Altlasten −' + Math.abs(t.altlasten) : ''}`, 12, FARBE.text2).lineLimit = 2
  }
  w.addSpacer()
  fussZeile(w, ergebnis)
  return w
}

// ---------- Ablauf ----------

let token = schluessel()

if (!config.runsInWidget) {
  // In der App: Schlüssel setzen oder ändern, dann Vorschau.
  if (token) {
    const a = new Alert()
    a.title = 'Daily-Widget'
    a.addAction('Vorschau')
    a.addAction('Schlüssel ändern')
    a.addCancelAction('Fertig')
    const wahl = await a.presentAlert()
    if (wahl === 1) token = await frageSchluessel()
    if (wahl === -1) token = null
  } else {
    token = await frageSchluessel()
  }
  if (token) {
    let ergebnis = await holeStand(token)
    if (!ergebnis.frisch) {
      const wahl = await zeigeFehler(ergebnis)
      if (wahl === 1 && (token = await frageSchluessel())) ergebnis = await holeStand(token)
      if (wahl === -1) token = null
    }
    if (token) await baueWidget('medium', ergebnis).presentMedium()
  }
} else if (!token) {
  const w = grundWidget()
  text(w, 'Daily', 15, FARBE.text1, 'medium')
  w.addSpacer(8)
  text(w, 'Einmal in Scriptable starten und den Schlüssel eingeben.', 12, FARBE.text2)
  Script.setWidget(w)
} else {
  Script.setWidget(baueWidget(config.widgetFamily || 'medium', await holeStand(token)))
}

Script.complete()
