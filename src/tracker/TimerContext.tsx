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
import { isoDate, useTracker } from "./store";
import { playChime } from "../lib/sound";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FocusMode = "focus" | "shortBreak" | "longBreak";

export const FOCUS_PRESETS: Record<FocusMode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

export type FocusTimer = {
  kind: "focus";
  mode: FocusMode;
  duration: number;
  baseRemaining: number;
  startedAt: number | null;
  subjectId: string;
  pomodoroCount: number;
  /** Wall-clock ms timestamp captured on the FIRST ▶ Start of this session.
   *  Kept across pause/resume so the persisted session knows when learning
   *  actually began (drives the productive-hours heatmap). */
  sessionStartedAtMs?: number;
  /** Self-rated mood at session start (optional). */
  mood?: import("./types").MoodRating;
};

export type StopwatchTimer = {
  kind: "stopwatch";
  baseElapsedMs: number;
  startedAt: number | null;
  subjectId: string;
  note: string;
  /** First-start timestamp — same purpose as on FocusTimer. */
  sessionStartedAtMs?: number;
  mood?: import("./types").MoodRating;
};

export type ActiveTimer = FocusTimer | StopwatchTimer;

// ── Context value ─────────────────────────────────────────────────────────────

export type SavedSession = {
  sessionId: string;        // id of the persisted session — used for mood update + undo
  subjectId: string;
  durationMin: number;
  at: number;               // timestamp — used as React key to retrigger animation
  mood?: import("./types").MoodRating;
  note?: string;            // "Was hast du gemacht?" free-text
};

/** @deprecated retained as a type alias for older imports — the in-app save
 *  flow now persists sessions instantly and prompts for mood via the toast. */
export type PendingSave = {
  kind: "focus" | "stopwatch" | "manual";
  subjectId: string;
  date: string;
  durationMin: number;
  trigger: "auto" | "manual";
  at: number;
  sessionStartedAtMs?: number;
  note?: string;
  initialMood?: import("./types").MoodRating;
};

/** @deprecated kept only so existing type imports keep compiling. */
export type PendingFocusSave = PendingSave;

export type TimerCtx = {
  // Separate timers — both can run simultaneously
  focusTimer: FocusTimer | null;
  stopwatch: StopwatchTimer | null;

  // Legacy compat: focusTimer ?? stopwatch
  timer: ActiveTimer | null;

  remainingSec: number;
  elapsedMs: number;
  isFocusRunning: boolean;
  isStopwatchRunning: boolean;
  isRunning: boolean; // either running

  /** Set briefly after any session save — drives the interactive "Gespeichert"
   *  toast which also serves as the mood prompt + undo target. */
  lastSaved: SavedSession | null;

  /** Attach (or change) a mood rating on the most-recently-saved session. */
  setLastSavedMood: (mood: import("./types").MoodRating | undefined) => void;
  /** Save the free-text "Was hast du gemacht?" note on the last-saved session. */
  setLastSavedNote: (note: string) => void;
  /** Pause/resume the toast's auto-dismiss (while the user types the note). */
  holdLastSaved: (hold: boolean) => void;
  /** Undo the most-recent save — deletes the session and clears the toast. */
  undoLastSaved: () => void;
  /** Dismiss the toast without taking action. */
  dismissLastSaved: () => void;
  /** Persist a manual entry immediately + open the mood toast. */
  requestManualSave: (
    subjectId: string,
    date: string,
    durationMin: number,
    note?: string,
    extras?: { startedAtMs?: number; category?: import("./types").BlockCategory },
  ) => void;

  // ── Back-compat stubs (deprecated) ──────────────────────────────────────
  /** @deprecated no longer used — kept as null for any stale callers. */
  pendingSave: null;
  /** @deprecated no longer used. */
  pendingFocusSave: null;
  /** @deprecated no-op kept for back-compat. */
  confirmFocusSave: () => void;
  /** @deprecated no-op kept for back-compat. */
  dismissFocusSave: () => void;
  /** @deprecated no-op kept for back-compat. */
  confirmPendingSave: (mood?: import("./types").MoodRating) => void;
  /** @deprecated no-op kept for back-compat. */
  dismissPendingSave: () => void;

  // Focus
  startFocus: (subjectId: string, mode: FocusMode, durationSec: number) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  resetFocus: (mode?: FocusMode, customSec?: number) => void;
  stopFocus: () => void;
  discardFocus: () => void;
  setFocusMode: (mode: FocusMode, customSec?: number) => void;
  setFocusSubject: (id: string) => void;
  setFocusMood: (mood: import("./types").MoodRating | undefined) => void;

  // Stopwatch
  startStopwatch: (subjectId: string, note: string) => void;
  pauseStopwatch: () => void;
  resumeStopwatch: () => void;
  saveStopwatch: () => void;
  resetStopwatch: () => void;
  setStopwatchNote: (note: string) => void;
  setStopwatchSubject: (id: string) => void;
  setStopwatchMood: (mood: import("./types").MoodRating | undefined) => void;
};

// ── Persistence: a running timer survives reloads and app restarts ───────────
// Both timers are wall-clock based (startedAt timestamp + Date.now() math), so
// restoring the serialized state is enough to "keep running" — time that passed
// while the app was closed is counted automatically. A focus timer that expired
// while away completes on next launch (session saved via the auto-complete
// effect, exactly as if the app had stayed open).
const TIMER_KEY = "morning.activeTimers";

function loadPersistedTimer<T extends ActiveTimer>(kind: T["kind"]): T | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const t = parsed[kind] as T | null | undefined;
    if (!t || typeof t !== "object" || t.kind !== kind) return null;
    const valid =
      kind === "focus"
        ? typeof (t as FocusTimer).duration === "number" &&
          typeof (t as FocusTimer).baseRemaining === "number"
        : typeof (t as StopwatchTimer).baseElapsedMs === "number";
    return valid ? t : null;
  } catch {
    return null;
  }
}

const TimerContext = createContext<TimerCtx | null>(null);

export function useTimerContext(): TimerCtx {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error("useTimerContext must be inside <TimerProvider>");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function TimerProvider({ children }: { children: ReactNode }) {
  const { addSession, deleteSession, updateSessionMood, updateSessionNote, addStudyBlock } = useTracker();

  // ── Independent timer states (hydrated from the last session, see above) ──
  const [focusTimer, setFocusTimer] = useState<FocusTimer | null>(() =>
    loadPersistedTimer<FocusTimer>("focus"),
  );
  const [stopwatch, setStopwatch] = useState<StopwatchTimer | null>(() =>
    loadPersistedTimer<StopwatchTimer>("stopwatch"),
  );

  // Mirror every timer change to localStorage. Ticks don't touch these objects
  // (remaining/elapsed are derived), so this only writes on start/pause/stop.
  useEffect(() => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify({ focus: focusTimer, stopwatch }));
    } catch { /* quota */ }
  }, [focusTimer, stopwatch]);
  const [lastSaved, setLastSaved] = useState<SavedSession | null>(null);
  const [toastHeld, setToastHeld] = useState(false);

  // Auto-clear lastSaved after the toast lifetime. 30 s gives the user enough
  // time to notice the prompt, rate focus and optionally undo. Paused (toastHeld)
  // while typing the "Was hast du gemacht?" note so the toast doesn't vanish.
  useEffect(() => {
    if (!lastSaved || toastHeld) return;
    const id = setTimeout(() => setLastSaved(null), 30_000);
    return () => clearTimeout(id);
  }, [lastSaved, toastHeld]);

  // Refs kept in sync so callbacks can read current state without stale closures
  // and without calling addSession inside a state updater (would double-fire in StrictMode)
  const focusTimerRef = useRef(focusTimer);
  const stopwatchRef = useRef(stopwatch);
  const lastSavedRef = useRef(lastSaved);
  useEffect(() => { focusTimerRef.current = focusTimer; }, [focusTimer]);
  useEffect(() => { stopwatchRef.current = stopwatch; }, [stopwatch]);
  useEffect(() => { lastSavedRef.current = lastSaved; }, [lastSaved]);

  const isFocusRunning = focusTimer !== null && focusTimer.startedAt !== null;
  const isStopwatchRunning = stopwatch !== null && stopwatch.startedAt !== null;
  const isRunning = isFocusRunning || isStopwatchRunning;

  // ── Independent tick intervals ─────────────────────────────────────────────
  const [focusTick, setFocusTick] = useState(0);
  const [swTick, setSwTick] = useState(0);

  useEffect(() => {
    if (!isFocusRunning) return;
    const id = setInterval(() => setFocusTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [isFocusRunning]);

  useEffect(() => {
    if (!isStopwatchRunning) return;
    const id = setInterval(() => setSwTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [isStopwatchRunning]);

  // ── Derived live values ───────────────────────────────────────────────────
  const remainingSec = useMemo(() => {
    if (!focusTimer) return 0;
    if (!focusTimer.startedAt) return focusTimer.baseRemaining;
    return Math.max(
      0,
      focusTimer.baseRemaining - (Date.now() - focusTimer.startedAt) / 1000,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTimer, focusTick]);

  const elapsedMs = useMemo(() => {
    if (!stopwatch) return 0;
    if (!stopwatch.startedAt) return stopwatch.baseElapsedMs;
    return stopwatch.baseElapsedMs + (Date.now() - stopwatch.startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopwatch, swTick]);

  // ── Auto-complete focus session when remaining hits 0 ─────────────────────
  // No more automatic break mode — instead we open the SaveConfirmDialog and
  // wait for the user to confirm or discard. After either action the timer
  // is cleared completely (no follow-up break).
  const autoCompletedRef = useRef(false);

  useEffect(() => {
    if (!focusTimer || !focusTimer.startedAt || remainingSec > 0) {
      if (focusTimer?.startedAt && remainingSec > 0) {
        autoCompletedRef.current = false;
      }
      return;
    }
    if (autoCompletedRef.current) return;
    autoCompletedRef.current = true;

    playChime();

    // Save instantly — no confirmation. The interactive toast lets the user
    // attach a mood or undo afterwards. Breaks finish silently.
    if (focusTimer.mode === "focus" && focusTimer.subjectId) {
      const mins = Math.round(focusTimer.duration / 60);
      const saved = addSession(focusTimer.subjectId, isoDate(), mins, undefined, {
        startedAtMs: focusTimer.sessionStartedAtMs,
        mood: focusTimer.mood,
      });
      if (saved) {
        setLastSaved({
          sessionId: saved.id,
          subjectId: saved.subjectId,
          durationMin: saved.durationMin,
          at: Date.now(),
          mood: saved.mood,
        });
      }
    }
    setFocusTimer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec]);

  // ── Single-timer rule helpers ─────────────────────────────────────────────
  // Auto-save a running stopwatch (≥1 min) before launching the focus timer,
  // so no work is lost when switching modes.
  const autoSaveStopwatchIfRunning = useCallback(() => {
    const sw = stopwatchRef.current;
    if (!sw) return;
    const elapsed = sw.startedAt
      ? sw.baseElapsedMs + (Date.now() - sw.startedAt)
      : sw.baseElapsedMs;
    const minutes = Math.round(elapsed / 60000);
    if (sw.subjectId && minutes >= 1) {
      const saved = addSession(sw.subjectId, isoDate(), minutes, sw.note || undefined, {
        startedAtMs: sw.sessionStartedAtMs,
        mood: sw.mood,
      });
      if (saved) {
        setLastSaved({
          sessionId: saved.id,
          subjectId: saved.subjectId,
          durationMin: saved.durationMin,
          at: Date.now(),
          mood: saved.mood,
        });
      }
    }
    setStopwatch(null);
  }, [addSession]);

  // Auto-save a running focus session (≥1 min studied) before launching the stopwatch.
  const autoSaveFocusIfRunning = useCallback(() => {
    const prev = focusTimerRef.current;
    if (!prev) return;
    if (prev.mode === "focus" && prev.subjectId) {
      const rawRemaining = prev.startedAt
        ? Math.max(0, prev.baseRemaining - (Date.now() - prev.startedAt) / 1000)
        : prev.baseRemaining;
      const elapsedSec = prev.duration - rawRemaining;
      const minutes = Math.round(elapsedSec / 60);
      if (minutes >= 1) {
        const saved = addSession(prev.subjectId, isoDate(), minutes, undefined, {
          startedAtMs: prev.sessionStartedAtMs,
          mood: prev.mood,
        });
        if (saved) {
          setLastSaved({
            sessionId: saved.id,
            subjectId: saved.subjectId,
            durationMin: saved.durationMin,
            at: Date.now(),
            mood: saved.mood,
          });
        }
      }
    }
    setFocusTimer(null);
  }, [addSession]);

  // ── Focus actions ─────────────────────────────────────────────────────────

  const startFocus = useCallback(
    (subjectId: string, mode: FocusMode, durationSec: number) => {
      // Single-timer rule: stop+save stopwatch first if running
      autoSaveStopwatchIfRunning();
      const now = Date.now();
      setFocusTimer((prev) => {
        if (prev?.startedAt === null && prev) {
          // Resume of an existing (paused) timer — keep its sessionStartedAtMs.
          // Also update subjectId in case setFocusMode() created the timer with ""
          // (happens when user picks a duration before selecting a subject).
          return {
            ...prev,
            startedAt: now,
            subjectId: subjectId || prev.subjectId,
            sessionStartedAtMs: prev.sessionStartedAtMs ?? now,
          };
        }
        return {
          kind: "focus",
          mode,
          duration: durationSec,
          baseRemaining: durationSec,
          startedAt: now,
          subjectId,
          pomodoroCount: 0,
          sessionStartedAtMs: now,
        };
      });
    },
    [autoSaveStopwatchIfRunning],
  );

  const pauseFocus = useCallback(() => {
    setFocusTimer((prev) => {
      if (!prev || !prev.startedAt) return prev;
      const elapsed = (Date.now() - prev.startedAt) / 1000;
      return {
        ...prev,
        baseRemaining: Math.max(0, prev.baseRemaining - elapsed),
        startedAt: null,
      };
    });
  }, []);

  const resumeFocus = useCallback(() => {
    // Single-timer rule: stop+save stopwatch first if it's running
    autoSaveStopwatchIfRunning();
    setFocusTimer((prev) => {
      if (!prev || prev.startedAt !== null) return prev;
      return { ...prev, startedAt: Date.now() };
    });
  }, [autoSaveStopwatchIfRunning]);

  const resetFocus = useCallback((mode?: FocusMode, customSec?: number) => {
    setFocusTimer((prev) => {
      if (!prev) return prev;
      const m = mode ?? prev.mode;
      const dur = customSec ?? FOCUS_PRESETS[m];
      return { ...prev, mode: m, duration: dur, baseRemaining: dur, startedAt: null };
    });
  }, []);

  const setFocusMode = useCallback((mode: FocusMode, customSec?: number) => {
    const dur = customSec ?? FOCUS_PRESETS[mode];
    setFocusTimer((prev) => {
      if (prev) return { ...prev, mode, duration: dur, baseRemaining: dur, startedAt: null };
      return {
        kind: "focus",
        mode,
        duration: dur,
        baseRemaining: dur,
        startedAt: null,
        subjectId: "",
        pomodoroCount: 0,
      };
    });
  }, []);

  const stopFocus = useCallback(() => {
    const prev = focusTimerRef.current;
    if (!prev) return;
    if (prev.mode === "focus" && prev.subjectId) {
      // Compute elapsed time right now
      const rawRemaining = prev.startedAt
        ? Math.max(0, prev.baseRemaining - (Date.now() - prev.startedAt) / 1000)
        : prev.baseRemaining;
      const elapsedSec = Math.max(0, prev.duration - rawRemaining);
      // Save instantly if any time elapsed — the toast that follows lets the
      // user rate their mood or hit "Rückgängig" to discard.
      if (elapsedSec >= 1) {
        const minutes = Math.max(1, Math.round(elapsedSec / 60));
        const saved = addSession(prev.subjectId, isoDate(), minutes, undefined, {
          startedAtMs: prev.sessionStartedAtMs,
          mood: prev.mood,
        });
        if (saved) {
          setLastSaved({
            sessionId: saved.id,
            subjectId: saved.subjectId,
            durationMin: saved.durationMin,
            at: Date.now(),
            mood: saved.mood,
          });
        }
      }
    }
    // Always clear the timer after a manual save click — no half-state.
    setFocusTimer(null);
  }, [addSession]);

  const discardFocus = useCallback(() => {
    setFocusTimer(null);
  }, []);

  // ── Mood / undo actions on the most-recent save ──────────────────────────
  const setLastSavedMood = useCallback((mood: import("./types").MoodRating | undefined) => {
    const prev = lastSavedRef.current;
    if (!prev) return;
    updateSessionMood(prev.sessionId, mood); // side effect once, outside the updater
    setLastSaved((s) => (s ? { ...s, mood } : s));
  }, [updateSessionMood]);

  const setLastSavedNote = useCallback((note: string) => {
    const prev = lastSavedRef.current;
    if (!prev) return;
    updateSessionNote(prev.sessionId, note);
    setLastSaved((s) => (s ? { ...s, note } : s));
  }, [updateSessionNote]);

  const holdLastSaved = useCallback((hold: boolean) => setToastHeld(hold), []);

  const undoLastSaved = useCallback(() => {
    const prev = lastSavedRef.current;
    if (!prev) return;
    deleteSession(prev.sessionId); // side effect once, outside the updater
    setLastSaved(null);
  }, [deleteSession]);

  const dismissLastSaved = useCallback(() => setLastSaved(null), []);

  const requestManualSave = useCallback(
    (
      subjectId: string,
      date: string,
      durationMin: number,
      note?: string,
      extras?: { startedAtMs?: number; category?: import("./types").BlockCategory },
    ) => {
      if (durationMin <= 0) return;
      const mins = Math.max(1, Math.round(durationMin));
      const category = extras?.category ?? "lern";

      // Non-study entries (Sport, Privat etc.) don't belong in sessions — they
      // become user-placed study blocks so they show up on the calendar.
      if (category !== "lern") {
        if (!extras?.startedAtMs) return; // need a start time to position the block
        const d = new Date(extras.startedAtMs);
        const startMin = d.getHours() * 60 + d.getMinutes();
        addStudyBlock({
          date,
          startMin,
          durationMin: mins,
          source: "user",
          category,
          note: note?.trim() || undefined,
        });
        // Toast: re-use lastSaved with a synthetic id so the user gets feedback
        setLastSaved({
          sessionId: "block-" + Date.now().toString(36),
          subjectId: "",
          durationMin: mins,
          at: Date.now(),
        });
        return;
      }

      // Study session — needs a subject
      if (!subjectId) return;
      const saved = addSession(subjectId, date, mins, note, {
        startedAtMs: extras?.startedAtMs,
      });
      if (saved) {
        setLastSaved({
          sessionId: saved.id,
          subjectId: saved.subjectId,
          durationMin: saved.durationMin,
          at: Date.now(),
          mood: saved.mood,
        });
      }
    },
    [addSession, addStudyBlock],
  );

  // ── Deprecated stubs (preserved so any stale import still type-checks) ───
  const confirmPendingSave = useCallback((_mood?: import("./types").MoodRating) => { void _mood; }, []);
  const dismissPendingSave = useCallback(() => {}, []);

  const setFocusSubject = useCallback((id: string) => {
    setFocusTimer((prev) => prev ? { ...prev, subjectId: id } : prev);
  }, []);

  const setFocusMood = useCallback((mood: import("./types").MoodRating | undefined) => {
    setFocusTimer((prev) => prev ? { ...prev, mood } : prev);
  }, []);

  // ── Stopwatch actions ─────────────────────────────────────────────────────

  const startStopwatch = useCallback((subjectId: string, note: string) => {
    autoSaveFocusIfRunning();
    const now = Date.now();
    setStopwatch((prev) => {
      if (prev && prev.startedAt === null) {
        return { ...prev, startedAt: now, sessionStartedAtMs: prev.sessionStartedAtMs ?? now };
      }
      return {
        kind: "stopwatch",
        baseElapsedMs: 0,
        startedAt: now,
        subjectId,
        note,
        sessionStartedAtMs: now,
      };
    });
  }, [autoSaveFocusIfRunning]);

  const pauseStopwatch = useCallback(() => {
    setStopwatch((prev) => {
      if (!prev || !prev.startedAt) return prev;
      return {
        ...prev,
        baseElapsedMs: prev.baseElapsedMs + (Date.now() - prev.startedAt),
        startedAt: null,
      };
    });
  }, []);

  const resumeStopwatch = useCallback(() => {
    // Single-timer rule: stop+save focus first if it's running
    autoSaveFocusIfRunning();
    setStopwatch((prev) => {
      if (!prev || prev.startedAt !== null) return prev;
      return { ...prev, startedAt: Date.now() };
    });
  }, [autoSaveFocusIfRunning]);

  const saveStopwatch = useCallback(() => {
    const prev = stopwatchRef.current;
    if (!prev || !prev.subjectId) return;
    const elapsed = prev.startedAt
      ? prev.baseElapsedMs + (Date.now() - prev.startedAt)
      : prev.baseElapsedMs;
    const minutes = Math.max(1, Math.round(elapsed / 60000));
    // Save instantly. The toast lets the user pick mood / hit Rückgängig
    // afterward — no confirm step in the middle.
    const saved = addSession(prev.subjectId, isoDate(), minutes, prev.note || undefined, {
      startedAtMs: prev.sessionStartedAtMs,
      mood: prev.mood,
    });
    if (saved) {
      setLastSaved({
        sessionId: saved.id,
        subjectId: saved.subjectId,
        durationMin: saved.durationMin,
        at: Date.now(),
        mood: saved.mood,
      });
    }
    setStopwatch(null);
  }, [addSession]);

  const resetStopwatch = useCallback(() => setStopwatch(null), []);

  const setStopwatchNote = useCallback((note: string) => {
    setStopwatch((prev) => prev ? { ...prev, note } : prev);
  }, []);

  const setStopwatchSubject = useCallback((id: string) => {
    setStopwatch((prev) => prev ? { ...prev, subjectId: id } : prev);
  }, []);

  const setStopwatchMood = useCallback((mood: import("./types").MoodRating | undefined) => {
    setStopwatch((prev) => prev ? { ...prev, mood } : prev);
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────

  // Legacy compat: expose `timer` as the most relevant active timer
  const timer: ActiveTimer | null = focusTimer ?? stopwatch;

  const value = useMemo<TimerCtx>(
    () => ({
      focusTimer,
      stopwatch,
      timer,
      remainingSec,
      elapsedMs,
      isFocusRunning,
      isStopwatchRunning,
      isRunning,
      lastSaved,
      setLastSavedMood,
      setLastSavedNote,
      holdLastSaved,
      undoLastSaved,
      dismissLastSaved,
      requestManualSave,
      // deprecated/back-compat stubs:
      pendingSave: null,
      pendingFocusSave: null,
      confirmPendingSave,
      dismissPendingSave,
      confirmFocusSave: () => {},
      dismissFocusSave: () => {},
      startFocus,
      pauseFocus,
      resumeFocus,
      resetFocus,
      stopFocus,
      discardFocus,
      setFocusMode,
      setFocusSubject,
      setFocusMood,
      startStopwatch,
      pauseStopwatch,
      resumeStopwatch,
      saveStopwatch,
      resetStopwatch,
      setStopwatchNote,
      setStopwatchSubject,
      setStopwatchMood,
    }),
    [
      focusTimer, stopwatch, timer, remainingSec, elapsedMs,
      isFocusRunning, isStopwatchRunning, isRunning, lastSaved,
      setLastSavedMood, setLastSavedNote, holdLastSaved, undoLastSaved, dismissLastSaved, requestManualSave, toastHeld,
      confirmPendingSave, dismissPendingSave,
      startFocus, pauseFocus, resumeFocus, resetFocus, stopFocus,
      discardFocus, setFocusMode, setFocusSubject, setFocusMood,
      startStopwatch, pauseStopwatch, resumeStopwatch, saveStopwatch,
      resetStopwatch, setStopwatchNote, setStopwatchSubject, setStopwatchMood,
    ],
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}
