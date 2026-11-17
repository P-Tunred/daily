// One schema for HTTP writes and browser hydration. A malformed history must
// never be committed only to strand the client behind its fail-closed reader.
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string';
const number = v => typeof v === 'number' && Number.isFinite(v);
const date = v => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
const cadence = v => ['day', 'week', 'month'].includes(v);
const goal = g => object(g) && text(g.id) && !!g.id && text(g.title) && text(g.topic) && text(g.unit) && number(g.target) && g.target > 0 && (g.hint === undefined || text(g.hint));
const goals = list => Array.isArray(list) && list.every(goal) && new Set(list.map(g => g.id)).size === list.length;
function boundsValid(p) {
  if (p.cadence === 'day') return p.start === p.end;
  const start = new Date(p.start + 'T12:00:00Z');
  if (p.cadence === 'week') {
    if (start.getUTCDay() !== 1) return false;
    start.setUTCDate(start.getUTCDate() + 6);
  } else {
    if (start.getUTCDate() !== 1) return false;
    start.setUTCMonth(start.getUTCMonth() + 1);
    start.setUTCDate(start.getUTCDate() - 1);
  }
  return start.toISOString().slice(0, 10) === p.end;
}
export function validState(v) {
  if (!object(v) || v.version !== 1 || !Array.isArray(v.plans) || !object(v.periods)) return false;
  if (!v.plans.every(p => object(p) && cadence(p.cadence) && date(p.effective) && text(p.revision) && goals(p.goals))) return false;
  return Object.entries(v.periods).every(([id, p]) => object(p)
    && p.id === id && cadence(p.cadence) && date(p.start) && date(p.end) && date(p.activated)
    && id === `${p.cadence}:${p.start}` && p.start <= p.activated && p.activated <= p.end && boundsValid(p)
    && p.formula === 1 && typeof p.partial === 'boolean' && text(p.revision)
    && (p.closed === null || (date(p.closed) && p.closed >= p.end))
    && Array.isArray(p.audit) && p.audit.every(text)
    && goals(p.goals) && p.goals.every(g => number(g.value) && g.value >= 0 && g.value <= g.target && text(g.note) && g.note.length <= 500 && text(g.paused)));
}
