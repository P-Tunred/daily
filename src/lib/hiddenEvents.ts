import { useEffect, useState } from "react";
import type { CalendarEvent } from "../types";

// ── Hidden calendar events ────────────────────────────────────────────────────
// Calendar events come from an external (Google/iCal) feed and are re-fetched
// every few minutes, so they can't be "deleted" at the source from here. Instead
// we keep a persistent local hide-list: the user can hide an imported event (or
// a whole recurring series) and it stays gone across reloads + refetches.
//
// Event IDs are stable and shaped `${uid}|${occurrenceStartISO}` (see
// server/calendarPlugin.ts). Hiding the full id hides one occurrence; hiding the
// bare `uid` prefix hides every occurrence of that series.

const HIDDEN_KEY = "morning.calendar.hiddenEventIds";
const CHANGE_EVENT = "morning:hidden-events-change";

/** The series key (iCal UID) for an event id — everything before the "|". */
export function uidPrefix(id: string): string {
  const i = id.indexOf("|");
  return i >= 0 ? id.slice(0, i) : id;
}

export function loadHiddenEventIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persist(set: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
  } catch {
    /* quota */
  }
  // Notify all listeners in this tab (storage event only fires cross-tab).
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Hide by full id (one occurrence) or by uid prefix (whole series). */
export function hideCalendarEvent(key: string) {
  const s = loadHiddenEventIds();
  s.add(key);
  persist(s);
}

export function unhideCalendarEvent(key: string) {
  const s = loadHiddenEventIds();
  s.delete(key);
  persist(s);
}

export function clearHiddenCalendarEvents() {
  persist(new Set());
}

/** True if this event id is hidden — either as a single occurrence or because
 *  its whole series (uid prefix) was hidden. */
export function isEventHidden(id: string, hidden: Set<string>): boolean {
  if (hidden.size === 0) return false;
  return hidden.has(id) || hidden.has(uidPrefix(id));
}

/** Fuzzy-match a free-text title against calendar feed events → their IDs.
 *  Matches every occurrence sharing that title (so "ignorier X" hides them all). */
export function matchEventIdsByTitle(title: string, events: CalendarEvent[]): string[] {
  const needle = title.toLowerCase().trim();
  if (!needle) return [];
  return events
    .filter((e) => {
      const h = (e.title || "").toLowerCase();
      if (!h) return false;
      if (h.includes(needle) || needle.includes(h)) return true;
      const nw = needle.split(/\s+/).filter((w) => w.length > 2);
      const hw = new Set(h.split(/\s+/));
      const overlap = nw.filter((w) => hw.has(w)).length;
      return nw.length > 0 && overlap / nw.length >= 0.5;
    })
    .map((e) => e.id);
}

/** React hook — live set of hidden keys, refreshes on any change (this tab or
 *  another). Use with `isEventHidden` to filter, or for a hidden-count badge. */
export function useHiddenEventIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => loadHiddenEventIds());
  useEffect(() => {
    const refresh = () => setIds(loadHiddenEventIds());
    const onStorage = (e: StorageEvent) => {
      if (e.key === HIDDEN_KEY) refresh();
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return ids;
}
