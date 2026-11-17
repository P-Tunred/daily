import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, dayInZone, bounds, emptyState, configure, periodFor, updateGoal, closePeriod, history, dailyQuote, isBewusstState } from '../src/lib/bewusst.ts';

test('Berlin dates, Monday weeks, leap month and year boundaries', () => {
  assert.equal(dayInZone(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.deepEqual(bounds('week', '2027-01-01'), { start: '2026-12-28', end: '2027-01-03' });
  assert.deepEqual(bounds('month', '2028-02-16'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(dayInZone(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
});

test('activation snapshots, next-period changes and preserved history', () => {
  const initial = configure(emptyState(), 'week', ['gym'], '2026-09-20');
  const p = periodFor(initial, 'week', '2026-09-20');
  assert.equal(p.partial, true);
  assert.equal(p.goals.length, 1);
  assert.equal(p.goals[0].value, 0);
  let state = updateGoal(initial, p, 'gym', { value: 1 }, '2026-09-20');
  state = configure(state, 'week', ['run'], '2026-09-20');
  assert.equal(periodFor(state, 'week', '2026-09-20').goals[0].id, 'gym');
  assert.equal(periodFor(state, 'week', '2026-09-21').goals[0].id, 'run');
  assert.equal(history(state, '2026-09-21').find(x => x.id === p.id).goals[0].value, 1);
  assert.equal(periodFor(state, 'week', '2026-09-13').goals.length, 0);
  assert.equal(isBewusstState(state), true);
  assert.equal(isBewusstState({ version: 1, plans: [], periods: { a: { goals: null } } }), false);
});

test('close is frozen; reopen explicit; notes, undo and pause survive JSON', () => {
  let s = configure(emptyState(), 'month', ['domain', 'book'], '2026-09-20');
  let p = periodFor(s, 'month', '2026-09-20');
  s = updateGoal(s, p, 'domain', { value: 120, note: 'Geschichte' }, '2026-09-20');
  p = periodFor(s, 'month', '2026-09-20');
  s = updateGoal(s, p, 'book', { paused: 'Krankheit' }, '2026-09-20');
  p = periodFor(s, 'month', '2026-09-20');
  assert.equal(score(p.goals), 50);
  s = closePeriod(s, p, '2026-09-30');
  p = periodFor(s, 'month', '2026-09-30');
  assert.throws(() => updateGoal(s, p, 'domain', { value: 240 }, '2026-09-30'));
  s = closePeriod(s, p, '2026-09-30', true);
  p = periodFor(s, 'month', '2026-09-30');
  s = updateGoal(s, p, 'domain', { value: 0 }, '2026-09-30');
  s = JSON.parse(JSON.stringify(s));
  assert.equal(periodFor(s, 'month', '2026-09-30').goals[0].note, 'Geschichte');
  assert.equal(periodFor(s, 'month', '2026-10-01').goals[0].value, 0);
  assert.equal(periodFor(s, 'month', '2026-10-01').goals[1].paused, '');
  assert.ok(s.periods[p.id].audit.length >= 4);
});

test('daily quote counts due opportunities, not pre-activation or future', () => {
  let s = configure(emptyState(), 'day', ['stretch', 'rest'], '2026-09-20');
  s = updateGoal(s, periodFor(s, 'day', '2026-09-20'), 'stretch', { value: 1 }, '2026-09-20');
  assert.deepEqual(dailyQuote(s, '2026-09-21'), { confirmed: 1, due: 4, percent: 25 });
  assert.equal(history(s, '2026-09-21').filter(p => p.cadence === 'day').length, 2);
});

test('strict dates and current daily periods cannot be finalized', () => {
  assert.equal(isBewusstState({ version: 1, plans: [{ cadence: 'day', effective: '2026-02-31', revision: 'r1', goals: [] }], periods: {} }), false);
  const s = configure(emptyState(), 'day', ['stretch'], '2026-09-20');
  const p = periodFor(s, 'day', '2026-09-20');
  assert.throws(() => closePeriod(s, p, '2026-09-20'));
  assert.equal(closePeriod(s, p, '2026-09-21').periods[p.id].closed, '2026-09-21');
});

test('counter intent is a delta rebased on the latest persisted period', () => {
  let s = configure(emptyState(), 'week', ['gym'], '2026-09-20');
  const stale = periodFor(s, 'week', '2026-09-20');
  s = updateGoal(s, stale, 'gym', { delta: 1 }, '2026-09-20');
  s = updateGoal(s, stale, 'gym', { delta: 1 }, '2026-09-20');
  assert.equal(periodFor(s, 'week', '2026-09-20').goals[0].value, 2);
  s = updateGoal(s, stale, 'gym', { delta: -9 }, '2026-09-20');
  assert.equal(periodFor(s, 'week', '2026-09-20').goals[0].value, 0);
});

test('equal weight, partial progress, cap, exclusions and no plan', () => {
  const goal = (value, target, paused = '') => ({ value, target, paused });
  assert.equal(score([]), null);
  assert.equal(score([goal(1, 3), goal(1, 1)]), 67);
  assert.equal(score([goal(999, 240)]), 100);
  assert.equal(score([goal(0, 1, 'Krankheit')]), null);
  assert.equal(score([goal(0, 1, 'Pause'), goal(120, 240)]), 50);
});
