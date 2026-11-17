import type { Task } from "../types";
import { todosDB, notifyTodosChanged } from "./db";

// Done-todo auto-cleanup — the 2 AM boundary, in one place.
//
// Studying often runs past midnight, so "today" for a done checkbox extends to
// 2 AM: a task ticked off at 01:30 must not vanish the instant the clock rolls
// over. The cutoff is therefore the most recent 2 AM — today's, or yesterday's
// while it is still between 00:00 and 02:00.
//
// This used to live inside HeuteJarvis, which meant the nightly sweep only ran
// while the dashboard was on screen. Leave the app on the Lernzeit page
// overnight and nothing was ever cleaned up. It is app-level now.

const STORAGE_KEY = "morning.todos";
export const CLEANUP_HOUR = 2;

export function lastTwoAmCutoff(now = new Date()): number {
  const boundary = new Date(now);
  boundary.setHours(CLEANUP_HOUR, 0, 0, 0);
  if (now.getTime() < boundary.getTime()) boundary.setDate(boundary.getDate() - 1);
  return boundary.getTime();
}

/** ms until the next 2 AM (today's if it hasn't passed, otherwise tomorrow's). */
export function msUntilNextTwoAm(now = new Date()): number {
  const next = new Date(now);
  next.setHours(CLEANUP_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * A done todo with no `doneAt` can never expire — the prune below has no date
 * to compare. Older builds (and the two now-unused card components) flipped
 * `done` without stamping, so such todos were immortal. Stamping them with the
 * current time is the conservative repair: they leave at the NEXT 2 AM instead
 * of disappearing under the user's hands the moment the app reloads.
 * Pure — the caller persists.
 */
export function backfillDoneStamps(list: Task[], now = Date.now()): { list: Task[]; stamped: Task[] } {
  const stamped: Task[] = [];
  const next = list.map((t) => {
    if (!t.done || t.doneAt !== undefined) return t;
    const fixed = { ...t, doneAt: now };
    stamped.push(fixed);
    return fixed;
  });
  return stamped.length === 0 ? { list, stamped } : { list: next, stamped };
}

/** Drop todos completed before the last 2 AM boundary. Pure — the caller
 *  persists (localStorage + IndexedDB) and updates state. */
export function pruneStaleDone(list: Task[], now = new Date()): { kept: Task[]; removedIds: string[] } {
  const cutoff = lastTwoAmCutoff(now);
  const stale = list.filter((t) => t.done && t.doneAt !== undefined && t.doneAt < cutoff);
  if (stale.length === 0) return { kept: list, removedIds: [] };
  const staleIds = new Set(stale.map((t) => t.id));
  return { kept: list.filter((t) => !staleIds.has(t.id)), removedIds: [...staleIds] };
}

function loadTodos(): Task[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as Task[]) : [];
  } catch {
    return [];
  }
}

/**
 * The actual sweep: backfill missing stamps, drop everything finished before the
 * last 2 AM, and persist to BOTH stores. Safe to call at any time and as often
 * as you like — outside the boundary it simply finds nothing to do.
 * Returns how many todos were removed.
 *
 * Reads IndexedDB first, because that is the canonical store — localStorage is
 * only a mirror. Reading the mirror alone would leave a done todo sitting in the
 * DB whenever the two drifted apart. Same precedence rule the dashboard uses on
 * hydrate: the DB wins when it has anything, otherwise fall back to the mirror
 * (never wipe real todos with an empty DB).
 */
export async function sweepDoneTodos(now = new Date()): Promise<number> {
  let source: Task[];
  try {
    const fromDb = await todosDB.getAll();
    source = Array.isArray(fromDb) && fromDb.length > 0 ? fromDb : loadTodos();
  } catch {
    source = loadTodos();
  }

  const { list, stamped } = backfillDoneStamps(source, now.getTime());
  const { kept, removedIds } = pruneStaleDone(list, now);
  if (removedIds.length === 0 && stamped.length === 0) return 0;

  removedIds.forEach((id) => void todosDB.remove(id));
  // Only persist stamps for todos that survived the prune.
  const removed = new Set(removedIds);
  stamped.filter((t) => !removed.has(t.id)).forEach((t) => void todosDB.put(t));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    /* quota — the list still works, only the cleanup didn't stick */
  }
  notifyTodosChanged();
  return removedIds.length;
}
