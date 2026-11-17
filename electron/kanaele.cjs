// Klemmt ein Kanal zwischen Daily, Hermes und dem Second Brain?
//
// WARUM ES DAS GIBT
// Am 2026-10-27 stellte sich heraus: zwölf Entscheidungen lagen seit dem 1.9.
// in Daily, keine war im Brain; eine Antwort auf eine Brain-Frage wartete seit
// Tagen auf Abholung. Nichts davon war kaputt im Sinne einer Fehlermeldung —
// es passierte einfach nichts, und niemand merkte es. Die tägliche
// Gesundheitsprüfung endet nur mit einem Exit-Code, den keiner liest.
//
// Hier wird jeder Kanal nach einer einfachen Frage geprüft: Ist etwas, das
// längst hätte passieren sollen, nicht passiert? Die Antwort erscheint als
// schmaler Streifen im Dashboard (KanalHinweis.tsx) — dort, wo Paul jeden
// Morgen hinsieht. Ein Kanal, der noch nie lief, gilt als „noch nicht
// eingerichtet", nicht als kaputt: sonst stünde vom ersten Tag an ein Alarm da.

const questionStore = require('./questionStore.cjs')
const suggestionStore = require('./suggestionStore.cjs')
const tagesbericht = require('./tagesbericht.cjs')
const fristenSync = require('./fristenSync.cjs')
const hoerbriefing = require('./hoerbriefing.cjs')

const ZONE = 'Europe/Berlin'
const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: ZONE })
const stundeBerlin = () => Number(new Date().toLocaleString('en-GB', { timeZone: ZONE, hour: '2-digit', hour12: false }))

function tage(von, bis) {
  return Math.round((Date.parse(bis + 'T12:00:00Z') - Date.parse(von + 'T12:00:00Z')) / 86_400_000)
}

/** Alle Kanäle, jeder mit `ok` und einem Satz. `probleme` nur die klemmenden. */
function stand() {
  const tag = heute()
  const kanaele = []

  // Tagesbericht: gestern Abend hätte er quittiert sein sollen.
  const q = tagesbericht.letzteQuittung()
  if (!q) kanaele.push({ name: 'tagesbericht', ok: true, eingerichtet: false, text: 'Tagesbericht: noch nie übergeben' })
  else {
    const alt = tage(q.letzter, tag)
    kanaele.push({ name: 'tagesbericht', ok: alt <= 1, eingerichtet: true,
      text: alt <= 1 ? `Tagesbericht vom ${q.letzter} im Brain` : `Tagesbericht seit ${alt} Tagen nicht im Brain (zuletzt ${q.letzter})` })
  }

  // Fristen: täglicher Abgleich mit dem Brain.
  const f = fristenSync.zustand().letzterAbgleich
  if (!f) kanaele.push({ name: 'fristen', ok: true, eingerichtet: false, text: 'Fristen-Abgleich: noch nie gelaufen' })
  else {
    const std = Math.round((Date.now() - Date.parse(f.um)) / 3_600_000)
    kanaele.push({ name: 'fristen', ok: std <= 48, eingerichtet: true,
      text: std <= 48 ? (std < 1 ? 'Fristen gerade mit dem Brain abgeglichen' : `Fristen vor ${std} h mit dem Brain abgeglichen`) : `Fristen seit ${Math.round(std / 24)} Tagen nicht mit dem Brain abgeglichen` })
  }

  // Antwort und Entscheidungen fahren mit dem Tagesbericht. Solange der noch
  // nie lief, gibt es keinen Weg ins Brain — dann wäre ein Alarm nur Lärm.
  const berichtLaeuft = Boolean(q)

  // Brain-Antwort: abgeholt wird mit dem Tagesbericht, spätestens am nächsten Tag.
  const antwort = questionStore.zustand().antwort
  if (antwort) {
    const alt = tage(antwort.beantwortetAm, tag)
    kanaele.push({ name: 'brainAntwort', ok: !berichtLaeuft || alt <= 1, eingerichtet: berichtLaeuft,
      text: alt <= 1 ? 'Deine Antwort geht heute Abend ins Brain' : `Deine Antwort von vor ${alt} Tagen ist noch nicht im Brain` })
  }

  // Entscheidungen: ebenfalls mit dem Tagesbericht.
  const offen = suggestionStore.entscheidungen(200, true).entscheidungen
  if (offen.length) {
    const aeltest = offen.map((e) => e.datum).filter(Boolean).sort()[0] || tag
    const alt = tage(aeltest, tag)
    kanaele.push({ name: 'entscheidungen', ok: !berichtLaeuft || alt <= 2, eingerichtet: berichtLaeuft,
      text: alt <= 2 ? `${offen.length} Entscheidung(en) gehen mit dem nächsten Tagesbericht ins Brain`
        : `${offen.length} Entscheidung(en) seit ${alt} Tagen nicht im Brain` })
  }

  // Hörbriefing: ab 9 Uhr sollte das von heute da sein.
  const hb = hoerbriefing.lies(tag)
  if (hoerbriefing.verlauf(14).length > 0) {
    const fehlt = !hb && stundeBerlin() >= 9
    const stimmeFehlt = hb?.status === 'fehler'
    kanaele.push({ name: 'hoerbriefing', ok: !fehlt && !stimmeFehlt, eingerichtet: true,
      text: fehlt ? 'Heute ist kein Hörbriefing gekommen' : stimmeFehlt ? 'Das Hörbriefing von heute hat keine Stimme bekommen'
        : hb?.ersatz ? 'Hörbriefing heute mit Ersatzstimme' : 'Hörbriefing ok' })
  }

  return { serverDate: tag, kanaele, probleme: kanaele.filter((k) => !k.ok).map((k) => k.text) }
}

module.exports = { stand }
