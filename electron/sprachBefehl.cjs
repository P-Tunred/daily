// Sprachbefehle, die Daily selbst versteht — ohne Modell, ohne Netz.
//
// WARUM ES DAS GIBT
// Seit 2026-11-02 ging jeder gesprochene Satz an Hermes. Das dauerte bis zur
// ersten Antwort rund zehn Sekunden — zu lange, um mitten im Hörbriefing
// „schreib auf …" zu sagen und weiterzuhören. Paul (2026-11-03): „Es muss
// nicht über Hermes passieren." Die häufigen Befehle erkennt Daily deshalb
// hier, nach festen Mustern, in Millisekunden:
//
//   { art: 'todo', text, wann }      wann: 'heute' | 'woche' | 'JJJJ-MM-TT'
//   { art: 'brain', suche }
//   { art: 'termin', titel, ids }    ids leer: kein Termin heute passt
//   { art: 'antwort', text }         auf die offene Brain-Frage
//   { art: 'ende' }                  „weiter", „passt", „stopp"
//   { art: 'hermes', text }          ausdrücklich an Hermes
//   { art: 'zurueck' }               „zurück", „mach das rückgängig"
//
// Nur von Gemini (über `pruefe`), weil sie den Zusammenhang brauchen —
// „ich geh doch nicht auf die Reise" heisst erst mit der Aufgabenliste etwas:
//   { art: 'streichen', ids, titel } offene Aufgaben streichen
//   { art: 'erledigt', ids, titel }  offene Aufgaben abhaken
//   { art: 'termin', …, datum, tage } auch Termine der nächsten zwei Wochen,
//                                    über bis zu 4 Tage (eine Reise)
//   { art: 'rueckfrage', text }      Daily fragt gezielt nach statt „nochmal"
//
// Was nicht sicher passt, ergibt null. Dann deutet Gemini den Satz mit dem
// Zusammenhang (sprachGemini.cjs) — etwa „mach das zu den To-dos", wo „das"
// erst aus dem Briefing klar wird. Lieber einmal nachfragen als eine falsche
// Aufgabe anlegen.
//
// `pruefe` ist die Grenze für alles, was von aussen kommt (Gemini): nur diese
// Arten, nur gültige Daten, nur Termine und Aufgaben, die es wirklich gibt.

const TAG_MS = 86_400_000
const MAX_TEXT = 200
const MAX_ANTWORT = 2000
const MAX_TAGE_VORAUS = 366
const MAX_RUECKFRAGE = 300
const MAX_TERMIN_NAME = 60
const MAX_TERMIN_IDS = 8
const MAX_TERMIN_TAGE = 4

const WOCHENTAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']
const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
// In JS-Regex ist \b nur ASCII: vor „ü" oder nach „ß" greift es nicht —
// dort stehen Lookarounds auf Buchstaben.
// Trennbare Vorsilben: „ich rufe … an" → „anrufen", „anzurufen" → „anrufen".
const PARTIKEL = ['an', 'ab', 'auf', 'aus', 'ein', 'mit', 'vor', 'nach', 'zurück', 'weg', 'los', 'zu', 'fertig', 'durch', 'um']
const BRAIN = '(?:second\\s+)?(?:brain|brein|bräin|brähn|brian|brane)'
const LISTE = /\s*\b(?:zu\s+(?:meinen|den|meiner|der)\s+(?:to-?\s?dos?|todos?|aufgaben|liste|to-?do-?liste)|zur\s+(?:to-?do-?)?liste|(?:auf|in)\s+(?:meine|die)\s+(?:to-?do-?)?liste|hinzu)\b/gi
const FUELLER_VORNE = /^(?:dass\s+ich|ich\s+(?:muss|will|sollte|soll|möchte|werde)|dass|daran|bitte|noch|mal|auch|gerne?|unbedingt|unbedingt\s+noch|dann|also|okay|ok)\b[\s,:]*/i
const MODAL_HINTEN = /\s+(?:muss|soll|sollte|will|möchte|werde|kann)$/i
const ARTIKEL_VORNE = /^(?:die|der|das|den|dem|ein|eine|einen|einem)\s+/i
const PRONOMEN = /^(?:das|es|dies|dieses|den|die|dem|der|das\s+hier|das\s+da)?$/i
// Kein Inhalt, nur ein Rest des Satzes: „Trag dich ein", „Füge ich später hinzu".
const KEIN_INHALT = /^(?:ich|dich|mich|mir|dir|sich|uns|euch|später|nachher|gleich|dann|jetzt|sofort|hier|da|so|bisschen|ein\s+bisschen.*)$/i

// ── Datum ───────────────────────────────────────────────────────────────────

const plusTage = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * TAG_MS).toISOString().slice(0, 10)
const wochentag = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay()
const pad = (n) => String(n).padStart(2, '0')

function naechster(heute, ziel, mindestens = 0) {
  let n = (ziel - wochentag(heute) + 7) % 7
  if (n < mindestens) n += 7
  return plusTage(heute, n)
}

function gueltig(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) === iso
}

/** Wann eine Aufgabe dran ist — und welche Wörter das sagten (zum Entfernen). */
const ZEITEN = [
  { re: /\b(?:für\s+|ab\s+)?nächste[nr]?\s+woche\b/i, wann: (h) => naechster(h, 1, 1) },
  { re: /\b(?:für\s+)?(?:diese[rn]?|die)\s+woche(?:\s+über)?\b|\bbis\s+ende\s+der\s+woche\b|\bin\s+dieser\s+woche\b/i, wann: () => 'woche' },
  { re: /(?:\b(?:für|bis)\s+)?(?<![a-zäöüß])übermorgen(?![a-zäöüß])/i, wann: (h) => plusTage(h, 2) },
  { re: /\b(?:für\s+|bis\s+)?morgen\b(?!s)(?:\s+früh)?/i, wann: (h) => plusTage(h, 1) },
  {
    re: new RegExp(`\\b(?:am\\s+|für\\s+|bis\\s+)?(nächsten\\s+)?(${WOCHENTAGE.join('|')})\\b`, 'i'),
    wann: (h, m) => {
      const ziel = WOCHENTAGE.indexOf(m[2].toLowerCase())
      const d = naechster(h, ziel, m[1] ? 1 : 0)
      return d === h ? 'heute' : d
    },
  },
  {
    re: new RegExp(`\\b(?:am\\s+|für\\s+(?:den\\s+)?|bis\\s+(?:zum\\s+)?)?(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.?|(${MONATE.join('|')}))(?:\\s*(\\d{4}))?`, 'i'),
    wann: (h, m) => {
      const tag = Number(m[1])
      const monat = m[2] ? Number(m[2]) : MONATE.indexOf(m[3].toLowerCase()) + 1
      let jahr = m[4] ? Number(m[4]) : Number(h.slice(0, 4))
      let d = `${jahr}-${pad(monat)}-${pad(tag)}`
      if (!m[4] && d < h) { jahr += 1; d = `${jahr}-${pad(monat)}-${pad(tag)}` }
      if (!gueltig(d)) return null
      return d === h ? 'heute' : d
    },
  },
  { re: /\b(?:für\s+)?heute(?:\s+(?:abend|noch|nachmittag|früh|morgen))?\b/i, wann: () => 'heute' },
]

/** Liest die Zeit aus dem ganzen Satz und streicht sie aus dem Inhalt. */
function zeitAus(satz, inhalt, heute) {
  let wann = 'heute'
  let gefunden = false
  let rest = inhalt
  for (const z of ZEITEN) {
    const m = satz.match(z.re)
    if (m && !gefunden) {
      // Ein unmögliches Datum („30. Februar") heisst nicht heute: lieber nachfragen.
      wann = z.wann(heute, m)
      gefunden = true
    }
    rest = rest.replace(new RegExp(z.re.source, 'gi'), ' ')
  }
  return { wann, rest }
}

/** Sagt der Satz einen anderen Tag als heute? */
function andererTag(satz, heute) {
  return ZEITEN.some((z) => {
    const m = satz.match(z.re)
    return m && z.wann(heute, m) !== 'heute'
  })
}

// ── Aufgabentext ────────────────────────────────────────────────────────────

const glatt = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim()
const gross = (s) => (s ? s[0].toLocaleUpperCase('de-DE') + s.slice(1) : s)

function ohneFueller(s) {
  let vorher
  let t = glatt(s)
  do {
    vorher = t
    t = glatt(t.replace(FUELLER_VORNE, '').replace(MODAL_HINTEN, ''))
  } while (t !== vorher)
  return t
}

/** „anzurufen" → „anrufen", „zu erledigen" → „erledigen". */
function ohneZu(woerter) {
  const out = woerter.map((w) => {
    const m = w.match(/^([a-zäöü]+?)zu([a-zäöü]+en)$/i)
    return m && PARTIKEL.includes(m[1].toLowerCase()) ? m[1] + m[2] : w
  })
  const n = out.length
  if (n >= 2 && out[n - 2].toLowerCase() === 'zu' && /en$/i.test(out[n - 1])) out.splice(n - 2, 1)
  return out
}

/** Erste Person → Grundform: „ich rufe den Vermieter an" → „den Vermieter anrufen". */
function hauptsatz(woerter) {
  const [verb, ...rest] = woerter
  if (!verb || !/e$/i.test(verb) || rest.length === 0) return woerter
  const letztes = rest[rest.length - 1].toLowerCase()
  if (rest.length >= 2 && PARTIKEL.includes(letztes)) return [...rest.slice(0, -1), letztes + verb + 'n']
  return [...rest, verb + 'n']
}

/** Nebensatz „dass ich … abschicke" → „… abschicken". */
function nebensatz(woerter) {
  const n = woerter.length
  if (n >= 2 && /[a-zäöü]e$/i.test(woerter[n - 1]) && !/^(?:sie|die|eine|seine|meine|deine|ihre|keine)$/i.test(woerter[n - 1])) {
    return [...woerter.slice(0, -1), woerter[n - 1] + 'n']
  }
  return woerter
}

function alsAufgabe(roh) {
  let t = glatt(roh.replace(LISTE, ' '))
  const nachDass = /^(?:,\s*)?dass\s+ich\b/i.test(t) || /\bdass\s+ich\b/i.test(t)
  if (nachDass) t = t.replace(/^.*?\bdass\s+ich\b/i, '')
  t = ohneFueller(t)
  const ichVorne = /^ich\s+/i.test(t)
  if (ichVorne) t = t.replace(/^ich\s+/i, '')
  let woerter = t.split(/\s+/).filter(Boolean)
  if (ichVorne) woerter = hauptsatz(woerter)
  else if (nachDass) woerter = nebensatz(woerter)
  woerter = ohneZu(woerter)
  t = ohneFueller(woerter.join(' ')).replace(ARTIKEL_VORNE, '')
  // „Erinner mich an das Paket" → „Paket"
  t = t.replace(/^an\s+(?:das|den|die|dem)?\s*/i, '').replace(ARTIKEL_VORNE, '')
  t = glatt(t)
  if (PRONOMEN.test(t) || KEIN_INHALT.test(t)) return null
  return gross(t).slice(0, MAX_TEXT)
}

// Wörter am Anfang, die eine Aufgabe ankündigen; der Rest ist der Inhalt.
const AUFGABE_VORNE = [
  /^(?:schreib|schreibe)\s+(?:mir\s+|dir\s+)?(?:bitte\s+)?(?:mal\s+)?auf\b[\s,:]*(.*)$/i,
  /^(?:notier|notiere)(?:\s+dir|\s+mir)?(?:\s+bitte)?[\s,:]+(.*)$/i,
  /^(?:erinner|erinnere)\s+mich\s+(?:bitte\s+)?[\s,:]*(.*)$/i,
  /^(?:neue\s+)?(?:aufgabe|to-?\s?do|todo)\b[\s,:]*(.*)$/i,
  /^(?:füg|füge)\s+(?:bitte\s+)?(.*)$/i,
  /^(?:setz|setze|pack|packe|stell|stelle)\s+(?:mir\s+)?(?:bitte\s+)?(.*?\b(?:liste|to-?\s?dos?|todos?|aufgaben)\b.*)$/i,
  // „Kannst du X auf meine Liste setzen?" — das Verb steht hinten
  /^(.+?\b(?:auf|zu|in)\s+(?:meine|die|den|meinen)\s+(?:to-?do-?)?(?:liste|to-?\s?dos?|todos?|aufgaben))\s+(?:setzen|packen|schreiben|stellen|hinzufügen|eintragen|aufnehmen)$/i,
]

function aufgabe(satz, heute) {
  const s = satz.replace(/[.!?]+$/, '')
  let inhalt = null
  // Am Ende angehängt: „…, schreib das auf". Für mach/setz/pack nur mit Liste —
  // sonst wird „mach es ein bisschen lauter" zur Aufgabe.
  const ZUR_LISTE = '(?:auf\\s+(?:die|meine)\\s+(?:to-?do-?)?liste|zu\\s+(?:den|meinen)\\s+(?:to-?\\s?dos?|todos?|aufgaben))'
  const ende = s.match(new RegExp(`^(.*?)[,.;]?\\s*(?:bitte\\s+)?(?:(?:schreib|schreibe|notier|notiere)\\s+(?:mir\\s+|dir\\s+)?(?:das|es|dies)\\s+(?:bitte\\s+)?(?:${ZUR_LISTE}|auf)|(?:trag|trage)\\s+(?:mir\\s+)?(?:das|es|dies)\\s+(?:bitte\\s+)?(?:${ZUR_LISTE}|ein)|(?:pack|packe|setz|setze|mach|mache|tu|tue)\\s+(?:mir\\s+)?(?:das|es|dies)\\s+(?:bitte\\s+)?${ZUR_LISTE})\\b(.*)$`, 'i'))
  const trag = s.match(/^(?:trag|trage)\s+(?:mir\s+)?(?:bitte\s+)?(.*?)\s*\bein\b[\s,:]*(.*)$/i)
  if (ende) inhalt = `${ende[1]} ${ende[2]}`
  else if (trag) inhalt = `${trag[1]} ${trag[2]}`
  else {
    for (const re of AUFGABE_VORNE) {
      const m = s.match(re)
      if (m) { inhalt = m[1]; break }
    }
  }
  if (inhalt === null) return undefined         // kein Aufgabensatz
  // „Erinner mich nicht an …" — verneint ist das Gegenteil einer Aufgabe.
  if (/^[\s,:]*nicht\b/i.test(inhalt)) return null
  const { wann, rest } = zeitAus(s, inhalt, heute)
  if (!wann) return null
  const text = alsAufgabe(rest)
  return text ? { art: 'todo', text, wann } : null   // null: Aufgabe gemeint, Inhalt unklar
}

// ── Brain ───────────────────────────────────────────────────────────────────

const BRAIN_SUCHE = [
  new RegExp(`\\b(?:such|suche|schau|guck|sieh|seh|check)\\w*\\b.*?\\b(?:im|in\\s+meinem|ins|in\\s+dem|in\\s+deinem)\\s+${BRAIN}\\b\\s*(?:nach\\b)?(.*)$`, 'i'),
  new RegExp(`^was\\s+(?:steht|weiß|weiss|sagt|gibt|hab\\w*)(?=\\s).*?\\b${BRAIN}\\b(.*)$`, 'i'),
]

function brain(satz) {
  for (const re of BRAIN_SUCHE) {
    const m = satz.match(re)
    if (!m) continue
    const suche = glatt(m[1].replace(/^[\s,:]*(?:über|zu|zum|zur|von|bei|für|wegen|nach)\b/i, '').replace(/[?!.]+$/, ''))
      .replace(ARTIKEL_VORNE, '').replace(/^(?:dem\s+)?thema\s+/i, '')
    return suche ? { art: 'brain', suche: suche.slice(0, MAX_TEXT) } : null
  }
  return undefined
}

// ── Termine ─────────────────────────────────────────────────────────────────

const ABSAGE = [
  /\bnehme\s+ich\s+(?:heute\s+|morgen\s+)?nicht\s+(?:wahr|teil)\b/i,   // „morgen": siehe andererTag
  /\b(?:werde\s+ich\s+)?nicht\s+teilnehmen\b/i,
  /\bbin\s+ich\s+(?:heute\s+)?nicht\s+dabei\b/i,
  /\bgehe\s+ich\s+(?:heute\s+)?nicht(?:\s+hin)?\b/i,
  /\blasse?\s+ich\s+(?:heute\s+)?ausfallen\b/i,
  /\bfällt\s+(?:für\s+mich\s+)?(?:heute\s+)?aus\b/i,
  /(?<![a-zäöüß])(?:überspringe|schwänze|streiche)\s+ich\b/i,
]
const TERMIN_FUELLER = /\b(?:den|die|das|der|dem|termine?|treffen|heute|morgen|bei|an|zu|zur|zum|ich|mal|bitte|da|dann|also|okay|ok|meinen|meine|mein|vom|von|heutigen?)\b/gi

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Wie hiddenEvents.matchEventIdsByTitle: enthalten oder halbe Wortüberdeckung. */
function passendeTermine(titel, termine) {
  const nadel = norm(titel)
  if (!nadel) return []
  const nw = nadel.split(' ').filter((w) => w.length > 2)
  return termine.filter((e) => {
    const h = norm(e.title)
    if (!h) return false
    if (h.includes(nadel) || nadel.includes(h)) return true
    const hw = new Set(h.split(' '))
    return nw.length > 0 && nw.filter((w) => hw.has(w)).length / nw.length >= 0.5
  })
}

/** Ein Kalendertitel, wie man ihn sagt: „Hamburg Hbf ➞ Essen Hbf" →
 *  „Hamburg Hauptbahnhof nach Essen Hauptbahnhof", ohne Auftragsnummern. */
function sprechbar(titel) {
  return String(titel)
    .replace(/\s*\((?:Auftrag|Buchung|Nr\.?)[^)]*\)/gi, '')
    .replace(/\s*(?:➞|→|➔|⇒|->)\s*/g, ' nach ')
    .replace(/\bHbf\b/g, 'Hauptbahnhof')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Alle verschiedenen Titel nennen — Paul soll hören, was verschwindet. */
function titelVon(treffer) {
  const namen = [...new Set(treffer.map((e) => sprechbar(e.title)))]
  return namen.length <= 3 ? namen.join(' und ') : `${namen.slice(0, 3).join(', ')} und ${namen.length - 3} weitere`
}

function terminTreffer(kandidat, termine) {
  const titel = glatt(kandidat.replace(TERMIN_FUELLER, ' '))
  if (!titel) return null
  const treffer = passendeTermine(titel, termine)
  return treffer.length
    ? { art: 'termin', titel: titelVon(treffer), ids: treffer.map((e) => e.id) }
    : { art: 'termin', titel: gross(titel).slice(0, MAX_TEXT), ids: [] }
}

function termin(satz, termine, heute) {
  const s = satz.replace(/[.!?]+$/, '')
  const sag = s.match(/^(?:sag|sage)\s+(?:bitte\s+)?(.+?)\s+ab$/i) || s.match(/^(?:nimm|nehm)\s+(?:bitte\s+)?(.+?)\s+(?:raus|aus\s+meinem\s+tag)$/i)
  const absage = sag ? null : ABSAGE.find((re) => re.test(s))
  if (!sag && !absage) return undefined
  // Daily kennt hier nur die heutigen Termine: „das Training morgen fällt
  // aus" darf nicht das heutige ausblenden.
  if (andererTag(s, heute)) return null
  return terminTreffer(sag ? sag[1] : s.replace(absage, ' '), termine)
}

// ── Der Rest ────────────────────────────────────────────────────────────────

const ENDE = /^(?:(?:okay|ok|gut|alles\s+klar|ja|nein)[,\s]*)?(?:weiter|mach\s+weiter|weitermachen|nichts|nichts\s+mehr|nein|danke|passt|stopp|stop|das\s+war'?s|das\s+wars|das\s+war\s+(?:alles|es)|fertig|gut|okay|ok|alles\s+klar)(?:[,\s]+(?:bitte|danke))?$/i
// Was vor dem eigentlichen Befehl stehen darf: Anrede, Füllwort, Höflichkeit.
const VORSPANN = /^(?:(?:hey\s+|hallo\s+)?daily|okay|ok|also|ja|gut|so|und|äh|ähm|kannst\s+du(?:\s+mir)?|könntest\s+du(?:\s+mir)?|würdest\s+du(?:\s+mir)?)(?:[\s,:]+(?:bitte\s+)?|\s*$)/i

// Nur die eindeutigen Formen — „ich will das doch nicht" braucht den
// Zusammenhang und geht an Gemini.
const ZURUECK = /^(?:(?:nein|ne|oh|ups|stopp)[,!\s]+)?(?:zurück|rückgängig|mach\s+(?:das|es)\s+rückgängig|nimm\s+(?:das|es)\s+(?:wieder\s+)?zurück|das\s+war\s+falsch|falsch\s+verstanden)(?:[,\s]+bitte)?$/i

function verstehe(satz, { heute, termine = [] } = {}) {
  let s = String(satz || '').trim()
  if (!s || !heute) return null
  if (ENDE.test(s.replace(/[.!?]+$/, '').trim())) return { art: 'ende' }
  for (let vorher = ''; vorher !== s;) { vorher = s; s = s.replace(VORSPANN, '').trim() }
  if (!s) return null
  const ohneSatzzeichen = s.replace(/[.!?]+$/, '').trim()
  if (ENDE.test(ohneSatzzeichen)) return { art: 'ende' }

  if (ZURUECK.test(ohneSatzzeichen)) return { art: 'zurueck' }

  const hermes = s.match(/^(?:hey\s+)?hermes[,:]?\s+(.+)$/i) || s.match(/^(?:frag|frage)\s+(?:mal\s+)?hermes[,:]?\s*(.+)$/i)
  if (hermes) return { art: 'hermes', text: hermes[1].trim() }

  const antwort = s.match(/^(?:zur|zu\s+der)\s+(?:brain-?\s*)?frage\b[\s,:]*(.+)$/i)
    || s.match(/^(?:meine\s+)?antwort(?:\s+auf\s+die\s+(?:brain-?\s*)?frage)?(?:\s+ist)?[\s,:]+(.+)$/i)
  if (antwort) return { art: 'antwort', text: gross(antwort[1].trim()).slice(0, MAX_ANTWORT) }

  const b = brain(s)
  if (b !== undefined) return b
  const a = aufgabe(s, heute)
  if (a !== undefined) return a
  const t = termin(s, termine, heute)
  if (t !== undefined) return t
  return null
}

/** Ein Befehl von aussen (Gemini) — nur, was Daily auch selbst erzeugen würde. */
function pruefe(b, { heute, termine = [], bald = [], aufgaben = [] } = {}) {
  if (!b || typeof b !== 'object' || typeof b.art !== 'string') return null
  const text = (v, max) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)
  switch (b.art) {
    case 'todo': {
      const t = text(b.text, MAX_TEXT)
      const wann = b.wann === undefined || b.wann === null || b.wann === '' ? 'heute' : b.wann
      if (!t) return null
      if (wann === 'heute' || wann === 'woche') return { art: 'todo', text: t, wann }
      if (typeof wann !== 'string' || !gueltig(wann) || wann < heute) return null
      if ((Date.parse(wann) - Date.parse(heute)) / TAG_MS > MAX_TAGE_VORAUS) return null
      return { art: 'todo', text: t, wann: wann === heute ? 'heute' : wann }
    }
    case 'termin': {
      const ids = Array.isArray(b.ids) ? b.ids.filter((id) => typeof id === 'string') : []
      // Gemini darf einen kurzen Namen mitgeben („deine Bahnfahrt nach Essen") —
      // sonst hört Paul „Buchungsbestätigung Deutsche Bahn …". Gesagt wird er
      // nur Paul; ausgeblendet wird trotzdem nur, was die ids treffen.
      const name = text(b.text, MAX_TERMIN_NAME)
      const heutige = termine.filter((e) => ids.includes(e.id))
      if (heutige.length) return { art: 'termin', titel: name || titelVon(heutige), ids: heutige.map((e) => e.id) }
      // Spätere Termine, auch über mehrere Tage (eine Reise: hin und zurück).
      // Der Satz nennt jeden Tag, damit Paul hört, was verschwindet.
      const spaeter = bald.filter((e) => ids.includes(e.id) && gueltig(e.datum))
      const tage = [...new Set(spaeter.map((e) => e.datum))].sort()
      if (!spaeter.length || spaeter.length > MAX_TERMIN_IDS || tage.length > MAX_TERMIN_TAGE) return null
      return { art: 'termin', titel: name || titelVon(spaeter), ids: spaeter.map((e) => e.id), datum: tage[0], tage }
    }
    case 'streichen':
    case 'erledigt': {
      const ids = Array.isArray(b.ids) ? b.ids.filter((id) => typeof id === 'string') : []
      const treffer = aufgaben.filter((t) => ids.includes(t.id))
      if (!treffer.length || treffer.length !== new Set(ids).size || treffer.length > 3) return null
      return { art: b.art, ids: treffer.map((t) => t.id), titel: treffer.map((t) => t.text).join(' und ') }
    }
    case 'rueckfrage': {
      const t = text(b.text, MAX_RUECKFRAGE)
      return t ? { art: 'rueckfrage', text: t } : null
    }
    case 'zurueck':
      return { art: 'zurueck' }
    case 'brain': {
      const s = text(b.suche, MAX_TEXT)
      return s ? { art: 'brain', suche: s } : null
    }
    case 'antwort': {
      const t = text(b.text, MAX_ANTWORT)
      return t ? { art: 'antwort', text: t } : null
    }
    case 'hermes': {
      const t = text(b.text, MAX_ANTWORT)
      return t ? { art: 'hermes', text: t } : null
    }
    case 'ende':
      return { art: 'ende' }
    default:
      return null
  }
}

module.exports = { verstehe, pruefe, passendeTermine, sprechbar }
