// „Zeit für dich" — Verlauf, Anpassungshinweise, Vorschlag für einen freien Block.
// Das Versprechen aus bewusst.ts gilt hier mit: ein unbesuchter Tag ist
// „unbekannt", nie „nicht gemacht".

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { configure, emptyState, periodFor, updateGoal, shiftDay } from '../src/lib/bewusst.ts'
import { verlauf, hinweise, vorschlag } from '../src/lib/zeitFuerDich.ts'

const HEUTE = '2026-10-30'
const START = '2026-10-01'

/** Routinen ab START, und an den genannten Tagen einen Eintrag (true = erledigt). */
function buch(tage) {
  let s = configure(emptyState(), 'day', ['stretch', 'journal'], START)
  for (const [tag, erledigt] of Object.entries(tage)) {
    const p = periodFor(s, 'day', tag)
    s = { ...s, periods: { ...s.periods, [p.id]: p } }
    if (erledigt) s = updateGoal(s, s.periods[p.id], 'stretch', { value: 1 }, tag)
  }
  return s
}

describe('Verlauf', () => {
  test('unbesuchte Tage sind unbekannt, nicht verpasst', () => {
    const s = buch({ [shiftDay(HEUTE, -1)]: true, [shiftDay(HEUTE, -3)]: false })
    const v = verlauf(s, HEUTE).find(x => x.id === 'stretch')
    assert.deepEqual(v.punkte.map(p => p.stand), ['unbekannt', 'unbekannt', 'unbekannt', 'nein', 'unbekannt', 'ja', 'offen'])
    assert.equal(v.erledigt, 1)
    assert.equal(v.erfasst, 2)
  })
})

describe('Anpassungshinweise', () => {
  const selten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [shiftDay(HEUTE, -(i + 1)), i === 0]))

  test('eine Routine, die fast nie klappt, bekommt einen Hinweis', () => {
    const h = hinweise(buch(selten), HEUTE)
    assert.ok(h.some(x => x.id === 'stretch' && x.erledigt === 1 && x.erfasst === 10))
  })
  test('zu wenige erfasste Tage → kein Urteil', () => {
    assert.deepEqual(hinweise(buch({ [shiftDay(HEUTE, -1)]: false, [shiftDay(HEUTE, -2)]: false }), HEUTE), [])
  })
  test('„Behalten" ruht zwei Wochen', () => {
    assert.equal(hinweise(buch(selten), HEUTE, { stretch: shiftDay(HEUTE, -3) }).some(x => x.id === 'stretch'), false)
    assert.equal(hinweise(buch(selten), HEUTE, { stretch: shiftDay(HEUTE, -20) }).some(x => x.id === 'stretch'), true)
  })
})

describe('Vorschlag', () => {
  test('freier Block heute + Wochenidee mit Rückstand', () => {
    const v = vorschlag(buch({}), HEUTE, [{ tag: HEUTE, von: '16:00', bis: '18:00', minuten: 120 }])
    assert.equal(v.block.von, '16:00')
    assert.match(v.idee, /0\/\d diese Woche/)
    assert.equal(v.offeneRoutinen, 2)
  })
  test('kein freier Block heute → kein Vorschlag', () => {
    assert.equal(vorschlag(buch({}), HEUTE, [{ tag: '2026-10-31', von: '10:00', bis: '12:00', minuten: 120 }]), null)
  })
})

describe('Diese Woche für dich', () => {
  test('alle sechs Wochenideen, mit Stand und Punkten der letzten Wochen', async () => {
    const { recordSuggestion } = await import('../src/lib/bewusst.ts')
    const { wochenSachen, restTage } = await import('../src/lib/zeitFuerDich.ts')
    let s = configure(emptyState(), 'day', ['stretch'], START)
    // vorletzte Woche: Gym 3/3; letzte Woche: Gym 1/3; diese Woche: Gym 2/3, Meal Prep erledigt
    s = recordSuggestion(s, 'week', 'gym', { value: 3 }, '2026-10-16')
    s = recordSuggestion(s, 'week', 'gym', { value: 1 }, '2026-10-23')
    s = recordSuggestion(s, 'week', 'gym', { delta: 2 }, HEUTE)
    s = recordSuggestion(s, 'week', 'meal', { value: 1 }, HEUTE)
    const w = wochenSachen(s, HEUTE, 4)
    assert.equal(w.length, 6)
    const gym = w.find(x => x.id === 'gym')
    assert.equal(gym.wert, 2)
    assert.deepEqual(gym.punkte.map(p => p.stand), ['unbekannt', 'ja', 'teil', 'teil'])
    assert.equal(w.find(x => x.id === 'meal').punkte.at(-1).stand, 'ja')
    assert.equal(w.find(x => x.id === 'run').punkte.at(-1).stand, 'offen')
    assert.equal(w.find(x => x.id === 'run').punkte[2].stand, 'nein')
    assert.equal(restTage('2026-10-26'), 7) // Montag
    assert.equal(restTage(HEUTE), 3)        // Freitag
    assert.equal(restTage('2026-11-01'), 1) // Sonntag
  })
})
