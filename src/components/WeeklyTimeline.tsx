import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CalendarEvent } from "../types";
import type { BlockCategory, Session, StudyBlock } from "../tracker/types";
import { isoDate, useTracker } from "../tracker/store";
import {
  hideCalendarEvent,
  clearHiddenCalendarEvents,
  useHiddenEventIds,
  uidPrefix,
} from "../lib/hiddenEvents";
import { calColor } from "../lib/calendarTags";
import { CATEGORY_META, CATEGORY_ORDER } from "../lib/categories";
import { verdraengteTermine, type Terminartig } from "../lib/studyOverlap";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLOT_PX = 22;          // pixels per 30-min slot
const SLOT_MIN = 30;          // slot granularity (minutes)
const HOUR_COL_PX = 56;       // hour-label column width
const RESIZE_HANDLE_PX = 6;   // height of the top/bottom resize grab areas

// ── Category palette (design-system aligned) ──────────────────────────────────

type CategoryDef = { id: BlockCategory; label: string; color: string; emoji: string };

const CATEGORIES: CategoryDef[] = CATEGORY_ORDER.map((id) => ({ id, ...CATEGORY_META[id] }));
const categoryOf = (b: StudyBlock): CategoryDef =>
  CATEGORIES.find((c) => c.id === (b.category ?? "lern")) ?? CATEGORIES[0];

// ── Move-history persistence (Jarvis learning) ────────────────────────────────
// Records every time a user moves an AUTO block to a different slot. We use it
// to bias future auto-placements toward the user's revealed preference.

const MOVE_HISTORY_KEY = "morning.weekPlan.moveHistory";
type MoveEvent = { weekday: number; fromMin: number; toMin: number; ts: number };
function loadMoveHistory(): MoveEvent[] {
  try {
    const raw = localStorage.getItem(MOVE_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as MoveEvent[]) : [];
  } catch { return []; }
}
function pushMoveEvent(ev: MoveEvent) {
  try {
    const hist = loadMoveHistory();
    hist.push(ev);
    // Cap at 200 most recent
    const trimmed = hist.slice(-200);
    localStorage.setItem(MOVE_HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hhmmToMin(hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return fallback;
  return Math.max(0, Math.min(24 * 60, parseInt(m[1], 10) * 60 + parseInt(m[2], 10)));
}
const minToHHMM = (min: number): string =>
  `${Math.floor(min / 60).toString().padStart(2, "0")}:${(min % 60).toString().padStart(2, "0")}`;
const snapTo30 = (min: number): number => Math.round(min / SLOT_MIN) * SLOT_MIN;
const eventStartMin = (e: CalendarEvent): number => {
  const d = new Date(e.start);
  return d.getHours() * 60 + d.getMinutes();
};
const eventEndMin = (e: CalendarEvent, startMin: number): number => {
  if (!e.end) return Math.min(24 * 60, startMin + 60);
  const d = new Date(e.end);
  return d.getHours() * 60 + d.getMinutes();
};
const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};
function dayHeader(d: Date, isToday: boolean) {
  const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
  return { wd, date: `${d.getDate()}.${d.getMonth() + 1}`, isToday };
}

// ── Productive-hours signal ───────────────────────────────────────────────────
// grid[weekday Mo=0..So=6][hour 0..23] = total minutes ever studied in that slot.

function buildProductivityGrid(sessions: Session[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of sessions) {
    if (!s.startedAtMs) continue;
    const d = new Date(s.startedAtMs);
    const weekday = (d.getDay() + 6) % 7; // 0=Mo..6=So
    const hour = d.getHours();
    grid[weekday][hour] += s.durationMin;
  }
  return grid;
}

// Returns 0..1 — relative productivity score for (weekday, startMin..endMin).
function productivityScore(
  grid: number[][],
  weekdayMo0: number,
  startMin: number,
  endMin: number,
): number {
  const startH = Math.floor(startMin / 60);
  const endH = Math.ceil(endMin / 60);
  let sum = 0, count = 0;
  for (let h = startH; h < endH; h++) {
    if (h >= 0 && h < 24) { sum += grid[weekdayMo0]?.[h] ?? 0; count++; }
  }
  if (count === 0) return 0;
  const avg = sum / count;
  // Normalize against grid max — log scale so a single power-hour doesn't dominate
  const max = Math.max(1, ...grid.flat());
  return Math.min(1, Math.log(1 + avg) / Math.log(1 + max));
}

// ── Auto-fill algorithm (productivity-aware) ──────────────────────────────────

type Interval = { start: number; end: number };
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end) prev.end = Math.max(prev.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}
function freeSlots(wakeMin: number, sleepMin: number, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy.filter((b) => b.end > wakeMin && b.start < sleepMin));
  const out: Interval[] = [];
  let cursor = wakeMin;
  for (const b of merged) {
    if (b.start - cursor >= SLOT_MIN) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (sleepMin - cursor >= SLOT_MIN) out.push({ start: cursor, end: sleepMin });
  return out;
}

function placementScore(
  start: number,
  end: number,
  weekdayMo0: number,
  prodGrid: number[][],
  moveHistory: MoveEvent[],
  /** Calendar commitments on this day — used to reward adjacency (study after a
   *  lecture etc.). `isUni` events get a stronger "review right after" bonus. */
  anchors: { startMin: number; endMin: number; isUni: boolean }[],
  /** 0..1 — how often Paul historically studied right after a commitment.
   *  Amplifies the adjacency reward so it only matters if it matches his habits. */
  afterEventAffinity: number,
): number {
  // Lower = better. Base bias: earlier in day.
  let score = start;
  const overlaps = (a1: number, a2: number, b1: number, b2: number) =>
    Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  // Meal-time penalties
  score += overlaps(start, end, 12 * 60, 13 * 60) * 4;
  score += overlaps(start, end, 18 * 60 + 30, 19 * 60 + 30) * 4;
  // Late evening penalty
  if (start >= 20 * 60) score += 200;
  // Productivity bonus — strong reward for historically productive hours
  const prod = productivityScore(prodGrid, weekdayMo0, start, end);
  score -= prod * 500;
  // Learned preference: did the user previously move auto blocks TO this slot
  // on this weekday? Reward it.
  const learnedHits = moveHistory.filter(
    (m) => m.weekday === weekdayMo0 && Math.abs(m.toMin - start) <= 30,
  ).length;
  score -= learnedHits * 60;
  // Adjacency to calendar commitments (Jarvis learns from your events):
  //  • a block starting right AFTER an event (you're already in work mode) is
  //    rewarded — extra for Uni events ("review straight after the lecture").
  //  • a short block right BEFORE an event gets a light warm-up bonus.
  // The whole reward scales with after-event affinity, so it only kicks in if
  // post-commitment studying actually matches Paul's history.
  let adjacency = 0;
  for (const a of anchors) {
    const afterGap = start - a.endMin;
    if (afterGap >= 0 && afterGap <= 45) adjacency += a.isUni ? 220 : 120;
    const beforeGap = a.startMin - end;
    if (beforeGap >= 0 && beforeGap <= 30) adjacency += 60;
  }
  score -= adjacency * (1 + afterEventAffinity);
  return score;
}

// ── Event-learning layer (Jarvis learns from your calendar) ───────────────────
// Three signals derived from the user's Apple-Calendar events:
//  1. Recurring commitments → (weekday, start, title) windows that repeat across
//     ≥2 distinct weeks are treated as reliably busy, even in weeks where the
//     instance isn't imported yet.
//  2. Event categories → how the user tagged an event (Uni/Sport/Privat) is
//     remembered by title, so the same commitment is understood next time.
//  3. After-event affinity → how often the user actually studied right after a
//     commitment ended — biases auto-blocks toward post-event slots.

const EVENT_CAT_KEY = "morning.weekPlan.eventCategories";
const eventTitleKey = (t: string) => t.toLowerCase().trim();

function loadEventCategories(): Record<string, BlockCategory> {
  try {
    const raw = localStorage.getItem(EVENT_CAT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BlockCategory>) : {};
  } catch { return {}; }
}
function saveEventCategory(title: string, category: BlockCategory) {
  if (!title.trim()) return;
  try {
    const map = loadEventCategories();
    map[eventTitleKey(title)] = category;
    localStorage.setItem(EVENT_CAT_KEY, JSON.stringify(map));
  } catch { /* quota */ }
}

/** Monday (local) of the week containing d, as ISO — to count distinct weeks. */
function mondayKey(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(x);
}

/** Detect recurring commitment windows per weekday (Mo=0). A (weekday, start,
 *  title) trio appearing in ≥2 distinct calendar weeks counts as recurring. */
function detectRecurringBusy(events: CalendarEvent[]): Interval[][] {
  const groups = new Map<
    string,
    { weekday: number; start: number; end: number; weeks: Set<string> }
  >();
  for (const e of events) {
    if (e.allDay) continue;
    const d = new Date(e.start);
    const weekday = (d.getDay() + 6) % 7;
    const start = snapTo30(d.getHours() * 60 + d.getMinutes());
    const end = Math.max(start + SLOT_MIN, snapTo30(eventEndMin(e, start)));
    const key = `${weekday}|${start}|${eventTitleKey(e.title)}`;
    const g = groups.get(key);
    if (g) { g.weeks.add(mondayKey(d)); g.end = Math.max(g.end, end); }
    else groups.set(key, { weekday, start, end, weeks: new Set([mondayKey(d)]) });
  }
  const out: Interval[][] = Array.from({ length: 7 }, () => []);
  for (const g of groups.values()) {
    if (g.weeks.size >= 2) out[g.weekday].push({ start: g.start, end: g.end });
  }
  return out.map(mergeIntervals);
}

/** 0..1 — fraction of sessions that started within 90 min after a recurring
 *  commitment ended. Returns 0 until there's enough data (≥5 timed sessions). */
function computeAfterEventAffinity(sessions: Session[], recurringBusy: Interval[][]): number {
  let after = 0, total = 0;
  for (const s of sessions) {
    if (!s.startedAtMs) continue;
    total++;
    const d = new Date(s.startedAtMs);
    const weekday = (d.getDay() + 6) % 7;
    const startMin = d.getHours() * 60 + d.getMinutes();
    const wins = recurringBusy[weekday] ?? [];
    if (wins.some((w) => startMin >= w.end && startMin <= w.end + 90)) after++;
  }
  if (total < 5) return 0;
  return Math.min(1, after / total);
}

function generateAutoBlocks(params: {
  iso: string;
  weekdayMo0: number;
  goalMin: number;
  wakeMin: number;
  sleepMin: number;
  events: CalendarEvent[];
  userBlocks: StudyBlock[];
  prodGrid: number[][];
  moveHistory: MoveEvent[];
  /** For TODAY: the earliest minute we still consider for auto-planning
   *  (typically = current time snapped to next 30-min). For other days: omit. */
  earliestStartMin?: number;
  /** Minutes already completed via real Sessions on this day. Subtracted from target. */
  completedSessionMin?: number;
  /** Paul's preferred block length (default 60). */
  blockSizeMin?: number;
  /** Paul's preferred break length between blocks (default 0). */
  breakSizeMin?: number;
  /** Recurring commitment windows for this weekday (learned from events). */
  recurringWins?: Interval[];
  /** 0..1 after-event affinity — amplifies the adjacency reward. */
  afterEventAffinity?: number;
  /** Learned event-title → category map (e.g. "fitnessstudio" → sport). */
  eventCategories?: Record<string, BlockCategory>;
  /** Earliest minute the user wants study planned (Settings "frühester
   *  Lernbeginn"). Floors placement so nothing lands at wake-up. */
  earliestStudyMin?: number;
}): Omit<StudyBlock, "id">[] {
  const {
    iso, weekdayMo0, goalMin, wakeMin, sleepMin, events, userBlocks,
    prodGrid, moveHistory, earliestStartMin, completedSessionMin = 0,
    blockSizeMin = 60, breakSizeMin = 0,
    recurringWins = [], afterEventAffinity = 0, eventCategories = {},
    earliestStudyMin = 0,
  } = params;

  // Planning window floor: never before the user's earliest study time, never
  // before wake, and (for today) never before "now".
  const planStart = Math.max(wakeMin, earliestStudyMin, earliestStartMin ?? wakeMin);
  if (planStart >= sleepMin - SLOT_MIN) return [];

  // Subtract already-planned user STUDY time (other-category user blocks count as busy time, not goal)
  const userStudyMin = userBlocks
    .filter((b) => (b.category ?? "lern") === "lern")
    .reduce((a, b) => a + b.durationMin, 0);

  // Conflict-aware target reduction: if the day is heavily booked with non-study
  // events (>4h), reduce auto-fill target to avoid stressful over-planning.
  const eventLoadMin = events
    .filter((e) => !e.allDay)
    .reduce((a, e) => {
      const s = eventStartMin(e);
      return a + (eventEndMin(e, s) - s);
    }, 0);
  const conflictFactor = eventLoadMin > 240 ? 0.7 : 1.0;
  const effectiveTarget = Math.round(goalMin * conflictFactor);

  // Subtract both already-completed sessions AND user-planned study blocks
  let remaining = Math.max(0, snapTo30(effectiveTarget - userStudyMin - completedSessionMin));
  if (remaining <= 0) return [];

  // Build busy intervals: events (15-min buffer) + ALL user blocks (study + private)
  const busy: Interval[] = [];
  for (const e of events) {
    if (e.allDay) continue;
    const s = eventStartMin(e);
    busy.push({ start: Math.max(0, s - 15), end: Math.min(24 * 60, eventEndMin(e, s) + 15) });
  }
  for (const b of userBlocks) {
    busy.push({ start: b.startMin, end: b.startMin + b.durationMin });
  }
  // Recurring commitments (learned from events): hold these weekday windows
  // busy even when the specific instance isn't imported in this week.
  for (const w of recurringWins) {
    busy.push({ start: Math.max(0, w.start - 15), end: Math.min(24 * 60, w.end + 15) });
  }

  // For today: also block the past portion of the day so candidate slots can't land there
  if (earliestStartMin !== undefined && earliestStartMin > wakeMin) {
    busy.push({ start: 0, end: earliestStartMin });
  }

  const slots = freeSlots(planStart, sleepMin, busy);
  if (slots.length === 0) return [];

  // Adjacency anchors: this day's timed commitments, tagged Uni/other via the
  // learned category map — used to reward studying right after them.
  const anchors = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = eventStartMin(e);
      return {
        startMin: s,
        endMin: eventEndMin(e, s),
        isUni: eventCategories[eventTitleKey(e.title)] === "uni",
      };
    });

  // Build candidate chunks honoring Paul's preferred block size + breaks.
  // Within a free slot we step through: [block, break, block, break, ...] —
  // the break advances the cursor but is NOT planned as a block.
  const effBlockLen = Math.max(SLOT_MIN, blockSizeMin);
  const effBreakLen = Math.max(0, breakSizeMin);
  const candidates: { start: number; end: number; score: number }[] = [];
  for (const slot of slots) {
    let cursor = slot.start;
    while (cursor + SLOT_MIN <= slot.end) {
      const chunkLen = Math.min(effBlockLen, slot.end - cursor);
      const end = cursor + chunkLen;
      candidates.push({
        start: cursor,
        end,
        score: placementScore(cursor, end, weekdayMo0, prodGrid, moveHistory, anchors, afterEventAffinity),
      });
      cursor = end + effBreakLen;
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const placed: Omit<StudyBlock, "id">[] = [];
  for (const c of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(c.end - c.start, remaining);
    if (take < SLOT_MIN) continue;
    placed.push({
      date: iso,
      startMin: c.start,
      durationMin: take,
      source: "auto",
      category: "lern",
    });
    remaining -= take;
  }
  placed.sort((a, b) => a.startMin - b.startMin);
  return placed;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  weekStart: Date;
  calendarEvents: CalendarEvent[];
  goalsByDay: number[]; // length 7, Mo..So
};

type DragState =
  | { kind: "idle" }
  | {
      kind: "moving";
      blockId: string;
      pointerStartX: number;
      pointerStartY: number;
      origStartMin: number;
      origDate: string;
      curStartMin: number;
      curDate: string;
      origSource: "auto" | "user";
    }
  | {
      kind: "resizing";
      blockId: string;
      edge: "top" | "bottom";
      pointerStartY: number;
      origStartMin: number;
      origDurationMin: number;
      curStartMin: number;
      curDurationMin: number;
    }
  | {
      kind: "movingSession";
      sessionId: string;
      pointerStartX: number;
      pointerStartY: number;
      origStartMin: number;
      origDate: string;
      curStartMin: number;
      curDate: string;
    };

export function WeeklyTimeline({ weekStart, calendarEvents, goalsByDay }: Props) {
  const {
    studyBlocks,
    addStudyBlock,
    updateStudyBlock,
    deleteStudyBlock,
    replaceAutoBlocksForDate,
    subjects,
    sessions,
    updateSessionTime,
    goalsByWeekday,
    setGoalForWeekday,
    wakeTime,
    sleepTime,
    studyStartTime,
    removeEventBlock,
  } = useTracker();

  // Titel der Termine, die der letzte Lernblock verdrängt hat. Nur als kurze
  // Rückmeldung — rückgängig macht es das Abzeichen in der Kopfzeile.
  const [verdraengt, setVerdraengt] = useState<string[]>([]);
  useEffect(() => {
    if (verdraengt.length === 0) return;
    const t = window.setTimeout(() => setVerdraengt([]), 6000);
    return () => window.clearTimeout(t);
  }, [verdraengt]);

  // Hour range
  const wakeMin = useMemo(() => Math.floor(hhmmToMin(wakeTime, 6 * 60) / 30) * 30, [wakeTime]);
  const sleepMin = useMemo(() => Math.ceil(hhmmToMin(sleepTime, 22 * 60 + 30) / 30) * 30, [sleepTime]);
  // Earliest minute the auto-planner may place study (Settings). Snap to 30.
  const studyStartMin = useMemo(() => Math.floor(hhmmToMin(studyStartTime, 8 * 60) / 30) * 30, [studyStartTime]);
  // Days
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      return { date: d, iso: isoDate(d), weekdayMo0: i };
    });
  }, [weekStart]);
  const today = isoDate();

  // Visible range — the wake→sleep window PLUS ~1.5h breathing room before and
  // after, and always wide enough to show every event / block / session in the
  // week (so nothing early or late gets clipped). Auto-planning still only fills
  // the wake→sleep window; these extra rows are just visible + manually usable.
  const { viewStartMin, viewEndMin } = useMemo(() => {
    const weekIsos = new Set(days.map((d) => d.iso));
    let earliest = wakeMin;
    let latest = sleepMin;
    for (const e of calendarEvents) {
      if (e.allDay) continue;
      const sd = new Date(e.start);
      if (!weekIsos.has(isoDate(sd))) continue;
      const s = sd.getHours() * 60 + sd.getMinutes();
      earliest = Math.min(earliest, s);
      latest = Math.max(latest, eventEndMin(e, s));
    }
    for (const b of studyBlocks) {
      if (!weekIsos.has(b.date)) continue;
      earliest = Math.min(earliest, b.startMin);
      latest = Math.max(latest, b.startMin + b.durationMin);
    }
    for (const s of sessions) {
      if (!s.startedAtMs || !weekIsos.has(s.date)) continue;
      const sd = new Date(s.startedAtMs);
      const sm = sd.getHours() * 60 + sd.getMinutes();
      earliest = Math.min(earliest, sm);
      latest = Math.max(latest, sm + s.durationMin);
    }
    const pad = 90; // ~1.5h before/after the waking window
    const start = Math.max(0, Math.floor((earliest - pad) / SLOT_MIN) * SLOT_MIN);
    const end = Math.min(24 * 60, Math.ceil((latest + pad) / SLOT_MIN) * SLOT_MIN);
    return { viewStartMin: start, viewEndMin: Math.max(start + SLOT_MIN, end) };
  }, [days, calendarEvents, studyBlocks, sessions, wakeMin, sleepMin]);

  const slotCount = (viewEndMin - viewStartMin) / SLOT_MIN;
  const gridHeight = slotCount * SLOT_PX;

  // Shift per-WEEKDAY learning goals when a LERN block moves across days, so
  // the Settings "Tagesziele pro Wochentag" (goalsByWeekday) stays in sync with
  // the calendar: source weekday loses the block's minutes, target gains them.
  const shiftGoalAcrossDays = useCallback(
    (fromIso: string, toIso: string, durationMin: number) => {
      if (fromIso === toIso || durationMin <= 0) return;
      const fromDate = days.find((d) => d.iso === fromIso)?.date;
      const toDate = days.find((d) => d.iso === toIso)?.date;
      if (fromDate) {
        const wd = fromDate.getDay(); // 0=Sun..6=Sat (goalsByWeekday index)
        setGoalForWeekday(wd, Math.max(0, (goalsByWeekday[wd] ?? 0) - durationMin));
      }
      if (toDate) {
        const wd = toDate.getDay();
        setGoalForWeekday(wd, (goalsByWeekday[wd] ?? 0) + durationMin);
      }
    },
    [days, goalsByWeekday, setGoalForWeekday],
  );

  // Locally hidden calendar events — for the restore badge + hide actions.
  const hiddenEventIds = useHiddenEventIds();

  // Productivity grid (memoized over sessions)
  const prodGrid = useMemo(() => buildProductivityGrid(sessions), [sessions]);

  // ── Event-learning signals (Jarvis learns from your calendar) ──
  // Recurring commitment windows per weekday (Mo=0), detected from events that
  // repeat across ≥2 weeks. Held busy even in weeks where the instance is absent.
  const recurringBusy = useMemo(() => detectRecurringBusy(calendarEvents), [calendarEvents]);
  // Learned event-title → category map. Bumped when the user categorizes an event.
  const [eventCatTick, setEventCatTick] = useState(0);
  const eventCategories = useMemo(() => loadEventCategories(), [eventCatTick]);
  // How often Paul studies right after a commitment — amplifies adjacency reward.
  const afterEventAffinity = useMemo(
    () => computeAfterEventAffinity(sessions, recurringBusy),
    [sessions, recurringBusy],
  );

  // Clock tick — advances every 30 min so the "earliest start" for today
  // retires past slots from the auto-suggestion list as the day progresses.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fine-grained clock (60s) — drives the "now" indicator line on today's
  // column. Kept separate from clockTick so it doesn't trigger a replan.
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Pref tick — bumps when Jarvis changes a preference via chat. Triggers
  // a replan so the new block/break sizes take effect immediately.
  const [prefTick, setPrefTick] = useState(0);
  useEffect(() => {
    const onPrefs = () => setPrefTick((t) => t + 1);
    window.addEventListener("morning:weekplan-prefs-change", onPrefs);
    return () => window.removeEventListener("morning:weekplan-prefs-change", onPrefs);
  }, []);
  const prefs = useMemo(() => {
    try {
      const raw = localStorage.getItem("morning.weekPlan.prefs");
      return raw ? (JSON.parse(raw) as { blockSizeMin?: number; breakSizeMin?: number }) : {};
    } catch { return {}; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefTick]);

  // ── Auto-replan trigger (debounced, productivity + move-history aware) ──
  const replanTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (replanTimerRef.current) window.clearTimeout(replanTimerRef.current);
    const moveHistory = loadMoveHistory();
    replanTimerRef.current = window.setTimeout(() => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      // Snap UP to the next 30-min slot so we don't suggest a block that
      // would start a few minutes in the past.
      const nowSnapUp = Math.ceil(nowMin / SLOT_MIN) * SLOT_MIN;

      days.forEach((d, i) => {
        if (d.iso < today) return;
        const isToday = d.iso === today;
        const dayEvents = calendarEvents.filter((e) => isoDate(new Date(e.start)) === d.iso);
        const userBlocks = studyBlocks.filter((b) => b.date === d.iso && b.source === "user");

        // Subtract real sessions already completed today from the day's target
        // — Paul shouldn't be pushed to over-plan if he's already done study time.
        const completedSessionMin = isToday
          ? sessions
              .filter((s) => s.date === d.iso)
              .reduce((a, s) => a + s.durationMin, 0)
          : 0;

        const next = generateAutoBlocks({
          iso: d.iso,
          weekdayMo0: d.weekdayMo0,
          goalMin: goalsByDay[i] ?? 0,
          wakeMin,
          sleepMin,
          events: dayEvents,
          userBlocks,
          prodGrid,
          moveHistory,
          earliestStartMin: isToday ? nowSnapUp : undefined,
          earliestStudyMin: studyStartMin,
          completedSessionMin,
          blockSizeMin: prefs.blockSizeMin,
          breakSizeMin: prefs.breakSizeMin,
          recurringWins: recurringBusy[d.weekdayMo0],
          afterEventAffinity,
          eventCategories,
        });
        const existingAuto = studyBlocks
          .filter((b) => b.date === d.iso && b.source === "auto")
          .map((b) => `${b.startMin}-${b.durationMin}`)
          .sort()
          .join(",");
        const proposed = next
          .map((b) => `${b.startMin}-${b.durationMin}`)
          .sort()
          .join(",");
        if (existingAuto !== proposed) {
          replaceAutoBlocksForDate(d.iso, next);
        }
      });
    }, 600);
    return () => { if (replanTimerRef.current) window.clearTimeout(replanTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    days.map((d) => d.iso).join(","),
    goalsByDay.join(","),
    calendarEvents.map((e) => `${e.id}:${e.start}:${e.end ?? ""}`).join("|"),
    studyBlocks
      .filter((b) => b.source === "user")
      .map((b) => `${b.id}:${b.date}:${b.startMin}:${b.durationMin}:${b.category ?? "lern"}`)
      .join("|"),
    // Sessions for today affect both the busy-window AND the completed-time
    // subtraction. Include them in the dep key.
    sessions
      .filter((s) => s.date === today)
      .map((s) => `${s.id}:${s.startedAtMs ?? ""}:${s.durationMin}`)
      .join("|"),
    wakeMin,
    sleepMin,
    studyStartMin,
    prodGrid,
    clockTick,
    prefs.blockSizeMin,
    prefs.breakSizeMin,
    recurringBusy,
    afterEventAffinity,
    eventCatTick,
  ]);


  // ── Drag state ──
  const [drag, setDrag] = useState<DragState>({ kind: "idle" });
  // Nach einem Zieh- oder Ziehvorgang feuert der Browser noch ein `click` auf
  // denselben Block. Bei Auto-Blöcken öffnete das den Vorschlagsdialog direkt
  // über dem gerade gezogenen Block — man konnte sie deshalb nicht vergrössern,
  // ohne dass einem ein Menü ins Gesicht springt. Der Merker schluckt genau
  // diesen einen Klick.
  const zogGeradeRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const beginMove = useCallback((e: React.PointerEvent, block: StudyBlock) => {
      // Jeder neue Griff setzt den Merker zurueck — sonst schluckte ein
      // frueheres Ziehen irgendwann einen Klick, der gar nichts damit zu tun hat.
      zogGeradeRef.current = false;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      kind: "moving",
      blockId: block.id,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      origStartMin: block.startMin,
      origDate: block.date,
      curStartMin: block.startMin,
      curDate: block.date,
      origSource: block.source,
    });
  }, []);

  const beginResize = useCallback(
    (e: React.PointerEvent, block: StudyBlock, edge: "top" | "bottom") => {
      // Jeder neue Griff setzt den Merker zurueck — sonst schluckte ein
      // frueheres Ziehen irgendwann einen Klick, der gar nichts damit zu tun hat.
      zogGeradeRef.current = false;
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDrag({
        kind: "resizing",
        blockId: block.id,
        edge,
        pointerStartY: e.clientY,
        origStartMin: block.startMin,
        origDurationMin: block.durationMin,
        curStartMin: block.startMin,
        curDurationMin: block.durationMin,
      });
    },
    [],
  );

  const beginSessionMove = useCallback((e: React.PointerEvent, session: Session) => {
    if (!session.startedAtMs) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const d = new Date(session.startedAtMs);
    const startMin = d.getHours() * 60 + d.getMinutes();
    setDrag({
      kind: "movingSession",
      sessionId: session.id,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      origStartMin: startMin,
      origDate: session.date,
      curStartMin: startMin,
      curDate: session.date,
    });
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (drag.kind === "moving" || drag.kind === "movingSession") {
        const dy = e.clientY - drag.pointerStartY;
        const dx = e.clientX - drag.pointerStartX;
        const minDelta = snapTo30((dy / SLOT_PX) * SLOT_MIN);
        const gridEl = gridRef.current;
        const colWidth = gridEl ? (gridEl.clientWidth - HOUR_COL_PX) / 7 : 100;
        const dayDelta = Math.round(dx / colWidth);
        const dayIdx = days.findIndex((d) => d.iso === drag.origDate);
        const newDayIdx = Math.max(0, Math.min(6, dayIdx + dayDelta));
        const newDate = days[newDayIdx].iso;
        const newStartMin = Math.max(viewStartMin, Math.min(viewEndMin - SLOT_MIN, drag.origStartMin + minDelta));
        if (newStartMin !== drag.curStartMin || newDate !== drag.curDate) {
          setDrag({ ...drag, curStartMin: newStartMin, curDate: newDate });
        }
      } else if (drag.kind === "resizing") {
        const dy = e.clientY - drag.pointerStartY;
        const minDelta = snapTo30((dy / SLOT_PX) * SLOT_MIN);
        if (drag.edge === "bottom") {
          const newDur = Math.max(SLOT_MIN, drag.origDurationMin + minDelta);
          // Cap at the bottom of the visible range
          const maxDur = viewEndMin - drag.origStartMin;
          const dur = Math.min(maxDur, newDur);
          if (dur !== drag.curDurationMin) setDrag({ ...drag, curDurationMin: dur });
        } else {
          const newStart = Math.max(viewStartMin, drag.origStartMin + minDelta);
          const newDur = drag.origDurationMin - (newStart - drag.origStartMin);
          if (newDur < SLOT_MIN) return;
          if (newStart !== drag.curStartMin) {
            setDrag({ ...drag, curStartMin: newStart, curDurationMin: newDur });
          }
        }
      }
    },
    [drag, days, viewStartMin, viewEndMin],
  );

  // Ein Lernblock über einem Termin heisst: da war ich nicht.
  //
  // Die Regel selbst steht in lib/studyOverlap.ts und ist dort geprüft; hier
  // wird sie nur angewandt. Aufgerufen an ALLEN drei Stellen, an denen ein
  // Lernblock seine Lage bekommt (neu anlegen, verschieben, ziehen) — eine
  // davon zu vergessen hiesse, dass die Regel je nach Handgriff gilt oder nicht.
  //
  // Nichts davon ist unwiderruflich: `hideCalendarEvent` blendet die einzelne
  // Wiederholung aus, das Abzeichen "N ausgeblendet ↺" in der Kopfzeile holt
  // sie zurück. Die Serie bleibt unberührt — nächste Woche steht die Vorlesung
  // wieder da.
  const verdraengeTermine = useCallback(
    (iso: string, startMin: number, durationMin: number, category: BlockCategory | undefined) => {
      if ((category ?? "lern") !== "lern") return;
      const lern = { startMin, endMin: startMin + durationMin };

      const kandidaten: Terminartig[] = [];
      const gesehen = new Set<string>();
      for (const e of calendarEvents) {
        if (e.allDay) continue;
        if (isoDate(new Date(e.start)) !== iso) continue;
        const s0 = eventStartMin(e);
        kandidaten.push({ id: e.id, startMin: s0, endMin: eventEndMin(e, s0), titel: e.title });
        gesehen.add(e.id);
      }
      // Termine, die schon als Block im Plan liegen ("hingehen" entschieden).
      // Sie meinen denselben Kalendereintrag — deshalb über die
      // Vorkommens-Kennung entdoppelt.
      for (const b of studyBlocks) {
        if (b.date !== iso || !b.fromEventId || gesehen.has(b.fromEventId)) continue;
        kandidaten.push({
          id: b.fromEventId,
          startMin: b.startMin,
          endMin: b.startMin + b.durationMin,
          titel: b.note ?? "Termin",
        });
        gesehen.add(b.fromEventId);
      }

      const weg = verdraengteTermine(lern, kandidaten);
      if (weg.length === 0) return;
      for (const t of weg) {
        removeEventBlock(t.id);
        hideCalendarEvent(t.id);
      }
      setVerdraengt(weg.map((t) => t.titel));
    },
    [calendarEvents, studyBlocks, removeEventBlock],
  );

  const handlePointerUp = useCallback(() => {
    if (drag.kind === "moving") {
      const moved = drag.curStartMin !== drag.origStartMin || drag.curDate !== drag.origDate;
      if (moved) {
        // If user moved an AUTO block, record the (weekday, fromMin → toMin) as a learning event
        if (drag.origSource === "auto") {
          const dayIdx = days.findIndex((d) => d.iso === drag.curDate);
          if (dayIdx >= 0) {
            pushMoveEvent({
              weekday: dayIdx,
              fromMin: drag.origStartMin,
              toMin: drag.curStartMin,
              ts: Date.now(),
            });
          }
        }
        // Cross-day move of a LERN block → shift the per-day goals so the
        // Learning settings stay in sync with the calendar.
        if (drag.curDate !== drag.origDate) {
          const block = studyBlocks.find((b) => b.id === drag.blockId);
          if (block && (block.category ?? "lern") === "lern") {
            shiftGoalAcrossDays(drag.origDate, drag.curDate, block.durationMin);
          }
        }
        updateStudyBlock(drag.blockId, {
          startMin: drag.curStartMin,
          date: drag.curDate,
          source: "user",
        });
        const b = studyBlocks.find((x) => x.id === drag.blockId);
        if (b) verdraengeTermine(drag.curDate, drag.curStartMin, b.durationMin, b.category);
        zogGeradeRef.current = true;
      }
    } else if (drag.kind === "resizing") {
      const changed =
        drag.curStartMin !== drag.origStartMin || drag.curDurationMin !== drag.origDurationMin;
      if (changed) {
        updateStudyBlock(drag.blockId, {
          startMin: drag.curStartMin,
          durationMin: drag.curDurationMin,
          source: "user",
        });
        const b = studyBlocks.find((x) => x.id === drag.blockId);
        if (b) verdraengeTermine(b.date, drag.curStartMin, drag.curDurationMin, b.category);
        zogGeradeRef.current = true;
      }
    } else if (drag.kind === "movingSession") {
      const moved = drag.curStartMin !== drag.origStartMin || drag.curDate !== drag.origDate;
      if (moved) {
        // Build a fresh startedAtMs from the dragged date + startMin (local time)
        const [y, mo, d] = drag.curDate.split("-").map((n) => parseInt(n, 10));
        const newDate = new Date(
          y,
          (mo || 1) - 1,
          d || 1,
          Math.floor(drag.curStartMin / 60),
          drag.curStartMin % 60,
        );
        updateSessionTime(drag.sessionId, drag.curDate, newDate.getTime());
      }
    }
    setDrag({ kind: "idle" });
  }, [drag, updateStudyBlock, days, updateSessionTime, studyBlocks, shiftGoalAcrossDays, verdraengeTermine]);

  useEffect(() => {
    if (drag.kind === "idle") return;
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = () => handlePointerUp();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag.kind, handlePointerMove, handlePointerUp]);

  // ── Selection + keyboard nav ──
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null);

  // Click anywhere outside → deselect / close popover
  useEffect(() => {
    if (!openBlock && !selectedBlockId) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const insidePopover = el.closest?.("[data-block-popover]");
      const onBlock = el.closest?.("[data-block-id]");
      if (!insidePopover && !onBlock) {
        setOpenBlock(null);
        setSelectedBlockId(null);
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [openBlock, selectedBlockId]);

  // Keyboard handlers
  useEffect(() => {
    if (!selectedBlockId) return;
    const onKey = (e: KeyboardEvent) => {
      const block = studyBlocks.find((b) => b.id === selectedBlockId);
      if (!block) return;

      // Don't hijack when user is typing in an input
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) {
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -SLOT_MIN : SLOT_MIN;
        const newStart = Math.max(viewStartMin, Math.min(viewEndMin - block.durationMin, block.startMin + delta));
        if (newStart !== block.startMin) {
          updateStudyBlock(block.id, { startMin: newStart, source: "user" });
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dayIdx = days.findIndex((d) => d.iso === block.date);
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        const newIdx = Math.max(0, Math.min(6, dayIdx + delta));
        const newDate = days[newIdx].iso;
        if (newDate !== block.date) {
          // Keep Learning goals in sync on cross-day keyboard moves
          if ((block.category ?? "lern") === "lern") {
            shiftGoalAcrossDays(block.date, newDate, block.durationMin);
          }
          updateStudyBlock(block.id, { date: newDate, source: "user" });
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteStudyBlock(block.id);
        setSelectedBlockId(null);
        setOpenBlock(null);
      } else if (e.key === "Escape") {
        setSelectedBlockId(null);
        setOpenBlock(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedBlockId, studyBlocks, days, viewStartMin, viewEndMin, updateStudyBlock, deleteStudyBlock, shiftGoalAcrossDays]);

  // Empty slot click → open quick-picker at click location
  type Picker = {
    iso: string;
    startMin: number;
    clientX: number;
    clientY: number;
    /** Pre-fill values when opened from a calendar event */
    suggestedDuration?: number;
    suggestedCategory?: BlockCategory;
    suggestedTitle?: string;
    headerText?: string;
    /** Set when the picker was opened from an imported calendar event — enables
     *  the "hide this Termin" actions. */
    eventId?: string;
    eventIsSeries?: boolean;
  };
  const [picker, setPicker] = useState<Picker | null>(null);
  const handleEmptyClick = useCallback(
    (iso: string, clickY: number, gridTop: number, clientX?: number) => {
      const relY = clickY - gridTop;
      const slotIdx = Math.floor(relY / SLOT_PX);
      const startMin = viewStartMin + snapTo30(slotIdx * SLOT_MIN);
      setPicker({ iso, startMin, clientX: clientX ?? 0, clientY: clickY });
    },
    [viewStartMin],
  );

  // Click on an AUTO block → treat it like clicking on the underlying slot:
  // open the picker prefilled with the auto-block's time + duration so the
  // user can replace the suggestion with their own block. The auto-replan
  // will remove the original auto-block once a user-block lands in its slot.
  const handleAutoBlockClick = useCallback(
    (b: StudyBlock, clientX: number, clientY: number) => {
      // Der Klick, der direkt auf ein Ziehen folgt, ist keine Absicht.
      if (zogGeradeRef.current) { zogGeradeRef.current = false; return; }
      setPicker({
        iso: b.date,
        startMin: b.startMin,
        clientX,
        clientY,
        suggestedDuration: b.durationMin,
        suggestedCategory: "lern",
        headerText: "Slot belegen",
      });
    },
    [],
  );

  // Calendar event click → open picker prefilled with event data so user
  // can categorize the event (Uni / Privat / Sport / etc.) and turn it into
  // a block that participates in auto-planning busy-intervals.
  const handleEventClick = useCallback(
    (event: CalendarEvent, clientX: number, clientY: number) => {
      const startD = new Date(event.start);
      const iso = isoDate(startD);
      const startMin = startD.getHours() * 60 + startD.getMinutes();
      const endMin = event.end ? (() => {
        const ed = new Date(event.end);
        return ed.getHours() * 60 + ed.getMinutes();
      })() : startMin + 60;
      const rawDuration = Math.max(30, endMin - startMin);
      // Snap to 30/60/90/120 for the picker chips
      const suggested = [30, 60, 90, 120].reduce(
        (best, m) => (Math.abs(m - rawDuration) < Math.abs(best - rawDuration) ? m : best),
        60,
      );
      const prefix = uidPrefix(event.id);
      const isSeries = calendarEvents.filter((ev) => uidPrefix(ev.id) === prefix).length > 1;
      setPicker({
        iso,
        startMin: snapTo30(startMin),
        clientX,
        clientY,
        suggestedDuration: suggested,
        suggestedCategory: "uni",
        suggestedTitle: event.title,
        headerText: `Termin · ${event.title}`,
        eventId: event.id,
        eventIsSeries: isSeries,
      });
    },
    [calendarEvents],
  );

  const createBlockFromPicker = useCallback(
    (params: { category: BlockCategory; subjectId?: string; durationMin: number; note?: string }) => {
      if (!picker) return;
      // Learn the event → category mapping when this picker came from a calendar
      // event (handleEventClick sets suggestedTitle). Future instances of the
      // same commitment are then understood automatically.
      if (picker.suggestedTitle) {
        saveEventCategory(picker.suggestedTitle, params.category);
        setEventCatTick((t) => t + 1);
      }
      const created = addStudyBlock({
        date: picker.iso,
        startMin: picker.startMin,
        durationMin: params.durationMin,
        source: "user",
        category: params.category,
        subjectId: params.category === "lern" ? params.subjectId : undefined,
        note: params.note,
      });
      verdraengeTermine(picker.iso, picker.startMin, params.durationMin, params.category);
      setSelectedBlockId(created.id);
      setPicker(null);
    },
    [picker, addStudyBlock, verdraengeTermine],
  );

  // Close picker on Escape. Outside-click is handled by a backdrop inside
  // SlotPicker (more robust than a window listener — no event-timing races).
  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker]);

  // Explicit add: opens the picker centered on screen with a sensible default
  // day + start time. A guaranteed-working path regardless of where you click.
  const openAddPicker = useCallback(() => {
    const todayIdx = days.findIndex((d) => d.iso === today);
    const targetIso = todayIdx >= 0 ? today : days[0].iso;
    // Default start: if today, next 30-min slot from now (clamped to wake/sleep); else wake time
    let startMin = wakeMin;
    if (todayIdx >= 0) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      startMin = Math.max(wakeMin, Math.min(sleepMin - SLOT_MIN, Math.ceil(nowMin / SLOT_MIN) * SLOT_MIN));
    }
    setPicker({
      iso: targetIso,
      startMin,
      clientX: window.innerWidth / 2,
      clientY: Math.min(window.innerHeight / 2, 320),
      headerText: "Neuer Block / Event",
    });
  }, [days, today, wakeMin, sleepMin]);

  return (
    <div className="mt-5">
      {/* Was der letzte Lernblock verdraengt hat. Verschwindet nach ein paar
          Sekunden von allein — es ist eine Quittung, keine Warnung. Zurueckholen
          geht ueber das Abzeichen rechts, das ohnehin schon da ist. */}
      {verdraengt.length > 0 && (
        <p className="vd-hinweis" role="status">
          {verdraengt.length === 1
            ? <>„{verdraengt[0]}" entfernt — du lernst zu der Zeit.</>
            : <>{verdraengt.length} Termine entfernt — du lernst zu der Zeit: {verdraengt.join(" · ")}</>}
          <span className="vd-zurueck"> Über „ausgeblendet ↺" zurückholen.</span>
        </p>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
          Stundenplan · {minToHHMM(wakeMin)}–{minToHHMM(sleepMin)}
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-fg-tertiary hidden md:inline">
            Klick = Block · Ziehen = verschieben · Rand = Dauer · ←↑↓→ = bewegen · ⌫ = löschen
          </span>
          {hiddenEventIds.size > 0 && (
            <button
              type="button"
              onClick={clearHiddenCalendarEvents}
              className="rounded-full px-2.5 py-1 text-[10px] font-mono shrink-0 transition-colors"
              style={{
                background: "var(--ink-3)",
                color: "var(--text-3)",
                border: "1px solid var(--line-1)",
                cursor: "pointer",
              }}
              title="Ausgeblendete Termine wiederherstellen"
            >
              {hiddenEventIds.size} ausgeblendet ↺
            </button>
          )}
          <button
            type="button"
            onClick={openAddPicker}
            className="rounded-full px-3 py-1.5 text-[11px] font-display font-semibold inline-flex items-center gap-1 shrink-0"
            style={{
              background: "var(--color-accent)",
              color: "var(--bg)",
              border: "none",
              cursor: "pointer",
              boxShadow: "var(--wp-schein, 0 2px 10px -2px color-mix(in srgb, var(--color-accent) 50%, transparent))",
              transition: "background var(--dur-micro) var(--ease), transform var(--dur-micro) var(--ease)",
            }}
            title="Neuen Block oder Event hinzufügen"
          >
            + Hinzufügen
          </button>
        </div>
      </div>

      {/* Day-name row */}
      <div
        className="grid mb-1"
        style={{ gridTemplateColumns: `${HOUR_COL_PX}px repeat(7, 1fr)` }}
      >
        <div />
        {days.map(({ date, iso }) => {
          const h = dayHeader(date, iso === today);
          return (
            <div
              key={iso}
              className="text-center py-1"
              style={{
                background: h.isToday
                  ? "var(--wp-heute-kopf, color-mix(in srgb, var(--color-accent) 8%, transparent))"
                  : "transparent",
                borderRadius: 6,
              }}
            >
              <div
                className="font-display font-semibold text-[11px]"
                style={{ color: h.isToday ? "var(--color-accent)" : "var(--text-2)" }}
              >
                {h.wd}
              </div>
              <div className="font-mono text-[10px] text-fg-tertiary">{h.date}</div>
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        className="grid relative rounded-card-sm overflow-hidden"
        style={{
          gridTemplateColumns: `${HOUR_COL_PX}px repeat(7, 1fr)`,
          background: "color-mix(in srgb, var(--ink-3) 45%, transparent)",
          border: "1px solid var(--line-1)",
        }}
      >
        {/* Hour column */}
        <div style={{ position: "relative", height: gridHeight }}>
          {Array.from({ length: slotCount }, (_, i) => {
            const min = viewStartMin + i * SLOT_MIN;
            if (min % 60 !== 0) return null;
            return (
              <div
                key={i}
                className="font-mono text-[10px] text-fg-tertiary"
                style={{ position: "absolute", top: i * SLOT_PX - 6, right: 6, lineHeight: 1 }}
              >
                {minToHHMM(min)}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {days.map(({ iso }) => {
          const dayEvents = calendarEvents.filter((e) => isoDate(new Date(e.start)) === iso);
          const dayBlocks = studyBlocks.filter((b) => b.date === iso);
          // Sessions that landed on this day AND have a clock time
          let daySessions = sessions.filter(
            (s) => s.date === iso && typeof s.startedAtMs === "number",
          );
          // Cross-day session drag: hide on origin, show on drag target
          if (drag.kind === "movingSession") {
            const dragged = sessions.find((s) => s.id === drag.sessionId);
            if (dragged) {
              if (dragged.date === iso && drag.curDate !== iso) {
                daySessions = daySessions.filter((s) => s.id !== drag.sessionId);
              }
              if (drag.curDate === iso && dragged.date !== iso) {
                daySessions = [...daySessions, dragged];
              }
            }
          }
          const dragGhost =
            drag.kind === "moving" && drag.curDate === iso
              ? studyBlocks.find((b) => b.id === drag.blockId) ?? null
              : null;

          return (
            <DayColumn
              key={iso}
              iso={iso}
              isToday={iso === today}
              gridHeight={gridHeight}
              wakeMin={viewStartMin}
              nowMin={nowMin}
              slotCount={slotCount}
              events={dayEvents}
              blocks={dayBlocks}
              sessions={daySessions}
              dragState={drag}
              dragGhost={dragGhost}
              subjects={subjects}
              selectedBlockId={selectedBlockId}
              openBlock={openBlock}
              onSelectBlock={setSelectedBlockId}
              onOpenBlock={setOpenBlock}
              onBeginMove={beginMove}
              onBeginResize={beginResize}
              onBeginSessionMove={beginSessionMove}
              onEventClick={handleEventClick}
              onAutoBlockClick={handleAutoBlockClick}
              onDeleteBlock={(id) => {
                deleteStudyBlock(id);
                if (selectedBlockId === id) setSelectedBlockId(null);
                if (openBlock === id) setOpenBlock(null);
              }}
              onUpdateBlock={updateStudyBlock}
              onEmptyClick={handleEmptyClick}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-fg-tertiary flex-wrap">
        {CATEGORIES.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span style={{
              width: 8, height: 8, borderRadius: 2,
              background: `color-mix(in srgb, ${c.color} 30%, transparent)`,
              border: `1px solid color-mix(in srgb, ${c.color} 70%, transparent)`,
            }} />
            {c.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="wp-zeichen" style={{ color: "var(--color-accent)" }}>✦</span>
          <span className="wp-nur-g" aria-hidden style={{ width: 8, height: 8, borderRadius: 2, border: "1px dashed var(--text-2)" }} />
          Hermes
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ color: "var(--ok)" }}>✓</span>
          gelernt
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(255,255,255,0.10)" }} />
          Termin
        </span>
      </div>

      {/* Quick-picker — rendered via portal to escape backdrop-filter
          containing blocks of the Card / glass surfaces. Without the portal
          the picker would be clipped/positioned wrong inside the blurred
          card and effectively invisible. */}
      {picker && createPortal(
        <SlotPicker
          picker={picker}
          subjects={subjects}
          onCreate={createBlockFromPicker}
          onClose={() => setPicker(null)}
          onHideEvent={(key) => {
            hideCalendarEvent(key);
            setPicker(null);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

// ── Slot picker (shown when clicking an empty slot to add a new block) ──

function SlotPicker({
  picker,
  subjects,
  onCreate,
  onClose,
  onHideEvent,
}: {
  picker: {
    iso: string;
    startMin: number;
    clientX: number;
    clientY: number;
    suggestedDuration?: number;
    suggestedCategory?: BlockCategory;
    suggestedTitle?: string;
    headerText?: string;
    eventId?: string;
    eventIsSeries?: boolean;
  };
  subjects: { id: string; name: string; color: string }[];
  onCreate: (p: { category: BlockCategory; subjectId?: string; durationMin: number; note?: string }) => void;
  onClose: () => void;
  onHideEvent?: (key: string) => void;
}) {
  const [category, setCategory] = useState<BlockCategory>(picker.suggestedCategory ?? "lern");
  const [subjectId, setSubjectId] = useState<string | undefined>(subjects[0]?.id);
  const [durationMin, setDurationMin] = useState(picker.suggestedDuration ?? 60);
  const [note, setNote] = useState(picker.suggestedTitle ?? "");

  const dateLabel = (() => {
    const [y, mo, d] = picker.iso.split("-").map((n) => parseInt(n, 10));
    const date = new Date(y, (mo || 1) - 1, d || 1);
    return date.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  })();
  const startLabel = minToHHMM(picker.startMin);

  // Position popover near click — clamp to viewport
  const popoverWidth = 280;
  const left = Math.min(window.innerWidth - popoverWidth - 16, Math.max(16, picker.clientX - popoverWidth / 2));
  const top = Math.min(window.innerHeight - 360, Math.max(16, picker.clientY + 12));

  return (
    <>
      {/* Backdrop — clicking it closes the picker. Robust against event races. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999,
          background: "rgba(0,0,0,0.35)",
        }}
      />
      <div
        data-slot-picker
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left, top,
          width: popoverWidth,
          padding: 14,
          borderRadius: 14,
          background: "var(--ink-2)",
          border: "1px solid var(--line-3)",
          boxShadow: "var(--shadow-pop)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="font-display font-semibold text-[12px] text-fg" style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {picker.headerText ?? "Neuer Block"} · {dateLabel} {startLabel}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: 9999,
            background: "rgba(255,255,255,0.06)",
            color: "var(--text-3)",
            fontSize: 11,
            border: "none",
            cursor: "pointer",
          }}
        >✕</button>
      </div>

      {/* Category */}
      <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Kategorie</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            style={{
              padding: "4px 9px",
              borderRadius: 9999,
              fontSize: 11,
              background:
                category === c.id
                  ? `color-mix(in srgb, ${c.color} 30%, transparent)`
                  : "rgba(255,255,255,0.06)",
              border:
                category === c.id
                  ? `1px solid color-mix(in srgb, ${c.color} 60%, transparent)`
                  : "1px solid transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span className="wp-zeichen">{c.emoji}</span>{c.label}
          </button>
        ))}
      </div>

      {/* Subject (only for lern) OR Title (other categories) */}
      {category === "lern" ? (
        <>
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Fach</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubjectId(s.id)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 9999,
                  fontSize: 10,
                  background:
                    subjectId === s.id
                      ? `color-mix(in srgb, ${s.color} 30%, transparent)`
                      : "rgba(255,255,255,0.06)",
                  border:
                    subjectId === s.id
                      ? `1px solid color-mix(in srgb, ${s.color} 60%, transparent)`
                      : "1px solid transparent",
                  color: "var(--text-1)",
                  cursor: "pointer",
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Titel (optional)</div>
          <input
            autoFocus
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={CATEGORIES.find(c => c.id === category)?.label}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 12,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--text-1)",
              outline: "none",
            }}
          />
        </>
      )}

      {/* Duration */}
      <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Dauer</div>
      <div style={{ display: "flex", gap: 4 }}>
        {[30, 60, 90, 120].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setDurationMin(m)}
            style={{
              flex: 1,
              padding: "5px 0",
              borderRadius: 6,
              fontSize: 11,
              background:
                durationMin === m
                  ? "color-mix(in srgb, var(--color-accent) 24%, transparent)"
                  : "rgba(255,255,255,0.06)",
              border: "1px solid transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            {m < 60 ? `${m}min` : `${m / 60}h`}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onCreate({ category, subjectId, durationMin, note: note || undefined })}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          background: "var(--color-accent)",
          border: "none",
          color: "var(--bg)",
          cursor: "pointer",
          marginTop: 4,
          boxShadow: "var(--wp-schein, 0 2px 10px -2px color-mix(in srgb, var(--color-accent) 50%, transparent))",
          transition: "background var(--dur-micro) var(--ease)",
        }}
      >
        Block einfügen
      </button>

      {/* Hide actions — only when this picker was opened from an imported
          calendar event. Lets the user "delete" (locally hide) feed events. */}
      {picker.eventId && onHideEvent && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 2,
            paddingTop: 10,
            borderTop: "1px solid var(--line-1)",
          }}
        >
          <button
            type="button"
            onClick={() => onHideEvent(picker.eventId!)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 11,
              background: "color-mix(in srgb, var(--crit) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--crit) 32%, transparent)",
              color: "var(--crit)",
              cursor: "pointer",
            }}
          >
            🗑 Diesen Termin ausblenden
          </button>
          {picker.eventIsSeries && (
            <button
              type="button"
              onClick={() => onHideEvent(uidPrefix(picker.eventId!))}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 11,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--line-1)",
                color: "var(--text-3)",
                cursor: "pointer",
              }}
            >
              🗑 Ganze Serie ausblenden
            </button>
          )}
          <span style={{ fontSize: 9, color: "var(--text-4)", textAlign: "center", lineHeight: 1.3 }}>
            Nur lokal ausgeblendet · „↺" oben holt sie zurück
          </span>
        </div>
      )}
      </div>
    </>
  );
}

// ── Day column ────────────────────────────────────────────────────────────────

function DayColumn(props: {
  iso: string;
  isToday: boolean;
  gridHeight: number;
  wakeMin: number; // grid-origin minute (= view start; can be earlier than wake)
  nowMin: number;
  slotCount: number;
  events: CalendarEvent[];
  blocks: StudyBlock[];
  sessions: Session[];
  dragState: DragState;
  dragGhost: StudyBlock | null;
  subjects: { id: string; name: string; color: string }[];
  selectedBlockId: string | null;
  openBlock: string | null;
  onSelectBlock: (id: string | null) => void;
  onOpenBlock: (id: string | null) => void;
  onBeginMove: (e: React.PointerEvent, b: StudyBlock) => void;
  onBeginResize: (e: React.PointerEvent, b: StudyBlock, edge: "top" | "bottom") => void;
  onBeginSessionMove: (e: React.PointerEvent, s: Session) => void;
  onEventClick: (event: CalendarEvent, clientX: number, clientY: number) => void;
  onAutoBlockClick: (b: StudyBlock, clientX: number, clientY: number) => void;
  onDeleteBlock: (id: string) => void;
  onUpdateBlock: (id: string, patch: Partial<Omit<StudyBlock, "id">>) => void;
  onEmptyClick: (iso: string, clickY: number, gridTop: number, clientX?: number) => void;
}) {
  const {
    iso, isToday, gridHeight, wakeMin, nowMin, slotCount,
    events, blocks, sessions, dragState, dragGhost, subjects,
    selectedBlockId, openBlock,
    onSelectBlock, onOpenBlock, onBeginMove, onBeginResize, onBeginSessionMove,
    onEventClick, onAutoBlockClick, onDeleteBlock, onUpdateBlock, onEmptyClick,
  } = props;

  const colRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={colRef}
      onClick={(e) => {
        // Any click that reaches the column bg (i.e. children that don't
        // stopPropagation) → open picker at the clicked slot. Blocks/events
        // already stopPropagation, so they bypass this naturally.
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        onEmptyClick(iso, e.clientY, rect.top, e.clientX);
      }}
      style={{
        position: "relative",
        height: gridHeight,
        borderLeft: "1px solid var(--line-1)",
        background: isToday
          ? "var(--wp-heute-spalte, color-mix(in srgb, var(--color-accent) 4%, transparent))"
          : "transparent",
        cursor: "pointer",
      }}
    >
      {/* Slot grid lines */}
      {Array.from({ length: slotCount }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: i * SLOT_PX,
            left: 0,
            right: 0,
            height: SLOT_PX,
            borderTop:
              i === 0
                ? "none"
                : (wakeMin + i * SLOT_MIN) % 60 === 0
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "1px dashed rgba(255,255,255,0.03)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* "Now" indicator — a thin glowing accent line across today's column,
          like a real calendar. Updates every 60s. */}
      {isToday && nowMin >= wakeMin && nowMin <= slotCount * SLOT_MIN + wakeMin && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: ((nowMin - wakeMin) / SLOT_MIN) * SLOT_PX,
            left: 0,
            right: 0,
            height: 0,
            borderTop: "2px solid var(--color-accent)",
            boxShadow: "var(--wp-schein, 0 0 8px color-mix(in srgb, var(--color-accent) 65%, transparent))",
            zIndex: 4,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: -3,
              top: -4,
              width: 7,
              height: 7,
              borderRadius: 9999,
              background: "var(--color-accent)",
              boxShadow: "var(--wp-schein, 0 0 6px var(--color-accent))",
            }}
          />
        </div>
      )}

      {/* Calendar events — clickable to categorize as a block */}
      {events.map((e) => {
        if (e.allDay) {
          return (
            <div
              key={e.id}
              title={e.title + " · klick zum Kategorisieren"}
              onClick={(ev) => {
                ev.stopPropagation();
                onEventClick(e, ev.clientX, ev.clientY);
              }}
              style={{
                position: "absolute",
                top: 2,
                left: 2,
                right: 2,
                padding: "2px 6px",
                borderRadius: 6,
                background: "color-mix(in srgb, var(--text-1) 7%, transparent)",
                borderLeft: "2px solid color-mix(in srgb, var(--text-3) 55%, transparent)",
                fontSize: 9,
                color: "var(--text-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              {e.title}
            </div>
          );
        }
        const sMin = eventStartMin(e);
        const eMin = eventEndMin(e, sMin);
        const top = ((sMin - wakeMin) / SLOT_MIN) * SLOT_PX;
        const height = Math.max(SLOT_PX, ((eMin - sMin) / SLOT_MIN) * SLOT_PX);
        if (top + height < 0 || top > gridHeight) return null;
        return (
          <div
            key={e.id}
            title={`${e.title}\n${minToHHMM(sMin)}–${minToHHMM(eMin)}\n→ klick zum Kategorisieren`}
            onClick={(ev) => {
              ev.stopPropagation();
              onEventClick(e, ev.clientX, ev.clientY);
            }}
            style={{
              position: "absolute",
              top: Math.max(0, top),
              left: 2,
              right: 2,
              height,
              padding: "2px 6px",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--text-1) 6%, transparent)",
              border: "1px solid var(--line-2)",
              borderLeft: "2px solid color-mix(in srgb, var(--text-3) 55%, transparent)",
              fontSize: 9,
              color: "var(--text-2)",
              overflow: "hidden",
              cursor: "pointer",
              transition: "background var(--dur-micro) var(--ease)",
            }}
            onMouseEnter={(ev) => {
              (ev.currentTarget as HTMLDivElement).style.background = "color-mix(in srgb, var(--text-1) 11%, transparent)";
            }}
            onMouseLeave={(ev) => {
              (ev.currentTarget as HTMLDivElement).style.background = "color-mix(in srgb, var(--text-1) 6%, transparent)";
            }}
          >
            <div style={{ fontWeight: 600, lineHeight: 1.1 }}>{e.title}</div>
            <div className="font-mono" style={{ opacity: 0.6, fontSize: 9 }}>
              {minToHHMM(sMin)}
            </div>
          </div>
        );
      })}

      {/* Blocks */}
      {blocks.map((b) => {
        const isDraggingThis =
          (dragState.kind === "moving" && dragState.blockId === b.id) ||
          (dragState.kind === "resizing" && dragState.blockId === b.id);
        if (
          dragState.kind === "moving" &&
          dragState.blockId === b.id &&
          dragState.curDate !== iso
        ) {
          return null; // moved away
        }

        const renderStart =
          dragState.kind === "moving" && dragState.blockId === b.id
            ? dragState.curStartMin
            : dragState.kind === "resizing" && dragState.blockId === b.id
              ? dragState.curStartMin
              : b.startMin;
        const renderDur =
          dragState.kind === "resizing" && dragState.blockId === b.id
            ? dragState.curDurationMin
            : b.durationMin;

        const top = ((renderStart - wakeMin) / SLOT_MIN) * SLOT_PX;
        const height = (renderDur / SLOT_MIN) * SLOT_PX;
        const cat = categoryOf(b);
        const subject = subjects.find((s) => s.id === b.subjectId);
        // Calendar-derived blocks use their exact calendar-tag color (matches the
        // calendar card); lern blocks with a subject use the subject color;
        // everything else falls back to the category color.
        const color = b.calendar
          ? calColor(b.calendar)
          : b.category === "lern" || !b.category
            ? (subject?.color ?? cat.color)
            : cat.color;
        const isAuto = b.source === "auto";
        const isOpen = openBlock === b.id;
        const isSelected = selectedBlockId === b.id;

        return (
          <div
            key={b.id}
            data-block-id={b.id}
            onPointerDown={(e) => {
              // Bottom 6px = bottom resize, top 6px = top resize, otherwise move
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const offsetY = e.clientY - rect.top;
              if (offsetY < RESIZE_HANDLE_PX) onBeginResize(e, b, "top");
              else if (rect.height - offsetY < RESIZE_HANDLE_PX) onBeginResize(e, b, "bottom");
              else onBeginMove(e, b);
            }}
            onClick={(e) => {
              e.stopPropagation();
              // Click on AUTO block → open picker so user can replace the suggestion
              if (b.source === "auto") {
                onAutoBlockClick(b, e.clientX, e.clientY);
                return;
              }
              // Click on USER block → open the block-edit popover
              onSelectBlock(b.id);
              onOpenBlock(isOpen ? null : b.id);
            }}
            style={{
              position: "absolute",
              top,
              left: 2,
              right: 2,
              height,
              padding: "3px 6px",
              borderRadius: 5,
              background: `color-mix(in srgb, ${color} ${isAuto ? 14 : 30}%, transparent)`,
              border: `${isSelected ? 2 : 1}px ${isAuto ? "dashed" : "solid"} color-mix(in srgb, ${color} ${isAuto ? 55 : 75}%, transparent)`,
              boxShadow: isSelected
                ? `0 0 0 2px color-mix(in srgb, ${color} 35%, transparent)`
                : "none",
              color: "var(--text-1)",
              fontSize: 10,
              cursor: isDraggingThis ? "grabbing" : "grab",
              overflow: "hidden",
              opacity: isDraggingThis ? 0.75 : 1,
              zIndex: isOpen || isDraggingThis || isSelected ? 5 : 2,
              touchAction: "none",
              userSelect: "none",
              transition: isDraggingThis ? "none" : "background var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease), box-shadow var(--dur-micro) var(--ease)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4, lineHeight: 1.1 }}>
              {isAuto && (
                <span className="wp-zeichen" style={{ color, fontSize: 11, lineHeight: 1, flexShrink: 0 }} title="Hermes-Vorschlag">
                  ✦
                </span>
              )}
              {!isAuto && subject && b.category === "lern" && (
                <span style={{
                  width: 6, height: 6, borderRadius: "9999px",
                  backgroundColor: subject.color, flexShrink: 0,
                }} />
              )}
              {!isAuto && b.category && b.category !== "lern" && (
                <span className="wp-zeichen" style={{ fontSize: 10, lineHeight: 1, flexShrink: 0 }}>
                  {CATEGORIES.find(c => c.id === b.category)?.emoji}
                </span>
              )}
              <span style={{
                fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {b.note
                  ? b.note
                  : b.category && b.category !== "lern"
                    ? CATEGORIES.find(c => c.id === b.category)?.label ?? "Block"
                    : (subject?.name ?? (isAuto ? "Lernen" : "Block"))}
              </span>
            </div>
            <div className="font-mono" style={{ opacity: 0.65, fontSize: 9, marginTop: 1 }}>
              {minToHHMM(renderStart)} · {renderDur}min
            </div>

            {/* Resize handles (invisible but cursor changes) */}
            <div
              style={{
                position: "absolute", top: 0, left: 0, right: 0,
                height: RESIZE_HANDLE_PX,
                cursor: "ns-resize",
              }}
            />
            <div
              style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: RESIZE_HANDLE_PX,
                cursor: "ns-resize",
              }}
            />

            {isOpen && !isDraggingThis && (
              <BlockPopover
                block={b}
                subjects={subjects}
                onCategoryChange={(category) => onUpdateBlock(b.id, { category, source: "user" })}
                onSubjectChange={(subjectId) => onUpdateBlock(b.id, { subjectId, source: "user" })}
                onDurationChange={(durationMin) => onUpdateBlock(b.id, { durationMin, source: "user" })}
                onNoteChange={(note) => onUpdateBlock(b.id, { note: note || undefined, source: "user" })}
                onDelete={() => onDeleteBlock(b.id)}
              />
            )}
          </div>
        );
      })}

      {/* Session overlay — actually-completed study time. Full column width
          on top of plan blocks. Pointer-drag to correct WHEN the session
          happened (move only — no resize, no delete). Past sessions can also
          be moved so the productive-hours heatmap reflects reality. */}
      {sessions.map((s) => {
        if (!s.startedAtMs) return null;
        const isDraggingThis =
          dragState.kind === "movingSession" && dragState.sessionId === s.id;
        // When this session is being dragged across to a different day, hide it on the origin day
        if (
          dragState.kind === "movingSession" &&
          dragState.sessionId === s.id &&
          dragState.curDate !== iso
        ) return null;

        // Render position: use drag-current values when dragged
        const d = new Date(s.startedAtMs);
        const naturalStartMin = d.getHours() * 60 + d.getMinutes();
        const startMin = isDraggingThis ? dragState.curStartMin : naturalStartMin;
        const top = ((startMin - wakeMin) / SLOT_MIN) * SLOT_PX;
        const height = Math.max(SLOT_PX * 0.6, (s.durationMin / SLOT_MIN) * SLOT_PX);
        if (top + height < 0 || top > gridHeight) return null;
        const subject = subjects.find((sb) => sb.id === s.subjectId);
        const color = subject?.color ?? "var(--ok)";
        const startLabel = minToHHMM(startMin);
        return (
          <div
            key={`sess-${s.id}`}
            data-session-id={s.id}
            title={`${subject?.name ?? "Session"} · ${startLabel} · ${s.durationMin}min${s.note ? "\n" + s.note : ""}\n→ ziehen, um die Zeit zu korrigieren · klick, um neuen Block hier zu setzen`}
            onPointerDown={(ev) => onBeginSessionMove(ev, s)}
            onClick={(ev) => {
              // Browser suppresses click after a real drag (movement > ~5px).
              // So this only fires for genuine clicks → open the picker at the
              // session's slot so Paul can add a new block here too.
              ev.stopPropagation();
              // Fake an empty-slot click at the column-relative Y
              const rect = (ev.currentTarget.parentElement as HTMLDivElement | null)?.getBoundingClientRect();
              if (!rect) return;
              onEmptyClick(iso, ev.clientY, rect.top, ev.clientX);
            }}
            style={{
              position: "absolute",
              top,
              left: 2,
              right: 2,
              height,
              padding: "3px 6px",
              borderRadius: 5,
              background: `color-mix(in srgb, ${color} 28%, transparent)`,
              border: `1.5px solid color-mix(in srgb, ${color} 85%, transparent)`,
              color: "var(--text-1)",
              fontSize: 10,
              overflow: "hidden",
              cursor: isDraggingThis ? "grabbing" : "grab",
              opacity: isDraggingThis ? 0.75 : 1,
              zIndex: isDraggingThis ? 6 : 3,
              touchAction: "none",
              userSelect: "none",
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--ok) 30%, transparent)`,
              transition: isDraggingThis ? "none" : "background var(--dur-micro) var(--ease)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4, lineHeight: 1.1 }}>
              <span style={{ color: "var(--ok)", fontSize: 11, lineHeight: 1, flexShrink: 0 }}>✓</span>
              <span style={{
                fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {subject?.name ?? "Session"}
              </span>
            </div>
            <div className="font-mono" style={{ opacity: 0.7, fontSize: 9, marginTop: 1 }}>
              {startLabel} · {s.durationMin}min
            </div>
          </div>
        );
      })}

      {/* Drag ghost target */}
      {dragGhost && dragState.kind === "moving" && dragState.curDate === iso && (
        <div
          style={{
            position: "absolute",
            top: ((dragState.curStartMin - wakeMin) / SLOT_MIN) * SLOT_PX,
            left: 2,
            right: 2,
            height: (dragGhost.durationMin / SLOT_MIN) * SLOT_PX,
            borderRadius: 5,
            border: "2px dashed var(--color-accent)",
            background: "transparent",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
}

// ── Block edit popover ────────────────────────────────────────────────────────

function BlockPopover({
  block,
  subjects,
  onCategoryChange,
  onSubjectChange,
  onDurationChange,
  onNoteChange,
  onDelete,
}: {
  block: StudyBlock;
  subjects: { id: string; name: string; color: string }[];
  onCategoryChange: (c: BlockCategory) => void;
  onSubjectChange: (id: string) => void;
  onDurationChange: (min: number) => void;
  onNoteChange: (note: string) => void;
  onDelete: () => void;
}) {
  const cat = block.category ?? "lern";
  return (
    <div
      data-block-popover
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        minWidth: 240,
        padding: 12,
        borderRadius: 14,
        background: "var(--ink-2)",
        border: "1px solid var(--line-2)",
        boxShadow: "var(--shadow-pop)",
        zIndex: 999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        cursor: "default",
      }}
    >
      {/* Category */}
      <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Kategorie</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCategoryChange(c.id)}
            style={{
              padding: "3px 8px",
              borderRadius: 9999,
              fontSize: 10,
              background:
                cat === c.id
                  ? `color-mix(in srgb, ${c.color} 30%, transparent)`
                  : "rgba(255,255,255,0.06)",
              border:
                cat === c.id
                  ? `1px solid color-mix(in srgb, ${c.color} 60%, transparent)`
                  : "1px solid transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span className="wp-zeichen">{c.emoji}</span>{c.label}
          </button>
        ))}
      </div>

      {/* Subject — only for Lern */}
      {cat === "lern" && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mt-1">Fach</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSubjectChange(s.id)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 9999,
                  fontSize: 10,
                  background:
                    block.subjectId === s.id
                      ? `color-mix(in srgb, ${s.color} 30%, transparent)`
                      : "rgba(255,255,255,0.06)",
                  border:
                    block.subjectId === s.id
                      ? `1px solid color-mix(in srgb, ${s.color} 60%, transparent)`
                      : "1px solid transparent",
                  color: "var(--text-1)",
                  cursor: "pointer",
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Note — for non-lern categories (Sport mit Tom etc.) */}
      {cat !== "lern" && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mt-1">Titel</div>
          <input
            type="text"
            value={block.note ?? ""}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={CATEGORIES.find(c => c.id === cat)?.label}
            style={{
              padding: "5px 8px",
              borderRadius: 6,
              fontSize: 11,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--text-1)",
              outline: "none",
            }}
          />
        </>
      )}

      {/* Duration */}
      <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mt-1">Dauer</div>
      <div style={{ display: "flex", gap: 4 }}>
        {[30, 60, 90, 120].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onDurationChange(m)}
            style={{
              flex: 1,
              padding: "4px 0",
              borderRadius: 6,
              fontSize: 10,
              background:
                block.durationMin === m
                  ? "color-mix(in srgb, var(--color-accent) 24%, transparent)"
                  : "rgba(255,255,255,0.06)",
              border: "1px solid transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            {m < 60 ? `${m}min` : `${m / 60}h`}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onDelete}
        style={{
          marginTop: 4,
          padding: "5px 10px",
          borderRadius: 6,
          fontSize: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "var(--crit)",
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        ✕ Block löschen  (oder ⌫-Taste)
      </button>
    </div>
  );
}
