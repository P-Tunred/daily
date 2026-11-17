import { useCallback, useEffect, useMemo, useState } from "react";
import { anthropicMessages, aiEnabled } from "../lib/anthropic";
import { Card } from "./Card";
import { WeeklyTimeline } from "./WeeklyTimeline";
import { WeekPlanChat } from "./WeekPlanChat";
import type { CalendarEvent } from "../types";
import { useStil } from "../lib/stil";
import { stundenZahl } from "../lib/stunden";
import { useTracker, isoDate, goalMinForDate, totalsByDate, WEEKDAY_LABELS_FULL } from "../tracker/store";

// ── localStorage keys ─────────────────────────────────────────────────────────

const PLAN_TEXT_KEY = "morning.weekPlan.text";
const PLAN_GENERATED_KEY = "morning.weekPlan.generatedAt";

// ── AI: routed through the local /api/anthropic proxy (key stays server-side) ──

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the Monday of the week containing `d` (local time). */
function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() + diff);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function formatHM(date: Date): string {
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDayShort(d: Date): string {
  // "Mo 27.5"
  const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
  return `${wd} ${d.getDate()}.${d.getMonth() + 1}`;
}

function minToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// ── Per-day cell ──────────────────────────────────────────────────────────────

function DayCell({
  day,
  goalMin,
  studiedMin,
  events,
  onGoalChange,
  isToday,
}: {
  day: Date;
  goalMin: number;
  studiedMin: number;
  events: CalendarEvent[];
  onGoalChange: (min: number) => void;
  isToday: boolean;
}) {
  const iso = isoDate(day);
  const isPast = iso < isoDate();
  const isFuture = iso > isoDate();
  const goalH = goalMin / 60;
  const progress = goalMin > 0 ? Math.min(1, studiedMin / goalMin) : 0;
  const reached = goalMin > 0 && studiedMin >= goalMin;
  const g = useStil() === "g";

  const visibleEvents = events.slice(0, 3);
  const moreCount = events.length - visibleEvents.length;

  // Local hours state for the inline +/- buttons. Mirror the prop, write through.
  const [hours, setHours] = useState<number>(goalH);
  useEffect(() => { setHours(goalH); }, [goalH]);

  const commit = (newH: number) => {
    const clamped = Math.max(0, Math.min(12, Math.round(newH * 2) / 2)); // half-hour steps
    setHours(clamped);
    onGoalChange(Math.round(clamped * 60));
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-card-sm p-3"
      style={{
        background: isToday
          ? "var(--wp-heute-grund, color-mix(in srgb, var(--color-accent) 8%, var(--ink-2)))"
          : "var(--wp-tag-grund, var(--fill-1))",
        border: isToday
          ? "1px solid var(--wp-heute-rand, color-mix(in srgb, var(--color-accent) 35%, transparent))"
          : "1px solid var(--line-1)",
        minHeight: 180,
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <span
          className="font-display font-semibold text-[12px]"
          style={{ color: isToday ? "var(--wp-heute-text, var(--color-accent))" : "var(--text-1)" }}
        >
          {formatDayShort(day)}
        </span>
        {isPast && reached && (
          <span className="text-[10px] font-mono" style={{ color: "var(--ok)" }}>✓</span>
        )}
      </div>

      {/* Hours adjuster */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => commit(hours - 0.5)}
          disabled={isPast}
          className="w-5 h-5 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary text-[11px] inline-flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="0.5h weniger"
        >−</button>
        <span
          className="font-mono font-semibold text-[13px] tabular-nums flex-1 text-center"
          style={{ color: goalMin === 0 ? "var(--text-2)" : "var(--text-1)" }}
        >
          {g ? stundenZahl(hours * 60) : hours.toFixed(1).replace(/\.0$/, "")} h
        </span>
        <button
          onClick={() => commit(hours + 0.5)}
          disabled={isPast}
          className="w-5 h-5 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary text-[11px] inline-flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="0.5h mehr"
        >+</button>
      </div>

      {/* Progress bar */}
      {goalMin > 0 && (
        <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line-1)" }}>
          <div
            className="absolute inset-y-0 left-0 transition-all duration-300"
            style={{
              width: `${progress * 100}%`,
              background: reached
                ? "var(--wp-erreicht, var(--ok))"
                : isFuture
                  ? "var(--wp-geplant, color-mix(in srgb, var(--color-accent) 60%, transparent))"
                  : "var(--wp-teil, var(--warn))",
            }}
          />
        </div>
      )}

      {/* Studied vs goal */}
      <div className="text-[10px] font-mono text-fg-tertiary tabular-nums">
        {isFuture ? "geplant" : `${minToHHMM(studiedMin)} / ${minToHHMM(goalMin)}`}
      </div>

      {/* Events */}
      {visibleEvents.length > 0 && (
        <div className="flex flex-col gap-1 mt-1 pt-2 border-t border-white/[0.05]">
          {visibleEvents.map((e) => {
            const startDate = new Date(e.start);
            return (
              <div key={e.id} className="flex items-start gap-1.5 text-[10px] leading-tight">
                {!e.allDay && (
                  <span className="font-mono text-fg-tertiary tabular-nums shrink-0">
                    {formatHM(startDate)}
                  </span>
                )}
                <span className="text-fg-secondary truncate" title={e.title}>
                  {e.title}
                </span>
              </div>
            );
          })}
          {moreCount > 0 && (
            <span className="text-[10px] text-fg-tertiary italic">+{moreCount} weitere</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Jarvis plan prompt ────────────────────────────────────────────────────────

function buildWeekPlanPrompt(params: {
  weekStart: Date;
  goalsByDay: { iso: string; weekdayLabel: string; goalMin: number; events: CalendarEvent[]; studiedMin: number }[];
  weeklyGoalHours: number;
  wakeTime: string;
  sleepTime: string;
  subjects: { id: string; name: string }[];
  /** Current week's auto+user blocks, so the explainer matches what's on screen. */
  studyBlocks: { date: string; startMin: number; durationMin: number; source: "auto" | "user"; category?: string; subjectId?: string }[];
  /** Most productive (weekday, hour) slots from session history. */
  productivePeaks: string[];
}): string {
  const { weekStart, goalsByDay, weeklyGoalHours, wakeTime, sleepTime, subjects, studyBlocks, productivePeaks } = params;
  const weekEnd = addDays(weekStart, 6);
  const weekRange = `${weekStart.getDate()}.${weekStart.getMonth() + 1} – ${weekEnd.getDate()}.${weekEnd.getMonth() + 1}`;

  const subjectName = (id?: string) => subjects.find(s => s.id === id)?.name ?? "—";

  const daysBlock = goalsByDay
    .map((d) => {
      const evs = d.events
        .map((e) => {
          const t = e.allDay ? "ganztägig" : formatHM(new Date(e.start));
          return `   • ${t} — ${e.title}`;
        })
        .join("\n") || "   (keine Termine)";
      const blocks = studyBlocks
        .filter((b) => b.date === d.iso)
        .sort((a, b) => a.startMin - b.startMin)
        .map((b) => {
          const hh = Math.floor(b.startMin / 60).toString().padStart(2, "0");
          const mm = (b.startMin % 60).toString().padStart(2, "0");
          const tag = b.source === "auto" ? "Vorschlag" : "fest";
          const cat = b.category && b.category !== "lern" ? b.category : subjectName(b.subjectId);
          return `   → ${hh}:${mm} · ${b.durationMin}min · ${cat} (${tag})`;
        })
        .join("\n") || "   (keine Blöcke geplant)";
      return `${d.weekdayLabel} (${d.iso}) — Ziel: ${Math.round(d.goalMin / 60 * 10) / 10}h\n${evs}\n${blocks}`;
    })
    .join("\n\n");

  const totalGoalH = goalsByDay.reduce((a, b) => a + b.goalMin, 0) / 60;
  const peaksLine = productivePeaks.length > 0
    ? `Pauls produktivste Slots (aus Sessions): ${productivePeaks.join(", ")}`
    : "Noch zu wenig Session-Daten für Produktivitäts-Muster.";

  return `Erkläre Paul den aktuellen Wochenplan für ${weekRange} — KEIN neuer Plan, sondern eine Begründung der bestehenden Verteilung.

Wochen-Lernziel: ${weeklyGoalHours}h (aktuell verteilt: ${totalGoalH.toFixed(1)}h)
Aufwachen: ${wakeTime} · Schlafen: ${sleepTime}
Fächer: ${subjects.map((s) => s.name).join(", ") || "(keine angelegt)"}
${peaksLine}

Tages-Aufstellung mit Terminen und Lernblöcken (was IST geplant):

${daysBlock}

Schreibe einen kurzen Wochen-Überblick (3-5 Absätze, unter 220 Wörtern):
1. Wochen-These in 1 Satz ("Diese Woche dreht sich um X, weil...")
2. Warum sind die Hauptlernblöcke an den ausgewählten Tagen? Beziehe dich konkret auf Termine + produktive Slots.
3. Welche Fächer würdest du in welche Blöcke legen — und warum?
4. Wo ist die Woche knapp / wo bleibt Puffer? Was passiert wenn ein Termin reinkommt?

Nutze "du". Schreibe persönlich und direkt. Keine Bulletpoints, fließender Text.`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function WeekPlanCard({ calendarEvents }: { calendarEvents: CalendarEvent[] }) {
  const {
    sessions,
    goalsByWeekday,
    setGoalForWeekday,
    goalOverrides,
    clearGoalOverride,
    weeklyGoalHours,
    setWeeklyGoalHours,
    subjects,
    wakeTime,
    sleepTime,
    goalMin,
    goalMinWeekend,
    goalEpochs,
    studyBlocks,
  } = useTracker();

  // Week navigation — 0 = current week, +1 = next, -1 = last
  const [weekOffset, setWeekOffset] = useState(0);
  const baseMonday = useMemo(() => {
    const m = mondayOf(new Date());
    return addDays(m, weekOffset * 7);
  }, [weekOffset]);

  // Per-day computed data
  const days = useMemo(() => {
    const totals = totalsByDate(sessions);
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(baseMonday, i);
      const iso = isoDate(date);
      const dayEvents = calendarEvents
        .filter((e) => {
          const start = new Date(e.start);
          return isoDate(start) === iso;
        })
        .sort((a, b) => +new Date(a.start) - +new Date(b.start));
      return {
        date,
        iso,
        weekdayLabel: WEEKDAY_LABELS_FULL[date.getDay()],
        // Per-weekday goal is the SINGLE source of truth here — no date-override
        // lookup — so the Wochenplan day-hours always equal the Lernzeit settings
        // sliders (both read goalsByWeekday). Editing either side updates the same
        // value (setGoalForWeekday also clears any stale override on that weekday).
        // The goal history still applies: days earlier in the week keep the goal
        // they were measured against, so a mid-week change can't rewrite Mon–Mi.
        goalMin: goalMinForDate(date, goalsByWeekday, goalMin, goalMinWeekend, undefined, goalEpochs),
        studiedMin: totals.get(iso) ?? 0,
        events: dayEvents,
      };
    });
  }, [baseMonday, calendarEvents, sessions, goalsByWeekday, goalOverrides, goalMin, goalMinWeekend, goalEpochs]);

  const totalGoalMin = days.reduce((a, d) => a + d.goalMin, 0);
  const totalStudiedMin = days.reduce((a, d) => a + d.studiedMin, 0);
  const weeklyGoalMin = weeklyGoalHours * 60;

  const today = isoDate();

  // ── Prognose — realistic projection of where this week lands ──
  // Counts actual studied hours (uncapped — overtime beyond the daily goal still
  // counts) plus the hours that are still planned but not yet done.
  //   • past days  → actual studied time (incl. overtime, never capped at goal)
  //   • today      → done + remaining planned ( = max(studied, goal) )
  //   • future     → the day's planned goal
  const totalForecastMin = days.reduce((a, d) => {
    if (d.iso < today) return a + d.studiedMin;
    if (d.iso === today) return a + Math.max(d.studiedMin, d.goalMin);
    return a + d.goalMin;
  }, 0);
  const forecastOvertimeMin = Math.max(0, totalForecastMin - weeklyGoalMin);
  const weekLabel =
    weekOffset === 0
      ? "Diese Woche"
      : weekOffset === 1
        ? "Nächste Woche"
        : weekOffset === -1
          ? "Letzte Woche"
          : `${weekOffset > 0 ? "+" : ""}${weekOffset} Wochen`;

  const weekRange = `${baseMonday.getDate()}.${baseMonday.getMonth() + 1} – ${addDays(baseMonday, 6).getDate()}.${addDays(baseMonday, 6).getMonth() + 1}`;

  // ── Jarvis plan ──
  const [planText, setPlanText] = useState<string>(() => localStorage.getItem(PLAN_TEXT_KEY) ?? "");
  const [planGeneratedAt, setPlanGeneratedAt] = useState<string>(() => localStorage.getItem(PLAN_GENERATED_KEY) ?? "");
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Productive peaks — top 3 (weekday, hour) slots from sessions
  const productivePeaks = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const s of sessions) {
      if (!s.startedAtMs) continue;
      const d = new Date(s.startedAtMs);
      const wd = (d.getDay() + 6) % 7;
      grid[wd][d.getHours()] += s.durationMin;
    }
    const dayN = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    type Slot = { wd: number; h: number; m: number };
    const all: Slot[] = [];
    for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) all.push({ wd: w, h, m: grid[w][h] });
    return all
      .filter((s) => s.m > 0)
      .sort((a, b) => b.m - a.m)
      .slice(0, 3)
      .map((s) => `${dayN[s.wd]} ${s.h.toString().padStart(2, "0")}:00`);
  }, [sessions]);

  const handleGeneratePlan = useCallback(async () => {
    if (!aiEnabled) {
      setPlanError("KI ist deaktiviert — ANTHROPIC_API_KEY in .env setzen (und VITE_AI_ENABLED=1).");
      return;
    }
    setPlanLoading(true);
    setPlanError(null);
    try {
      // Filter studyBlocks to the current week range
      const weekIsos = days.map((d) => d.iso);
      const blocksForWeek = studyBlocks.filter((b) => weekIsos.includes(b.date));
      const prompt = buildWeekPlanPrompt({
        weekStart: baseMonday,
        goalsByDay: days,
        weeklyGoalHours,
        wakeTime,
        sleepTime,
        subjects,
        studyBlocks: blocksForWeek,
        productivePeaks,
      });
      const res = await anthropicMessages({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const block = res.content[0];
      const text = (block && block.type === "text" ? block.text : "") ?? "";
      setPlanText(text);
      const stamp = new Date().toISOString();
      setPlanGeneratedAt(stamp);
      try {
        localStorage.setItem(PLAN_TEXT_KEY, text);
        localStorage.setItem(PLAN_GENERATED_KEY, stamp);
      } catch { /* quota */ }
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setPlanLoading(false);
    }
  }, [baseMonday, days, weeklyGoalHours, wakeTime, sleepTime, subjects, studyBlocks, productivePeaks]);

  const planAge = planGeneratedAt ? Date.now() - +new Date(planGeneratedAt) : null;
  const planStale = planAge !== null && planAge > 7 * 24 * 60 * 60 * 1000; // older than 1 week
  // Stil G schreibt Stunden deutsch („15,3 h"), das Original bleibt bei „15.3h".
  const g = useStil() === "g";
  const stunde = (min: number) => (g ? `${stundenZahl(min)} h` : `${(min / 60).toFixed(1)}h`);

  return (
    <Card
      title="Wochenplan"
      icon="🗓️"
      meta={weekRange}
      className="wp"
      action={
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="w-7 h-7 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary inline-flex items-center justify-center transition-colors"
            title="Vorherige Woche"
          >‹</button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 h-7 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary text-[11px] font-display font-medium transition-colors"
            title="Diese Woche"
          >
            {weekLabel}
          </button>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="w-7 h-7 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary inline-flex items-center justify-center transition-colors"
            title="Nächste Woche"
          >›</button>
        </div>
      }
    >
      {/* Weekly goal adjuster */}
      <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-white/[0.05]">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Wochenziel</span>
          <button
            onClick={() => setWeeklyGoalHours(Math.max(0, weeklyGoalHours - 1))}
            className="w-6 h-6 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary text-[12px] inline-flex items-center justify-center transition-colors"
          >−</button>
          <span className="font-display font-bold text-[18px] tabular-nums text-fg">
            {weeklyGoalHours}{g ? " h" : "h"}
          </span>
          <button
            onClick={() => setWeeklyGoalHours(weeklyGoalHours + 1)}
            className="w-6 h-6 rounded-full bg-white/8 hover:bg-white/15 text-fg-secondary text-[12px] inline-flex items-center justify-center transition-colors"
          >+</button>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Verteilt</div>
          <div className="font-mono text-[13px] tabular-nums">
            <span style={{ color: totalGoalMin >= weeklyGoalMin ? "var(--wp-gut, var(--ok))" : "var(--warn)" }}>
              {stunde(totalGoalMin)}
            </span>
            <span className="text-fg-tertiary"> / {weeklyGoalHours}{g ? " h" : "h"}</span>
          </div>
        </div>
        <div className="text-right">
          <div
            className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary"
            title="Schon gelernt (inkl. Überstunden) + noch geplante Stunden"
          >
            Prognose
          </div>
          <div className="font-mono text-[13px] tabular-nums">
            <span style={{ color: totalForecastMin >= weeklyGoalMin ? "var(--wp-gut, var(--ok))" : "var(--warn)" }}>
              {stunde(totalForecastMin)}
            </span>
            <span className="text-fg-tertiary"> / {weeklyGoalHours}{g ? " h" : "h"}</span>
            {forecastOvertimeMin > 0 && (
              <span style={{ color: "var(--wp-gut, var(--ok))" }}> · +{stunde(forecastOvertimeMin)}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Gelernt</div>
          <div className="font-mono text-[13px] tabular-nums text-fg">
            {stunde(totalStudiedMin)}
          </div>
        </div>
      </div>

      {/* 7-day grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 mb-5">
        {days.map((d) => (
          <DayCell
            key={d.iso}
            day={d.date}
            goalMin={d.goalMin}
            studiedMin={d.studiedMin}
            events={d.events}
            isToday={d.iso === today}
            onGoalChange={(min) => {
              // Sync to the per-weekday goal (Settings "Tagesziele pro Wochentag").
              // Clear any date-specific override so the weekday value is what shows.
              setGoalForWeekday(d.date.getDay(), min);
              if (goalOverrides[d.iso] !== undefined) clearGoalOverride(d.iso);
            }}
          />
        ))}
      </div>

      {/* Hourly timeline — wake to sleep, 30-min slots, drag-and-drop blocks */}
      <WeeklyTimeline
        weekStart={baseMonday}
        calendarEvents={calendarEvents}
        goalsByDay={days.map((d) => d.goalMin)}
      />

      {/* Chat — tell Jarvis what to change in natural language */}
      <WeekPlanChat
        weekStart={baseMonday}
        calendarEvents={calendarEvents}
        goalsByDay={days.map((d) => d.goalMin)}
      />

      <div className="mb-5" />

      {/* Wochen-Überblick — Jarvis erklärt die aktuelle Verteilung */}
      <div className="rounded-card-sm p-4" style={{ background: "var(--fill-0)", border: "1px solid var(--line-1)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {!g && <span style={{ color: "var(--color-accent)" }}>✦</span>}
            <span className="font-display font-semibold text-[13px] text-fg">Wochen-Überblick</span>
            <span className="font-mono text-[10px] text-fg-tertiary">· warum diese Verteilung?</span>
            {planGeneratedAt && (
              <span className="font-mono text-[10px] text-fg-tertiary">
                · {new Date(planGeneratedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {planStale && (
              <span className="font-mono text-[10px]" style={{ color: "var(--warn)" }}>· veraltet</span>
            )}
          </div>
          <button
            onClick={handleGeneratePlan}
            disabled={planLoading}
            className="rounded-full px-3 py-1.5 text-[11px] font-display font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--wp-knopf-grund, color-mix(in srgb, var(--color-accent) 18%, transparent))",
              color: "var(--wp-knopf-text, var(--color-accent))",
              border: "1px solid var(--wp-knopf-rand, color-mix(in srgb, var(--color-accent) 35%, transparent))",
            }}
          >
            {g
              ? (planLoading ? "schreibt…" : planText ? "Aktualisieren" : "Erklären lassen")
              : (planLoading ? "⏳ schreibt…" : planText ? "↻ Aktualisieren" : "✦ Erklären lassen")}
          </button>
        </div>

        {planError && (
          <p className="text-[12px]" style={{ color: "var(--crit)" }}>{planError}</p>
        )}
        {!planError && planText && (
          <div
            className="text-[13px] text-fg-secondary leading-relaxed whitespace-pre-wrap"
            style={{ maxHeight: 280, overflowY: "auto" }}
          >
            {planText}
          </div>
        )}
        {!planError && !planText && (
          <p className="text-[12px] text-fg-tertiary italic">
            Hermes platziert Vorschläge (gestrichelt{g ? "" : ", ✦"}) automatisch im Stundenplan basierend auf deinen produktivsten Zeiten und Terminen. Klick „Erklären lassen" für eine kurze Begründung der aktuellen Verteilung.
          </p>
        )}
      </div>
    </Card>
  );
}
