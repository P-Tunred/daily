// Uebersicht ueber Pauls KI-Abos — Claude, z.ai/GLM, Codex/ChatGPT.
//
// WARUM EIN EIGENES MODUL UND NICHT EIN FELD MEHR IN usageStats
// usageStats beantwortet eine einzige Frage: "wie voll ist das Kontingent?"
// Das speist die Randleisten und muss schnell sein. Hier geht es um etwas
// anderes — Plan, Laufzeit, Kosten, Herkunft der Zahl —, und das kommt aus
// drei Quellen mit drei verschiedenen Verlaesslichkeiten. In einen Topf
// geworfen liesse sich hinterher nicht mehr sagen, welche Zahl woher stammt.
//
// DIE DREI DIENSTE HABEN DREI VERSCHIEDENE WEGE
//   z.ai   — echte API, laeuft auf der VM selbst. Verlaesslichste Quelle.
//   Claude — OAuth-Quote. Haengt am Login von Claude Code; auf der VM gibt es
//            den nicht, deshalb schiebt der Mac die fertigen Prozente hoch.
//   Codex  — ChatGPTs Backend ist hinter Cloudflare-Botabwehr (403 auf jede
//            programmatische Anfrage). Verbrauch ist damit NICHT abrufbar.
//            Plan und Laufzeit stehen aber im lokalen Anmeldetoken, und den
//            schiebt der Mac mit hoch.
//
// GRUNDREGEL
// "weiss ich nicht" ist ein eigener Zustand und wird nie zu "alles gut"
// verkuerzt. Eine Karte, die bei fehlender Anmeldung einfach 0 % anzeigt,
// waere schlimmer als gar keine Karte.

const fs = require('fs')
const { dataPath } = require('./dataDir.cjs')
const usageStats = require('./usageStats.cjs')

const CODEX_PATH = dataPath('codex-abo.json')

// Der vom Mac zugespielte Codex-Stand altert langsamer als eine Quote: Plan
// und Laufzeit aendern sich hoechstens monatlich. 14 Tage sind grosszuegig
// genug, dass ein Urlaub ohne Mac die Karte nicht leerraeumt, und eng genug,
// dass ein gekuendigtes Abo nicht ewig weiterleuchtet.
const CODEX_MAX_ALTER_MS = 14 * 24 * 60 * 60 * 1000

const ZONE = 'Europe/Berlin'

function serverDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
}

// ── Kosten ───────────────────────────────────────────────────────────────────
// Kein Anbieter verraet ueber eine API, was Paul zahlt. Das weiss nur er.
// Deshalb aus der Umgebung, und wenn dort nichts steht, wird auch nichts
// behauptet: eine erfundene Zahl in einer Kostenuebersicht ist schlimmer als
// eine leere Spalte.
//
// Format in /etc/daily/env (eine Zeile, JSON):
//   ABO_KOSTEN={"claude":{"betrag":20,"waehrung":"USD"},"glm":{"betrag":3}}
function leseKosten() {
  // Umgebung zuerst (VM: /etc/daily/env), dann die .env im Projekt — dieselbe
  // Reihenfolge wie beim z.ai-Schluessel. Ohne den zweiten Weg haette die
  // App auf dem Mac nie Preise, obwohl dort jede andere Einstellung ankommt.
  let roh = (process.env.ABO_KOSTEN || '').trim()
  if (!roh) {
    try {
      const datei = fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf-8')
      const m = datei.match(/^ABO_KOSTEN=(.+)$/m)
      if (m) roh = m[1].trim().replace(/^['"]|['"]$/g, '')
    } catch { /* keine .env — dann eben keine Preise */ }
  }
  if (!roh) return {}
  try {
    const doc = JSON.parse(roh)
    if (!doc || typeof doc !== 'object') return {}
    const out = {}
    for (const [id, wert] of Object.entries(doc)) {
      const betrag = Number(wert && wert.betrag)
      if (!Number.isFinite(betrag) || betrag < 0) continue
      out[id] = {
        betrag,
        waehrung: typeof wert.waehrung === 'string' ? wert.waehrung : 'EUR',
        zyklus: wert.zyklus === 'jaehrlich' ? 'jaehrlich' : 'monatlich',
      }
    }
    return out
  } catch {
    console.warn('[abo] ABO_KOSTEN ist kein gueltiges JSON — Kosten bleiben leer.')
    return {}
  }
}

/** Alles auf einen Monatsbetrag bringen, damit sich die Summe bilden laesst. */
function proMonat(kosten) {
  if (!kosten) return null
  return kosten.zyklus === 'jaehrlich' ? kosten.betrag / 12 : kosten.betrag
}

// ── Codex (vom Mac zugespielt) ───────────────────────────────────────────────

function gueltigerVerbrauch(v) {
  if (!v || typeof v !== 'object') return null
  const woche = Number(v.wocheProzent)
  if (!Number.isFinite(woche)) return null
  const fuenf = Number(v.fuenfStundenProzent)
  return {
    wocheProzent: Math.max(0, Math.min(100, woche)),
    fuenfStundenProzent: Number.isFinite(fuenf) ? Math.max(0, Math.min(100, fuenf)) : null,
    resetAt: typeof v.resetAt === 'string' ? v.resetAt : null,
    gemessenAm: typeof v.gemessenAm === 'string' ? v.gemessenAm : null,
  }
}

function schreibeCodex(input) {
  const plan = typeof input.plan === 'string' && input.plan.trim() ? input.plan.trim() : null
  if (!plan) throw new Error('Feld "plan" fehlt')
  const doc = {
    plan,
    laufzeitBis: typeof input.laufzeitBis === 'string' ? input.laufzeitBis : null,
    laufzeitAb: typeof input.laufzeitAb === 'string' ? input.laufzeitAb : null,
    // Wann der Mac den Anmeldetoken zuletzt erneuert hat. Das ist das Alter der
    // Aussage, nicht das Alter der Datei — beides auseinanderzuhalten ist der
    // ganze Sinn dieser Uebung.
    standVon: typeof input.standVon === 'string' ? input.standVon : null,
    // Verbrauch aus dem Sitzungsprotokoll der Codex-CLI. Die Werte stammen aus
    // derselben Antwort, die auch die CLI sieht — aber sie sind nur so frisch
    // wie die letzte Codex-Nutzung. `gemessenAm` ist deshalb Pflicht und wird
    // angezeigt: eine Prozentzahl ohne ihren Zeitpunkt wäre hier gelogen.
    verbrauch: gueltigerVerbrauch(input.verbrauch),
    empfangenAm: new Date().toISOString(),
  }
  fs.mkdirSync(require('path').dirname(CODEX_PATH), { recursive: true })
  fs.writeFileSync(CODEX_PATH, JSON.stringify(doc, null, 2) + '\n')
  return doc
}

function leseCodex() {
  try {
    const doc = JSON.parse(fs.readFileSync(CODEX_PATH, 'utf-8'))
    if (!doc || typeof doc.plan !== 'string') return null
    const alter = Date.now() - Date.parse(doc.empfangenAm || 0)
    if (!Number.isFinite(alter) || alter > CODEX_MAX_ALTER_MS) return { ...doc, zuAlt: true, alterMs: alter }
    return { ...doc, zuAlt: false, alterMs: alter }
  } catch {
    return null
  }
}

// ── Die drei Dienste ─────────────────────────────────────────────────────────

const PLAN_NAMEN = { lite: 'Coding Lite', pro: 'Pro', max: 'Max', team: 'Team', plus: 'Plus' }

function schoenerPlan(roh) {
  if (!roh) return null
  const k = String(roh).toLowerCase()
  return PLAN_NAMEN[k] || (roh.charAt(0).toUpperCase() + roh.slice(1))
}

async function claudeDienst(kosten) {
  const u = await usageStats.getClaudeUsage()
  const basis = {
    id: 'claude',
    name: 'Claude',
    anbieter: 'Anthropic',
    kosten: kosten.claude || null,
  }
  if (u && u.available && (u.source === 'plan' || u.source === 'pushed')) {
    return {
      ...basis,
      status: 'ok',
      plan: schoenerPlan(u.planName) || 'Pro',
      verbrauch: {
        wocheProzent: u.usedPct,
        fuenfStundenProzent: u.fiveHourUsedPct,
        resetAt: u.resetAt || null,
      },
      quelle: u.source === 'pushed' ? 'mac' : 'oauth',
      standVon: u.receivedAt || null,
      hinweis: null,
    }
  }
  // Ab hier ist die Quote NICHT lesbar. Der Grund gehoert in die Karte —
  // "Login noetig" allein hat acht Tage lang verschwiegen, dass es einmal
  // funktioniert hat und seit dem 22.08. kaputt ist.
  return {
    ...basis,
    status: 'unbekannt',
    plan: null,
    verbrauch: null,
    quelle: null,
    standVon: (u && u.zuletztGesehenAm) || null,
    hinweis: (u && u.grundText) || 'Kontingent nicht abrufbar.',
  }
}

async function glmDienst(kosten) {
  const u = await usageStats.getWeeklyGlmUsage()
  const basis = { id: 'glm', name: 'GLM', anbieter: 'z.ai', kosten: kosten.glm || null }
  if (!u || !u.available) {
    return {
      ...basis, status: 'unbekannt', plan: null, verbrauch: null, quelle: null, standVon: null,
      hinweis: u && u.reason === 'no-key'
        ? 'ZAI_API_KEY ist auf dem Server nicht gesetzt.'
        : `Kontingent nicht abrufbar (${(u && u.reason) || 'unbekannt'}).`,
    }
  }
  return {
    ...basis,
    status: 'ok',
    plan: schoenerPlan(u.level),
    verbrauch: {
      wocheProzent: u.usedPct,
      fuenfStundenProzent: u.fiveHourUsedPct,
      resetAt: u.resetAt || null,
      // z.ai liefert als einziger absolute Zahlen. Die sind aussagekraeftiger
      // als ein Prozentwert, also gehen sie mit.
      credits: u.credits || null,
    },
    quelle: 'api',
    standVon: new Date().toISOString(),
    hinweis: null,
  }
}

function codexDienst(kosten) {
  const c = leseCodex()
  const basis = { id: 'codex', name: 'Codex', anbieter: 'OpenAI', kosten: kosten.codex || null }
  if (!c) {
    return {
      ...basis, status: 'unbekannt', plan: null, verbrauch: null, quelle: null, standVon: null,
      hinweis: 'Noch nichts vom Mac empfangen — dort liegt die ChatGPT-Anmeldung.',
    }
  }
  if (c.zuAlt) {
    const tage = Math.round(c.alterMs / 86400000)
    return {
      ...basis, status: 'unbekannt', plan: c.plan, verbrauch: null, quelle: 'mac', standVon: c.empfangenAm,
      hinweis: `Der Mac hat seit ${tage} Tagen nichts geschickt — der Plan könnte sich geändert haben.`,
    }
  }
  // Der Verbrauch kommt NICHT aus einer API — OpenAI hat dafür keine, die von
  // aussen erreichbar wäre. Er stammt aus dem Sitzungsprotokoll der Codex-CLI
  // auf dem Mac und ist damit so frisch wie die letzte Codex-Nutzung. Genau das
  // sagt die Karte auch, statt die Zahl als Stand von heute auszugeben.
  const v = c.verbrauch
  const gemessen = v && v.gemessenAm ? Date.now() - Date.parse(v.gemessenAm) : null
  const veraltet = gemessen !== null && Number.isFinite(gemessen) && gemessen > 3 * 86400000
  return {
    ...basis,
    status: 'ok',
    plan: schoenerPlan(c.plan),
    verbrauch: v
      ? { wocheProzent: v.wocheProzent, fuenfStundenProzent: v.fuenfStundenProzent, resetAt: v.resetAt, credits: null }
      : null,
    laufzeitBis: c.laufzeitBis,
    laufzeitAb: c.laufzeitAb,
    quelle: 'mac',
    standVon: (v && v.gemessenAm) || c.standVon || c.empfangenAm,
    hinweis: !v
      ? 'Verbrauch erst nach der nächsten Codex-Nutzung — er wird aus deren Protokoll gelesen.'
      : veraltet
        ? 'Gemessen bei der letzten Codex-Nutzung — seitdem ist einige Zeit vergangen.'
        : null,
  }
}

// ── Zusammenbau ──────────────────────────────────────────────────────────────

async function uebersicht() {
  const kosten = leseKosten()
  const [claude, glm] = await Promise.all([claudeDienst(kosten), glmDienst(kosten)])
  const dienste = [claude, glm, codexDienst(kosten)]

  // Die Summe wird nur gebildet, wenn ALLE Betraege dieselbe Waehrung haben.
  // Sonst stuende da eine Zahl, die 20 USD und 3 EUR addiert — falsch, und auf
  // den ersten Blick nicht als falsch erkennbar.
  const mitKosten = dienste.filter((d) => d.kosten)
  const waehrungen = new Set(mitKosten.map((d) => d.kosten.waehrung))
  const summierbar = mitKosten.length > 0 && waehrungen.size === 1
  const gesamt = summierbar
    ? {
        betragProMonat: Math.round(mitKosten.reduce((s, d) => s + proMonat(d.kosten), 0) * 100) / 100,
        waehrung: [...waehrungen][0],
        // Ehrlich gesagt, wenn nur zwei von drei Preisen hinterlegt sind:
        vollstaendig: mitKosten.length === dienste.length,
      }
    : null

  return {
    serverDate: serverDate(),
    gesamt,
    // Ohne hinterlegte Preise gibt es keine Kostenspalte — statt einer stillen
    // Null sagt die Karte, was zu tun waere.
    kostenHinweis: mitKosten.length === 0
      ? 'Keine Preise hinterlegt — ABO_KOSTEN in /etc/daily/env setzen.'
      : gesamt && !gesamt.vollstaendig
        ? 'Summe unvollständig — für mindestens einen Dienst fehlt der Preis.'
        : !summierbar && mitKosten.length > 0
          ? 'Keine Summe möglich — die Preise stehen in verschiedenen Währungen.'
          : null,
    dienste,
  }
}

module.exports = { uebersicht, schreibeCodex, leseCodex, CODEX_PATH }
