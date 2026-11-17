import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, StudyBlock, Subject } from "./types";
import { pickNextColor, SUBJECT_COLORS, LEGACY_SUBJECT_HEX } from "./colors";
import {
  EPOCH_START,
  goalsAt,
  loadGoalEpochs,
  saveGoalEpochs,
  upsertEpoch,
  type GoalEpoch,
} from "../lib/goalHistory";

const SUBJECTS_KEY = "morning.tracker.subjects";
const SESSIONS_KEY = "morning.tracker.sessions";
const GOAL_KEY = "morning.tracker.goalMin";
const GOAL_WEEKEND_KEY = "morning.tracker.goalMinWeekend";
const WEEKDAY_GOALS_KEY = "morning.tracker.goalsByWeekday"; // number[7], Sun..Sat
const WEEKLY_GOAL_HOURS_KEY = "morning.tracker.weeklyGoalHours"; // total hours per week — drives heatmap reference
const GOAL_OVERRIDES_KEY = "morning.tracker.goalOverrides"; // { "2026-05-28": 30 } — date-specific overrides
const WAKE_TIME_KEY = "morning.tracker.wakeTime";   // "HH:MM"
const SLEEP_TIME_KEY = "morning.tracker.sleepTime"; // "HH:MM"
const STUDY_START_KEY = "morning.tracker.studyStartTime"; // "HH:MM" — earliest the auto-planner may place study
const STUDY_BLOCKS_KEY = "morning.tracker.studyBlocks"; // StudyBlock[]

/** A "shadow" block is a study block that older builds auto-created for every
 *  timed session. It duplicates the session overlay on the Stundenplan (block +
 *  ✓-overlay at the same slot), so we detect and drop these. Matched on day,
 *  subject, duration and exact start minute — i.e. exactly how they were made. */
function isShadowOfSession(b: StudyBlock, sessions: Session[]): boolean {
  if (b.source !== "user" || (b.category ?? "lern") !== "lern") return false;
  return sessions.some((s) => {
    if (typeof s.startedAtMs !== "number") return false;
    if (s.date !== b.date || s.subjectId !== b.subjectId || s.durationMin !== b.durationMin) return false;
    const d = new Date(s.startedAtMs);
    return d.getHours() * 60 + d.getMinutes() === b.startMin;
  });
}

/** Indexes: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat */
export const WEEKDAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const WEEKDAY_LABELS_FULL = [
  "Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag",
];

const DEFAULT_SUBJECTS: Subject[] = [
  { id: "s-analysis", name: "Analysis", color: SUBJECT_COLORS[0] },
  { id: "s-db", name: "Datenbanken", color: SUBJECT_COLORS[1] },
  { id: "s-bwl", name: "BWL", color: SUBJECT_COLORS[4] },
];

/** Subjects created before the var(--subject-N) palette existed have a literal
 *  hex baked into `color` (e.g. "#7AA2FF") — upgrade those in place to the
 *  matching var() reference so they re-color with the theme like every subject
 *  created since. Matched by position in the (fixed, never-reordered) legacy
 *  hex list; anything already var()-based or unrecognized passes through. */
function migrateSubjectColors(subjects: Subject[]): Subject[] {
  let changed = false;
  const next = subjects.map((s) => {
    const i = LEGACY_SUBJECT_HEX.findIndex((hex) => hex.toLowerCase() === s.color.toLowerCase());
    if (i === -1) return s;
    changed = true;
    return { ...s, color: SUBJECT_COLORS[i] };
  });
  return changed ? next : subjects;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  const text = JSON.stringify(value);
  // Nur schreiben, was sich geändert hat. Nach einem Abgleich liest der
  // Tracker den Serverstand neu ein (siehe TRACKER_NEU_GELADEN) — schriebe er
  // ihn danach unverändert zurück, löste jedes Einlesen einen Upload aus.
  if (localStorage.getItem(key) === text) return;
  localStorage.setItem(key, text);
}

/** Der Abgleich (lib/sync.ts) hat Werte vom Server in den localStorage
 *  übernommen. Der Tracker liest dann neu ein. */
const TRACKER_NEU_GELADEN = "morning:tracker-changed";

function loadGoalsByWeekday(): number[] {
  const raw = load<number[] | null>(WEEKDAY_GOALS_KEY, null);
  if (Array.isArray(raw) && raw.length === 7 && raw.every((n) => typeof n === "number" && n >= 0)) {
    return raw;
  }
  // Migrate from legacy weekday/weekend settings
  const wd = load(GOAL_KEY, 120);
  const we = load(GOAL_WEEKEND_KEY, 60);
  return deriveWeekdayGoals(wd, we || wd);
}

/** Alter Wert, wenn der neue inhaltlich gleich ist — sonst der neue. Hält die
 *  Identität stabil, damit nichts neu rechnet oder speichert, was gleich blieb. */
function gleichOderNeu<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function isoDate(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type TrackerStore = {
  subjects: Subject[];
  sessions: Session[];
  goalMin: number;            // legacy "weekday goal" — still surfaced for backward compat
  goalMinWeekend: number;     // legacy "weekend goal"
  /** Per-weekday minutes target. Indexes: 0=Sun..6=Sat. Source of truth. */
  goalsByWeekday: number[];
  /** Total weekly study target in hours — drives the streak-heatmap reference (40h ÷ 7 = 343 min/day) */
  weeklyGoalHours: number;
  /** Date-specific minute overrides. Keys: ISO date "YYYY-MM-DD". Take precedence over goalsByWeekday. */
  goalOverrides: Record<string, number>;
  /** User's typical wake-up time "HH:MM" (e.g., "05:00") — fed to Jarvis for planning */
  wakeTime: string;
  /** User's typical sleep time "HH:MM" */
  sleepTime: string;
  /** Earliest time the auto-planner may place study blocks "HH:MM" (e.g. "08:00").
   *  Stops the planner from dumping blocks at wake-up; finer placement is still
   *  learned from real sessions. */
  studyStartTime: string;
  addSubject: (name: string) => Subject;
  renameSubject: (id: string, name: string) => void;
  archiveSubject: (id: string, archiviert: boolean) => void;
  setSubjectColor: (id: string, color: string) => void;
  setSubjectWeeklyHours: (id: string, stunden: number | undefined) => void;
  deleteSubject: (id: string) => void;
  addSession: (
    subjectId: string,
    date: string,
    durationMin: number,
    note?: string,
    extra?: { startedAtMs?: number; mood?: import("./types").MoodRating },
  ) => Session | null;
  deleteSession: (id: string) => void;
  /** Update the mood rating on an existing session — used by the post-save
   *  mood prompt so the user can rate AFTER the session is already persisted. */
  updateSessionMood: (id: string, mood: import("./types").MoodRating | undefined) => void;
  /** Update WHEN a session happened (date + startedAtMs). Used by the
   *  weekly-timeline drag — lets the user correct the time of a logged
   *  session so the productive-hours heatmap reflects reality. */
  updateSessionTime: (id: string, date: string, startedAtMs: number) => void;
  /** Update the free-text note on a session (e.g. "Was hast du gemacht?"). */
  updateSessionNote: (id: string, note: string | undefined) => void;
  setGoalMin: (min: number) => void;
  setGoalMinWeekend: (min: number) => void;
  setGoalForWeekday: (weekday: number, min: number) => void;
  setGoalsByWeekday: (arr: number[]) => void;
  setWeeklyGoalHours: (hours: number) => void;
  setGoalOverride: (iso: string, min: number) => void;
  clearGoalOverride: (iso: string) => void;
  /** Recorded goal changes, oldest first. Read-only — written by the provider
   *  whenever the targets change. */
  goalEpochs: GoalEpoch[];
  /** The minutes-goal that applies to `date`, resolved against the goal history.
   *  Use this instead of `goalMinForDate` whenever a PAST day is involved —
   *  it is the only path that keeps finished days frozen. */
  goalForDate: (date: Date) => number;
  setWakeTime: (hhmm: string) => void;
  setSleepTime: (hhmm: string) => void;
  setStudyStartTime: (hhmm: string) => void;

  // ── WeekPlan: study blocks placed on the hourly calendar ────────────────
  studyBlocks: StudyBlock[];
  /** Add a new block. Returns the created block (with generated id). */
  addStudyBlock: (block: Omit<StudyBlock, "id">) => StudyBlock;
  /** Update a block by id (partial patch). */
  updateStudyBlock: (id: string, patch: Partial<Omit<StudyBlock, "id">>) => void;
  /** Delete a block by id. */
  deleteStudyBlock: (id: string) => void;
  /** Replace ALL `source: "auto"` blocks for a given date with the supplied list.
   *  User blocks on that date are untouched. Used by the auto-replan algorithm. */
  replaceAutoBlocksForDate: (iso: string, blocks: Omit<StudyBlock, "id">[]) => void;
  /** Add a block for a calendar occurrence — but only if no block with the same
   *  `fromEventId` exists yet. The check happens inside the state updater so it
   *  is atomic (StrictMode double-invoke + rapid effects can't create dupes). */
  ensureEventBlock: (block: Omit<StudyBlock, "id"> & { fromEventId: string }) => void;
  /** Delete the block(s) materialized from a given calendar occurrence id. */
  removeEventBlock: (fromEventId: string) => void;
};

function deriveWeekdayGoals(weekday: number, weekend: number): number[] {
  // Sun, Mon..Fri, Sat
  return [weekend, weekday, weekday, weekday, weekday, weekday, weekend];
}

/** Returns the effective minutes-goal for the given date.
 *  Resolution order: date-specific override → the goals that were in force on
 *  that date (goal history) → current goalsByWeekday → legacy fallback.
 *
 *  Passing `epochs` is what keeps a finished day frozen: raising the weekly
 *  goal today must not retroactively fail days that already cleared the old
 *  one. Callers that only ever ask about today can leave it out — for today
 *  the newest epoch and the current settings are the same thing. */
export function goalMinForDate(
  date: Date,
  goalsByWeekday: number[],
  fallbackWeekday: number,
  fallbackWeekend: number,
  goalOverrides?: Record<string, number>,
  epochs?: GoalEpoch[],
): number {
  const iso = isoDate(date);
  // Date-specific override takes precedence
  if (goalOverrides && Object.prototype.hasOwnProperty.call(goalOverrides, iso)) {
    return goalOverrides[iso];
  }
  const wd = date.getDay();
  const historic = epochs && epochs.length > 0 ? goalsAt(epochs, iso) : null;
  const arr = historic ?? goalsByWeekday;
  if (Array.isArray(arr) && arr.length === 7) {
    return arr[wd] ?? (wd === 0 || wd === 6 ? fallbackWeekend || fallbackWeekday : fallbackWeekday);
  }
  return wd === 0 || wd === 6 ? (fallbackWeekend || fallbackWeekday) : fallbackWeekday;
}

const TrackerContext = createContext<TrackerStore | null>(null);

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>(() =>
    migrateSubjectColors(load(SUBJECTS_KEY, DEFAULT_SUBJECTS)),
  );
  const [sessions, setSessions] = useState<Session[]>(() =>
    load(SESSIONS_KEY, []),
  );
  const [goalMin, setGoalMin] = useState<number>(() => load(GOAL_KEY, 120));
  const [goalMinWeekend, setGoalMinWeekend] = useState<number>(() => load(GOAL_WEEKEND_KEY, 60));
  const [goalsByWeekday, setGoalsByWeekdayState] = useState<number[]>(loadGoalsByWeekday);
  const [weeklyGoalHours, setWeeklyGoalHoursState] = useState<number>(() => load(WEEKLY_GOAL_HOURS_KEY, 40));
  const [goalOverrides, setGoalOverridesState] = useState<Record<string, number>>(() => load(GOAL_OVERRIDES_KEY, {}));
  const [goalEpochs, setGoalEpochs] = useState<GoalEpoch[]>(() => loadGoalEpochs());
  const [wakeTime, setWakeTimeState] = useState<string>(() => load(WAKE_TIME_KEY, "06:30"));
  const [sleepTime, setSleepTimeState] = useState<string>(() => load(SLEEP_TIME_KEY, "22:30"));
  const [studyStartTime, setStudyStartTimeState] = useState<string>(() => load(STUDY_START_KEY, "08:00"));
  const [studyBlocks, setStudyBlocks] = useState<StudyBlock[]>(() => load(STUDY_BLOCKS_KEY, []));

  // Neu einlesen, wenn der Abgleich Serverwerte übernommen hat.
  //
  // WARUM
  // Bis 2026-10-27 las der Tracker seinen Stand nur beim Start. Der Abgleich
  // schrieb Sitzungen von einem anderen Gerät zwar in den localStorage, aber
  // ein seit dem Morgen offenes Fenster rechnete weiter mit seinen alten —
  // und schrieb daraus jede Minute einen Score mit 0 min Lernzeit (26.10.:
  // 367 min gelernt, Score 0). Speicherte so ein Fenster selbst eine Sitzung,
  // überschrieb es mit seiner alten Liste sogar die fremden Sitzungen.
  // `storage` deckt ein zweites Fenster im selben Browser ab.
  useEffect(() => {
    const neuLaden = () => {
      setSubjects((p) => gleichOderNeu(p, migrateSubjectColors(load(SUBJECTS_KEY, DEFAULT_SUBJECTS))));
      setSessions((p) => gleichOderNeu(p, load<Session[]>(SESSIONS_KEY, [])));
      setGoalMin((p) => gleichOderNeu(p, load(GOAL_KEY, 120)));
      setGoalMinWeekend((p) => gleichOderNeu(p, load(GOAL_WEEKEND_KEY, 60)));
      setGoalsByWeekdayState((p) => gleichOderNeu(p, loadGoalsByWeekday()));
      setWeeklyGoalHoursState((p) => gleichOderNeu(p, load(WEEKLY_GOAL_HOURS_KEY, 40)));
      setGoalOverridesState((p) => gleichOderNeu(p, load<Record<string, number>>(GOAL_OVERRIDES_KEY, {})));
      setGoalEpochs((p) => gleichOderNeu(p, loadGoalEpochs()));
      setWakeTimeState((p) => gleichOderNeu(p, load(WAKE_TIME_KEY, "06:30")));
      setSleepTimeState((p) => gleichOderNeu(p, load(SLEEP_TIME_KEY, "22:30")));
      setStudyStartTimeState((p) => gleichOderNeu(p, load(STUDY_START_KEY, "08:00")));
      setStudyBlocks((p) => gleichOderNeu(p, load<StudyBlock[]>(STUDY_BLOCKS_KEY, [])));
    };
    const vonAnderemFenster = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith("morning.tracker.")) neuLaden();
    };
    window.addEventListener(TRACKER_NEU_GELADEN, neuLaden);
    window.addEventListener("storage", vonAnderemFenster);
    return () => {
      window.removeEventListener(TRACKER_NEU_GELADEN, neuLaden);
      window.removeEventListener("storage", vonAnderemFenster);
    };
  }, []);

  useEffect(() => save(SUBJECTS_KEY, subjects), [subjects]);
  useEffect(() => save(SESSIONS_KEY, sessions), [sessions]);
  useEffect(() => save(GOAL_KEY, goalMin), [goalMin]);
  useEffect(() => save(GOAL_WEEKEND_KEY, goalMinWeekend), [goalMinWeekend]);
  useEffect(() => save(WEEKDAY_GOALS_KEY, goalsByWeekday), [goalsByWeekday]);
  useEffect(() => save(WEEKLY_GOAL_HOURS_KEY, weeklyGoalHours), [weeklyGoalHours]);
  useEffect(() => save(GOAL_OVERRIDES_KEY, goalOverrides), [goalOverrides]);

  // Goal history: every change to the weekly targets is stamped with the day it
  // was made, so days that are already over keep the goal they were measured
  // against. The very first run seeds one epoch reaching back to EPOCH_START —
  // we have no record of earlier settings, so the current ones are the honest
  // best guess for the past, and from here on nothing shifts under our feet.
  useEffect(() => {
    setGoalEpochs((prev) => {
      const goals = { goalsByWeekday, weeklyGoalHours };
      const next = prev.length === 0
        ? [{ from: EPOCH_START, ...goals }]
        : upsertEpoch(prev, isoDate(new Date()), goals);
      if (next === prev) return prev;
      saveGoalEpochs(next);
      return next;
    });
  }, [goalsByWeekday, weeklyGoalHours]);
  useEffect(() => save(WAKE_TIME_KEY, wakeTime), [wakeTime]);
  useEffect(() => save(SLEEP_TIME_KEY, sleepTime), [sleepTime]);
  useEffect(() => save(STUDY_START_KEY, studyStartTime), [studyStartTime]);
  useEffect(() => save(STUDY_BLOCKS_KEY, studyBlocks), [studyBlocks]);

  // One-time cleanup of legacy "shadow" blocks (older builds auto-created a
  // study block per timed session, duplicating the session overlay). Runs once
  // on load; idempotent if it runs again.
  useEffect(() => {
    setStudyBlocks((prev) => {
      const next = prev.filter((b) => !isShadowOfSession(b, sessions));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setWeeklyGoalHours = useCallback((hours: number) => {
    setWeeklyGoalHoursState(Math.max(0, hours));
  }, []);
  const setGoalOverride = useCallback((iso: string, min: number) => {
    setGoalOverridesState((prev) => ({ ...prev, [iso]: Math.max(0, Math.round(min)) }));
  }, []);
  const clearGoalOverride = useCallback((iso: string) => {
    setGoalOverridesState((prev) => {
      const next = { ...prev };
      delete next[iso];
      return next;
    });
  }, []);
  const setWakeTime = useCallback((hhmm: string) => {
    if (/^\d{1,2}:\d{2}$/.test(hhmm)) setWakeTimeState(hhmm);
  }, []);
  const setSleepTime = useCallback((hhmm: string) => {
    if (/^\d{1,2}:\d{2}$/.test(hhmm)) setSleepTimeState(hhmm);
  }, []);
  const setStudyStartTime = useCallback((hhmm: string) => {
    if (/^\d{1,2}:\d{2}$/.test(hhmm)) setStudyStartTimeState(hhmm);
  }, []);

  // Keep legacy weekday/weekend in sync with array (so AI prompt + dashboard helpers stay coherent).
  // Use Mon as the canonical "weekday" and Sun as canonical "weekend".
  const setGoalForWeekday = useCallback((weekday: number, min: number) => {
    setGoalsByWeekdayState((prev) => {
      const next = [...prev];
      next[weekday] = Math.max(0, Math.round(min));
      return next;
    });
    // Keep the Wochenplan calendar and the Lernzeit settings perfectly in sync:
    // a per-weekday edit supersedes any date-specific override that falls on
    // that weekday, so neither surface can shadow the other with a stale value.
    setGoalOverridesState((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [iso, v] of Object.entries(prev)) {
        const [y, m, d] = iso.split("-").map(Number);
        const wd = y && m && d ? new Date(y, m - 1, d).getDay() : -1;
        if (wd === weekday) { changed = true; continue; }
        next[iso] = v;
      }
      return changed ? next : prev;
    });
  }, []);
  const setGoalsByWeekday = useCallback((arr: number[]) => {
    if (arr.length !== 7) return;
    setGoalsByWeekdayState(arr.map((n) => Math.max(0, Math.round(n))));
    // A full-template reset (presets) clears all per-date overrides so the
    // calendar mirrors the settings exactly.
    setGoalOverridesState((prev) => (Object.keys(prev).length ? {} : prev));
  }, []);

  // Backward-compat: when user changes legacy weekday/weekend goal, propagate to array
  const handleSetGoalMin = useCallback((min: number) => {
    setGoalMin(min);
    setGoalsByWeekdayState((prev) => {
      const next = [...prev];
      // Mon..Fri only — weekend slots untouched
      for (let i = 1; i <= 5; i++) next[i] = min;
      return next;
    });
  }, []);
  const handleSetGoalMinWeekend = useCallback((min: number) => {
    setGoalMinWeekend(min);
    setGoalsByWeekdayState((prev) => {
      const next = [...prev];
      next[0] = min || prev[0]; // Sunday
      next[6] = min || prev[6]; // Saturday
      return next;
    });
  }, []);

  const addSubject = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      const color = pickNextColor(subjects.map((s) => s.color));
      const subject: Subject = { id: `s-${uid()}`, name: trimmed, color };
      setSubjects((prev) => [...prev, subject]);
      return subject;
    },
    [subjects],
  );

  const renameSubject = useCallback((id: string, name: string) => {
    setSubjects((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s)),
    );
  }, []);

  /** Fach stilllegen oder zurueckholen.
   *
   *  Das Gegenstueck zu `deleteSubject`, das die Sitzungen MITLOESCHT. Beim
   *  Semesterwechsel will man das fast nie: die Faecher sind vorbei, die
   *  Stunden nicht ungeschehen. Archivieren nimmt sie nur aus der Auswahl. */
  const archiveSubject = useCallback((id: string, archiviert: boolean) => {
    setSubjects((prev) =>
      prev.map((s) => (s.id === id ? { ...s, archiviert } : s)),
    );
  }, []);

  /** Feste Wochenstunden für ein Fach ohne Klausurplan — leer = keine. */
  const setSubjectWeeklyHours = useCallback((id: string, stunden: number | undefined) => {
    setSubjects((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        if (stunden && stunden > 0) next.stundenProWoche = Math.min(60, Math.round(stunden * 2) / 2);
        else delete next.stundenProWoche;
        return next;
      }),
    );
  }, []);

  const setSubjectColor = useCallback((id: string, color: string) => {
    setSubjects((prev) =>
      prev.map((s) => (s.id === id ? { ...s, color } : s)),
    );
  }, []);

  const deleteSubject = useCallback((id: string) => {
    setSubjects((prev) => prev.filter((s) => s.id !== id));
    setSessions((prev) => prev.filter((s) => s.subjectId !== id));
  }, []);

  const addSession = useCallback(
    (
      subjectId: string,
      date: string,
      durationMin: number,
      note?: string,
      extra?: { startedAtMs?: number; mood?: import("./types").MoodRating },
    ): Session | null => {
      if (durationMin <= 0) return null;
      const session: Session = {
        id: `r-${uid()}`,
        subjectId,
        date,
        durationMin,
        note: note?.trim() || undefined,
        ...(extra?.startedAtMs ? { startedAtMs: extra.startedAtMs } : {}),
        ...(extra?.mood ? { mood: extra.mood } : {}),
      };
      setSessions((prev) => [session, ...prev]);
      // A timed session already renders on the Stundenplan via the session
      // overlay (the ✓ block at its real start time). We deliberately do NOT
      // also create a study block here — that produced a duplicate entry
      // (solid block + ✓-overlay at the same slot).
      return session;
    },
    [],
  );

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const updateSessionMood = useCallback(
    (id: string, mood: import("./types").MoodRating | undefined) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          if (mood) return { ...s, mood };
          // Remove the mood field entirely if undefined
          const { mood: _omit, ...rest } = s;
          void _omit;
          return rest as Session;
        }),
      );
    },
    [],
  );

  const updateSessionNote = useCallback((id: string, note: string | undefined) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const trimmed = (note ?? "").trim();
        if (trimmed) return { ...s, note: trimmed };
        const { note: _omit, ...rest } = s;
        void _omit;
        return rest as Session;
      }),
    );
  }, []);

  const updateSessionTime = useCallback((id: string, date: string, startedAtMs: number) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, date, startedAtMs } : s)),
    );
  }, []);

  // ── WeekPlan CRUD ──────────────────────────────────────────────────────
  const addStudyBlock = useCallback((block: Omit<StudyBlock, "id">): StudyBlock => {
    const full: StudyBlock = { id: `b-${uid()}`, ...block };
    setStudyBlocks((prev) => [...prev, full]);
    return full;
  }, []);

  const updateStudyBlock = useCallback(
    (id: string, patch: Partial<Omit<StudyBlock, "id">>) => {
      setStudyBlocks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      );
    },
    [],
  );

  const deleteStudyBlock = useCallback((id: string) => {
    setStudyBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const replaceAutoBlocksForDate = useCallback(
    (iso: string, blocks: Omit<StudyBlock, "id">[]) => {
      setStudyBlocks((prev) => {
        // Drop existing AUTO blocks for that day (user blocks stay)
        const kept = prev.filter((b) => !(b.date === iso && b.source === "auto"));
        const fresh = blocks.map((b) => ({ id: `b-${uid()}`, ...b }));
        return [...kept, ...fresh];
      });
    },
    [],
  );

  const ensureEventBlock = useCallback(
    (block: Omit<StudyBlock, "id"> & { fromEventId: string }) => {
      setStudyBlocks((prev) => {
        if (prev.some((b) => b.fromEventId === block.fromEventId)) return prev; // already there
        return [...prev, { id: `b-${uid()}`, ...block }];
      });
    },
    [],
  );

  const removeEventBlock = useCallback((fromEventId: string) => {
    setStudyBlocks((prev) => {
      const next = prev.filter((b) => b.fromEventId !== fromEventId);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  const goalForDate = useCallback(
    (date: Date) =>
      goalMinForDate(date, goalsByWeekday, goalMin, goalMinWeekend, goalOverrides, goalEpochs),
    [goalsByWeekday, goalMin, goalMinWeekend, goalOverrides, goalEpochs],
  );

  const value = useMemo<TrackerStore>(
    () => ({
      subjects,
      sessions,
      goalMin,
      goalMinWeekend,
      goalsByWeekday,
      weeklyGoalHours,
      goalOverrides,
      goalEpochs,
      goalForDate,
      wakeTime,
      sleepTime,
      studyStartTime,
      addSubject,
      renameSubject,
      archiveSubject,
      setSubjectColor,
      setSubjectWeeklyHours,
      deleteSubject,
      addSession,
      deleteSession,
      updateSessionMood,
      updateSessionTime,
      updateSessionNote,
      setGoalMin: handleSetGoalMin,
      setGoalMinWeekend: handleSetGoalMinWeekend,
      setGoalForWeekday,
      setGoalsByWeekday,
      setWeeklyGoalHours,
      setGoalOverride,
      clearGoalOverride,
      setWakeTime,
      setSleepTime,
      setStudyStartTime,
      studyBlocks,
      addStudyBlock,
      updateStudyBlock,
      deleteStudyBlock,
      replaceAutoBlocksForDate,
      ensureEventBlock,
      removeEventBlock,
    }),
    [
      subjects,
      sessions,
      goalMin,
      goalMinWeekend,
      goalsByWeekday,
      weeklyGoalHours,
      goalOverrides,
      goalEpochs,
      goalForDate,
      wakeTime,
      sleepTime,
      studyStartTime,
      studyBlocks,
      addStudyBlock,
      updateStudyBlock,
      deleteStudyBlock,
      replaceAutoBlocksForDate,
      ensureEventBlock,
      removeEventBlock,
      addSubject,
      renameSubject,
      archiveSubject,
      setSubjectColor,
      setSubjectWeeklyHours,
      deleteSubject,
      addSession,
      deleteSession,
      updateSessionMood,
      updateSessionTime,
      updateSessionNote,
      handleSetGoalMin,
      handleSetGoalMinWeekend,
      setGoalForWeekday,
      setGoalsByWeekday,
      setWeeklyGoalHours,
      setGoalOverride,
      clearGoalOverride,
      setWakeTime,
      setSleepTime,
      setStudyStartTime,
    ],
  );

  return (
    <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
  );
}

export function useTracker(): TrackerStore {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useTracker must be used inside <TrackerProvider>");
  return ctx;
}

export function totalsByDate(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    m.set(s.date, (m.get(s.date) ?? 0) + s.durationMin);
  }
  return m;
}

export function totalsBySubjectInRange(
  sessions: Session[],
  fromIso: string,
  toIso: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    if (s.date < fromIso || s.date > toIso) continue;
    m.set(s.subjectId, (m.get(s.subjectId) ?? 0) + s.durationMin);
  }
  return m;
}

/** Consecutive days whose goal was met, counting back from today.
 *
 *  Takes a resolver rather than raw goal numbers so each day is judged against
 *  the goal that was in force ON that day (see `goalForDate` / goalHistory).
 *  Otherwise raising the weekly target would retroactively break a streak that
 *  was honestly earned. */
export function streakDays(
  sessions: Session[],
  goalForDate: (date: Date) => number,
): number {
  // Build per-day totals
  const byDate = new Map<string, number>();
  for (const s of sessions) {
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.durationMin);
  }
  // A day with no goal at all counts as soon as anything was logged.
  const effectiveGoal = (d: Date) => Math.max(1, goalForDate(d));

  let count = 0;
  const cur = new Date();

  // If today's goal not yet met, start from yesterday
  const todayMin = byDate.get(isoDate(cur)) ?? 0;
  if (todayMin < effectiveGoal(cur)) {
    cur.setDate(cur.getDate() - 1);
  }

  while (true) {
    const iso = isoDate(cur);
    const dayMin = byDate.get(iso) ?? 0;
    if (dayMin < effectiveGoal(cur)) break;
    count++;
    cur.setDate(cur.getDate() - 1);
  }
  return count;
}
