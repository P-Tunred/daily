// Goal history — so a finished day keeps the target it was actually measured
// against.
//
// The tracker used to resolve EVERY day (past, present, future) against the
// goals currently stored in settings. Raising the weekly goal therefore
// re-judged the whole past: days that had cleared their target retroactively
// fell short, and the streak collapsed. That made "set a new weekly goal" an
// expensive move, which is the opposite of what it should be.
//
// Now goal changes are recorded as epochs. An epoch takes effect on the day it
// was made and runs until the next one — so today and everything ahead follow
// the new goal, while every day that is already over keeps its own.

export type GoalEpoch = {
  /** ISO date (YYYY-MM-DD) from which these goals apply, inclusive. */
  from: string;
  /** Minutes per weekday, indexed by `Date.getDay()` — 0 = Sunday. */
  goalsByWeekday: number[];
  /** Weekly total in hours (heatmap reference), snapshotted alongside. */
  weeklyGoalHours: number;
};

const KEY = "morning.tracker.goalEpochs";

/** Sorts before any real date — used for the seed epoch that covers the past
 *  we have no record of. */
export const EPOCH_START = "0000-01-01";

const isValid = (e: unknown): e is GoalEpoch =>
  !!e && typeof e === "object"
  && typeof (e as GoalEpoch).from === "string"
  && Array.isArray((e as GoalEpoch).goalsByWeekday)
  && (e as GoalEpoch).goalsByWeekday.length === 7;

export function loadGoalEpochs(): GoalEpoch[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isValid)
      .map((e) => ({ ...e, weeklyGoalHours: Number(e.weeklyGoalHours) || 0 }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  } catch {
    return [];
  }
}

export function saveGoalEpochs(epochs: GoalEpoch[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(epochs));
  } catch {
    /* quota — goals still work, only the history stops growing */
  }
}

const sameGoals = (a: GoalEpoch, b: Omit<GoalEpoch, "from">) =>
  a.weeklyGoalHours === b.weeklyGoalHours
  && a.goalsByWeekday.every((v, i) => v === b.goalsByWeekday[i]);

/**
 * Records a goal change effective `from`. Pure — returns a new array.
 * Same-day edits replace each other (dragging a slider must not litter the
 * history), and a change that lands on the same numbers is a no-op.
 */
export function upsertEpoch(
  epochs: GoalEpoch[],
  from: string,
  goals: Omit<GoalEpoch, "from">,
): GoalEpoch[] {
  const past = epochs.filter((e) => e.from < from);
  const latest = past[past.length - 1];
  if (latest && sameGoals(latest, goals)) {
    // Nothing new to say — but any epoch already recorded for today is now
    // redundant and would otherwise shadow the identical earlier one.
    return past.length === epochs.length ? epochs : past;
  }
  return [...past, { from, ...goals }];
}

/** The epoch in force on `iso`. Falls back to the earliest one for dates that
 *  predate the history (better than pretending there was no goal at all). */
export function epochAt(epochs: GoalEpoch[], iso: string): GoalEpoch | null {
  if (epochs.length === 0) return null;
  let found: GoalEpoch | null = null;
  for (const e of epochs) {
    if (e.from <= iso) found = e;
    else break;
  }
  return found ?? epochs[0];
}

/** Weekday goals in force on `iso`, or null when there is no history yet. */
export function goalsAt(epochs: GoalEpoch[], iso: string): number[] | null {
  return epochAt(epochs, iso)?.goalsByWeekday ?? null;
}
