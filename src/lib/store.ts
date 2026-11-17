// Das Speicher-Register — ein Ort für alle Schlüssel im Browserspeicher.
//
// WARUM ES DAS GIBT
// Die Schlüsselnamen standen als Zeichenketten über 34 Module verstreut, dazu
// rund 40-mal dasselbe Gerüst aus try / JSON.parse / catch. Zwei Probleme:
//
//   1. Ein Tippfehler im Namen legt STILL einen neuen Schlüssel an. Die alten
//      Daten sind dann nicht weg, aber unerreichbar — und nichts meldet sich.
//      Über das Register wird daraus ein Fehler beim Übersetzen.
//   2. `JSON.parse(localStorage.getItem(k) ?? "[]")` liefert `any`. Steht dort
//      ein Objekt statt einer Liste, gibt die Funktion es als `string[]` zurück
//      und die nächste Zeile wirft. Deshalb hat hier JEDER Schlüssel einen
//      Prüfer: was nicht passt, fällt auf die Vorgabe zurück statt zu vergiften.
//
// WORAUF ES BEIM SCHREIBEN ANKOMMT
// src/lib/sync.ts ERSETZT `localStorage.setItem` und `removeItem`, um den
// Abgleich mit dem Server anzustoßen. Wer daran vorbeischreibt — etwa über eine
// eigene Ablage oder einen gepufferten Zugriff —, schaltet die Synchronisation
// lautlos ab. Deshalb geht hier alles durch genau diese beiden Aufrufe.
//
// WAS DAS REGISTER NICHT IST
// Es hält KEINEN Zustand. Es hält Namen, Vorgaben und Prüfer. Die Daten liegen
// weiter im Browserspeicher und auf dem Server. Ein Fehler hier kann eine
// Vorgabe verfälschen, aber nicht den Zustand der App an sich halten.
//
// UND WAS WEITER ÜBER DAS PRÄFIX LÄUFT
// Abgleich und Backup zählen die Schlüssel über `morning.` auf, nicht über
// dieses Register. Ein Schlüssel, der hier fehlt, wird also trotzdem
// synchronisiert und gesichert. Das Register muss nicht vollständig sein, um
// sicher zu sein — es ist eine Verbesserung pro Schlüssel, keine Umschaltung.

import { emptyState, isBewusstState, type BewusstState } from './bewusst';
import { istGueltig as istProjekteState, leer as leerProjekte, type ProjekteState } from './projekte';

/** Ein Schlüssel mit allem, was man über ihn wissen muss. */
export type Schluessel<T> = {
  /** Der Name im Browserspeicher. Beginnt immer mit `morning.`. */
  readonly name: string;
  /** Was gilt, wenn nichts gespeichert ist — oder das Gespeicherte kaputt ist. */
  readonly vorgabe: T;
  /** Rohtext → Wert. Gibt `undefined` zurück, wenn der Text nicht passt. */
  readonly lese: (roh: string) => T | undefined;
  /** Wert → Rohtext. */
  readonly schreibe: (wert: T) => string;
};

// ── Bausteine ───────────────────────────────────────────────────────────────

/** JSON-Schlüssel. Der Prüfer ist PFLICHT — ohne ihn wäre der Rückfall auf die
 *  Vorgabe wertlos, weil kaputte Daten als gültiger Wert durchgingen. */
function json<T>(name: string, vorgabe: T, pruefe: (v: unknown) => v is T): Schluessel<T> {
  return {
    name,
    vorgabe,
    lese: (roh) => {
      try {
        const v: unknown = JSON.parse(roh);
        return pruefe(v) ? v : undefined;
      } catch {
        return undefined;
      }
    },
    schreibe: (wert) => JSON.stringify(wert),
  };
}

/** Schlüssel, der reinen Text hält (kein JSON) — etwa das Thema. */
function text<T extends string>(name: string, vorgabe: T, erlaubt?: readonly T[]): Schluessel<T> {
  return {
    name,
    vorgabe,
    lese: (roh) => (!erlaubt || (erlaubt as readonly string[]).includes(roh) ? (roh as T) : undefined),
    schreibe: (wert) => wert,
  };
}

/** Schalter, der als "on"/"off" gespeichert wird. Bewusst nicht als JSON:
 *  so lag er schon im Speicher, und ein Formatwechsel würde die Einstellung
 *  bei allen zurücksetzen, die sie einmal gesetzt haben. */
function schalter(name: string, vorgabe: boolean): Schluessel<boolean> {
  return {
    name,
    vorgabe,
    lese: (roh) => (roh === "on" ? true : roh === "off" ? false : undefined),
    schreibe: (wert) => (wert ? "on" : "off"),
  };
}

// ── Prüfer ──────────────────────────────────────────────────────────────────

const istListe = <T,>(pruefeEintrag: (v: unknown) => boolean) =>
  (v: unknown): v is T[] => Array.isArray(v) && v.every(pruefeEintrag);

const istText = (v: unknown): v is string => typeof v === "string";
const istZahl = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const istObjekt = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Objekt mit Zahlwerten — etwa die Tagesziele `{"2026-08-16": 300}`. */
const istZahlKarte = (v: unknown): v is Record<string, number> =>
  istObjekt(v) && Object.values(v).every(istZahl);

/** Objekt mit Textwerten. */
const istTextKarte = (v: unknown): v is Record<string, string> =>
  istObjekt(v) && Object.values(v).every(istText);

/** Genau sieben Zahlen — die Wochentagsziele, So..Sa. Die Länge zu prüfen ist
 *  nicht Pedanterie: eine Liste mit sechs Werten liefert für einen Wochentag
 *  `undefined` und daraus wird stillschweigend ein Ziel von 0 Minuten. */
const istSiebenZahlen = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 7 && v.every(istZahl);

/** Für Listen von Objekten, deren Form woanders geprüft wird (Sessions, Todos,
 *  Termine). Hier wird nur sichergestellt, dass es überhaupt eine Liste von
 *  Objekten ist — der Rest gehört in die jeweilige Fachschicht. */
const istObjektListe = istListe<Record<string, unknown>>(
  (e) => !!e && typeof e === "object",
);

const istTextListe = istListe<string>(istText);

const istZielVerlauf = (v: unknown): v is Record<string, Record<string, number>> =>
  istObjekt(v) && Object.values(v).every(istZahlKarte);

/** Stand des Prioritäten-Lernens. Die Signale selbst prüft lib/prioSpeicher.ts
 *  einzeln — ein kaputtes soll nicht alle anderen mitreissen. */
export type PrioStand = {
  version: 1;
  signale: Record<string, unknown>[];
  abgelehnt: Record<string, string>;
  profil?: string;
  profilAm?: string;
};
const istPrioStand = (v: unknown): v is PrioStand =>
  istObjekt(v) && v.version === 1 && istObjektListe(v.signale) && istTextKarte(v.abgelehnt);

// ── Das Register ────────────────────────────────────────────────────────────
// Sortiert wie die App: Kern, Lernzeit, Kalender, Triage, Oberfläche.
// Wer einen Schlüssel hinzufügt, gibt Vorgabe UND Prüfer an — sonst nimmt
// TypeScript es nicht an.

export const SCHLUESSEL = {
  bewusst: json<BewusstState>('morning.bewusst.v1', emptyState(), isBewusstState),
  // Eigene Versionsprüfung über /api/projekte, wie „bewusst" (lib/useProjekte.ts).
  projekte: json<ProjekteState>('morning.projekte', leerProjekte(), istProjekteState),
  // ── Kern ──
  todos: json<Record<string, unknown>[]>("morning.todos", [], istObjektListe),
  wichtigeTermine: json<Record<string, unknown>[]>("morning.important.events", [], istObjektListe),
  briefing: json<Record<string, unknown> | null>(
    "morning.briefing",
    null,
    (v): v is Record<string, unknown> | null => v === null || istObjekt(v),
  ),
  // `morning.briefing.collapsedFor` (Briefing-Karte eingeklappt) ist seit
  // 2026-10-31 mit der Karte weg.
  /** Vorgänge im Fokus — siehe electron/focusStore.cjs für das Warum.
   *  OBJEKT mit `vorgaenge`-Liste, nicht die blosse Liste: der Server legt
   *  später weitere Felder daneben (Zähler, Stand), und ein Formwechsel wäre
   *  dann eine Migration statt einer Ergänzung. */
  fokus: json<{ vorgaenge: Record<string, unknown>[] }>(
    "morning.focus",
    { vorgaenge: [] },
    (v): v is { vorgaenge: Record<string, unknown>[] } =>
      istObjekt(v) && istObjektListe((v as { vorgaenge?: unknown }).vorgaenge),
  ),
  quittierteTermine: json<string[]>("morning.assistant.acknowledgedEvents", [], istTextListe),
  /** KARTE Datum → Tageswerte, keine Liste. Der Code liest sie mit
   *  `Object.values(...)` — dass daraus eine Liste WIRD, hat mich beim ersten
   *  Entwurf zu `[]` verleitet. 120 Tage Verlauf wären damit weg gewesen. */
  scoreVerlauf: json<Record<string, Record<string, unknown>>>(
    "morning.scoreHistory",
    {},
    (v): v is Record<string, Record<string, unknown>> =>
      istObjekt(v) && Object.values(v).every((e) => !!e && typeof e === "object"),
  ),

  // ── Lernzeit ──
  sitzungen: json<Record<string, unknown>[]>("morning.tracker.sessions", [], istObjektListe),
  faecher: json<Record<string, unknown>[]>("morning.tracker.subjects", [], istObjektListe),
  lernbloecke: json<Record<string, unknown>[]>("morning.tracker.studyBlocks", [], istObjektListe),
  zielMinuten: json<number>("morning.tracker.goalMin", 240, istZahl),
  zielMinutenWochenende: json<number>("morning.tracker.goalMinWeekend", 240, istZahl),
  zieleNachWochentag: json<number[] | null>(
    "morning.tracker.goalsByWeekday",
    null,
    (v): v is number[] | null => v === null || istSiebenZahlen(v),
  ),
  zielAusnahmen: json<Record<string, number>>("morning.tracker.goalOverrides", {}, istZahlKarte),
  wochenzielStunden: json<number>("morning.tracker.weeklyGoalHours", 40, istZahl),
  aufstehzeit: text("morning.tracker.wakeTime", "07:00"),
  schlafenszeit: text("morning.tracker.sleepTime", "23:00"),
  lernbeginn: text("morning.tracker.studyStartTime", "08:00"),
  letztesFach: text("morning.tracker.lastSubject", ""),
  zielEpochen: json<Record<string, unknown>[]>("morning.tracker.goalEpochs", [], istObjektListe),
  laufendeTimer: json<Record<string, unknown>>("morning.activeTimers", {}, istObjekt),

  // ── Kalender ──
  versteckteTermine: json<string[]>("morning.calendar.hiddenEventIds", [], istTextListe),
  serienEntscheidungen: json<Record<string, string>>("morning.calendar.seriesDecisions", {}, istTextKarte),
  bearbeiteteTermine: json<string[]>("morning.calendar.processedOccurrences", [], istTextListe),
  letzteWochenschau: text("morning.calendar.lastWeeklyReview", ""),
  gcalGrabsteine: json<string[]>("morning.important.gcal-tombstones", [], istTextListe),

  // ── Posteingang / Triage ──
  triageGesehen: json<string[]>("morning.triage.seen", [], istTextListe),
  /** `{ [mailId]: ISO-Datum }` — wann zuletzt gefragt wurde. KEINE Liste:
   *  ein erster Entwurf hatte hier `string[]` stehen, der Prüfer hätte die
   *  Karte abgelehnt und die Cooldowns beim ersten Lesen gelöscht. */
  triageGefragt: json<Record<string, string>>("morning.triage.asked", {}, istTextKarte),
  /** Vollständige zurückgestellte Einträge, keine IDs. Gleiche Falle wie oben. */
  triageZurueckgestellt: json<Record<string, unknown>[]>("morning.triage.deferred", [], istObjektListe),
  triageKalenderGesehen: json<string[]>("morning.triage.calseen", [], istTextListe),
  triageDoppeltOk: json<string[]>("morning.triage.dupok", [], istTextListe),
  stummeAbsender: json<string[]>("morning.triage.mutedSenders", [], istTextListe),

  // ── Oberfläche ──
  thema: text("morning.theme", "setzling"),
  /** Erster Bildschirm: bisheriges Intro oder „Still" (lib/introLayout.ts). */
  introLayout: text("morning.introLayout", "original", ["original", "still"] as const),
  /** Stil der ganzen App: bisheriges Aussehen oder Seite G (lib/stil.ts). */
  stil: text("morning.stil", "original", ["original", "g"] as const),
  /** Welche ASCII-Tiere hinter dem Thema Glas schwimmen (lib/teichMotiv.ts). */
  teichMotiv: text(
    "morning.teichMotiv",
    "koi",
    ["koi", "libellen", "quallen", "schmetterlinge", "voegel", "aus"] as const,
  ),
  /** Gewählte Platte JE THEMA, etwa `{ kupferstich: 2, arkadien: 0 }` —
   *  nicht eine einzelne Zahl. */
  platteIndex: json<Record<string, number>>("morning.plateIndex", {}, istZahlKarte),
  /** Deckkraft des Milchglases, 0–0,72 — ein SCHIEBEREGLER, kein Schalter.
   *  Der Name klingt nach an/aus und hat genau dazu verführt: der erste Entwurf
   *  hatte hier `boolean` stehen. Die Prüfung gegen die echten Daten
   *  (check-storage-shapes.mjs) hat es gefangen. */
  kupferstichFrost: json<number>(
    "morning.kupferstichFrost",
    0.2,
    (v): v is number => typeof v === "number" && v >= 0 && v <= 0.72,
  ),
  aktienZeigen: json<boolean>("morning.showStocks", false, (v): v is boolean => typeof v === "boolean"),
  tonAn: schalter("morning.soundEnabled", true),

  // ── Zwischenspeicher (dürfen jederzeit fehlen) ──
  wetterCache: json<Record<string, unknown> | null>(
    "morning.weather.cache",
    null,
    (v): v is Record<string, unknown> | null => v === null || istObjekt(v),
  ),
  ortCache: json<Record<string, unknown> | null>(
    "morning.location.cache",
    null,
    (v): v is Record<string, unknown> | null => v === null || istObjekt(v),
  ),
  aktienCache: json<Record<string, unknown> | null>(
    "morning.stock.cache",
    null,
    (v): v is Record<string, unknown> | null => v === null || istObjekt(v),
  ),
  portfolioVerlauf: json<Record<string, unknown>[]>("morning.portfolio.history", [], istObjektListe),

  // ── Hermes-Panel ──
  // Weg seit 2026-10-31, mit dem Chat im Dashboard: `morning.jarvis.autoSpeak`,
  // `.autoSpoke` und `.profile` (was sich der Offline-Chat gemerkt hatte).
  // Pauls Entscheidung: mit Hermes redet er über Hermes selbst. Die alten
  // Werte liegen harmlos weiter im Speicher.
  /** Das Prioritäten-Lernen (lib/prioLernen.ts, lib/prioSpeicher.ts):
   *  Signale, abgelehnte Empfehlungen und das daraus gebaute Profil als Text.
   *  Der Text liegt mit drin, damit der Server ihn Hermes geben kann, ohne
   *  die Rechnung ein zweites Mal zu führen (GET /api/hermes/prioritaeten). */
  prioritaeten: json<PrioStand>("morning.prioritaeten.v1", { version: 1, signale: [], abgelehnt: {} }, istPrioStand),
  /** `{ JJJJ-MM-TT: { [Klausur]: Minuten } }` — das Tagesziel des Klausur-
   *  Planers, wie es morgens stand (lib/lernTempo.ts → mitZiel). Ohne diese
   *  Liste liesse sich später nicht sagen, ob ein Tagesziel erreicht wurde. */
  lernplanVerlauf: json<Record<string, Record<string, number>>>("morning.lernplan.verlauf", {}, istZielVerlauf),
  /** `{ [routineId]: JJJJ-MM-TT }` — Anpassungshinweise in „Bewusst leben",
   *  die Paul mit „Behalten" beantwortet hat. Ruhen zwei Wochen. */
  bewusstHinweiseOk: json<Record<string, string>>("morning.bewusst.hinweiseOk", {}, istTextKarte),
  stupserAn: schalter("morning.jarvis.nudges", true),
  /** `{ [stupser]: ISO-Datum }` — was heute schon kam. */
  stupserGefeuert: json<Record<string, string>>("morning.jarvis.nudges.fired", {}, istTextKarte),

  // ── Wochenplan ──
  wochenplanText: text("morning.weekPlan.text", ""),
  wochenplanErzeugt: text("morning.weekPlan.generatedAt", ""),
  wochenplanEinstellungen: json<Record<string, unknown>>("morning.weekPlan.prefs", {}, istObjekt),
  wochenplanVerschiebungen: json<Record<string, unknown>[]>("morning.weekPlan.moveHistory", [], istObjektListe),
  wochenplanTerminkategorien: json<Record<string, string>>("morning.weekPlan.eventCategories", {}, istTextKarte),

  // ── Einmalige Wanderungen ──
  // Werden genau einmal gesetzt und nie wieder gelesen ausser zum Prüfen.
  // Bewusst als Text mit "true", weil sie so schon im Speicher liegen — ein
  // Formatwechsel würde die Wanderung bei allen erneut auslösen.
  terminesGesaet: text("morning.important.seeded.v1", ""),
  dbGewandert: text("morning.db.migrated.v1", ""),
} as const;

// ── Zugriff ─────────────────────────────────────────────────────────────────

/** Liest einen Schlüssel. Gibt IMMER einen brauchbaren Wert zurück: fehlt der
 *  Eintrag oder passt er nicht zum Prüfer, kommt die Vorgabe. */
export function lies<T>(s: Schluessel<T>): T {
  try {
    const roh = localStorage.getItem(s.name);
    if (roh === null) return s.vorgabe;
    const wert = s.lese(roh);
    if (wert === undefined) {
      // Nicht still schlucken: ein kaputter Wert ist ein Hinweis, kein
      // Normalzustand. Die App läuft weiter, aber es steht im Protokoll.
      console.warn(`[speicher] ${s.name} ist unlesbar — Vorgabe verwendet.`);
      return s.vorgabe;
    }
    return wert;
  } catch {
    // Speicher ganz gesperrt (privater Modus, Richtlinie) — die App soll
    // trotzdem laufen.
    return s.vorgabe;
  }
}

/** Schreibt einen Schlüssel. Geht bewusst durch `localStorage.setItem`, weil
 *  sync.ts genau dort den Abgleich anhängt. */
export function schreib<T>(s: Schluessel<T>, wert: T): void {
  try {
    localStorage.setItem(s.name, s.schreibe(wert));
  } catch {
    /* Speicher voll oder gesperrt — der Wert bleibt dann eben nur im Speicher
       der laufenden Sitzung. Besser als ein Absturz beim Abhaken. */
  }
}

/** Entfernt einen Schlüssel — ebenfalls über den überschriebenen Aufruf. */
export function entferne<T>(s: Schluessel<T>): void {
  try {
    localStorage.removeItem(s.name);
  } catch {
    /* siehe schreib() */
  }
}

/** Liest, ändert und schreibt in einem Zug. Spart das Muster
 *  `const x = lies(k); schreib(k, f(x))`, das sonst überall entstünde. */
export function aendere<T>(s: Schluessel<T>, f: (bisher: T) => T): T {
  const nachher = f(lies(s));
  schreib(s, nachher);
  return nachher;
}
