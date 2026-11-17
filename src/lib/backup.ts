// ── Backup / Restore ──────────────────────────────────────────────────────────
// Exports ALL of the user's data — localStorage (`morning.*`) AND the IndexedDB
// stores (todos, importantEvents, aiMessages) — into a single JSON file, and
// restores it again. This is the bridge that carries data across the
// browser → standalone-app boundary (storage is per-origin, so it can't be
// shared automatically). Doubles as a normal backup.

import { todosDB, importantEventsDB, aiMessagesDB, type AIMessage } from "./db";
import type { Task } from "../types";
import type { ImportantEvent } from "../important/types";

const BACKUP_APP = "daily-dashboard";
const BACKUP_VERSION = 1;

export type BackupFile = {
  _app: string;
  _version: number;
  _exportedAt: string;
  localStorage: Record<string, string>;
  indexedDB: {
    todos: Task[];
    importantEvents: ImportantEvent[];
    aiMessages: AIMessage[];
  };
};

/** Collect every `morning.*` localStorage entry + all IndexedDB stores. */
export async function collectBackup(): Promise<BackupFile> {
  const ls: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("morning.")) {
      const v = localStorage.getItem(k);
      if (v != null) ls[k] = v;
    }
  }

  const [todos, importantEvents, aiMessages] = await Promise.all([
    todosDB.getAll().catch(() => [] as Task[]),
    importantEventsDB.getAll().catch(() => [] as ImportantEvent[]),
    aiMessagesDB.getAll().catch(() => [] as AIMessage[]),
  ]);

  return {
    _app: BACKUP_APP,
    _version: BACKUP_VERSION,
    _exportedAt: new Date().toISOString(),
    localStorage: ls,
    indexedDB: { todos, importantEvents, aiMessages },
  };
}

/** Export all data → triggers a download of `daily-backup-YYYY-MM-DD.json`. */
export async function exportAllData(): Promise<void> {
  const backup = await collectBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Restore from a backup file. Returns how many entries were imported. */
export async function importAllData(file: File): Promise<{ localStorage: number; indexedDB: number }> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<BackupFile> & { data?: Record<string, string> };

  // localStorage — accept either the structured `{localStorage:{…}}` shape or a
  // bare `{key:value}` map (forward-compatible with simpler exports).
  const ls = parsed.localStorage ?? parsed.data ?? {};
  let lsCount = 0;
  for (const [k, v] of Object.entries(ls)) {
    if (k.startsWith("morning.") && typeof v === "string") {
      localStorage.setItem(k, v);
      lsCount++;
    }
  }

  // IndexedDB
  let idbCount = 0;
  const idb = parsed.indexedDB;
  if (idb) {
    if (Array.isArray(idb.todos) && idb.todos.length) {
      await todosDB.putMany(idb.todos);
      idbCount += idb.todos.length;
    }
    if (Array.isArray(idb.importantEvents) && idb.importantEvents.length) {
      await importantEventsDB.putMany(idb.importantEvents);
      idbCount += idb.importantEvents.length;
    }
    if (Array.isArray(idb.aiMessages) && idb.aiMessages.length) {
      for (const m of idb.aiMessages) await aiMessagesDB.put(m);
      idbCount += idb.aiMessages.length;
    }
  }

  return { localStorage: lsCount, indexedDB: idbCount };
}
