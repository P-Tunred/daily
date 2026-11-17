import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useCalendarSync } from "./useCalendarSync";
import type { ImportantEvent } from "./types";
import { importantEventsDB, migrateFromLocalStorage, notifyEventsChanged } from "../lib/db";

const KEY      = "morning.important.events";
const SEED_KEY = "morning.important.seeded.v1";

function dateInDays(days: number, year?: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${year ?? d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildDefaults(): ImportantEvent[] {
  return [
    { id: "seed-klausur-db",       kind: "exam",     title: "Klausur Datenbanken",       date: dateInDays(3),  subjectId: "s-db" },
    { id: "seed-deadline-bwl",     kind: "deadline", title: "Hausarbeit BWL abgeben",    date: dateInDays(12), subjectId: "s-bwl" },
    { id: "seed-bday-mama",        kind: "birthday", title: "Mama",                       date: dateInDays(8, 1970), recurringYearly: true },
    { id: "seed-klausur-analysis", kind: "exam",     title: "Klausur Analysis II",        date: dateInDays(17), subjectId: "s-analysis" },
  ];
}

/** Synchronous localStorage read for instant initial render (no flash) */
function loadFromLocalStorage(): ImportantEvent[] {
  try {
    const raw    = localStorage.getItem(KEY);
    const seeded = localStorage.getItem(SEED_KEY) === "true";
    if (!seeded) {
      localStorage.setItem(SEED_KEY, "true");
      const parsed = raw ? (JSON.parse(raw) as ImportantEvent[]) : [];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : buildDefaults();
    }
    return raw ? (JSON.parse(raw) as ImportantEvent[]) : [];
  } catch {
    return [];
  }
}

function uid() { return Math.random().toString(36).slice(2, 10); }

type Store = {
  events: ImportantEvent[];
  addEvent:    (e: Omit<ImportantEvent, "id">, id?: string) => void;
  updateEvent: (id: string, patch: Partial<Omit<ImportantEvent, "id">>) => void;
  deleteEvent: (id: string) => void;
  dismissEvent:(id: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function ImportantEventsProvider({ children }: { children: ReactNode }) {
  // Start with localStorage (sync, no flash), then hydrate from IndexedDB
  const [events, setEvents] = useState<ImportantEvent[]>(() => loadFromLocalStorage());
  const [ready, setReady] = useState(false);

  // Ref mirror so mutation callbacks read current events without stale closures
  // and without doing IndexedDB writes inside a setState updater (which would
  // double-fire under StrictMode).
  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // One-time migration + initial IndexedDB load
  useEffect(() => {
    void (async () => {
      await migrateFromLocalStorage();
      const dbEvents = await importantEventsDB.getAll();
      if (dbEvents.length > 0) setEvents(dbEvents);
      setReady(true);
    })();

    // Listen for deletion triggered by the AI chat
    const handler = () => {
      void importantEventsDB.getAll().then(setEvents);
    };
    window.addEventListener("morning:events-changed", handler);
    return () => window.removeEventListener("morning:events-changed", handler);
  }, []);

  // Keep localStorage in sync for backward-compat (other code that reads it)
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(KEY, JSON.stringify(events));
  }, [events, ready]);

  // ── Mutations — write to React state AND IndexedDB ──────────────────────────

  const addEvent = useCallback((e: Omit<ImportantEvent, "id">, id?: string) => {
    const newEvent: ImportantEvent = { id: id ?? `e-${uid()}`, ...e };
    setEvents(prev => [...prev, newEvent]);
    void importantEventsDB.put(newEvent);
  }, []);

  const updateEvent = useCallback((id: string, patch: Partial<Omit<ImportantEvent, "id">>) => {
    const existing = eventsRef.current.find(e => e.id === id);
    if (existing) void importantEventsDB.put({ ...existing, ...patch });
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const deleteEvent = useCallback((id: string) => {
    // Tombstone gcal- events so useCalendarSync doesn't re-add them
    if (id.startsWith("gcal-")) {
      try {
        const existing = JSON.parse(
          localStorage.getItem("morning.important.gcal-tombstones") ?? "[]"
        ) as string[];
        if (!existing.includes(id))
          localStorage.setItem(
            "morning.important.gcal-tombstones",
            JSON.stringify([...existing, id])
          );
      } catch { /* ignore */ }
    }
    setEvents(prev => prev.filter(e => e.id !== id));
    void importantEventsDB.remove(id);
  }, []);

  const dismissEvent = useCallback((id: string) => {
    const existing = eventsRef.current.find(e => e.id === id);
    if (existing) void importantEventsDB.put({ ...existing, dismissed: true });
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, dismissed: true } : e)));
  }, []);

  const value = useMemo<Store>(
    () => ({ events, addEvent, updateEvent, deleteEvent, dismissEvent }),
    [events, addEvent, updateEvent, deleteEvent, dismissEvent],
  );

  return (
    <Ctx.Provider value={value}>
      <CalendarSyncer />
      {children}
    </Ctx.Provider>
  );
}

function CalendarSyncer() {
  useCalendarSync();
  return null;
}

export function useImportantEvents(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useImportantEvents must be used inside <ImportantEventsProvider>");
  return ctx;
}

/** Delete an important event by ID from outside a React component (e.g. AI chat handler). */
export async function deleteImportantEventById(id: string): Promise<void> {
  // Tombstone gcal- events
  if (id.startsWith("gcal-")) {
    try {
      const existing = JSON.parse(
        localStorage.getItem("morning.important.gcal-tombstones") ?? "[]"
      ) as string[];
      if (!existing.includes(id))
        localStorage.setItem(
          "morning.important.gcal-tombstones",
          JSON.stringify([...existing, id])
        );
    } catch { /* ignore */ }
  }
  await importantEventsDB.remove(id);
  // Also remove from localStorage mirror
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw) as ImportantEvent[];
      localStorage.setItem(KEY, JSON.stringify(list.filter(e => e.id !== id)));
    }
  } catch { /* ignore */ }
  notifyEventsChanged();
}
