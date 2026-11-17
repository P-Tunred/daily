// Die kritische Stelle des Kalender-Postausgangs: ein von Daily angelegter
// Termin kommt ueber den Export ZURUECK und darf dann nicht doppelt dastehen.
//
// WARUM ALS EIGENER TEST UND NICHT IM RAUCHTEST
// Der Rauchtest braucht einen laufenden Server. Diese Regel ist aber reine
// Rechnung in horizon.ts — sie laesst sich ohne Server pruefen, und je
// billiger eine Pruefung ist, desto oefter laeuft sie.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { baueHorizont } from '../src/lib/horizon.ts'

const HEUTE = '2026-08-20'

/** Ein exportierter Kalendertermin, wie calendarSource ihn normalisiert. */
function kalenderTermin({ uid, titel, start }) {
  return { id: `${uid}|${start}`, uid, title: titel, start, end: start, allDay: false, calendar: 'Daily' }
}

describe('Horizont — Entdopplung ueber calUid', () => {
  test('von Daily angelegter Termin steht nach dem Export genau EINMAL', () => {
    const uid = 'ABC-123-DAILY'
    const items = baueHorizont(
      [kalenderTermin({ uid, titel: 'Zahnarzt', start: '2026-08-21T09:00:00.000Z' })],
      [{ id: 'lokal-1', kind: 'note', title: 'Zahnarzt', date: '2026-08-21', calUid: uid, syncState: 'im-kalender' }],
      { heute: HEUTE },
    )
    const zahn = items.filter((i) => i.title === 'Zahnarzt')
    assert.equal(zahn.length, 1, 'der Termin steht doppelt im Horizont')
    // Der EXPORTIERTE gewinnt: er traegt die Wahrheit aus dem Kalender.
    assert.equal(zahn[0].time, '11:00', 'die Uhrzeit kommt nicht aus dem Kalender')
  })

  test('ohne passenden Export bleibt der lokale Eintrag sichtbar', () => {
    const items = baueHorizont(
      [],
      [{ id: 'lokal-2', kind: 'note', title: 'Noch nicht drin', date: '2026-08-22', syncState: 'offen' }],
      { heute: HEUTE },
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].syncState, 'offen', 'der Zustand erreicht die Karte nicht')
  })

  test('fremde UID legt NICHTS zusammen', () => {
    const items = baueHorizont(
      [kalenderTermin({ uid: 'FREMD-999', titel: 'Etwas anderes', start: '2026-08-23T09:00:00.000Z' })],
      [{ id: 'lokal-3', kind: 'note', title: 'Mein Eintrag', date: '2026-08-24', calUid: 'MEIN-111' }],
      { heute: HEUTE },
    )
    assert.equal(items.length, 2, 'zwei verschiedene Termine wurden zusammengeworfen')
  })

  test('ein Export OHNE uid wirft nichts zusammen', () => {
    // Faellt die uid weg (aeltere Exporte), darf nicht ploetzlich alles
    // zusammenfallen — der Rueckfall auf den Titel greift nur bei exakt
    // gleichem Titel am gleichen Tag, nicht ueber eine leere UID.
    const items = baueHorizont(
      [{ id: 'x|2026-08-25', title: 'Ohne UID', start: '2026-08-25T09:00:00.000Z', end: '2026-08-25T10:00:00.000Z', allDay: false }],
      [{ id: 'lokal-4', kind: 'note', title: 'Ganz anderer Titel', date: '2026-08-25', calUid: '' }],
      { heute: HEUTE },
    )
    assert.equal(items.length, 2)
  })
})
