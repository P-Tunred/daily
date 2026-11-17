import { validState } from '../../electron/bewusstSchema.mjs';

/** Bewusst leben is deliberately independent of dayScore and scoreHistory.
 * Plans are dated immutable revisions. Periods snapshot their actual goals,
 * not references to a mutable catalogue. Merely opening Daily never records
 * progress; missing days are derived as unconfirmed opportunities, not failures.
 */
export type Cadence = 'day' | 'week' | 'month';
export type Goal = { id: string; title: string; topic: string; target: number; unit: string; hint?: string };
export type Entry = Goal & { value: number; note: string; paused: string };
export type Period = { id: string; cadence: Cadence; start: string; end: string; activated: string; partial: boolean; formula: 1; revision: string; goals: Entry[]; closed: string | null; audit: string[] };
type Plan = { cadence: Cadence; effective: string; revision: string; goals: Goal[] };
export type BewusstState = { version: 1; plans: Plan[]; periods: Record<string, Period> };
export const TOPICS = ['Es juckt keinen', '„Ich hab zu wenig Zeit“', 'Meinen Körper respektieren', 'Offen für neues', 'Konzepte verstehen, nicht einfach akzeptieren', 'Bessere Kommunikation Skills', 'Projekte haben die man zeigen kann', 'Mehr ausprobieren vom Style her'];
const goal = (id: string, title: string, topic: number, target = 1, unit = 'Mal', hint?: string): Goal => ({ id, title, topic: TOPICS[topic], target, unit, ...(hint ? { hint } : {}) });
export const CATALOG: Record<Cadence, Goal[]> = {
  day: [
    goal('stretch', 'Dehne dich fünf Minuten.', 2),
    goal('rest', 'Nimm dir Zeit für NSDR oder Meditation.', 1),
    goal('food', 'Iss protein- und ballaststoffreich.', 2, 1, 'Mal', 'Kreatin nur nach deinem bisherigen Plan; keine neue Einnahmeempfehlung.'),
    goal('compliment', 'Mach jemandem ein ehrliches Kompliment.', 5),
    goal('journal', 'Schreib abends ins Heft.', 0, 1, 'Mal', 'Was hat dir unnötig Sorgen gemacht? Was hat dich selbstsicher gemacht? Was war unnötig? Ein gemeinsamer Haken.'),
    goal('style', 'Sammle abends eine Inspiration für deinen Stil.', 7),
    goal('read', 'Lies 30 Minuten.', 3, 1, 'Mal', 'Ein Buch oder ein langer Text, kein Scrollen. Ein Haken für die halbe Stunde.'),
  ],
  week: [
    goal('gym', 'Geh ins Gym.', 2, 3, 'Besuche'),
    goal('run', 'Mach einen längeren Lauf.', 2, 1, 'Mal', 'Nur bei körperlicher und saisonaler Eignung; sonst bewusst pausieren.'),
    goal('meal', 'Bereite Essen vor: Meal Prep.', 2),
    goal('conversation', 'Fang ein Gespräch an.', 0),
    goal('automation', 'Halte eine Automatisierungsidee fest.', 4),
    goal('time', 'Schau dir deine Top-5-Zeitfresser an.', 1, 1, 'Mal', 'Sonntag, 15 Minuten.'),
  ],
  month: [
    goal('sport', 'Probiere eine neue Sportart aus.', 2),
    goal('book', 'Lies ein Buch außerhalb Uni und Produktivität.', 3),
    goal('art', 'Male oder skizziere.', 3),
    goal('domain', 'Vertiefe dich in ein Fachgebiet.', 3, 240, 'Minuten'),
    goal('culture', 'Geh zu einem Konzert, einer Lesung oder Kultur.', 3),
    goal('museum', 'Entdecke ein Museum oder Kunst.', 3),
    goal('ai', 'Erkläre jemandem KI.', 4),
    goal('vintage', 'Stöbere nach Vintage.', 7, 1, 'Mal', 'Kaufen ist keine Voraussetzung.'),
    goal('outfit', 'Trag etwas, das dir sonst zu auffällig wäre.', 7),
  ],
};
export const emptyState = (): BewusstState => ({ version: 1, plans: [], periods: {} });

/** Date-keyed Todo projections, never a second persisted completion copy. */
export function routineTodos(state: BewusstState, today: string) {
  const period = periodFor(state, 'day', today);
  return period.goals.filter(g => !g.paused).map(g => ({
    id: `routine:${today}:${g.id}`, text: g.title, done: g.value >= g.target,
    origin: 'bewusst' as const, routineId: g.id, date: today, scope: 'day' as const,
  }));
}

/** A suggestion enters the journal only on an explicit user action.
 *  `day` = der Tag, an dem es passiert ist. Standard heute; der Nachtrag für
 *  gestern übergibt gestern — am Montag landet „gestern im Gym" so in der
 *  Vorwoche, nicht in der laufenden. Das Audit trägt weiter `today`, also das
 *  Datum, an dem eingetragen wurde. */
export function recordSuggestion(state: BewusstState, cadence: 'week' | 'month', id: string, patch: GoalPatch, today: string, day = today): BewusstState {
  const period = periodFor(state, cadence, day);
  if (!period.goals.some(g => g.id === id)) {
    const goal = CATALOG[cadence].find(g => g.id === id);
    if (!goal) throw new Error('Unbekannter Vorschlag.');
    period.goals.push({ ...goal, value: 0, note: '', paused: '' });
  }
  return updateGoal({ ...state, periods: { ...state.periods, [period.id]: period } }, period, id, patch, today, day);
}

export function monthlySummary(state: BewusstState, today: string) {
  // Only real recorded days, not silently backfilled absences. Week entries
  // belong to their week-start month; make that explicit in the interface.
  const periods = Object.values(state.periods).filter(p => p.start.slice(0, 7) === today.slice(0, 7));
  const routines = periods.filter(p => p.cadence === 'day').flatMap(p => p.goals).filter(g => !g.paused);
  const suggestions = periods.filter(p => p.cadence !== 'day').flatMap(p => p.goals).filter(g => !g.paused && g.value > 0);
  return { routineDone: routines.filter(g => g.value >= g.target).length, routineDue: routines.length,
    suggestions: suggestions.length, suggestionUnits: suggestions.filter(g => g.unit !== 'Minuten').reduce((n, g) => n + g.value, 0),
    minutes: suggestions.filter(g => g.unit === 'Minuten').reduce((n, g) => n + g.value, 0) };
}
export const dayInZone = (date = new Date()): string => date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
export function shiftDay(day: string, delta: number): string {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function bounds(cadence: Cadence, day: string): { start: string; end: string } {
  if (cadence === 'day') return { start: day, end: day };
  if (cadence === 'week') {
    const offset = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const start = shiftDay(day, -offset);
    return { start, end: shiftDay(start, 6) };
  }
  const start = day.slice(0, 7) + '-01';
  const date = new Date(start + 'T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + 1);
  return { start, end: shiftDay(date.toISOString().slice(0, 10), -1) };
}
export function configure(state: BewusstState, cadence: Cadence, ids: string[], today: string): BewusstState {
  const effective = state.plans.some(p => p.cadence === cadence)
    ? shiftDay(bounds(cadence, today).end, 1) : today;
  // Retain superseded revisions for an honest change log. Last matching wins.
  const goals = ids.map(id => CATALOG[cadence].find(g => g.id === id)).filter((g): g is Goal => !!g);
  const plan: Plan = { cadence, effective, revision: `r${state.plans.length + 1}`, goals: structuredClone(goals) };
  return { ...state, plans: [...state.plans, plan] };
}
export function periodFor(state: BewusstState, cadence: Cadence, day: string): Period {
  const { start, end } = bounds(cadence, day);
  const id = `${cadence}:${start}`;
  if (state.periods[id]) return structuredClone(state.periods[id]);
  const plan = state.plans.filter(p => p.cadence === cadence && p.effective <= day).at(-1);
  return { id, cadence, start, end, activated: plan ? (plan.effective > start ? plan.effective : start) : day,
    partial: !!plan && plan.effective > start, formula: 1, revision: plan?.revision ?? '–',
    goals: (plan?.goals ?? []).map(g => ({ ...g, value: 0, paused: '', note: '' })), closed: null, audit: [] };
}
export type GoalPatch = Partial<Pick<Entry, 'value' | 'note' | 'paused'>> & { delta?: number };
/** `day` = der Tag, für den die Änderung gilt (Standard: heute). Weicht er ab
 *  — der Nachtrag für gestern —, steht er im Audit als „(für JJJJ-MM-TT)".
 *  Nur daran lässt sich später ablesen, an welchem TAG etwas passiert ist:
 *  Wochenziele wie Gym speichern sonst nur eine Summe pro Woche, und das
 *  Audit-Datum ist das der Eingabe (siehe aenderungAm). */
export function updateGoal(state: BewusstState, period: Period, id: string, patch: GoalPatch, today: string, day = today): BewusstState {
  const current = state.periods[period.id] ?? period;
  if (current.closed) throw new Error('Der Abschluss ist eingefroren. Öffne ihn zuerst zur Korrektur.');
  if (current.start > today) throw new Error('Zukünftige Zeiträume sind noch nicht fällig.');
  const goals = current.goals.map(g => {
    if (g.id !== id) return g;
    const { delta, ...fields } = patch;
    const value = delta !== undefined ? Math.max(0, g.value + delta) : patch.value === undefined ? g.value : patch.value;
    if (!Number.isFinite(value) || value < 0) throw new Error('Bitte eine gültige, positive Menge eintragen.');
    return { ...g, ...fields, value: Math.min(value, g.target) };
  });
  const fuer = day !== today ? ` (für ${day})` : '';
  const changed = { ...current, goals, audit: [...current.audit, `${today}: ${id} — ${JSON.stringify(patch)}${fuer}`] };
  return { ...state, periods: { ...state.periods, [period.id]: changed } };
}
export function closePeriod(state: BewusstState, period: Period, today: string, reopen = false): BewusstState {
  const current = state.periods[period.id] ?? period;
  if (!reopen && (today < current.end || (current.cadence === 'day' && today === current.end))) throw new Error('Der Abschluss ist erst am Ende des Zeitraums möglich.');
  const changed = { ...current, closed: reopen ? null : today, audit: [...current.audit, `${today}: ${reopen ? 'Zur Korrektur wieder geöffnet' : 'Abgeschlossen'}`] };
  return { ...state, periods: { ...state.periods, [period.id]: changed } };
}
export function history(state: BewusstState, today: string): Period[] {
  const periods: Period[] = [];
  for (const cadence of ['day', 'week', 'month'] as const) {
    const first = state.plans.find(p => p.cadence === cadence);
    if (!first) continue;
    for (let day = first.effective; day <= today; day = shiftDay(bounds(cadence, day).end, 1)) {
      // Query at the last elapsed day to include mid-period initial activation.
      periods.push(periodFor(state, cadence, bounds(cadence, day).end < today ? bounds(cadence, day).end : today));
    }
  }
  return periods.sort((a, b) => b.start.localeCompare(a.start) || a.cadence.localeCompare(b.cadence));
}
export function dailyQuote(state: BewusstState, today: string): { confirmed: number; due: number; percent: number | null } {
  const entries = history(state, today).filter(p => p.cadence === 'day').flatMap(p => p.goals).filter(g => !g.paused);
  const confirmed = entries.filter(g => g.value >= g.target).length;
  return { confirmed, due: entries.length, percent: entries.length ? Math.round(100 * confirmed / entries.length) : null };
}

// Fail closed in the UI instead of silently replacing damaged history.
export function isBewusstState(value: unknown): value is BewusstState {
  return validState(value);
}

export function score(goals: { value: number; target: number; paused: string }[]): number | null {
  const active = goals.filter((g) => !g.paused);
  return active.length ? Math.round(100 * active.reduce((sum, g) => sum + Math.min(Math.max(g.value / g.target, 0), 1), 0) / active.length) : null;
}

// ── Haken pro Tag — für den Tagesscore (Bonus, siehe dayScore.ts) ────────────

const AUDIT_RE = /^(\d{4}-\d{2}-\d{2}): (\S+) — (\{.*\})(?: \(für (\d{4}-\d{2}-\d{2})\))?$/;

/** Um wie viel sich der Wert eines Ziels AN einem Tag verändert hat.
 *
 *  WARUM AUS DEM AUDIT
 *  Wochen- und Monatsziele speichern nur eine Summe pro Zeitraum („Gym 2/3").
 *  An welchem Tag trainiert wurde, steht nur im Audit — Zeile für Zeile, mit
 *  dem Datum der Eingabe und, beim Nachtrag, „(für Tag)". Das Audit wird hier
 *  nachgespielt, mit genau den Regeln von updateGoal (Delta, gesetzter Wert,
 *  Deckel bei `target`), damit die Tagesbeiträge zur Summe passen.
 *
 *  Grenze: Einträge von vor dem 2026-10-22 kennen kein „(für …)". Ein damals
 *  für gestern nachgetragenes Gym zählt deshalb am Tag der Eingabe. */
export function aenderungAm(period: Period | undefined, goalId: string, day: string): number {
  if (!period) return 0;
  const goal = period.goals.find(g => g.id === goalId);
  if (!goal) return 0;
  let value = 0;
  let amTag = 0;
  for (const line of period.audit) {
    const m = AUDIT_RE.exec(line);
    if (!m || m[2] !== goalId) continue;
    let patch: GoalPatch;
    try { patch = JSON.parse(m[3]) as GoalPatch; } catch { continue; }
    const next = patch.delta !== undefined ? Math.max(0, value + patch.delta)
      : patch.value === undefined ? value : patch.value;
    const capped = Math.min(Math.max(0, Number.isFinite(next) ? next : value), goal.target);
    if ((m[4] ?? m[1]) === day) amTag += capped - value;
    value = capped;
  }
  return amTag;
}

/** Wie viele Haken ein Tag für den Score bringt: erledigte, nicht pausierte
 *  Tagesroutinen — plus eins, wenn an dem Tag Gym war (Pauls Entscheidung
 *  vom 2026-10-22: „Gym zählt wie eine Routine"). Mehrere Gym-Einträge an
 *  einem Tag zählen einmal. Nur gelesen; ein nie besuchter Tag bringt 0. */
export function routineHakenAm(state: BewusstState, day: string): number {
  const tag = state.periods[`day:${day}`];
  const routinen = tag ? tag.goals.filter(g => !g.paused && g.value >= g.target).length : 0;
  const woche = state.periods[`week:${bounds('week', day).start}`];
  return routinen + (aenderungAm(woche, 'gym', day) > 0 ? 1 : 0);
}
