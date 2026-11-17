// Second Brain → Jarvis
//
// Paul keeps a curated Obsidian vault in Google Drive ("KI/Second Brain"):
// people, working style, projects — written by hand, with sources and dated
// facts. Jarvis previously only knew the loose facts he had picked up himself
// via <<MERKEN>>. This module hands him the curated part instead.
//
// Deliberately NOT the whole vault:
//   - all of `wiki/personen/`, and from `wiki/konzepte/` ONLY the pages that
//     describe Paul himself (PERSONA_KONZEPTE) — who he is and how he wants to
//     be talked to. Deadlines, money and project state are a different
//     feature (they belong next to calendar/mail, not in the persona block).
//   - `## Quellen` sections are dropped: file paths on Paul's disk, useless to
//     Jarvis and needless to send anywhere.
//   - identifiers are redacted (see REDACTIONS) — a chat assistant has no
//     business knowing the matriculation number or street address.
//
// The vault is partly derived from mails and chat exports, so its text is NOT
// trusted input: the renderer wraps it in a data block, same as calendar/mail.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const VAULT_REL = [
  'My Drive/KI/Second Brain',
  'Meine Ablage/KI/Second Brain',
]

/** Die Seiten aus `wiki/konzepte/`, die PAUL beschreiben.
 *
 *  WARUM EINE LISTE UND NICHT DER GANZE ORDNER
 *  `konzepte/` heisst laut Brain-CLAUDE.md „Begriffe und Methoden" — und so
 *  ist der Ordner gewachsen: von 8 Seiten auf 14, darunter Klausurstoff
 *  (Hypothesentests, ML-Grundbegriffe), eine Formularanleitung und ein
 *  KI-Modell. All das stand im Prompt unter der Überschrift „Wie Paul arbeitet
 *  und angesprochen werden will" — rund 36k Tokens pro Offline-Nachricht,
 *  davon gut die Hälfte falsch beschriftet (gemessen 2026-10-07).
 *
 *  Was hier fehlt, ist nicht verloren: der Offline-Chat sucht pro Frage im
 *  ganzen Wiki (brainPages.search). Die Persona muss nur tragen, was in JEDER
 *  Antwort gelten soll.
 *
 *  Eine fehlende Seite meldet sich im Log — eine umbenannte Seite fiele sonst
 *  still aus der Persona, und niemand merkte es. */
const PERSONA_KONZEPTE = [
  'arbeitsrhythmus.md',
  'interessen-und-gewohnheiten.md',
  'lern-und-arbeitsstil.md',
  'technik-und-werkzeuge.md',
  'werte-und-lebensziele.md',
]

/** Folders to read, in prompt order. `only` = feste Auswahl statt des Ordners. */
const SECTIONS = [
  { dir: 'wiki/personen', label: 'Menschen in Pauls Leben' },
  { dir: 'wiki/konzepte', label: 'Wie Paul arbeitet und angesprochen werden will', only: PERSONA_KONZEPTE },
]

const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g

// Identifiers that add nothing to a conversation but everything to a leak.
const REDACTIONS = [
  [/\bMatrikelnummer\s+\d+/gi, 'Matrikelnummer (nicht gespeichert)'],
  [/\b\d{8,}\b/g, '…'],                              // long bare numbers (matr.-no, IDs)
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, '…'],        // IBAN
  [MAIL_RE, '…'],                                    // mail addresses
  // Street + number, e.g. "Connollystraße 3 / 0J13, 80809 München"
  [/\b[A-ZÄÖÜ][\wäöüß.-]*(?:straße|strasse|weg|allee|platz|gasse)\s+\d+[^,\n]*(?:,\s*\d{5}\s*[A-ZÄÖÜ][\wäöüß]*)?/gi, '(Adresse)'],
]

// Pages that describe Paul's CURRENT situation — what is running, what is
// overdue, who is who. This is what the mail triage needs to judge stakes:
// "a form is empty" only becomes urgent once you know 5 ECTS hang off it.
// Deliberately the cockpit rather than all of wiki/themen/: the cockpit is the
// page Hermes curates as the present state, and it carries Stand-Daten.
const TRIAGE_PAGES = [
  'wiki/start.md',
  'wiki/themen/pruefungen-und-fristen.md',
  'wiki/personen/uni-umfeld.md',
]

const CACHE_MS = 10 * 60 * 1000
let cache = null // { text, pages, updatedAt, vault, builtAt, signature }

/** Locate the vault under any GoogleDrive-* mount. Env override wins. */
function findVault() {
  const override = process.env.SECOND_BRAIN_PATH
  if (override) {
    try {
      if (fs.statSync(override).isDirectory()) return override
      console.warn('[brain] SECOND_BRAIN_PATH zeigt auf keine Verzeichnis:', override)
    } catch (e) {
      // Früher fiel das stumm durch auf den Drive-Suchlauf — der auf Linux
      // nichts findet. Ergebnis: Jarvis ohne Kontext, ohne jeden Hinweis warum.
      console.warn('[brain] SECOND_BRAIN_PATH nicht lesbar:', override, '—', e.message)
    }
  }
  const cs = path.join(os.homedir(), 'Library', 'CloudStorage')
  let roots = []
  try {
    roots = fs.readdirSync(cs).filter((d) => d.startsWith('GoogleDrive')).map((d) => path.join(cs, d))
  } catch {
    return null
  }
  for (const root of roots) {
    for (const rel of VAULT_REL) {
      const p = path.join(root, rel)
      try {
        if (fs.statSync(p).isDirectory()) return p
      } catch { /* not here */ }
    }
  }
  return null
}

/** Markdown → compact prose. Keeps headings as plain lines, drops link syntax,
 *  source sections and blockquote markers.
 *  `keepEmails`: the triage context needs addresses to match a sender against a
 *  known person — and the mails themselves already carry them, so withholding
 *  them there protects nothing. The persona block has no such need. */
function condense(md, { keepEmails = false } = {}) {
  const out = []
  let skipping = false
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      const title = heading[1].trim()
      // "Quellen" is disk paths, "Verwandte Seiten" is wiki navigation — both
      // are noise in a prompt and cost tokens on every single turn.
      skipping = /^(quellen|verwandte seiten)$/i.test(title)
      if (!skipping) out.push(`### ${title}`)
      continue
    }
    if (skipping) continue
    if (!line.trim()) { if (out.length && out[out.length - 1] !== '') out.push(''); continue }

    let t = line
      .replace(/^>\s?/, '')                       // blockquote marker
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')    // [text](link) → text
      .replace(/\*\*/g, '')                       // bold
      .replace(/^[-*]\s+/, '- ')
      .replace(/^\|/, '')                         // table pipes → readable-ish
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/·\s*$/, '')
    if (/^[\s·:-]*$/.test(t)) continue            // table separator rows
    for (const [re, to] of REDACTIONS) {
      if (keepEmails && re === MAIL_RE) continue
      t = t.replace(re, to)
    }
    out.push(t.trimEnd())
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Schon gemeldete fehlende Seiten — einmal pro Prozess reicht, sonst
 *  schreibt jeder Chat-Aufruf dieselbe Warnung ins Journal. */
const gemeldet = new Set()

function readSection(vault, dir, only) {
  const abs = path.join(vault, dir)
  let files = []
  try {
    files = fs.readdirSync(abs).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
  if (only) {
    for (const f of only) {
      if (!files.includes(f) && !gemeldet.has(`${dir}/${f}`)) {
        gemeldet.add(`${dir}/${f}`)
        console.warn(`[brain] Persona-Seite fehlt: ${dir}/${f} — umbenannt? PERSONA_KONZEPTE in brainSource.cjs anpassen.`)
      }
    }
    files = files.filter((f) => only.includes(f))
  }
  const pages = []
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(abs, f))
      const body = condense(fs.readFileSync(path.join(abs, f), 'utf8'))
      if (body) pages.push({ file: `${dir}/${f}`, body, mtime: st.mtimeMs })
    } catch { /* unreadable page — skip it, the rest is still useful */ }
  }
  return pages
}

/**
 * Build the persona block. Returns null when no vault is synced — Jarvis then
 * simply runs as before, he does not get a "brain missing" story to tell.
 */
function readBrain() {
  const vault = findVault()
  if (!vault) return null

  const sections = SECTIONS.map((s) => ({ ...s, pages: readSection(vault, s.dir, s.only) }))
  const all = sections.flatMap((s) => s.pages)
  if (all.length === 0) return null

  // Rebuild only when a page actually changed.
  const signature = all.map((p) => `${p.file}:${Math.round(p.mtime)}`).join('|')
  if (cache && cache.signature === signature && Date.now() - cache.builtAt < CACHE_MS) return cache

  const text = sections
    .filter((s) => s.pages.length > 0)
    .map((s) => `## ${s.label}\n\n${s.pages.map((p) => p.body).join('\n\n')}`)
    .join('\n\n')

  cache = {
    text,
    pages: all.map((p) => p.file),
    updatedAt: new Date(Math.max(...all.map((p) => p.mtime))).toISOString(),
    vault,
    builtAt: Date.now(),
    signature,
  }
  return cache
}

let triageCache = null // { text, sig, builtAt }

/**
 * Context for the mail triage: what is currently running and who is who.
 *
 * Returns `{ text, sig }`. `sig` is a content hash, not an mtime — Hermes
 * rewrites the vault daily, and re-classifying every mail because an unrelated
 * page was touched would be expensive for nothing. Only a real change to THESE
 * pages invalidates the verdicts.
 *
 * Null when nothing is readable, so the triage keeps working as before.
 */
function readTriageContext() {
  const vault = findVault()
  if (!vault) return null

  const parts = []
  for (const rel of TRIAGE_PAGES) {
    try {
      const body = condense(fs.readFileSync(path.join(vault, rel), 'utf8'), { keepEmails: true })
      if (body) parts.push(body)
    } catch { /* page missing — the others still carry their weight */ }
  }
  if (parts.length === 0) return null

  const text = parts.join('\n\n')
  if (triageCache && triageCache.text === text && Date.now() - triageCache.builtAt < CACHE_MS) {
    return triageCache
  }
  triageCache = {
    text,
    sig: crypto.createHash('sha1').update(text).digest('hex').slice(0, 12),
    builtAt: Date.now(),
  }
  return triageCache
}

/** Shape served to the renderer. `vault` stays server-side — it's a disk path. */
function serveBrain() {
  const b = readBrain()
  if (!b) return { ok: false, text: '', pages: [], updatedAt: null }
  return { ok: true, text: b.text, pages: b.pages, updatedAt: b.updatedAt }
}

module.exports = { readBrain, serveBrain, readTriageContext, findVault, condense, PERSONA_KONZEPTE }
