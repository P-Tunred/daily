// Freie Bloecke im Kalender — gerechnet, nicht geschaetzt.
//
// WARUM DAS KEIN AGENT MACHT
// "Wann habe ich Zeit" ist Intervallarithmetik. Hermes rechnet die Luecken
// heute schon fuer den Briefing-Text aus, aber das Ergebnis versickert im
// Fliesstext ("vormittags hast du drei Stunden"). Als Satz kann man es nicht
// anklicken, nicht eintragen und nicht nachpruefen. Hier faellt dieselbe
// Rechnung als Liste an, aus der ein Termin werden kann.
//
// WAS ES NICHT TUT
// Es traegt nichts von allein ein. Ein Kalender, der sich selbst befuellt,
// ist in zwei Wochen unbenutzbar — die Luecke wird angeboten, Paul entscheidet.

const calSource = require('./calendarSource.cjs')

const ZONE = 'Europe/Berlin'
/** Kuerzer lohnt sich nicht: unter einer Stunde ist es keine Lernzeit,
 *  sondern eine Pause zwischen zwei Terminen. */
const MIN_MINUTEN = 60
/** Der Tag, in dem gesucht wird. Vor 8 und nach 22 wird nichts vorgeschlagen —
 *  eine "Luecke" um 3 Uhr nachts ist keine. */
const TAG_START = 8
const TAG_ENDE = 22
const TAGE = 7
/** Luft um bestehende Termine. Wer 10:00 Schluss hat, faengt nicht 10:00 an. */
const PUFFER_MIN = 15

function tagIso(d) {
  return d.toLocaleDateString('sv-SE', { timeZone: ZONE })
}

/** Minuten seit Mitternacht (Berlin) fuer einen Zeitpunkt. */
function minuteImTag(iso) {
  const d = new Date(iso)
  const s = d.toLocaleTimeString('de-DE', { timeZone: ZONE, hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

function alsUhrzeit(minuten) {
  const h = Math.floor(minuten / 60)
  const m = minuten % 60
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

/** Belegte Intervalle eines Tages, zusammengefasst und mit Puffer.
 *  Ganztagestermine blockieren den ganzen Tag — wer Geburtstag hat oder auf
 *  Reisen ist, hat keine drei Stunden Lernzeit, auch wenn der Kalender formal
 *  leer aussieht. */
function belegt(events, tag) {
  const heute = events.filter((e) => {
    const s = String(e.start)
    const startTag = s.length === 10 ? s : tagIso(new Date(s))
    return startTag === tag
  })
  if (heute.some((e) => e.allDay)) return [[TAG_START * 60, TAG_ENDE * 60]]

  const roh = heute
    .filter((e) => !e.allDay)
    .map((e) => {
      const von = minuteImTag(e.start) - PUFFER_MIN
      const bis = minuteImTag(e.end || e.start) + PUFFER_MIN
      return [Math.max(0, von), Math.max(von + 30, bis)]
    })
    .sort((a, b) => a[0] - b[0])

  // Ueberlappungen verschmelzen — sonst entstehen Scheinluecken zwischen zwei
  // Terminen, die sich in Wahrheit ueberschneiden.
  const zusammen = []
  for (const [von, bis] of roh) {
    const letzter = zusammen[zusammen.length - 1]
    if (letzter && von <= letzter[1]) letzter[1] = Math.max(letzter[1], bis)
    else zusammen.push([von, bis])
  }
  return zusammen
}

/** Freie Bloecke der naechsten Tage, laengster zuerst. */
function luecken({ tage = TAGE, minMinuten = MIN_MINUTEN } = {}) {
  const events = calSource.readEvents()
  if (!events) return { verfuegbar: false, grund: 'kein-kalender', bloecke: [] }

  const jetztTag = tagIso(new Date())
  const jetztMinute = minuteImTag(new Date().toISOString())
  const bloecke = []

  for (let i = 0; i < tage; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const tag = tagIso(d)

    // Heute zaehlt nur, was noch kommt — eine Luecke von 9 bis 12 ist um 15 Uhr
    // keine Empfehlung mehr, sondern eine Verhoehnung.
    let cursor = i === 0 ? Math.max(TAG_START * 60, jetztMinute + PUFFER_MIN) : TAG_START * 60

    for (const [von, bis] of belegt(events, tag)) {
      if (von - cursor >= minMinuten) bloecke.push({ tag, von: cursor, bis: von })
      cursor = Math.max(cursor, bis)
    }
    if (TAG_ENDE * 60 - cursor >= minMinuten) bloecke.push({ tag, von: cursor, bis: TAG_ENDE * 60 })
  }

  const fertig = bloecke
    .map((b) => ({
      tag: b.tag,
      von: alsUhrzeit(b.von),
      bis: alsUhrzeit(b.bis),
      minuten: b.bis - b.von,
      id: `luecke:${b.tag}:${alsUhrzeit(b.von)}`,
    }))
    .sort((a, b) => (a.tag === b.tag ? a.von.localeCompare(b.von) : a.tag.localeCompare(b.tag)))

  return { verfuegbar: true, serverDate: jetztTag, minMinuten, bloecke: fertig }
}

module.exports = { luecken, MIN_MINUTEN, TAG_START, TAG_ENDE }
