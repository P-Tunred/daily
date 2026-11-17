// Sprachbefehle ohne Umweg: was Daily aus einem gesprochenen Satz selbst versteht.
//
// WARUM DIESE TESTS EXISTIEREN
// Paul (2026-11-03): Über Hermes dauert jede Antwort zehn Sekunden — zu lange,
// um mitten im Hörbriefing „schreib auf …" zu sagen. Die häufigen Befehle
// erkennt Daily deshalb selbst, ohne Modell und ohne Netz: Aufgabe für heute,
// diese Woche oder einen Tag; im Brain nachsehen; einen Termin aus dem Tag
// nehmen; die Brain-Frage beantworten; „weiter". Was hier nicht sicher passt,
// muss `null` ergeben — lieber nachfragen (Gemini, dann Hermes) als eine
// falsche Aufgabe anlegen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { verstehe, pruefe } = require('../electron/sprachBefehl.cjs')

// Dienstag, 3. November 2026
const HEUTE = '2026-11-03'
const TERMINE = [
  { id: 'lern-1|2026-11-03T16:00:00Z', title: 'Lerngruppe OR' },
  { id: 'vl-9|2026-11-03T08:00:00Z', title: 'Vorlesung Statistik' },
  { id: 'zahn-2|2026-11-03T13:30:00Z', title: 'Zahnarzt Dr. Müller' },
]
const v = (satz, extra = {}) => verstehe(satz, { heute: HEUTE, termine: TERMINE, frageOffen: true, ...extra })

describe('Aufgaben', () => {
  const faelle = [
    ['Schreib auf, dass ich morgen die Steuererklärung abschicke.', 'Steuererklärung abschicken', '2026-11-04'],
    ['Füg bitte Milch kaufen zu meinen To-dos hinzu.', 'Milch kaufen', 'heute'],
    ['Setz Wohnung putzen diese Woche auf meine Liste.', 'Wohnung putzen', 'woche'],
    ['Erinner mich am Freitag daran, Mama anzurufen.', 'Mama anrufen', '2026-11-06'],
    ['Neue Aufgabe: Bewerbung an Siemens schicken.', 'Bewerbung an Siemens schicken', 'heute'],
    ['Ich muss heute noch die Bachelorarbeit drucken, schreib das auf.', 'Bachelorarbeit drucken', 'heute'],
    ['Trag für übermorgen ein: Zahnarzt anrufen.', 'Zahnarzt anrufen', '2026-11-05'],
    ['To-do für nächste Woche: Reifen wechseln.', 'Reifen wechseln', '2026-11-09'],
    ['Am 12. November Geschenk für Lisa besorgen, schreib das auf.', 'Geschenk für Lisa besorgen', '2026-11-12'],
    ['Notier dir, dass ich die Rechnung bezahlen muss.', 'Rechnung bezahlen', 'heute'],
    ['Schreib auf: ich rufe morgen den Vermieter an.', 'Vermieter anrufen', '2026-11-04'],
    ['Pack auf die Liste für diese Woche, dass ich das Fahrrad repariere.', 'Fahrrad reparieren', 'woche'],
    ['Füge Gym zu den Aufgaben für heute hinzu', 'Gym', 'heute'],
    ['Okay, schreib auf, Wäsche waschen.', 'Wäsche waschen', 'heute'],
    ['Kannst du Milch kaufen auf meine Liste setzen?', 'Milch kaufen', 'heute'],
    ['Notiere: Geburtstagsgeschenk für Mama.', 'Geburtstagsgeschenk für Mama', 'heute'],
    ['Daily, schreib auf, dass ich morgen die Miete überweise.', 'Miete überweisen', '2026-11-04'],
  ]
  for (const [satz, text, wann] of faelle) {
    test(satz, () => assert.deepEqual(v(satz), { art: 'todo', text, wann }))
  }

  test('„mach das zu den To-dos" ohne Inhalt braucht den Zusammenhang → null', () => {
    assert.equal(v('Mach das zu den To-dos.'), null)
    assert.equal(v('Schreib das auf.'), null)
    assert.equal(v('Setz das auf meine Liste für diese Woche.'), null)
  })

  test('Beiläufiges wird keine Aufgabe (Review 2026-11-03)', () => {
    for (const satz of [
      'Mach es ein bisschen lauter.',
      'Schreib das ein bisschen kürzer.',
      'Okay, ich schreibe das auf.',
      'Trag dich ein.',
      'Setz dich auf die Liste.',
      'Füge ich dann später hinzu.',
      'Erinner mich nicht an das Paket.',
    ]) assert.equal(v(satz), null, satz)
  })

  test('ein unmögliches Datum wird nicht still zu heute', () => {
    assert.equal(v('Am 30. Februar Miete überweisen, schreib das auf.'), null)
  })

  test('ein Datum, das schon vorbei ist, rutscht ins nächste Jahr', () => {
    assert.deepEqual(v('Am 2. Januar Steuer machen, schreib das auf.'), { art: 'todo', text: 'Steuer machen', wann: '2027-01-02' })
  })

  test('der heutige Wochentag heisst heute', () => {
    assert.deepEqual(v('Erinner mich am Dienstag an das Paket.'), { art: 'todo', text: 'Paket', wann: 'heute' })
  })
})

describe('Brain', () => {
  test('im Brain suchen', () => {
    assert.deepEqual(v('Such im Brain nach Operations Research.'), { art: 'brain', suche: 'Operations Research' })
    assert.deepEqual(v('Was steht im Second Brain über Daisy?'), { art: 'brain', suche: 'Daisy' })
    assert.deepEqual(v('Schau mal im Brain nach der Klausur in Statistik.'), { art: 'brain', suche: 'Klausur in Statistik' })
    assert.deepEqual(v('Was weiß mein Brain zu Siemens'), { art: 'brain', suche: 'Siemens' })
    assert.deepEqual(v('Was steht im Brain zum Thema Bachelorarbeit?'), { art: 'brain', suche: 'Bachelorarbeit' })
  })

  test('falsch gehörtes „Brain" (Whisper) zählt auch', () => {
    assert.deepEqual(v('Such im Brein nach Daisy.'), { art: 'brain', suche: 'Daisy' })
  })

  test('ohne Suchbegriff → null', () => {
    assert.equal(v('Such mal im Brain.'), null)
  })
})

describe('Termine aus dem Tag nehmen', () => {
  test('mit Titel', () => {
    assert.deepEqual(v('Den Termin Lerngruppe nehme ich heute nicht wahr.'),
      { art: 'termin', titel: 'Lerngruppe OR', ids: ['lern-1|2026-11-03T16:00:00Z'] })
    assert.deepEqual(v('Bei der Vorlesung Statistik bin ich nicht dabei.'),
      { art: 'termin', titel: 'Vorlesung Statistik', ids: ['vl-9|2026-11-03T08:00:00Z'] })
    assert.deepEqual(v('An der Lerngruppe nehme ich nicht teil.'),
      { art: 'termin', titel: 'Lerngruppe OR', ids: ['lern-1|2026-11-03T16:00:00Z'] })
    assert.deepEqual(v('Sag den Zahnarzt ab.'),
      { art: 'termin', titel: 'Zahnarzt Dr. Müller', ids: ['zahn-2|2026-11-03T13:30:00Z'] })
    assert.deepEqual(v('Statistik lasse ich heute ausfallen.'),
      { art: 'termin', titel: 'Vorlesung Statistik', ids: ['vl-9|2026-11-03T08:00:00Z'] })
  })

  test('kein passender Termin heute → leere Treffer, damit Daily es sagen kann', () => {
    assert.deepEqual(v('Den Termin Yoga nehme ich nicht wahr.'), { art: 'termin', titel: 'Yoga', ids: [] })
  })

  test('ein anderer Tag als heute → null, sonst verschwände der heutige Termin', () => {
    assert.equal(v('Die Lerngruppe morgen fällt aus.'), null)
    assert.equal(v('Die Lerngruppe nehme ich morgen nicht wahr.'), null)
    assert.equal(v('Am Freitag gehe ich nicht zur Lerngruppe, da bin ich nicht dabei.'), null)
  })

  test('„die Termine" ohne Titel braucht den Zusammenhang → null', () => {
    assert.equal(v('Die Termine nehme ich nicht teil.'), null)
    assert.equal(v('Da bin ich nicht dabei.'), null)
  })
})

describe('Antwort auf die Brain-Frage', () => {
  test('ausdrücklich zur Frage', () => {
    assert.deepEqual(v('Zur Frage: Ich lerne lieber morgens.'), { art: 'antwort', text: 'Ich lerne lieber morgens.' })
    assert.deepEqual(v('Meine Antwort auf die Frage ist, dass ich das Tutorium weitermache.'),
      { art: 'antwort', text: 'Dass ich das Tutorium weitermache.' })
  })
  test('„Die Frage ist, …" ist keine Antwort', () => {
    assert.equal(v('Die Frage ist, wie spät es ist.'), null)
  })
  test('auch ohne offene Frage erkannt — Daily sagt dann, dass keine offen ist', () => {
    assert.deepEqual(v('Zur Frage: ja.', { frageOffen: false }), { art: 'antwort', text: 'Ja.' })
  })
})

describe('Schluss und Hermes', () => {
  for (const s of ['Weiter.', 'Mach weiter', 'Nichts, danke.', 'Passt.', 'Stopp.', 'Das wars.', 'Okay, weiter!', 'Weiter bitte.', 'Ja, weiter.', 'Nein, das war alles.']) {
    test(`„${s}" beendet`, () => assert.deepEqual(v(s), { art: 'ende' }))
  }
  test('„Hermes, …" geht an Hermes', () => {
    assert.deepEqual(v('Hermes, was war gestern in meinen Mails?'), { art: 'hermes', text: 'was war gestern in meinen Mails?' })
    assert.deepEqual(v('Frag Hermes, ob die Miete bezahlt ist.'), { art: 'hermes', text: 'ob die Miete bezahlt ist.' })
  })
  test('alles andere: null', () => {
    assert.equal(v('Wie wird das Wetter morgen?'), null)
    assert.equal(v(''), null)
    assert.equal(v('   '), null)
  })
})

describe('pruefe — was von aussen (Gemini) kommt', () => {
  const ctx = { heute: HEUTE, termine: TERMINE }
  test('gültige Befehle kommen durch, Termine nur mit bekannten ids', () => {
    assert.deepEqual(pruefe({ art: 'todo', text: ' Milch kaufen ', wann: 'woche' }, ctx), { art: 'todo', text: 'Milch kaufen', wann: 'woche' })
    assert.deepEqual(pruefe({ art: 'todo', text: 'X', wann: '2026-11-20' }, ctx), { art: 'todo', text: 'X', wann: '2026-11-20' })
    assert.deepEqual(pruefe({ art: 'termin', ids: ['vl-9|2026-11-03T08:00:00Z', 'erfunden'] }, ctx),
      { art: 'termin', titel: 'Vorlesung Statistik', ids: ['vl-9|2026-11-03T08:00:00Z'] })
    assert.deepEqual(pruefe({ art: 'brain', suche: 'Daisy' }, ctx), { art: 'brain', suche: 'Daisy' })
    assert.deepEqual(pruefe({ art: 'ende' }, ctx), { art: 'ende' })
  })
  test('Unsinn wird verworfen', () => {
    assert.equal(pruefe(null, ctx), null)
    assert.equal(pruefe({ art: 'loeschen', id: 'x' }, ctx), null)
    assert.equal(pruefe({ art: 'todo', text: '' }, ctx), null)
    assert.equal(pruefe({ art: 'todo', text: 'x'.repeat(300) }, ctx), null)
    assert.equal(pruefe({ art: 'todo', text: 'X', wann: '2020-01-01' }, ctx), null)
    assert.equal(pruefe({ art: 'todo', text: 'X', wann: 'irgendwann' }, ctx), null)
    assert.equal(pruefe({ art: 'termin', ids: ['erfunden'] }, ctx), null)
  })
})

describe('pruefe: streichen, erledigt, spätere Termine, Rückfrage', () => {
  const aufgaben = [{ id: 'a', text: 'Reise buchen', wo: 'heute' }, { id: 'b', text: 'Miete', wo: 'Woche' }]
  const bald = [
    { id: 'w1', title: 'Reise Wien', datum: '2026-11-07' },
    { id: 'w2', title: 'Rückflug', datum: '2026-11-09' },
  ]
  const k = { heute: '2026-11-04', termine: [], bald, aufgaben }

  test('streichen nur mit bekannten ids, Titel aus der Liste', () => {
    assert.deepEqual(pruefe({ art: 'streichen', ids: ['a', 'b'] }, k), { art: 'streichen', ids: ['a', 'b'], titel: 'Reise buchen und Miete' })
    assert.equal(pruefe({ art: 'streichen', ids: ['a', 'erfunden'] }, k), null)
    assert.equal(pruefe({ art: 'erledigt', ids: [] }, k), null)
  })

  test('ein späterer Termin bekommt sein Datum, eine Reise alle ihre Tage', () => {
    assert.deepEqual(pruefe({ art: 'termin', ids: ['w1'] }, k), { art: 'termin', titel: 'Reise Wien', ids: ['w1'], datum: '2026-11-07', tage: ['2026-11-07'] })
    const reise = pruefe({ art: 'termin', ids: ['w2', 'w1'], text: 'deine Reise nach Wien' }, k)
    assert.equal(reise.titel, 'deine Reise nach Wien')
    assert.deepEqual(reise.tage, ['2026-11-07', '2026-11-09'])
  })

  test('mehr als vier Tage oder eine erfundene id: nicht ausblenden', () => {
    const lang = { ...k, bald: ['05', '06', '07', '08', '09'].map((d, i) => ({ id: `x${i}`, title: 'Kurs', datum: `2026-11-${d}` })) }
    assert.equal(pruefe({ art: 'termin', ids: ['x0', 'x1', 'x2', 'x3', 'x4'] }, lang), null)
    assert.equal(pruefe({ art: 'termin', ids: ['erfunden'] }, k), null)
  })

  test('Bahntitel werden sprechbar', () => {
    const bahn = { ...k, bald: [{ id: 'b1', title: 'Hamburg Hbf ➞ Essen Hbf', datum: '2026-11-06' }, { id: 'b2', title: 'Buchungsbestätigung Deutsche Bahn (Auftrag: 185879313034)', datum: '2026-11-06' }] }
    assert.equal(pruefe({ art: 'termin', ids: ['b1', 'b2'] }, bahn).titel, 'Hamburg Hauptbahnhof nach Essen Hauptbahnhof und Buchungsbestätigung Deutsche Bahn')
  })

  test('Rückfrage braucht Text, „zurück" nichts', () => {
    assert.equal(pruefe({ art: 'rueckfrage', text: '' }, k), null)
    assert.equal(pruefe({ art: 'rueckfrage', text: 'Welche meinst du?' }, k).text, 'Welche meinst du?')
    assert.deepEqual(pruefe({ art: 'zurueck' }, k), { art: 'zurueck' })
  })
})
