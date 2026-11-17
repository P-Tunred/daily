// Second Brain → Daily, zweiter Teil: die Themenseiten.
//
// brainSource.cjs liefert Jarvis die Persona (Menschen, Arbeitsweise) und der
// Mail-Sortierung das Cockpit. Dieses Modul erschliesst den Rest des Wikis —
// aber nie pauschal, sondern immer für eine konkrete Frage:
//
//   pagesForSubject  Welche Seiten gehören zum Fach, das gerade im Timer läuft?
//   search           Was steht im Brain zu dem, was Paul Jarvis gerade fragt?
//   openQuestions    Welche der offenen Fragen im Wiki ist die dringendste?
//   freshness        Wie alt ist der Stand, den Daily gerade sieht?
//
// NUR LESEN
// Wie überall in Daily: ins Brain schreibt ausschliesslich Hermes. Hier wird
// gelesen, gekürzt und geschwärzt — nichts sonst.
//
// DER INHALT IST DATEN, KEINE ANWEISUNG
// Das Wiki ist zum Teil aus Mails und Chat-Exporten entstanden. Alles, was
// hier herausgeht, läuft durch brainSource.condense() (Quellen weg,
// Kennungen geschwärzt), und die Oberfläche setzt es als Text, nie als HTML.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const brainSource = require('./brainSource.cjs')

const DIRS = ['wiki/themen', 'wiki/konzepte', 'wiki/personen']
const CACHE_MS = 60 * 1000
// Der Obsidian-Tresor heisst wie sein Ordner in Drive. Auf der VM liegt die
// Spiegelung unter einem anderen Namen, der Link muss aber auf Pauls Mac
// passen — deshalb nicht aus dem Pfad abgeleitet, sondern fest mit Schalter.
const OBSIDIAN_VAULT = process.env.BRAIN_OBSIDIAN_VAULT || 'Second Brain'

// Fachkürzel aus der Lernzeit → Begriffe, unter denen das Wiki sie führt.
// Ohne diese Tabelle fände „OR“ jede Seite, auf der das englische „or“ steht,
// und „Statistik“ nie die Seite zu Hypothesentests.
const ALIASES = {
  or: ['operations research', 'in0024'],
  // Bewusst OHNE „data science“: das stünde auch in „Foundations of Data
  // Science“ (FODS) — und die Statistik-Nachklausur ist ein anderes Fach.
  statistik: ['statistik', 'hypothesentests', 'statistical thinking', 'cit5130002'],
  'data science': ['statistik', 'hypothesentests', 'statistical thinking', 'cit5130002'],
  fods: ['fods', 'foundations of data science'],
  km: ['km', 'knowledge management'],
  eist: ['eist', 'softwaretechnik'],
  grnvs: ['grnvs', 'in0010'],
  intsec: ['intsec', 'information security'],
  xai: ['explainable', 'xai', 'ml755n'],
  pgdp: ['pgdp'],
  seminar: ['seminar', 'ai ethics', 'in0014'],
}

// Überschriften, unter denen die lernrelevanten Punkte einer Fachseite stehen.
const LERN_HEADINGS = /lernplan|lernstand|klausur|prüfung|pruefung|exam|prüfungsrelevant|kern|themen|nächste|naechste|schritte|aufgaben|todo/i

const STOPWORDS = new Set(('der die das den dem des ein eine einer eines einem und oder aber ist sind war '
  + 'wie was wer wo wann warum ich du er sie es wir ihr mir mich dir dich mein dein sein kann soll muss '
  + 'noch schon auch nur mal bei mit von zu zum zur für fuer auf aus nach über ueber unter vor im in an am '
  + 'nicht kein keine heute morgen gerade bitte danke hast habe hat gibt the and for you are').split(' '))

let cache = null // { vault, signature, pages, builtAt }

function norm(s) {
  return String(s).toLowerCase().normalize('NFC').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wortgrenze, die auch Umlaute als Buchstaben kennt — \b tut das nicht. */
function wordRe(term, flags = 'i') {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}(?=$|[^\\p{L}\\p{N}])`, flags + 'u')
}

function countWord(text, term) {
  return (text.match(wordRe(term, 'gi')) || []).length
}

function listPages(vault) {
  const entries = []
  for (const dir of DIRS) {
    let files = []
    try { files = fs.readdirSync(path.join(vault, dir)).filter((f) => f.endsWith('.md')).sort() } catch { continue }
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(vault, dir, f))
        entries.push({ file: `${dir}/${f}`, mtime: st.mtimeMs })
      } catch { /* verschwunden zwischen readdir und stat — egal */ }
    }
  }
  return entries
}

/** Alle Seiten, gecacht, bis sich eine Datei ändert oder eine Minute um ist. */
function loadPages() {
  const vault = brainSource.findVault()
  if (!vault) return null
  const entries = listPages(vault)
  const signature = entries.map((e) => `${e.file}:${Math.round(e.mtime)}`).join('|')
  if (cache && cache.vault === vault && cache.signature === signature && Date.now() - cache.builtAt < CACHE_MS) {
    return cache
  }
  const pages = []
  for (const e of entries) {
    let raw
    try { raw = fs.readFileSync(path.join(vault, e.file), 'utf8') } catch { continue }
    const h1 = /^#\s+(.+)$/m.exec(raw)
    const name = path.basename(e.file, '.md')
    pages.push({
      file: e.file,
      name,
      nameNorm: norm(name),
      title: h1 ? h1[1].trim() : name,
      raw,
      mtime: e.mtime,
    })
  }
  cache = { vault, signature, pages, builtAt: Date.now() }
  return cache
}

function obsidianUrl(file) {
  const target = file.replace(/\.md$/, '')
  return `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(target)}`
}

/** Markdown-Abschnitte einer Seite: [{ heading, lines }]. */
function sections(raw) {
  const out = []
  let cur = { heading: '', lines: [] }
  for (const line of raw.split('\n')) {
    const h = /^#{2,6}\s+(.*)$/.exec(line)
    if (h) { out.push(cur); cur = { heading: h[1].trim(), lines: [] }; continue }
    cur.lines.push(line)
  }
  out.push(cur)
  return out
}

function firstSentence(raw) {
  const body = raw.split('\n').filter((l) => l.trim() && !/^#/.test(l) && !/^>/.test(l) && !/^\|/.test(l))
  const para = brainSource.condense(body.slice(0, 4).join(' '))
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(para)
  return (m ? m[1] : para.slice(0, 220)).trim()
}

function countOpenQuestions(raw) {
  return parseQuestionSection(raw).filter((q) => !q.erledigt).length
}

// ── Fach → Seiten ───────────────────────────────────────────────────────────

function subjectTerms(name) {
  const n = norm(name)
  const terms = new Set(ALIASES[n] || [])
  if (n.length >= 2) terms.add(n)
  return [...terms]
}

/** Punktzahl, wie gut eine Seite zu den Begriffen passt. Treffer im Dateinamen
 *  oder Titel sind Pflicht — eine Seite, die ein Fach nur nebenbei erwähnt,
 *  ist keine Fachseite. */
function subjectScore(page, terms) {
  let head = 0
  let body = 0
  for (const t of terms) {
    if (wordRe(t).test(page.nameNorm)) head += 5
    if (wordRe(t).test(page.title)) head += 4
    // Kurze Kürzel („km“, „or“) nur im Kopf zählen: im Fliesstext sind sie
    // zu oft etwas anderes.
    if (t.length > 3) body += Math.min(countWord(page.raw, t), 5) * 0.4
  }
  return head > 0 ? head + body : 0
}

/** Stichpunkte eines Abschnitts. Im Wiki sind lange Punkte auf mehrere Zeilen
 *  umbrochen — die Folgezeilen gehören dazu, sonst endet ein Punkt mitten im Satz. */
function bullets(lines) {
  const out = []
  let cur = null
  for (const line of lines) {
    const b = /^\s{0,1}(-|\*|\d+\.)\s+(.*)$/.exec(line)
    if (b) { cur = b[2].trim(); out.push(cur); continue }
    if (cur !== null && /^\s{2,}\S/.test(line) && !/^\s+(-|\*|\d+\.)\s/.test(line) && !/^\s+→/.test(line)) {
      out[out.length - 1] = out[out.length - 1] + ' ' + line.trim()
      continue
    }
    if (!line.trim() || /^\S/.test(line)) cur = null
  }
  return out
}

function lernPunkte(raw, max = 4) {
  const punkte = []
  for (const s of sections(raw)) {
    if (!s.heading || !LERN_HEADINGS.test(s.heading) || /^(quellen|offene fragen|verwandte seiten)$/i.test(s.heading)) continue
    for (const b of bullets(s.lines)) {
      const t = brainSource.condense(b).replace(/^-\s*/, '')
      if (t) punkte.push(t.length > 220 ? t.slice(0, 219) + '…' : t)
      if (punkte.length >= max) return punkte
    }
  }
  return punkte
}

/** Rückfall für Fächer ohne eigene Seite (OR, GRNVS …): Seiten, die das Fach
 *  mehrfach beim vollen Namen nennen — etwa die Semesterseite. Nur lange
 *  Begriffe, und erst ab drei Nennungen, sonst gewinnt jede Randbemerkung. */
function bodyScore(page, terms) {
  let n = 0
  for (const t of terms) if (t.length > 3) n += countWord(page.raw, t)
  return n >= 3 ? n : 0
}

function pagesForSubject(name, { limit = 3 } = {}) {
  const c = loadPages()
  if (!c) return { ok: false, fach: String(name || ''), seiten: [] }
  const terms = subjectTerms(name || '')
  if (terms.length === 0) return { ok: true, fach: '', seiten: [] }
  let ranked = c.pages
    .map((p) => ({ p, score: subjectScore(p, terms) }))
    .filter((x) => x.score > 0)
  const nurErwaehnt = ranked.length === 0
  if (nurErwaehnt) {
    ranked = c.pages.map((p) => ({ p, score: bodyScore(p, terms) })).filter((x) => x.score > 0)
  }
  // Unter dem Timer zählt, was es zu lernen gibt. Eine Seite, die nur
  // Lernstunden führt (etwa die, die Hermes für den Lernbericht pflegt),
  // passt zwar dem Namen nach, hat aber keine Lernpunkte — sie rückt nach
  // hinten, statt oben einen Verwaltungssatz zu zeigen.
  const seiten = ranked
    .map((x) => ({ ...x, punkte: lernPunkte(x.p.raw) }))
    .sort((a, b) => (b.punkte.length > 0) - (a.punkte.length > 0) || b.score - a.score || b.p.mtime - a.p.mtime)
    .slice(0, nurErwaehnt ? 2 : limit)
    .map(({ p, punkte }) => {
      return {
        titel: p.title,
        datei: p.file,
        obsidian: obsidianUrl(p.file),
        stand: new Date(p.mtime).toISOString(),
        punkte: punkte.length ? punkte : [firstSentence(p.raw)].filter(Boolean),
        offeneFragen: countOpenQuestions(p.raw),
        // Die Oberfläche soll sagen können: „keine eigene Seite, erwähnt in …“
        eigeneSeite: !nurErwaehnt,
      }
    })
  return { ok: true, fach: String(name), seiten }
}

// ── Suche ───────────────────────────────────────────────────────────────────

function queryTokens(q) {
  return [...new Set(norm(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !STOPWORDS.has(t)))].slice(0, 12)
}

/** Durchsucht Themen, Konzepte und Personen. Gesucht wird im GEKÜRZTEN Text —
 *  also ohne Quellenabschnitte und mit geschwärzten Kennungen. Was hier nicht
 *  auftaucht, kann auch nicht in einem Prompt landen. */
function search(q, { limit = 4, maxChars = 600 } = {}) {
  const c = loadPages()
  if (!c) return { ok: false, treffer: [] }
  const tokens = queryTokens(q || '')
  if (tokens.length === 0) return { ok: true, treffer: [] }

  const scored = []
  for (const p of c.pages) {
    const text = p.condensed ?? (p.condensed = brainSource.condense(p.raw))
    let score = 0
    let hit = 0
    for (const t of tokens) {
      const n = countWord(text, t)
      const inHead = wordRe(t).test(p.nameNorm) || wordRe(t).test(p.title)
      if (n || inHead) hit += 1
      score += Math.min(n, 6) + (inHead ? 4 : 0)
    }
    // Bei mehreren Suchwörtern muss mehr als eins passen — sonst gewinnt jede
    // Seite, die zufällig ein häufiges Wort enthält.
    const needed = tokens.length >= 3 ? 2 : 1
    if (hit >= needed && score > 0) scored.push({ p, text, score: score * (hit / tokens.length) })
  }
  scored.sort((a, b) => b.score - a.score)

  const treffer = scored.slice(0, limit).map(({ p, text }) => ({
    titel: p.title,
    datei: p.file,
    obsidian: obsidianUrl(p.file),
    stand: new Date(p.mtime).toISOString(),
    auszug: bestExcerpt(text, tokens, maxChars),
  }))
  return { ok: true, treffer }
}

function bestExcerpt(text, tokens, maxChars) {
  const lines = text.split('\n').filter((l) => l.trim() && !/^###/.test(l))
  let best = 0
  let bestScore = -1
  lines.forEach((l, i) => {
    const s = tokens.reduce((a, t) => a + (wordRe(t).test(l) ? 1 : 0), 0)
    if (s > bestScore) { bestScore = s; best = i }
  })
  const out = lines.slice(Math.max(0, best - 1), best + 3).join('\n')
  return out.length > maxChars ? out.slice(0, maxChars - 1) + '…' : out
}

// ── Offene Fragen ───────────────────────────────────────────────────────────

/** Liest den Abschnitt „## Offene Fragen“: je Punkt der Text, ob er erledigt
 *  ist und ob schon eine Teilantwort („→ …“) darunter steht. */
function parseQuestionSection(raw) {
  const sec = sections(raw).find((s) => /^offene fragen$/i.test(s.heading))
  if (!sec) return []
  const items = []
  let cur = null
  for (const line of sec.lines) {
    const top = /^(-|\*|\d+\.)\s+(.*)$/.exec(line)
    if (top) {
      cur = { text: top[2].trim(), teilantwort: false }
      items.push(cur)
      continue
    }
    if (!cur || !line.trim()) continue
    if (/^\s+→/.test(line)) { cur.teilantwort = true; continue }
    if (/^\s{2,}\S/.test(line) && !/^\s+(-|\*|\d+\.)\s/.test(line)) cur.text += ' ' + line.trim()
  }
  return items.map((q) => ({
    ...q,
    erledigt: /^(✅|~~)/.test(q.text) || /\*\*(beantwortet|geklärt|erledigt)/i.test(q.text),
  }))
}

const FRIST_RE = /\bfrist|deadline|fällig|faellig|bis zum|klausur|prüfung|pruefung|zahlung|€|\b\d{1,2}\.\d{1,2}\.|\d{4}-\d{2}-\d{2}/i

function linkedFromStart(vault) {
  try {
    const start = fs.readFileSync(path.join(vault, 'wiki/start.md'), 'utf8')
    return new Set([...start.matchAll(/\]\(((?:themen|konzepte|personen)\/[^)#\s]+\.md)/g)].map((m) => 'wiki/' + m[1]))
  } catch {
    return new Set()
  }
}

function plainQuestion(text) {
  return brainSource.condense(text).replace(/\s+/g, ' ').trim()
}

/** Offene Fragen aus dem ganzen Wiki, die dringendsten zuerst.
 *  `verlauf` und `gesperrt` kommen aus questionStore: was Paul verworfen,
 *  beantwortet oder gerade zurückgestellt hat, taucht hier nicht wieder auf. */
function openQuestions({ limit = 10, verlauf = {}, gesperrt = () => null, heute = '' } = {}) {
  const c = loadPages()
  if (!c) return { ok: false, gesamt: 0, fragen: [] }
  const start = linkedFromStart(c.vault)
  const frisch = Date.now() - 14 * 86_400_000

  const alle = []
  for (const p of c.pages) {
    for (const q of parseQuestionSection(p.raw)) {
      if (q.erledigt) continue
      const frage = plainQuestion(q.text)
      if (frage.length < 8) continue
      // Manche Punkte unter „Offene Fragen“ sind festgehaltene Tatsachen mit
      // Quelle, keine Fragen. Die an Paul zu stellen, wäre Lärm.
      if (!frage.includes('?') && /Quelle:/i.test(frage)) continue
      // „(Stand: …, Quelle: …)“ ist Herkunft, keine Frist.
      const ohneHerkunft = frage.replace(/\((?:[^()]*\b(?:Stand|Quelle)\b[^()]*)\)/gi, '')
      const id = 'brain:' + crypto.createHash('sha1').update(p.file + '|' + frage).digest('hex').slice(0, 12)
      if (gesperrt(verlauf, id, heute)) continue

      const gruende = []
      let prio = 0
      if (start.has(p.file)) { prio += 3; gruende.push('Seite hängt am Cockpit') }
      if (FRIST_RE.test(ohneHerkunft)) { prio += 2; gruende.push('Frist, Geld oder Prüfung') }
      if (p.mtime >= frisch) { prio += 1; gruende.push('Seite kürzlich geändert') }
      if (q.teilantwort) { prio -= 1; gruende.push('schon teilweise beantwortet') }
      if (p.file.startsWith('wiki/konzepte/')) prio -= 1

      alle.push({
        id,
        frage: frage.length > 280 ? frage.slice(0, 279) + '…' : frage,
        seite: p.file,
        titel: p.title,
        prio,
        gruende,
        mtime: p.mtime,
      })
    }
  }
  alle.sort((a, b) => b.prio - a.prio || b.mtime - a.mtime)
  return {
    ok: true,
    gesamt: alle.length,
    fragen: alle.slice(0, Math.max(1, Math.min(limit, 50))).map(({ mtime, ...rest }) => rest),
  }
}

// ── Frische ─────────────────────────────────────────────────────────────────

/** Wie aktuell ist das Brain, das Daily sieht? Auf der VM ist es eine
 *  stündliche Spiegelung — steht sie, sieht alles hier weiter „ok“ aus, nur
 *  eben mit altem Stand. Genau das soll sichtbar werden. */
function freshness() {
  const c = loadPages()
  if (!c) return { ok: false, updatedAt: null, lastLog: null, pages: 0 }
  let newest = c.pages.reduce((m, p) => Math.max(m, p.mtime), 0)
  let lastLog = null
  try {
    const logPath = path.join(c.vault, 'wiki/log.md')
    newest = Math.max(newest, fs.statSync(logPath).mtimeMs)
    const log = fs.readFileSync(logPath, 'utf8')
    const heads = [...log.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]?\s*(.*)$/gm)]
    const last = heads[heads.length - 1]
    if (last) lastLog = { date: last[1], title: last[2].trim().slice(0, 120) }
  } catch { /* kein Log — dann eben ohne */ }
  return {
    ok: true,
    updatedAt: newest ? new Date(newest).toISOString() : null,
    lastLog,
    pages: c.pages.length,
  }
}

// ── Neu im Brain ────────────────────────────────────────────────────────────

/** Markdown-Verweise zu lesbarem Text: [[seite|Text]] → Text, [t](u) → t. */
function ohneMarkup(zeile) {
  return zeile
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, z) => path.basename(z).replace(/[-_]/g, ' '))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Was seit gestern ins Brain kam — aus `wiki/log.md`, wo die Einspeisung
 *  jeden Lauf als `## JJJJ-MM-TT — Titel` mit Stichpunkten einträgt.
 *  Bewusst NICHT über Änderungszeiten der Seiten: auf der VM ist das Brain
 *  eine stündliche Spiegelung, deren Zeitstempel nichts über Pauls Notizen
 *  sagen. Neueste Einträge zuerst, je Eintrag höchstens drei Stichpunkte. */
function neuImBrain({ heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }), tage = 2, max = 6 } = {}) {
  const c = loadPages()
  if (!c) return { ok: false, eintraege: [] }
  let log
  try { log = fs.readFileSync(path.join(c.vault, 'wiki/log.md'), 'utf8') } catch { return { ok: true, eintraege: [] } }
  const grenze = new Date(Date.parse(heute + 'T12:00:00Z') - (tage - 1) * 86_400_000).toISOString().slice(0, 10)
  const eintraege = []
  let akt = null
  for (const zeile of log.split('\n')) {
    const h = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]?\s*(.*)$/.exec(zeile)
    if (h) {
      akt = h[1] >= grenze && h[1] <= heute ? { datum: h[1], titel: ohneMarkup(h[2]).slice(0, 120) || 'Eintrag', punkte: [] } : null
      if (akt) eintraege.push(akt)
      continue
    }
    if (/^#{1,6}\s/.test(zeile)) { akt = null; continue }
    if (akt && akt.punkte.length < 3 && /^\s*[-*+]\s+\S/.test(zeile)) {
      const t = ohneMarkup(zeile).slice(0, 160)
      if (t) akt.punkte.push(t)
    }
  }
  return {
    ok: true,
    eintraege: eintraege.reverse().slice(0, max),
    log: obsidianUrl('wiki/log.md'),
  }
}

module.exports = {
  pagesForSubject, search, openQuestions, freshness, neuImBrain,
  // für Tests
  parseQuestionSection, subjectTerms, queryTokens, obsidianUrl, _resetCache: () => { cache = null },
}
