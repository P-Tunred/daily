export type Subject = {
  id: string;
  name: string;
  color: string;
  /** Nicht mehr auswählbar, aber weiterhin in Statistik, Kalender und Verlauf.
   *
   *  WARUM ARCHIVIEREN STATT LÖSCHEN
   *  An den Fächern hängen die Lernsitzungen über `subjectId`. Ein gelöschtes
   *  Fach lässt jede `subjects.find()`-Stelle ins Leere laufen: die Sitzungen
   *  bleiben zwar in den Daten, verlieren aber Namen und Farbe — und aus den
   *  Summen im Dashboard fallen sie ganz heraus, weil die über `subjects`
   *  iterieren. Beim Semesterwechsel wären das auf einen Schlag mehrere
   *  hundert Stunden. Ein Semester endet, aber es ist nicht ungeschehen. */
  archiviert?: boolean;
  /** Feste Lernzeit pro Woche für ein Fach OHNE Klausurplan in LearnHarness
   *  (Vorlesungen nacharbeiten, Übungsblätter). Geht in den Bedarf des
   *  Tagesziels ein (lib/lernTempo.ts → tagesziel); bei einem Fach mit
   *  Klausurplan zählt der Plan, nicht diese Zahl. */
  stundenProWoche?: number;
};

export type MoodRating = "tired" | "okay" | "fit" | "focused";

export type Session = {
  id: string;
  subjectId: string;
  date: string;
  durationMin: number;
  note?: string;
  /** Local ms timestamp when the session started. Captured by the timer
   *  context. Optional so legacy sessions (no start time) keep working —
   *  but the productive-hours heatmap only counts ones that have it. */
  startedAtMs?: number;
  /** Optional self-rating captured at session start (mood check). */
  mood?: MoodRating;
};

/** Categories for week-plan blocks. "lern" = study, the rest are non-study
 *  events the user places on the timeline (Uni, Privat, Sport, etc.). */
export type BlockCategory = "lern" | "uni" | "privat" | "sport" | "sonstiges";

/** A planned block placed on the weekly calendar (study OR personal event).
 *  Lives in the WeekPlan store, separate from finished `Session`s. */
export type StudyBlock = {
  id: string;
  /** ISO date "YYYY-MM-DD" — local day the block belongs to. */
  date: string;
  /** Start time in minutes from local midnight. 30-min snapped. */
  startMin: number;
  /** Duration in minutes. 30-min snapped. */
  durationMin: number;
  /** Optional subject reference (only relevant when category = "lern"). */
  subjectId?: string;
  /** "auto" = Jarvis suggested, soft / dashed. "user" = manually placed or moved, solid. */
  source: "auto" | "user";
  /** Block category — drives color + whether it counts as study time. Defaults to "lern". */
  category?: BlockCategory;
  /** Optional one-line note / custom title (e.g. "Sport mit Tom"). */
  note?: string;
  /** Set when this block was materialized from a calendar occurrence (the
   *  CalendarEvent id `${uid}|${startISO}`). Lets us dedupe + remove it when the
   *  user changes their "hingehen" decision. */
  fromEventId?: string;
  /** Source calendar tag (Uni, Privat, Klausur …) for calendar-derived blocks.
   *  Drives the block color so it matches the calendar card exactly. */
  calendar?: string;
};
