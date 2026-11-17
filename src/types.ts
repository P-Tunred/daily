export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  allDay?: boolean;
  description?: string;
  /** Source calendar this event came from (Uni, Privat, Klausur, Familie …).
   *  Drives the colored tag in the UI. Present for Drive-JSON events. */
  calendar?: string;
  /** Die CalDAV-UID, ohne den Startzeitpunkt.
   *
   *  `id` ist `uid|start` — praktisch als Schlüssel für Wiederholungen, aber
   *  unbrauchbar zum Wiedererkennen: Daily kennt beim Anlegen die UID, nicht
   *  aber den Zeitpunkt, den der Kalender daraus macht. Zum Entdoppeln
   *  (horizon.ts) braucht es deshalb die nackte UID. */
  uid?: string;
};

export type Email = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  starred?: boolean;
  /** Quiet urgency marker from the triage scoring ("überfällig"/"heute"/…). */
  flag?: string | null;
};

export type TaskPriority = "dringend" | "wichtig" | "normal";

/** "day" = lives in the daily list ("Was heute zählt"). "week" = backlog item
 *  in the weekly list ("Diese Woche") until pushed into a day. Missing on a
 *  task = treated as "day" — preserves exact current behavior for every todo
 *  created before this field existed. */
export type TaskScope = "day" | "week";

export type Task = {
  /** Routine projections are scored only in Bewusst leben. */
  origin?: 'bewusst';
  id: string;
  text: string;
  done: boolean;
  priority?: TaskPriority;
  /** ms timestamp when the todo was created. Used to surface "stale" todos
   *  in the Jarvis nudges. Missing on legacy todos → migrated to creation
   *  read-time fallback on first load. */
  createdAt?: number;
  /** Self-estimated effort in minutes. Picked from a chip row when adding.
   *  Jarvis uses this to decide which todos fit a calendar gap. */
  estimatedMin?: number;
  /** ms timestamp when the todo was checked off. Done todos completed on an
   *  earlier day are auto-removed on the next day's load. Cleared when un-done. */
  doneAt?: number;
  /** Weekly backlog vs. daily list — see TaskScope. */
  scope?: TaskScope;
  /** ISO date "YYYY-MM-DD" the task was placed on (set when pushed into the
   *  daily list, or on direct daily add). Informational only — the daily list
   *  is never hard-filtered by it, so an older open task still carries over
   *  instead of silently disappearing. */
  date?: string;
  /** Rubrik — same 5 categories as the calendar tags and Stundenplan blocks
   *  (lib/categories.ts), so the app shares one category language throughout. */
  category?: import("./tracker/types").BlockCategory;
  /** Free-text elaboration on what the task actually involves — primarily for
   *  weekly backlog items ("Diese Woche") where you jot down WHAT to do, not
   *  how long it takes. Carries over into the daily list when pushed to today. */
  description?: string;
  /** Planned weekday for weekly-backlog items (ISO: 1 = Montag … 7 = Sonntag).
   *  A light sorting label for the week, not a hard schedule — nothing moves
   *  automatically when that day arrives. */
  plannedDay?: number;
  /** Aus welchem Termin diese Aufgabe entstanden ist (electron/dayStart.cjs).
   *  Ohne den Rückverweis liesse sich später nicht mehr sagen, woher sie kam. */
  ausTermin?: string;
  /** Kam heute aus der Wochenliste in den Tag, weil `plannedDay` erreicht war. */
  ausWoche?: boolean;
  /** Ein konkreter Tag (JJJJ-MM-TT), für den die Aufgabe geplant ist — gesetzt
   *  von Hermes („am 12.11. Rückmeldung an Daisy"). Bis dahin wartet sie in der
   *  Wochenliste; electron/dayStart.cjs schiebt sie an genau diesem Morgen in
   *  den Tag. Hat Vorrang vor `plannedDay`, das nur den Wochentag kennt. */
  geplantAm?: string;
  /** Wie oft der Tagesabschluss diese Aufgabe schon auf einen neuen Tag
   *  gestempelt hat (electron/dayClose.cjs). Ohne diesen Zähler sieht eine
   *  Aufgabe, die seit drei Wochen mitläuft, genauso aus wie eine von heute
   *  Morgen — beide stehen einfach da. Mit ihm wird aus "steht auf der Liste"
   *  ein "steht seit 12 Tagen auf der Liste", und das ist die Angabe, die eine
   *  Entscheidung auslöst: machen, delegieren oder streichen. */
  verschoben?: number;
  /** Optional Fach (tracker subject id) the task belongs to — shown as a small
   *  colored tag. Complements `category`, which stays the coarse Rubrik. */
  subjectId?: string;
};

export type Holding = {
  name: string;
  ticker: string;
  invested: number;
};

export type Quote = {
  ticker: string;
  price: number;
  currency: string;
  changePct: number;
  fetchedAt: Date;
  stale?: boolean; // true when served from localStorage stale-cache (all live sources failed)
};
