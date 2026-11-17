import { useEffect, useState } from "react";
import { uidPrefix } from "./hiddenEvents";

// ── Calendar → Stundenplan decisions (with learning) ────────────────────────────
// For each calendar *series* (the iCal uid, shared by every occurrence) Paul
// decides once: "hingehen" → the event is materialized as a block in his
// Lernstundenplan, "überspringen" → it isn't. The decision is remembered and
// auto-applied to all future occurrences of that series — so a new occurrence of
// a known series needs no asking. Only genuinely new series are asked about:
// once a week (review) and directly when one first shows up during the week.
//
// `processed` tracks which individual occurrences have already been acted on
// (block created OR explicitly skipped), so we never double-materialize and can
// tell "new" occurrences apart.

export type Decision = "attend" | "skip";

const DECISIONS_KEY = "morning.calendar.seriesDecisions"; // { [uid]: Decision }
const PROCESSED_KEY = "morning.calendar.processedOccurrences"; // occurrence id[]
const REVIEW_KEY = "morning.calendar.lastWeeklyReview"; // ISO-week key "2026-W27"
const CHANGE_EVENT = "morning:calendar-decisions-change";

/** The series key for an event id — the iCal uid (everything before "|"). */
export const seriesUid = uidPrefix;

// ── ISO-week key (Mon-based) ────────────────────────────────────────────────────
export function isoWeekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── load / persist ──────────────────────────────────────────────────────────────
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function loadDecisions(): Record<string, Decision> {
  return loadJSON<Record<string, Decision>>(DECISIONS_KEY, {});
}
export function loadProcessed(): Set<string> {
  return new Set(loadJSON<string[]>(PROCESSED_KEY, []));
}
export function loadLastReview(): string {
  return loadJSON<string>(REVIEW_KEY, "");
}

/** Set (or change) the learned decision for a whole series. */
export function setSeriesDecision(uid: string, decision: Decision) {
  const all = loadDecisions();
  all[uid] = decision;
  persist(DECISIONS_KEY, all);
}
/** Forget a series decision (back to "undecided" → will be asked again). */
export function clearSeriesDecision(uid: string) {
  const all = loadDecisions();
  delete all[uid];
  persist(DECISIONS_KEY, all);
}

/** Mark occurrence ids as acted-on (block created or skipped). */
export function markProcessed(ids: string[]) {
  if (!ids.length) return;
  const set = loadProcessed();
  let changed = false;
  for (const id of ids) if (!set.has(id)) { set.add(id); changed = true; }
  if (changed) persist(PROCESSED_KEY, [...set]);
}
/** Drop occurrences from the processed set (e.g. when a decision is reversed so
 *  they can be re-materialized under the new decision). */
export function unmarkProcessed(ids: string[]) {
  if (!ids.length) return;
  const set = loadProcessed();
  let changed = false;
  for (const id of ids) if (set.delete(id)) changed = true;
  if (changed) persist(PROCESSED_KEY, [...set]);
}

export function markWeeklyReviewed(weekKey: string = isoWeekKey()) {
  persist(REVIEW_KEY, weekKey);
}
export function needsWeeklyReview(weekKey: string = isoWeekKey()): boolean {
  return loadLastReview() !== weekKey;
}

// ── React hook — live decision state ────────────────────────────────────────────
export type DecisionState = {
  decisions: Record<string, Decision>;
  processed: Set<string>;
  lastReview: string;
};

export function useCalendarDecisions(): DecisionState {
  const [state, setState] = useState<DecisionState>(() => ({
    decisions: loadDecisions(),
    processed: loadProcessed(),
    lastReview: loadLastReview(),
  }));
  useEffect(() => {
    const refresh = () =>
      setState({
        decisions: loadDecisions(),
        processed: loadProcessed(),
        lastReview: loadLastReview(),
      });
    const onStorage = (e: StorageEvent) => {
      if (e.key === DECISIONS_KEY || e.key === PROCESSED_KEY || e.key === REVIEW_KEY) refresh();
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return state;
}
