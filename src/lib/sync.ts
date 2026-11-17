// ── Abgleich zwischen Browser-Speicher und der Datei auf dem Server ──────────
//
// WARUM
// Todos, Lernzeit und Score liegen im localStorage/IndexedDB des Browsers.
// Dieser Speicher gehört zur Adresse des Fensters: eine neue Adresse bekommt
// einen leeren Speicher. Damit die Daten Adress-, Geräte- und Rechnerwechsel
// überleben — und damit Hermes sie überhaupt lesen kann — liegen sie zusätzlich
// als Datei auf dem Server (siehe electron/stateStore.cjs).
//
// WIE, OHNE 20 KOMPONENTEN UMZUSCHREIBEN
// Der bestehende Speicher bleibt genau wie er ist. Wir hängen uns nur an:
//   · beim Start einmal vom Server holen bzw. einmalig hochladen
//   · danach nach jeder Änderung (gebündelt) den ganzen Stand hochschicken
// Gesammelt wird mit collectBackup() aus backup.ts — dieselbe Funktion, die
// auch die Backup-Datei erzeugt. Ein Sammelpunkt, kein zweiter.
//
// GRUNDREGEL: NIE LÖSCHEN
// Beim Übernehmen vom Server werden Schlüssel gesetzt und Datensätze ergänzt,
// aber nichts lokal entfernt. Ein unvollständiger Serverstand kann so nichts
// wegräumen; im Zweifel bleibt zu viel stehen statt zu wenig.
//   ⚠️ Bekannte Grenze: Löschungen wandern damit nicht von einem Gerät zum
//   anderen. Solange nur ein Gerät im Einsatz ist, ist das egal. Sobald die App
//   parallel auf Mac und Handy läuft, muss hier auf vollständiges Ersetzen
//   umgestellt werden.

import { collectBackup, type BackupFile } from "./backup";
import { todosDB, importantEventsDB, aiMessagesDB } from "./db";
import { folgeSpruengen, mitSprung, STAND_WEITER, type Spruenge } from "./syncBasis";

type ServerState = {
  updatedAt: string | null;
  localStorage: Record<string, string>;
  indexedDB: BackupFile["indexedDB"];
};

const ENDPOINT = "/api/state";
const BOOT_TIMEOUT_MS = 3000;   // hängt der Server, startet die App trotzdem
const DEBOUNCE_MS = 2000;       // Tippen bündeln statt bei jedem Zeichen senden
const RETRY_MS = 15000;
const POLL_MS = 30000;      // wie oft nachgesehen wird, ob jemand anderes geschrieben hat

let syncing = false;            // erst nach erfolgreichem Start
let baseUpdatedAt: string | null = null;
// Eigene Sprünge der Server-Marke (Bewusst leben schreibt an diesem Weg
// vorbei) — siehe syncBasis.ts für das Warum.
let spruenge: Spruenge = {};
/** Die bekannte Marke setzen und dabei eigene gemerkte Sprünge einlösen.
 *  JEDE Zuweisung an baseUpdatedAt geht hier durch. */
function setzeBasis(stand: string | null): void {
  const r = folgeSpruengen(stand, spruenge);
  baseUpdatedAt = r.stand;
  spruenge = r.spruenge;
}
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let againAfterwards = false;
let applying = false;        // während des Übernehmens nichts hochschicken

// ── Start ───────────────────────────────────────────────────────────────────

export async function bootstrapSync(): Promise<void> {
  let server: ServerState | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), BOOT_TIMEOUT_MS);
    const res = await fetch(ENDPOINT, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    server = (await res.json()) as ServerState;
  } catch (e) {
    // Kein Server erreichbar → die App verhält sich exakt wie vorher, rein lokal.
    console.warn("[sync] Server nicht erreichbar — laufe nur lokal weiter.", e);
    return;
  }

  if (server.updatedAt) {
    const n = await applyFromServer(server);
    setzeBasis(server.updatedAt);
    console.log(`[sync] ${n} Einträge vom Server übernommen (Stand ${server.updatedAt}).`);
  } else {
    const local = await collectBackup();
    const n = Object.keys(local.localStorage).length;
    if (n > 0) {
      console.log(`[sync] Server ist leer — lade ${n} Schlüssel einmalig hoch.`);
      await send(local);
    }
  }

  syncing = true;
  installTriggers();
}

/** Serverstand in den Browser übernehmen — ERSETZEND.
 *
 *  Früher wurde hier nur gesetzt und ergänzt, nie entfernt. Das war sicher,
 *  solange nur ein Gerät im Einsatz war, hatte aber einen Haken: Löschungen
 *  wanderten nie mit. Ein auf dem Mac weggeklicktes Todo tauchte auf dem Handy
 *  wieder auf — und wanderte von dort beim nächsten Hochschicken sogar zurück.
 *
 *  Seit der Zustand auf dem Server lebt, ist dessen Stand die Wahrheit. Also
 *  wird ersetzt. Die eine Sicherung, die bleibt: steht auf dem Server praktisch
 *  nichts, hier aber viel, wird NICHT angefasst — lieber veraltet anzeigen als
 *  leer räumen. */
async function applyFromServer(server: ServerState): Promise<number> {
  const incoming = server.localStorage ?? {};
  const incomingKeys = Object.keys(incoming).filter(
    (k) => k.startsWith("morning.") && typeof incoming[k] === "string",
  );

  const localKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("morning.")) localKeys.push(k);
  }

  if (incomingKeys.length === 0 && localKeys.length > 5) {
    console.warn(
      `[sync] Serverstand ist leer, hier stehen ${localKeys.length} Schlüssel — nichts übernommen.`,
    );
    return 0;
  }

  applying = true;
  let n = 0;
  try {
    for (const k of incomingKeys) {
      try { localStorage.setItem(k, incoming[k]); n++; } catch { /* Speicher voll */ }
    }
    const keep = new Set(incomingKeys);
    for (const k of localKeys) {
      if (!keep.has(k)) localStorage.removeItem(k);
    }

    const idb = server.indexedDB;
    if (idb) {
      try {
        await todosDB.replaceAll(idb.todos ?? []);
        await importantEventsDB.replaceAll(idb.importantEvents ?? []);
        await aiMessagesDB.replaceAll(idb.aiMessages ?? []);
        n += (idb.todos?.length ?? 0) + (idb.importantEvents?.length ?? 0) + (idb.aiMessages?.length ?? 0);
      } catch (e) {
        console.warn("[sync] IndexedDB konnte nicht übernommen werden:", e);
      }
    }
  } finally {
    applying = false;
  }

  // Die Komponenten lesen ihren Stand beim Aufbau. Ohne dieses Signal stünde
  // ein von Hermes angelegtes Todo zwar im Speicher, aber nicht auf dem Schirm.
  // Beide Ereignisse gibt es in der App bereits (siehe lib/db.ts).
  if (n > 0) {
    window.dispatchEvent(new Event("morning:todos-changed"));
    window.dispatchEvent(new Event("morning:events-changed"));
    // Eigenes Ereignis fuers Briefing. Vorher hing es an "todos-changed" —
    // eine Zufallsabhaengigkeit: der Text wurde sichtbar, WEIL zufaellig ein
    // Todo mitkam, und blieb stehen, wenn keins kam. Ein Briefing ohne Todos
    // ist der Normalfall, nicht die Ausnahme.
    window.dispatchEvent(new Event("morning:briefing-changed"));
    window.dispatchEvent(new Event("morning:bewusst-changed"));
    // Projekte, die Hermes angelegt oder ergänzt hat (lib/useProjekte.ts).
    window.dispatchEvent(new Event("morning:projekte-changed"));
    // Der Tracker hält Sitzungen und Ziele im Speicher und las sie früher nur
    // beim Start — siehe TRACKER_NEU_GELADEN in tracker/store.tsx.
    window.dispatchEvent(new Event("morning:tracker-changed"));
  }
  return n;
}

// ── Nachsehen, ob jemand anderes geschrieben hat ────────────────────────────
// Hermes schreibt über /api/hermes/* direkt auf dem Server. Der Browser merkt
// davon nichts, solange er nur selbst sendet — deshalb wird regelmäßig
// nachgefragt. Verglichen wird nur `updatedAt`; ist es unverändert, kostet der
// Durchgang eine winzige Antwort und sonst nichts.

/** Sofort nachsehen statt auf den Takt zu warten — wenn die Oberfläche weiss,
 *  dass gerade auf dem Server geschrieben wurde (Aufgabe aus dem Gespräch mit
 *  Hermes). Dieselben Schutzregeln wie beim Takt. */
export function zieheJetzt(): Promise<void> {
  return poll();
}

async function poll(): Promise<void> {
  if (!syncing || inFlight) return;
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" });
    if (!res.ok) return;
    const server = (await res.json()) as ServerState;
    if (!server.updatedAt || server.updatedAt === baseUpdatedAt) return;
    const n = await applyFromServer(server);
    setzeBasis(server.updatedAt);
    console.log(`[sync] ${n} Einträge von außen übernommen (Stand ${server.updatedAt}).`);
  } catch {
    /* Netz weg — beim nächsten Durchgang wieder */
  }
}

// ── Hochschicken ────────────────────────────────────────────────────────────

async function send(snapshot?: BackupFile): Promise<void> {
  if (inFlight) { againAfterwards = true; return; }
  inFlight = true;
  try {
    const data = snapshot ?? (await collectBackup());
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUpdatedAt,
        localStorage: data.localStorage,
        indexedDB: data.indexedDB,
      }),
    });

    if (res.status === 409) {
      // Jemand anderes hat zwischendurch geschrieben. Dessen Stand gewinnt;
      // eigene Änderungen gehen beim nächsten Durchgang mit hoch.
      const { current } = (await res.json()) as { current: ServerState };
      console.warn("[sync] Server hat einen neueren Stand — übernehme ihn.");
      await applyFromServer(current);
      setzeBasis(current.updatedAt);
      schedule();
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);

    const ok = (await res.json()) as { updatedAt: string };
    setzeBasis(ok.updatedAt);
  } catch (e) {
    console.warn("[sync] Hochladen fehlgeschlagen — neuer Versuch in 15 s.", e);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void send(), RETRY_MS);
  } finally {
    inFlight = false;
    if (againAfterwards) { againAfterwards = false; schedule(); }
  }
}

function schedule(): void {
  if (!syncing || applying) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void send(), DEBOUNCE_MS);
}

/** Sofort schicken, ohne zu warten — beim Schließen oder Wegklicken. */
export function flushSync(): void {
  if (!syncing) return;
  if (timer) clearTimeout(timer);
  void send();
}

// ── Auslöser ────────────────────────────────────────────────────────────────

function installTriggers(): void {
  // localStorage umhüllen: Original immer zuerst, danach den Abgleich anstoßen.
  const setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    setItem(key, value);
    if (typeof key === "string" && key.startsWith("morning.")) schedule();
  };
  const removeItem = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = (key: string) => {
    removeItem(key);
    if (typeof key === "string" && key.startsWith("morning.")) schedule();
  };

  // Ein eigener Schreibvorgang an diesem Weg vorbei (useBewusst) hat die
  // Server-Marke weitergesetzt. Nur merken und einlösen — ob die Kette passt,
  // entscheidet setzeBasis, nicht dieser Zuhörer.
  window.addEventListener(STAND_WEITER, (e) => {
    const d = (e as CustomEvent<{ vorher?: unknown; nachher?: unknown }>).detail ?? {};
    spruenge = mitSprung(spruenge, d.vorher, d.nachher);
    setzeBasis(baseUpdatedAt);
  });

  // IndexedDB meldet sich über Ereignisse (siehe db.ts).
  window.addEventListener("morning:state-dirty", schedule);
  window.addEventListener("morning:todos-changed", schedule);
  window.addEventListener("morning:events-changed", schedule);

  // Fenster weg oder in den Hintergrund → nicht auf die 2 Sekunden warten.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSync();
  });
  window.addEventListener("pagehide", flushSync);

  // Regelmäßig nachsehen, plus sofort beim Zurückkommen ins Fenster — dann
  // steht ein von Hermes angelegtes Todo da, ohne auf den Takt zu warten.
  setInterval(() => void poll(), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void poll();
  });
}
