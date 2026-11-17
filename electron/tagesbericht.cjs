// Der Tagesbericht — was an einem Tag in Daily passiert ist, fürs Second Brain.
//
// WOZU
// Das Brain wusste, was in Mails und im Kalender stand, aber nicht, was Paul
// getan hat: gelernt, abgehakt, liegen gelassen, Routinen, Gym. Geplant seit
// August (Phase 7.2 in „Daily auf die VM"), nie gebaut. Wunsch vom 2026-10-27.
//
// WER WAS TUT
// Daily stellt den Bericht zusammen — aus gemessenen Daten, ohne Modell, jeden
// Abend gleich aufgebaut. Hermes legt ihn WORTGLEICH als
// `raw/inbox/<datum>_daily.md` ins Brain (nur er schreibt dorthin) und
// quittiert mit dem Pfad. Die Einspeisung am nächsten Morgen verarbeitet ihn
// wie jede andere Datei in der Inbox — nach den Regeln der Brain-CLAUDE.md.
//
// ZWEI ANDERE KANÄLE FAHREN MIT
// Eine Antwort auf die Brain-Frage und die Entscheidungen aus dem
// Morgendialog sind seit Wochen in Daily liegen geblieben (Befund 2026-10-27:
// 12 Entscheidungen, keine im Brain; eine Antwort wartete auf Abholung). Sie
// kommen jetzt mit in den Bericht. Erst wenn Hermes den Pfad quittiert, gelten
// sie als übergeben — vorher nicht. Ein Weg, ein Schreiber, eine Quittung.

const stateStore = require('./stateStore.cjs')
const questionStore = require('./questionStore.cjs')
const suggestionStore = require('./suggestionStore.cjs')
const stimmeLog = require('./stimmeLog.cjs')

const ZONE = 'Europe/Berlin'
const MARKER_KEY = 'morning.tagesbericht'
const ISO = /^\d{4}-\d{2}-\d{2}$/
const NACHHOLEN_TAGE = 7

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
const tagVon = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: ZONE })

function fehler(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {})
}

function json(state, key, fallback) {
  try { const v = JSON.parse(state.localStorage[key]); return v ?? fallback } catch { return fallback }
}

function dauer(min) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

function langesDatum(datum) {
  return new Date(datum + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const kurz = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

/** Gym an einem Tag — mit derselben Rechnung wie der Score (src/lib/bewusst.ts).
 *  Lädt die TS-Datei direkt; Node 22 kann das. Geht es nicht (Electron auf dem
 *  Mac), heisst die Antwort „unbekannt" statt geraten. */
function gymAm(bewusst, datum) {
  try {
    const { aenderungAm, bounds } = require('../src/lib/bewusst.ts')
    return aenderungAm(bewusst.periods?.[`week:${bounds('week', datum).start}`], 'gym', datum) > 0
  } catch {
    return null
  }
}

/** Den Bericht für einen Tag bauen. Liest nur. */
function baue(datum = heute()) {
  if (!ISO.test(datum)) throw fehler(400, 'datum muss JJJJ-MM-TT sein')
  if (datum > heute()) throw fehler(400, 'Ein Bericht über einen Tag, der noch nicht war, wäre erfunden.')
  const state = stateStore.read()

  const score = json(state, 'morning.scoreHistory', {})[datum] || null
  const sessions = json(state, 'morning.tracker.sessions', []).filter((s) => s && s.date === datum && s.durationMin > 0)
  const faecher = new Map(json(state, 'morning.tracker.subjects', []).map((f) => [f.id, f.name]))
  const proFach = new Map()
  for (const s of sessions) {
    const name = faecher.get(s.subjectId) || '(unbekanntes Fach)'
    proFach.set(name, (proFach.get(name) || 0) + s.durationMin)
  }
  const lernMin = sessions.reduce((a, s) => a + s.durationMin, 0)

  const alleTodos = [...json(state, 'morning.todos', []), ...(state.indexedDB.todos || [])]
  const todos = [...new Map(alleTodos.filter((t) => t && t.id).map((t) => [t.id, t])).values()]
  const erledigt = todos.filter((t) => t.done && t.origin !== 'bewusst' && Number.isFinite(t.doneAt) && tagVon(t.doneAt) === datum)
  const offen = todos.filter((t) => !t.done && (t.scope ?? 'day') === 'day' && t.origin !== 'bewusst')

  const bewusst = json(state, 'morning.bewusst.v1', null)
  const tagPeriode = bewusst?.periods?.[`day:${datum}`]
  const routinen = (tagPeriode?.goals || []).filter((g) => !g.paused)
  const gym = bewusst ? gymAm(bewusst, datum) : null

  const events = json(state, 'morning.important.events', [])
  const fristHeuteAufgabe = events.filter((e) => e && e.todoErzeugt === datum)
  const ergebnisse = (json(state, 'morning.vorlauf', {}).ergebnisse || [])
    .filter((r) => r && (r.erledigtAm === datum || (r.verpasst && r.am === datum)))

  const frageZustand = questionStore.zustand()
  const antwort = frageZustand.antwort || null
  const entscheidungen = suggestionStore.entscheidungen(200, true).entscheidungen
  const perStimme = stimmeLog.vomTag(state, datum)

  // ── Text ──
  const z = []
  z.push('---', 'quelle: Daily (automatisch erzeugt)', `datum: ${datum}`, `erstellt: ${new Date().toISOString()}`, 'art: tagesbericht', '---', '')
  z.push(`# Tagesbericht ${langesDatum(datum)}`, '')
  z.push('Automatisch aus Daily zusammengestellt. Alle Zahlen sind gemessen, nichts ist geschätzt.', '')

  z.push('## Der Tag in Zahlen', '')
  // Der Score ist ein Schnappschuss des Browsers, aufgenommen, solange das
  // Dashboard offen ist. Wurde danach noch gelernt oder abgehakt, ist er
  // veraltet (Befund 2026-10-27: am 26.10. 367 min gelernt, Score „0 min").
  // Dann lieber sagen, dass er nicht stimmt, als dem Brain eine falsche Zahl
  // als gemessen zu verkaufen.
  const veraltet = score && ((score.studyMin ?? 0) + 5 < lernMin || (score.tasksDone ?? 0) < erledigt.length)
  if (veraltet) {
    z.push(`- Score: nicht verlässlich — Daily hat ihn zuletzt bei ${score.studyMin ?? 0} min Lernzeit und ${score.tasksDone ?? 0} erledigten Aufgaben festgehalten, gemessen sind mehr (siehe unten). Nicht ins Wiki übernehmen.`)
  } else if (score) {
    const teile = [`Aufgaben ${score.tasks}`, `Lernzeit ${score.time}`]
    if (score.routineBonus) teile.push(`Routinen +${score.routineBonus}`)
    if (score.drag) teile.push(`Liegenbleiber ${score.drag}`)
    z.push(`- Score: **${score.score}/100** (${teile.join(', ')})${score.nachgetragen ? ' — nachträglich ergänzt' : ''}`)
  } else {
    z.push('- Score: an diesem Tag nicht festgehalten')
  }
  const ziel = score?.goalMin
  z.push(`- Lernzeit: **${dauer(lernMin)}**${ziel ? ` von ${dauer(ziel)} Ziel` : ''}${proFach.size ? ' — ' + [...proFach].sort((a, b) => b[1] - a[1]).map(([f, m]) => `${f} ${dauer(m)}`).join(', ') : ''}`)
  z.push(`- Aufgaben: ${erledigt.length} erledigt, ${offen.length} offen`, '')

  if (erledigt.length) {
    z.push('## Erledigt', '')
    for (const t of erledigt) z.push(`- ${t.text}${t.ausTermin ? ' (aus einer Frist)' : ''}`)
    z.push('')
  }
  if (offen.length) {
    z.push('## Offen geblieben', '')
    for (const t of [...offen].sort((a, b) => (b.verschoben || 0) - (a.verschoben || 0)).slice(0, 10)) {
      z.push(`- ${t.text}${t.verschoben ? ` — seit ${t.verschoben} Tagen weitergeschoben` : ''}`)
    }
    if (offen.length > 10) z.push(`- … und ${offen.length - 10} weitere`)
    z.push('')
  }

  if (routinen.length || gym !== null) {
    z.push('## Routinen und Bewusst leben', '')
    const gemacht = routinen.filter((g) => g.value >= g.target).map((g) => g.title)
    const nicht = routinen.filter((g) => g.value < g.target).map((g) => g.title)
    if (gemacht.length) z.push(`- Gemacht: ${gemacht.join(' · ')}`)
    if (nicht.length) z.push(`- Nicht gemacht: ${nicht.join(' · ')}`)
    if (!routinen.length) z.push('- Für diesen Tag waren keine Routinen ausgewählt.')
    if (gym !== null) z.push(`- Gym: ${gym ? 'ja' : 'nein'}`)
    z.push('')
  }

  if (fristHeuteAufgabe.length || ergebnisse.length) {
    z.push('## Fristen', '')
    for (const e of fristHeuteAufgabe) z.push(`- Zur Aufgabe geworden: „${e.title}" (Frist ${kurz(e.date)})`)
    for (const r of ergebnisse) {
      if (r.verpasst && !r.erledigtAm) z.push(`- **Verpasst:** „${r.titel}" (Frist ${kurz(r.frist)}, Aufgabe war ${r.vorlaufTage ?? '?'} Tage vorher da)`)
      else z.push(`- Erledigt: „${r.titel}" — ${r.pufferTage} Tage vor der Frist (Vorlauf war ${r.vorlaufTage ?? '?'} Tage)`)
    }
    z.push('')
  }

  if (antwort) {
    z.push('## Antwort auf eine Brain-Frage', '')
    z.push(`- Frage: ${antwort.frage}`, `- Kennung: \`${antwort.id}\``, `- Zielseite: \`${antwort.seite}\``)
    z.push(`- Beantwortet von Paul in Daily am ${antwort.beantwortetAm}:`, '', `> ${String(antwort.antwort).replace(/\n+/g, ' ')}`, '')
  }

  if (entscheidungen.length) {
    z.push('## Entscheidungen aus dem Morgendialog', '')
    z.push('| Datum | Entschieden | Vorschlag | Begründung | Quelle |', '|---|---|---|---|---|')
    const zelle = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
    for (const e of entscheidungen) z.push(`| ${e.datum} | ${e.ja ? 'Ja' : 'Nein'} | ${zelle(e.titel)} | ${zelle(e.warum)} | ${zelle(e.quelle)} |`)
    z.push('')
  }

  if (perStimme.length) {
    // Was Paul gesagt hat, nicht was Daily vermutet: Aufgaben stehen oben
    // schon in der Liste, hier geht es um das Wie und um das, was nirgends
    // sonst auftaucht (abgesagte Termine, Fragen ans Brain).
    z.push('## Per Stimme', '')
    const zeile = {
      todo: (e) => `- Aufgabe angelegt: ${e.text}${e.wo ? ` (${e.wo})` : ''}`,
      termin: (e) => `- Nicht wahrgenommen: ${e.text}`,
      brain: (e) => `- Im Brain nachgesehen: ${e.text}`,
      antwort: (e) => `- Brain-Frage beantwortet: ${e.text}`,
      streichen: (e) => `- Gestrichen, will Paul nicht mehr: ${e.text}`,
      erledigt: (e) => `- Per Stimme abgehakt: ${e.text}`,
    }
    for (const e of perStimme) if (zeile[e.art]) z.push(zeile[e.art](e))
    z.push('')
  }

  z.push('## Für die Einspeisung', '')
  if (antwort) z.push(`- Die Antwort gehört auf \`${antwort.seite}\` unter die Frage (Format „→ **Laut Paul (Daily, ${antwort.beantwortetAm}):** …").`)
  if (perStimme.some((e) => e.art === 'termin')) z.push('- Nicht wahrgenommene Termine: nur übernehmen, wenn sich daraus etwas ergibt (eine Serie, die Paul aufgibt, ein Mensch, den er versetzt).')
  if (perStimme.some((e) => e.art === 'streichen')) z.push('- Gestrichene Vorhaben sind Entscheidungen („doch nicht"): eine Reise, ein Projekt, ein Termin, den Paul aufgibt, gehört ins Entscheidungsarchiv; Kleinkram nicht.')
  if (perStimme.some((e) => e.art === 'brain')) z.push('- Die Suchen im Brain zeigen, was Paul gerade beschäftigt — fand sich nichts, fehlt dort vielleicht eine Seite.')
  if (entscheidungen.length) z.push('- Entscheidungen mit Gewicht (zugesagt, abgelehnt, gebucht, storniert, eingereicht) ins Entscheidungsarchiv; Kleinkram nicht.')
  z.push('- Die Tageszahlen nicht einzeln ins Wiki übernehmen — die Wochenauswertung fasst sie zusammen. Auffälliges (mehrere Tage ohne Lernzeit, eine verpasste Frist) darf auf die passende Seite.')
  z.push('')

  return {
    datum,
    dateiname: `${datum}_daily.md`,
    markdown: z.join('\n'),
    enthaelt: { antwortId: antwort ? antwort.id : null, entscheidungIds: entscheidungen.map((e) => e.id) },
  }
}

/**
 * Hermes hat den Bericht ins Brain gelegt. Erst jetzt gelten Antwort und
 * Entscheidungen als übergeben. Teilerfolge werden einzeln gemeldet — eine
 * Quittung, die „ok" sagt, obwohl die Antwort hängen blieb, wäre genau die Art
 * Fehler, die hier schon einmal wochenlang niemand bemerkt hat.
 */
function quittiere(input = {}) {
  const datum = input.datum
  if (typeof datum !== 'string' || !ISO.test(datum)) throw fehler(400, 'Feld "datum" fehlt (JJJJ-MM-TT).')
  const grenze = new Date(Date.now() - NACHHOLEN_TAGE * 86_400_000).toLocaleDateString('sv-SE', { timeZone: ZONE })
  if (datum > heute() || datum < grenze) throw fehler(400, `Quittungen gehen nur für die letzten ${NACHHOLEN_TAGE} Tage.`)
  const pfad = typeof input.pfad === 'string' ? input.pfad.trim() : ''
  if (!/^raw\/inbox\/[\w.-]+\.md$/.test(pfad)) throw fehler(400, 'Feld "pfad" muss der Pfad im Brain sein, z. B. "raw/inbox/2026-10-27_daily.md".')

  const ergebnis = { ok: true, datum, pfad, antwort: null, entscheidungen: null, probleme: [] }
  if (typeof input.antwortId === 'string' && input.antwortId) {
    try { ergebnis.antwort = questionStore.quittiereAntwort(input.antwortId).id }
    catch (e) { ergebnis.probleme.push(`Antwort ${input.antwortId}: ${e.message}`) }
  }
  if (Array.isArray(input.entscheidungIds) && input.entscheidungIds.length) {
    try { ergebnis.entscheidungen = suggestionStore.imBrainVermerkt(input.entscheidungIds.map(String), pfad).vermerkt }
    catch (e) { ergebnis.probleme.push(`Entscheidungen: ${e.message}`) }
  }

  const state = stateStore.read()
  const alt = json(state, MARKER_KEY, null)
  state.localStorage[MARKER_KEY] = JSON.stringify({
    letzter: alt && alt.letzter > datum ? alt.letzter : datum, pfad, um: new Date().toISOString(),
  })
  stateStore.write(state)
  console.log(`[tagesbericht] ${datum} im Brain unter ${pfad}` +
    (ergebnis.antwort ? ', Antwort übergeben' : '') + (ergebnis.entscheidungen ? `, ${ergebnis.entscheidungen} Entscheidung(en)` : '') +
    (ergebnis.probleme.length ? ` — PROBLEME: ${ergebnis.probleme.join(' | ')}` : ''))
  return ergebnis
}

function letzteQuittung() {
  return json(stateStore.read(), MARKER_KEY, null)
}

module.exports = { baue, quittiere, letzteQuittung, MARKER_KEY }
