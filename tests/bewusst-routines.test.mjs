import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, configure, routineTodos, recordSuggestion, monthlySummary, periodFor, updateGoal } from '../src/lib/bewusst.ts';
import { computeDayScore } from '../src/lib/dayScore.ts';
test('routine projection is idempotent, today only, one canonical completion and no score weight', () => {
 let s = configure(emptyState(), 'day', ['stretch'], '2026-09-20');
 const before = JSON.stringify(s);
 const rows = routineTodos(s, '2026-09-20');
 assert.equal(rows.length, 1); assert.equal(rows[0].done, false);
 assert.deepEqual(routineTodos(s, '2026-09-20'), rows);
 assert.equal(JSON.stringify(s), before);
 s = updateGoal(s, periodFor(s, 'day', '2026-09-20'), 'stretch', {value:1}, '2026-09-20');
 assert.equal(routineTodos(s, '2026-09-20')[0].done, true);
 assert.equal(routineTodos(s, '2026-09-22')[0].done, false);
 assert.notEqual(routineTodos(s, '2026-09-22')[0].id, rows[0].id);
  assert.equal(Object.keys(s.periods).length, 1);
 assert.equal(monthlySummary(s, '2026-09-22').routineDue, 1);
 assert.equal(monthlySummary(s, '2026-10-01').routineDue, 0);
 assert.deepEqual(computeDayScore(rows, 120, 240), computeDayScore([], 120, 240));
});
test('optional suggestions need no plan, concurrent intents rebase, monthly excludes unchosen suggestions', () => {
 let s = recordSuggestion(emptyState(), 'week', 'gym', {delta:1}, '2026-09-20');
 s = recordSuggestion(s, 'week', 'gym', {delta:1}, '2026-09-20');
 assert.equal(periodFor(s, 'week', '2026-09-20').goals[0].value, 2);
 const sum = monthlySummary(s, '2026-09-20');
 assert.equal(sum.suggestions, 1); assert.equal(sum.routineDue, 0);
 assert.equal(sum.suggestionUnits, 2);
});

test('30 Minuten Lesen ist als tägliche Routine wählbar (Paul, 2026-11-03)', () => {
  const s = configure(emptyState(), 'day', ['read'], '2026-11-03');
  const g = periodFor(s, 'day', '2026-11-03').goals;
  assert.deepEqual(g.map(x => [x.id, x.title, x.target]), [['read', 'Lies 30 Minuten.', 1]]);
});
