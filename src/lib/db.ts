/**
 * IndexedDB wrapper — single source of truth for todos, importantEvents, AI messages.
 * All UI components AND the AI chat read/write through here.
 * localStorage is kept in sync for backward-compatibility with code that still reads it.
 */

import type { Task } from "../types";
import type { ImportantEvent } from "../important/types";

const DB_NAME = "morning-db";
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

/** Nach jeder Schreiboperation: der Abgleich mit dem Server (lib/sync.ts)
 *  horcht darauf und schickt den neuen Stand hoch. Kostet nichts, wenn kein
 *  Server da ist — dann hört einfach niemand zu. */
function markDirty(): void {
  try { window.dispatchEvent(new Event("morning:state-dirty")); } catch { /* egal */ }
}

function open(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("todos"))
        db.createObjectStore("todos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("importantEvents"))
        db.createObjectStore("importantEvents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("aiMessages"))
        db.createObjectStore("aiMessages", { keyPath: "id" });
    };
    req.onsuccess = () => { _db = req.result; resolve(req.result); };
    req.onerror  = () => reject(req.error);
  });
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror  = () => reject(req.error);
  });
}

async function put<T>(store: string, item: T): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(item);
    tx.oncomplete = () => { markDirty(); resolve(); };
    tx.onerror    = () => reject(tx.error);
  });
}

async function putMany<T>(store: string, items: T[]): Promise<void> {
  if (!items.length) return;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    items.forEach(i => s.put(i));
    tx.oncomplete = () => { markDirty(); resolve(); };
    tx.onerror    = () => reject(tx.error);
  });
}

/** Store leeren und neu befüllen. Für den Abgleich: nach dem Umzug ist der
 *  Serverstand die Wahrheit. Ohne Ersetzen würden dort gelöschte Einträge auf
 *  einem zweiten Gerät wieder auftauchen und beim nächsten Hochschicken sogar
 *  zurückwandern. */
async function replaceAll<T>(store: string, items: T[]): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    s.clear();
    items.forEach(i => s.put(i));
    tx.oncomplete = () => { markDirty(); resolve(); };
    tx.onerror    = () => reject(tx.error);
  });
}

async function del(store: string, id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => { markDirty(); resolve(); };
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Todos ──────────────────────────────────────────────────────────────────────

export const todosDB = {
  getAll:  (): Promise<Task[]>        => getAll<Task>("todos"),
  put:     (t: Task): Promise<void>   => put("todos", t),
  putMany: (ts: Task[]): Promise<void> => putMany("todos", ts),
  remove:  (id: string): Promise<void> => del("todos", id),
  replaceAll: (xs: Task[]): Promise<void> => replaceAll("todos", xs),
};

// ── Important Events ───────────────────────────────────────────────────────────

export const importantEventsDB = {
  getAll:  (): Promise<ImportantEvent[]>        => getAll<ImportantEvent>("importantEvents"),
  put:     (e: ImportantEvent): Promise<void>   => put("importantEvents", e),
  putMany: (es: ImportantEvent[]): Promise<void> => putMany("importantEvents", es),
  remove:  (id: string): Promise<void>           => del("importantEvents", id),
  replaceAll: (xs: ImportantEvent[]): Promise<void> => replaceAll("importantEvents", xs),
};

// ── AI Messages ────────────────────────────────────────────────────────────────

export type AIMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  date: string; // YYYY-MM-DD — used for daily reset
};

export const aiMessagesDB = {
  getAll:   (): Promise<AIMessage[]> => getAll<AIMessage>("aiMessages"),
  getToday: async (): Promise<AIMessage[]> => {
    const today = new Date().toISOString().slice(0, 10);
    const all   = await getAll<AIMessage>("aiMessages");
    return all.filter(m => m.date === today);
  },
  put:    (m: AIMessage): Promise<void>   => put("aiMessages", m),
  remove: (id: string): Promise<void>    => del("aiMessages", id),
  replaceAll: (ms: AIMessage[]): Promise<void> => replaceAll("aiMessages", ms),
  removeAll: async (): Promise<void> => {
    const all = await getAll<AIMessage>("aiMessages");
    await Promise.all(all.map(m => del("aiMessages", m.id)));
  },
};

// ── One-time migration from localStorage ──────────────────────────────────────

const MIGRATED_KEY = "morning.db.migrated.v1";

export async function migrateFromLocalStorage(): Promise<void> {
  if (localStorage.getItem(MIGRATED_KEY) === "true") return;
  try {
    const todos = JSON.parse(localStorage.getItem("morning.todos") ?? "[]") as Task[];
    if (todos.length) await putMany("todos", todos);
  } catch { /* ignore */ }
  try {
    const events = JSON.parse(
      localStorage.getItem("morning.important.events") ?? "[]"
    ) as ImportantEvent[];
    if (events.length) await putMany("importantEvents", events);
  } catch { /* ignore */ }
  localStorage.setItem(MIGRATED_KEY, "true");
}

// ── Cross-component change notifications ──────────────────────────────────────
// Dispatch these after a DB mutation so sibling components can re-read.

export function notifyTodosChanged()  { window.dispatchEvent(new Event("morning:todos-changed")); }
export function notifyEventsChanged() { window.dispatchEvent(new Event("morning:events-changed")); }
