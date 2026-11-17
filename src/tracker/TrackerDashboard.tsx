import { useMemo } from "react";
import { FlatSection } from "../components/FlatSection";
import { ProgressRing } from "./ProgressRing";
import {
  isoDate,
  streakDays,
  totalsBySubjectInRange,
  useTracker,
} from "./store";
import { SubjectMark } from "./SubjectDot";
import type { Session, Subject } from "./types";
import { useImportantEvents } from "../important/store";
import type { ImportantEvent } from "../important/types";

// ── Trend helpers ──────────────────────────────────────────────────────────────

function trendArrow(curr: number, prev: number): { icon: string; cls: string; pct: number } {
  if (prev === 0) return curr > 0 ? { icon: "↑", cls: "text-[var(--color-positive)]", pct: 100 } : { icon: "—", cls: "text-fg-tertiary", pct: 0 };
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct >= 10) return { icon: "↑", cls: "text-[var(--color-positive)]", pct };
  if (pct <= -10) return { icon: "↓", cls: "text-[var(--color-red)]", pct };
  return { icon: "→", cls: "text-fg-tertiary", pct };
}

/** Share of days in the range that met their goal. Each day is judged against
 *  the goal that applied THEN — a new weekly target doesn't rewrite last week. */
function goalAdherence(
  sessions: { date: string; durationMin: number }[],
  effectiveGoal: (date: Date) => number,
  fromIso: string,
  toIso: string,
): number {
  let daysHit = 0;
  let totalDays = 0;
  const start = new Date(fromIso);
  const end = new Date(toIso);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoDate(new Date(d));
    if (iso > isoDate()) break; // don't count future days
    const eff = effectiveGoal(new Date(d));
    if (eff === 0) continue;          // day with no goal — skip from adherence
    totalDays++;
    const dayMin = sessions.filter(s => s.date === iso).reduce((a, s) => a + s.durationMin, 0);
    if (dayMin >= eff) daysHit++;
  }
  return totalDays === 0 ? 0 : Math.round((daysHit / totalDays) * 100);
}

function formatHM(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m}`;
}

function startOfWeekIso(d: Date): string {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return isoDate(date);
}

function startOfMonthIso(d: Date): string {
  const date = new Date(d);
  date.setDate(1);
  return isoDate(date);
}

export function TrackerDashboard() {
  const { subjects, sessions, goalMin, goalMinWeekend, goalsByWeekday, weeklyGoalHours, goalForDate } = useTracker();
  const { events: importantEvents } = useImportantEvents();

  const today = isoDate();
  const weekStart = startOfWeekIso(new Date());
  const monthStart = startOfMonthIso(new Date());

  // Previous periods for comparison
  const prevWeekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 1);
    return isoDate(d);
  }, [weekStart]);
  const prevWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    return isoDate(d);
  }, [weekStart]);
  const prevMonthEnd = useMemo(() => {
    const d = new Date(monthStart);
    d.setDate(d.getDate() - 1);
    return isoDate(d);
  }, [monthStart]);
  const prevMonthStart = useMemo(() => {
    const d = new Date(prevMonthEnd);
    d.setDate(1);
    return isoDate(d);
  }, [prevMonthEnd]);

  const todayBySubject = useMemo(
    () => totalsBySubjectInRange(sessions, today, today),
    [sessions, today],
  );
  const weekBySubject = useMemo(
    () => totalsBySubjectInRange(sessions, weekStart, today),
    [sessions, weekStart, today],
  );
  const monthBySubject = useMemo(
    () => totalsBySubjectInRange(sessions, monthStart, today),
    [sessions, monthStart, today],
  );
  const prevWeekBySubject = useMemo(
    () => totalsBySubjectInRange(sessions, prevWeekStart, prevWeekEnd),
    [sessions, prevWeekStart, prevWeekEnd],
  );
  const prevMonthBySubject = useMemo(
    () => totalsBySubjectInRange(sessions, prevMonthStart, prevMonthEnd),
    [sessions, prevMonthStart, prevMonthEnd],
  );

  const sumMap = (m: Map<string, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);

  const todayMin = sumMap(todayBySubject);
  const weekMin = sumMap(weekBySubject);
  const monthMin = sumMap(monthBySubject);
  const prevWeekMin = sumMap(prevWeekBySubject);
  const prevMonthMin = sumMap(prevMonthBySubject);

  const weekTrend  = trendArrow(weekMin, prevWeekMin);
  const monthTrend = trendArrow(monthMin, prevMonthMin);

  // Goal adherence (% of days this week/month where daily goal was met)
  const weekAdherence  = useMemo(() => goalAdherence(sessions, goalForDate, weekStart, today), [sessions, goalForDate, weekStart, today]);
  const monthAdherence = useMemo(() => goalAdherence(sessions, goalForDate, monthStart, today), [sessions, goalForDate, monthStart, today]);

  const streak = useMemo(() => streakDays(sessions, goalForDate), [sessions, goalForDate]);

  // Today's effective goal (uses weekday array)
  const todayIsWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
  const todayGoal = goalForDate(new Date());
  const goalProgress = todayGoal > 0 ? Math.min(1, todayMin / todayGoal) : 0;
  const goalPct = todayGoal > 0 ? Math.round((todayMin / todayGoal) * 100) : 0;
  const weeklyTargetTotal = goalsByWeekday?.reduce((a, b) => a + b, 0) ?? (goalMin * 5 + (goalMinWeekend || goalMin) * 2);

  const monthBars = useMemo(() => {
    const totals = subjects.map((s) => ({
      subject: s,
      min: monthBySubject.get(s.id) ?? 0,
    }));
    totals.sort((a, b) => b.min - a.min);
    const max = Math.max(1, ...totals.map((t) => t.min));
    return { totals, max };
  }, [subjects, monthBySubject]);

  return (
    <div className="flex flex-col gap-6">
      <FlatSection title="Heute" icon="📅" size="large" className="flat-hero">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-center">
          {/* Number alone inside the ring, caption below — mirrors the Daily day card */}
          <div className="flex flex-col items-center gap-3 justify-center">
            <ProgressRing
              progress={goalProgress}
              size={200}
              strokeWidth={12}
              color="var(--lz-accent, var(--ok))"
            >
              <span
                className="metric text-5xl tabular-nums leading-none"
                style={{ color: "var(--text-1)", letterSpacing: "-0.03em" }}
              >
                {goalPct}
              </span>
            </ProgressRing>
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
              % Ziel
            </span>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Serif statement — the page speaks first, numbers follow.
                Derived strictly from existing values (todayMin / todayGoal). */}
            <p className="lern-statement">
              {todayMin === 0
                ? <>Noch ein leeres Blatt heute. <em>Dein Ziel: {todayGoal} Minuten.</em></>
                : todayGoal > 0 && todayMin >= todayGoal
                  ? <>Ziel erreicht. <em>{formatHM(todayMin)} heute, stark.</em></>
                  : <>{formatHM(todayMin)} heute. <em>Noch {Math.max(0, todayGoal - todayMin)} Minuten bis zum Ziel.</em></>}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Heute gelernt"
                value={formatHM(todayMin)}
                accent="var(--color-blue)"
              />
              <Stat
                label={todayIsWeekend ? "Wochenendziel" : "Tagesziel"}
                value={`${todayGoal} min`}
                accent="var(--color-fg-secondary)"
              />
            </div>

            {todayBySubject.size > 0 ? (
              <div className="flex flex-wrap gap-2">
                {[...todayBySubject.entries()].map(([id, min]) => {
                  const s = subjects.find((x) => x.id === id);
                  if (!s) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-[12px]"
                    >
                      <SubjectMark name={s.name} color={s.color} size="sm" />
                      <span className="text-fg-secondary">{s.name}</span>
                      <span className="text-fg-tertiary tabular-nums">
                        {formatHM(min)}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-fg-tertiary">
                Heute noch keine Lernzeit erfasst.
              </p>
            )}

            {todayMin >= todayGoal && todayGoal > 0 && (
              <p className="font-display font-semibold text-sm text-[var(--color-positive)]">
                ✓ {todayIsWeekend ? "Wochenendziel" : "Tagesziel"} erreicht
              </p>
            )}
          </div>
        </div>
      </FlatSection>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* This week */}
        <FlatSection title="Diese Woche" icon="📆">
          <div className="flex items-end justify-between mb-3">
            <Stat label="Gesamt" value={formatHM(weekMin)} accent="var(--color-blue)" big />
            <div className="flex flex-col items-end gap-0.5 mb-1">
              <span className={`text-[13px] font-semibold tabular-nums ${weekTrend.cls}`}>
                {weekTrend.icon} {Math.abs(weekTrend.pct)}%
              </span>
              <span className="text-[10px] text-fg-tertiary">vs. Vorwoche ({formatHM(prevWeekMin)})</span>
            </div>
          </div>
          {goalMin > 0 && (
            <div className="mb-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-mono text-fg-tertiary uppercase tracking-wide">Ziel-Einhaltung</span>
                <span className={`text-[11px] font-semibold tabular-nums ${weekAdherence >= 70 ? "text-[var(--color-positive)]" : weekAdherence >= 40 ? "text-[var(--color-yellow)]" : "text-[var(--color-red)]"}`}>
                  {weekAdherence}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${weekAdherence}%`, backgroundColor: weekAdherence >= 70 ? "var(--color-positive)" : weekAdherence >= 40 ? "var(--color-yellow)" : "var(--color-red)" }} />
              </div>
            </div>
          )}
          <SubjectBreakdown subjects={subjects} totals={weekBySubject} empty="Diese Woche keine Lernzeit." />
          <WeekBarChart sessions={sessions} goalForDate={goalForDate} />
        </FlatSection>

        {/* This month */}
        <FlatSection title="Diesen Monat" icon="🗓️">
          <div className="flex items-end justify-between mb-3">
            <Stat label="Gesamt" value={formatHM(monthMin)} accent="var(--color-mint)" big />
            <div className="flex flex-col items-end gap-0.5 mb-1">
              <span className={`text-[13px] font-semibold tabular-nums ${monthTrend.cls}`}>
                {monthTrend.icon} {Math.abs(monthTrend.pct)}%
              </span>
              <span className="text-[10px] text-fg-tertiary">vs. Vormonat ({formatHM(prevMonthMin)})</span>
            </div>
          </div>
          {goalMin > 0 && (
            <div className="mb-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-mono text-fg-tertiary uppercase tracking-wide">Ziel-Einhaltung</span>
                <span className={`text-[11px] font-semibold tabular-nums ${monthAdherence >= 70 ? "text-[var(--color-positive)]" : monthAdherence >= 40 ? "text-[var(--color-yellow)]" : "text-[var(--color-red)]"}`}>
                  {monthAdherence}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${monthAdherence}%`, backgroundColor: monthAdherence >= 70 ? "var(--color-positive)" : monthAdherence >= 40 ? "var(--color-yellow)" : "var(--color-red)" }} />
              </div>
            </div>
          )}
          <SubjectBreakdown subjects={subjects} totals={monthBySubject} empty="Diesen Monat keine Lernzeit." />
          <DonutChart subjects={subjects} totals={monthBySubject} />
        </FlatSection>

        {/* Streak */}
        <FlatSection title="Streak" icon="🔥">
          <div className="flex flex-col items-center text-center py-2">
            <div className="metric text-7xl text-[var(--color-orange)] tabular-nums leading-none">
              {streak}
            </div>
            <p className="font-display font-semibold text-sm text-fg mt-3">
              {streak === 1 ? "Tag in Folge" : streak === 0 ? "Heute noch nicht gelernt" : "Tage in Folge"}
            </p>
            <p className="text-[12px] text-fg-tertiary mt-1">
              {streak >= 14 ? "Außergewöhnlich 🏆" : streak >= 7 ? "Stark unterwegs 💪" : streak >= 3 ? "Momentum aufgebaut." : "Schritt für Schritt — bleib dran."}
            </p>
          </div>
          {/* Quick mini-stats below streak */}
          <div className="mt-4 pt-3 border-t border-white/[0.05] grid grid-cols-2 gap-2">
            <div className="text-center">
              <p className="text-[16px] font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>{goalMin} min</p>
              <p className="text-[10px] font-mono text-fg-tertiary uppercase tracking-wide mt-0.5">Wochentag</p>
            </div>
            <div className="text-center">
              <p className="text-[16px] font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>
                {goalMinWeekend > 0 ? `${goalMinWeekend} min` : "—"}
              </p>
              <p className="text-[10px] font-mono text-fg-tertiary uppercase tracking-wide mt-0.5">Wochenende</p>
            </div>
          </div>
        </FlatSection>
      </div>

      {/* ── Weekly goal adherence summary ── */}
      {weeklyTargetTotal > 0 && (
        <FlatSection title="Lernstatistik" icon="📈">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatBox
              label="Wochenziel"
              value={formatHM(weeklyTargetTotal)}
              sub={`${Math.round(weekMin / Math.max(1, weeklyTargetTotal) * 100)}% erreicht`}
              color={weekMin >= weeklyTargetTotal ? "var(--color-positive)" : "var(--color-blue)"}
            />
            <StatBox
              label="Ø pro Tag (Woche)"
              value={formatHM(Math.round(weekMin / 7))}
              sub={`Ziel heute: ${formatHM(todayGoal)}`}
              color={weekMin / 7 >= weeklyTargetTotal / 7 ? "var(--color-positive)" : "var(--color-yellow)"}
            />
            <StatBox
              label="Vorwoche"
              value={formatHM(prevWeekMin)}
              sub={`${weekTrend.icon} ${weekTrend.pct > 0 ? "+" : ""}${weekTrend.pct}% vs. jetzt`}
              color={weekTrend.cls.includes("positive") ? "var(--color-positive)" : weekTrend.cls.includes("red") ? "var(--color-red)" : "var(--color-fg-secondary)"}
            />
            <StatBox
              label="Ziel-Tage/Woche"
              value={`${weekAdherence}%`}
              sub={goalMin > 0 ? `${Math.round(weekAdherence / 100 * 7 * 10) / 10} / 7 Tage` : "kein Ziel"}
              color={weekAdherence >= 70 ? "var(--color-positive)" : weekAdherence >= 40 ? "var(--color-yellow)" : "var(--color-red)"}
            />
          </div>

          {/* Subject week-over-week comparison */}
          {subjects.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/[0.05]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-3">
                Fächer — diese Woche vs. letzte Woche
              </p>
              <ul className="flex flex-col gap-2.5">
                {subjects.map(s => {
                  const curr = weekBySubject.get(s.id) ?? 0;
                  const prev = prevWeekBySubject.get(s.id) ?? 0;
                  if (curr === 0 && prev === 0) return null;
                  const t = trendArrow(curr, prev);
                  const maxVal = Math.max(1, ...[...weekBySubject.values(), ...[curr, prev]]);
                  return (
                    <li key={s.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <SubjectMark name={s.name} color={s.color} size="sm" />
                        <span className="text-[13px] font-medium text-fg flex-1 truncate">{s.name}</span>
                        <span className={`text-[11px] font-semibold tabular-nums ${t.cls}`}>
                          {t.icon} {Math.abs(t.pct)}%
                        </span>
                        <span className="font-mono text-[11px] text-fg-tertiary tabular-nums w-14 text-right">
                          {formatHM(curr)}
                        </span>
                      </div>
                      {/* Dual bar: current (solid) vs previous (ghost) */}
                      <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-visible">
                        {prev > 0 && (
                          <div className="absolute inset-y-0 left-0 rounded-full opacity-25"
                            style={{ width: `${Math.min(100, (prev / maxVal) * 100)}%`, backgroundColor: s.color }} />
                        )}
                        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, (curr / maxVal) * 100)}%`, backgroundColor: s.color,
                            boxShadow: `0 0 6px color-mix(in srgb, ${s.color} 38%, transparent)` }} />
                      </div>
                    </li>
                  );
                }).filter(Boolean)}
              </ul>
              <p className="text-[10px] text-fg-tertiary mt-2">
                <span className="opacity-60">▬</span> Diese Woche &nbsp;
                <span className="opacity-30">▬</span> Vorwoche
              </p>
            </div>
          )}
        </FlatSection>
      )}

      <StreakHeatmap
        sessions={sessions}
        weeklyGoalHours={weeklyGoalHours}
      />

      <WeekCompareCard
        subjects={subjects}
        thisWeek={weekBySubject}
        prevWeek={prevWeekBySubject}
        thisWeekTotal={weekMin}
        prevWeekTotal={prevWeekMin}
      />

      <ProductiveHoursCard sessions={sessions} />

      <ExamCountdownCard
        events={importantEvents}
        sessions={sessions}
        subjects={subjects}
      />

      <FlatSection title="Verteilung diesen Monat" icon="📊">
        {monthBars.totals.length === 0 ||
        monthBars.totals.every((t) => t.min === 0) ? (
          <p className="text-sm text-fg-tertiary py-4 text-center">
            Diesen Monat: nichts. Die Balken warten auf dich.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {monthBars.totals.map(({ subject, min }) => {
              const w = (min / monthBars.max) * 100;
              return (
                <li key={subject.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <SubjectMark
                      name={subject.name}
                      color={subject.color}
                      size="sm"
                    />
                    <span className="font-display font-medium text-[14px] text-fg flex-1 truncate">
                      {subject.name}
                    </span>
                    <span className="font-mono text-[12px] text-fg-tertiary tabular-nums">
                      {formatHM(min)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.max(2, w)}%`,
                        backgroundColor: subject.color,
                        boxShadow: `0 0 8px color-mix(in srgb, ${subject.color} 50%, transparent)`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </FlatSection>
    </div>
  );
}

// Aurora-style stat: flat on the card surface (no filled box), value in
// text-1 on top, tiny mono label below — mirrors Daily's `.day-stats`.
function StatBox({ label, value, sub }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <p className="text-[18px] font-semibold tabular-nums leading-tight" style={{ color: "var(--text-1)" }}>
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">{label}</p>
      {sub && <p className="text-[11px] text-fg-tertiary leading-snug">{sub}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  big = false,
}: {
  label: string;
  value: string;
  accent?: string;
  big?: boolean;
}) {
  return (
    <div className={big ? "mb-1" : ""}>
      <div
        className={"font-semibold tabular-nums leading-tight " + (big ? "text-3xl" : "text-xl")}
        style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mt-1.5">
        {label}
      </div>
    </div>
  );
}

function SubjectBreakdown({
  subjects,
  totals,
  empty,
}: {
  subjects: { id: string; name: string; color: string }[];
  totals: Map<string, number>;
  empty: string;
}) {
  const entries = subjects
    .map((s) => ({ s, min: totals.get(s.id) ?? 0 }))
    .filter((e) => e.min > 0)
    .sort((a, b) => b.min - a.min);

  if (entries.length === 0) {
    return <p className="text-sm text-fg-tertiary mt-3">{empty}</p>;
  }

  return (
    <ul className="mt-3 flex flex-col gap-2">
      {entries.map(({ s, min }) => (
        <li key={s.id} className="flex items-center gap-2.5 text-[13px]">
          <SubjectMark name={s.name} color={s.color} size="sm" />
          <span className="text-fg flex-1 truncate">{s.name}</span>
          <span className="font-mono text-[12px] text-fg-tertiary tabular-nums">
            {formatHM(min)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── WeekBarChart — last 7 days as vertical bars ────────────────────────────────

type WeekBarChartProps = {
  sessions: { date: string; durationMin: number }[];
  /** Historic resolver — each of the last 7 days keeps its own goal. */
  goalForDate: (date: Date) => number;
};

function WeekBarChart({ sessions, goalForDate }: WeekBarChartProps) {
  const days = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = isoDate(d);
      const isWe = d.getDay() === 0 || d.getDay() === 6;
      const goal = goalForDate(d);
      const total = sessions.filter(s => s.date === iso).reduce((a, s) => a + s.durationMin, 0);
      const label = ["So","Mo","Di","Mi","Do","Fr","Sa"][d.getDay()];
      result.push({ iso, total, goal, label, isToday: i === 0, isWe });
    }
    return result;
  }, [sessions, goalForDate]);

  const maxVal = Math.max(...days.map(d => Math.max(d.total, d.goal)), 1);
  const W = 280; const H = 80; const BAR_W = 28; const GAP = 12;
  const totalW = days.length * (BAR_W + GAP) - GAP;
  const offsetX = (W - totalW) / 2;

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.05]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-3">
        Letzte 7 Tage
      </p>
      <svg viewBox={`0 0 ${W} ${H + 28}`} className="w-full" style={{ maxHeight: 130 }}>
        {days.map((day, i) => {
          const x = offsetX + i * (BAR_W + GAP);
          const barH = Math.round((day.total / maxVal) * H);
          const goalH = Math.round((day.goal / maxVal) * H);
          const hitGoal = day.total >= day.goal && day.goal > 0;
          const color = hitGoal ? "var(--color-positive)"
            : day.isWe ? "var(--color-purple)"
            : "var(--color-blue)";

          return (
            <g key={day.iso}>
              {/* Goal line */}
              {day.goal > 0 && (
                <line
                  x1={x} y1={H - goalH} x2={x + BAR_W} y2={H - goalH}
                  stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="2 2"
                />
              )}
              {/* Background track */}
              <rect x={x} y={0} width={BAR_W} height={H} rx={6}
                fill="rgba(255,255,255,0.04)" />
              {/* Value bar */}
              {day.total > 0 && (
                <rect x={x} y={H - barH} width={BAR_W} height={barH} rx={6}
                  fill={color} opacity={day.isToday ? 1 : 0.75}
                  style={{ filter: hitGoal ? `drop-shadow(0 0 4px ${color}80)` : "none" }}
                />
              )}
              {/* Today indicator */}
              {day.isToday && (
                <circle cx={x + BAR_W / 2} cy={H + 10} r={2.5} fill={color} />
              )}
              {/* Day label */}
              <text x={x + BAR_W / 2} y={H + 22} textAnchor="middle"
                fontSize="9" fill={day.isToday ? "rgba(235,235,245,0.8)" : "rgba(235,235,245,0.35)"}>
                {day.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── DonutChart — subject breakdown as arc segments ─────────────────────────────

type DonutChartProps = {
  subjects: { id: string; name: string; color: string }[];
  totals: Map<string, number>;
};

function DonutChart({ subjects, totals }: DonutChartProps) {
  const entries = useMemo(() => {
    const list = subjects
      .map(s => ({ s, min: totals.get(s.id) ?? 0 }))
      .filter(e => e.min > 0)
      .sort((a, b) => b.min - a.min);
    const total = list.reduce((a, e) => a + e.min, 0) || 1;
    return list.map(e => ({ ...e, pct: (e.min / total) * 100 }));
  }, [subjects, totals]);

  if (entries.length === 0) return null;

  const R = 36; const cx = 44; const cy = 44;
  const circ = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/[0.05]">
      <svg viewBox="0 0 88 88" className="shrink-0" style={{ width: 88, height: 88 }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" />
        {entries.map(({ s, pct }) => {
          const len = (pct / 100) * circ;
          const seg = (
            <circle key={s.id} cx={cx} cy={cy} r={R}
              fill="none" stroke={s.color} strokeWidth="14"
              strokeLinecap="butt"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 44 44)"
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <ul className="flex flex-col gap-1.5 flex-1 min-w-0">
        {entries.map(({ s, pct, min }) => (
          <li key={s.id} className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-fg-secondary truncate flex-1">{s.name}</span>
            <span className="font-mono text-fg-tertiary tabular-nums text-[11px]">
              {Math.round(pct)}%
            </span>
            <span className="font-mono text-fg-tertiary tabular-nums text-[11px] w-12 text-right">
              {formatHM(min)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Streak heatmap — last 53 weeks, GitHub-style ──────────────────────────────

type HeatmapProps = {
  sessions: Session[];
  /** Total weekly study target in hours — converted to a fixed per-day reference */
  weeklyGoalHours: number;
};

/** Days are rendered top→bottom Mon..Sun. Newest week sits on the right.
 *  Cells are colored against a FIXED per-day reference (weeklyGoalHours ÷ 7)
 *  so the heatmap stays consistent even when Jarvis adjusts day-specific goals. */
function StreakHeatmap({ sessions, weeklyGoalHours }: HeatmapProps) {
  const refDayMin = Math.round((weeklyGoalHours * 60) / 7);
  const { weeks, totals } = useMemo(() => {
    // Build day-keyed totals
    const totalsMap = new Map<string, number>();
    for (const s of sessions) {
      totalsMap.set(s.date, (totalsMap.get(s.date) ?? 0) + s.durationMin);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Anchor on the most recent Sunday (end of the rightmost column)
    const dayOfWeek = today.getDay(); // 0=Sun
    const daysToSunday = (7 - dayOfWeek) % 7;
    const endSunday = new Date(today);
    endSunday.setDate(today.getDate() + daysToSunday);

    // 53 weeks back from there
    const startMonday = new Date(endSunday);
    startMonday.setDate(endSunday.getDate() - (53 * 7 - 1));

    const weeks: { date: Date; iso: string; min: number; inFuture: boolean }[][] = [];
    const cursor = new Date(startMonday);
    for (let w = 0; w < 53; w++) {
      const col: typeof weeks[number] = [];
      for (let d = 0; d < 7; d++) {
        const iso = cursor.toISOString().slice(0, 10);
        col.push({
          date: new Date(cursor),
          iso,
          min: totalsMap.get(iso) ?? 0,
          inFuture: cursor > today,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(col);
    }

    return { weeks, totals: totalsMap };
  }, [sessions]);

  const totalDaysHit = useMemo(
    () => Array.from(totals.values()).filter((m) => m > 0).length,
    [totals],
  );
  const totalMin = useMemo(
    () => Array.from(totals.values()).reduce((a, b) => a + b, 0),
    [totals],
  );

  // Color for a cell — based on ratio of (min / refDayMin). 5-level scale.
  // refDayMin = weeklyGoalHours * 60 / 7 (fixed reference, no per-day variance).
  function cellColor(min: number, inFuture: boolean) {
    if (inFuture) return "transparent";
    if (min === 0) return "rgba(255,255,255,0.04)";
    const ratio = refDayMin > 0 ? min / refDayMin : 0;
    if (ratio >= 1)   return "var(--ok)";
    if (ratio >= 0.7) return "color-mix(in srgb, var(--ok) 75%, var(--warn))";
    if (ratio >= 0.4) return "var(--warn)";
    return "color-mix(in srgb, var(--warn) 60%, var(--crit))";
  }

  // Month labels: show abbreviated month at the column where it starts
  const monthLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let prevMonth = -1;
    weeks.forEach((col, idx) => {
      const m = col[0].date.getMonth();
      if (m !== prevMonth) {
        labels.push({
          col: idx,
          label: col[0].date.toLocaleDateString("de-DE", { month: "short" }),
        });
        prevMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  const dayLabels = ["Mo", "", "Mi", "", "Fr", "", "So"];

  return (
    <FlatSection title="365-Tage Streak" icon="🌱" size="large">
      <div className="flex flex-col gap-3">
        {/* Headline stats */}
        <div className="flex items-baseline gap-5 flex-wrap">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Tage gelernt</p>
            <p className="metric text-2xl text-fg tabular-nums leading-none mt-1">
              {totalDaysHit}<span className="text-fg-tertiary text-base"> / 365</span>
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Gesamt</p>
            <p className="metric text-2xl text-fg tabular-nums leading-none mt-1">
              {Math.floor(totalMin / 60)}<span className="text-fg-tertiary text-base"> h </span>
              {totalMin % 60}<span className="text-fg-tertiary text-base"> min</span>
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Referenz</p>
            <p className="metric text-base text-fg-secondary tabular-nums leading-none mt-1">
              {Math.round((refDayMin / 60) * 10) / 10}<span className="text-fg-tertiary text-sm"> h/Tag </span>
              <span className="text-fg-tertiary text-xs">({weeklyGoalHours}h/Wo)</span>
            </p>
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="overflow-x-auto pb-1">
          <div className="inline-flex flex-col gap-1.5 min-w-full">
            {/* Month labels row */}
            <div className="flex pl-7">
              {weeks.map((_, idx) => {
                const label = monthLabels.find((l) => l.col === idx);
                return (
                  <div
                    key={idx}
                    className="font-mono text-[9px] text-fg-tertiary uppercase tracking-wider"
                    style={{ width: 12, flexShrink: 0 }}
                  >
                    {label?.label.slice(0, 3) ?? ""}
                  </div>
                );
              })}
            </div>

            {/* Day rows */}
            <div className="flex gap-[3px]">
              {/* Day labels column */}
              <div className="flex flex-col gap-[3px] pr-1">
                {dayLabels.map((l, i) => (
                  <div
                    key={i}
                    className="font-mono text-[9px] text-fg-tertiary uppercase tracking-wider leading-none"
                    style={{ height: 9, width: 14, display: "flex", alignItems: "center" }}
                  >
                    {l}
                  </div>
                ))}
              </div>

              {/* Week columns */}
              {weeks.map((col, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {col.map((cell) => {
                    const bg = cellColor(cell.min, cell.inFuture);
                    const pct = refDayMin > 0 ? Math.round((cell.min / refDayMin) * 100) : 0;
                    return (
                      <div
                        key={cell.iso}
                        title={`${cell.date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · ${cell.min} min${refDayMin > 0 ? ` (${pct}% von ${refDayMin} min)` : ""}`}
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 2,
                          background: bg,
                          opacity: cell.inFuture ? 0.15 : 1,
                          boxShadow: cell.min > 0 && refDayMin > 0 && cell.min >= refDayMin
                            ? `0 0 6px color-mix(in srgb, var(--ok) 45%, transparent)`
                            : undefined,
                          transition: "background 200ms var(--ease)",
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-2 mt-1 pl-7">
              <span className="font-mono text-[9px] text-fg-tertiary uppercase tracking-wider">Weniger</span>
              {[
                "rgba(255,255,255,0.04)",
                "color-mix(in srgb, var(--warn) 60%, var(--crit))",
                "var(--warn)",
                "color-mix(in srgb, var(--ok) 75%, var(--warn))",
                "var(--ok)",
              ].map((c, i) => (
                <div
                  key={i}
                  style={{ width: 9, height: 9, borderRadius: 2, background: c }}
                />
              ))}
              <span className="font-mono text-[9px] text-fg-tertiary uppercase tracking-wider">Mehr</span>
            </div>
          </div>
        </div>
      </div>
    </FlatSection>
  );
}

// ── Week-over-week comparison card ────────────────────────────────────────────

type WeekCompareProps = {
  subjects: Subject[];
  thisWeek: Map<string, number>;
  prevWeek: Map<string, number>;
  thisWeekTotal: number;
  prevWeekTotal: number;
};

function WeekCompareCard({
  subjects,
  thisWeek,
  prevWeek,
  thisWeekTotal,
  prevWeekTotal,
}: WeekCompareProps) {
  const rows = useMemo(() => {
    // Include a row for every subject that has activity in either week.
    return subjects
      .map((s) => ({
        subject: s,
        now: thisWeek.get(s.id) ?? 0,
        prev: prevWeek.get(s.id) ?? 0,
      }))
      .filter((r) => r.now > 0 || r.prev > 0)
      .sort((a, b) => Math.max(b.now, b.prev) - Math.max(a.now, a.prev));
  }, [subjects, thisWeek, prevWeek]);

  if (rows.length === 0) {
    return (
      <FlatSection title="Wochenvergleich" icon="↔" size="large">
        <p className="text-sm text-fg-tertiary py-4 text-center">
          Für einen Vergleich fehlt mir Material — gib mir ein paar Tage.
        </p>
      </FlatSection>
    );
  }

  const totalDelta = thisWeekTotal - prevWeekTotal;
  const totalDeltaPct = prevWeekTotal > 0
    ? Math.round((totalDelta / prevWeekTotal) * 100)
    : (thisWeekTotal > 0 ? 100 : 0);
  const totalColor = totalDelta > 0
    ? "var(--ok)"
    : totalDelta < 0
      ? "var(--crit)"
      : "var(--text-3)";

  // Bar widths: scale relative to the largest single-cell value across both weeks
  const maxVal = Math.max(1, ...rows.flatMap((r) => [r.now, r.prev]));

  return (
    <FlatSection title="Wochenvergleich" icon="↔" size="large">
      {/* Aggregate header */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-baseline gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Diese Woche</p>
            <p className="metric text-2xl tabular-nums leading-none mt-1" style={{ color: "var(--accent)" }}>
              {formatHM(thisWeekTotal)}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Vorwoche</p>
            <p className="metric text-xl text-fg-tertiary tabular-nums leading-none mt-1">
              {formatHM(prevWeekTotal)}
            </p>
          </div>
        </div>
        <div
          className="rounded-full px-3 py-1.5 font-display font-semibold text-[13px] tabular-nums"
          style={{
            background: `color-mix(in srgb, ${totalColor} 14%, transparent)`,
            color: totalColor,
            border: `1px solid color-mix(in srgb, ${totalColor} 28%, transparent)`,
          }}
        >
          {totalDelta > 0 ? "↑" : totalDelta < 0 ? "↓" : "→"}{" "}
          {totalDelta > 0 ? "+" : ""}{formatHM(Math.abs(totalDelta))}{" "}
          <span className="text-fg-tertiary text-[11px] font-normal">
            ({totalDeltaPct > 0 ? "+" : ""}{totalDeltaPct}%)
          </span>
        </div>
      </div>

      {/* Per-subject rows */}
      <div className="flex flex-col gap-3">
        {rows.map(({ subject, now, prev }) => {
          const delta = now - prev;
          const deltaColor = delta > 0
            ? "var(--ok)"
            : delta < 0
              ? "var(--crit)"
              : "var(--text-3)";
          return (
            <div key={subject.id} className="flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-[120px] flex-shrink-0">
                <SubjectMark name={subject.name} color={subject.color} size="sm" />
                <span className="font-display font-medium text-[13px] text-fg truncate">
                  {subject.name}
                </span>
              </div>

              {/* Twin bars — top = this week (full color), bottom = prev (muted) */}
              <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${(now / maxVal) * 100}%`,
                        background: subject.color,
                        boxShadow: now > 0 ? `0 0 6px color-mix(in srgb, ${subject.color} 50%, transparent)` : undefined,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-fg w-12 text-right">
                    {formatHM(now)}
                  </span>
                </div>
                <div className="flex items-center gap-2 opacity-55">
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${(prev / maxVal) * 100}%`,
                        background: subject.color,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-fg-tertiary w-12 text-right">
                    {formatHM(prev)}
                  </span>
                </div>
              </div>

              {/* Delta pill */}
              <div
                className="rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums flex-shrink-0 w-[72px] text-center"
                style={{
                  background: `color-mix(in srgb, ${deltaColor} 12%, transparent)`,
                  color: deltaColor,
                  border: `1px solid color-mix(in srgb, ${deltaColor} 24%, transparent)`,
                }}
              >
                {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}
                {delta !== 0 ? ` ${delta > 0 ? "+" : ""}${delta}m` : " —"}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-fg-tertiary mt-4">
        <span className="opacity-100">▬</span> Diese Woche &nbsp;
        <span className="opacity-50">▬</span> Vorwoche
      </p>
    </FlatSection>
  );
}

// ── Productive hours heatmap (hour-of-day × weekday) ──────────────────────────

type ProductiveHoursProps = {
  sessions: Session[];
};

function ProductiveHoursCard({ sessions }: ProductiveHoursProps) {
  // Sessions without startedAtMs can't contribute — they have no clock time.
  const { grid, totalDataPoints, peakLabel, max } = useMemo(() => {
    // grid[weekday][hour] = total minutes; weekday 0=Mo, 6=So
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let withStart = 0;
    for (const s of sessions) {
      if (!s.startedAtMs) continue;
      withStart++;
      const d = new Date(s.startedAtMs);
      // Convert Sun=0..Sat=6 to Mon=0..Sun=6
      const weekday = (d.getDay() + 6) % 7;
      const hour = d.getHours();
      grid[weekday][hour] += s.durationMin;
    }

    // Peak slot
    let peakHour = -1, peakDay = -1, peakMin = 0;
    for (let w = 0; w < 7; w++) {
      for (let h = 0; h < 24; h++) {
        if (grid[w][h] > peakMin) {
          peakMin = grid[w][h]; peakHour = h; peakDay = w;
        }
      }
    }
    const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const peakLabel = peakHour >= 0
      ? `${dayNames[peakDay]} ${peakHour.toString().padStart(2, "0")}–${(peakHour + 1).toString().padStart(2, "0")} Uhr`
      : null;

    const max = Math.max(1, ...grid.flat());
    return { grid, totalDataPoints: withStart, peakLabel, max };
  }, [sessions]);

  const dayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  // Hour labels: every 3 hours for compact axis
  const hourLabels = Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? `${h}` : ""));

  function cellColor(min: number) {
    if (min === 0) return "rgba(255,255,255,0.04)";
    const t = Math.min(1, min / max);
    if (t >= 0.75) return "var(--accent)";
    if (t >= 0.4)  return "color-mix(in srgb, var(--accent) 65%, var(--warn))";
    if (t >= 0.15) return "color-mix(in srgb, var(--accent) 40%, var(--ink-2))";
    return "color-mix(in srgb, var(--accent) 20%, var(--ink-2))";
  }

  if (totalDataPoints === 0) {
    return (
      <FlatSection title="Produktivste Stunden" icon="⏰" size="large">
        <p className="text-sm text-fg-tertiary py-4 text-center">
          Noch zu wenig Daten — die Heatmap füllt sich mit neuen Sessions.
        </p>
      </FlatSection>
    );
  }

  return (
    <FlatSection title="Produktivste Stunden" icon="⏰" size="large">
      {/* Headline */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Peak-Slot</p>
          <p className="metric text-xl tabular-nums leading-none mt-1" style={{ color: "var(--accent)" }}>
            {peakLabel ?? "—"}
          </p>
        </div>
        <p className="text-[11px] text-fg-tertiary">
          {totalDataPoints} {totalDataPoints === 1 ? "Session" : "Sessions"} mit Zeitstempel
        </p>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          {/* Hour-axis labels */}
          <div className="flex pl-7 gap-[2px]">
            {hourLabels.map((h, i) => (
              <div
                key={i}
                className="font-mono text-[9px] text-fg-tertiary tabular-nums text-center"
                style={{ width: 13, flexShrink: 0 }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Day rows */}
          {dayLabels.map((dayName, w) => (
            <div key={dayName} className="flex items-center gap-1">
              <div
                className="font-mono text-[10px] text-fg-tertiary uppercase tracking-widest"
                style={{ width: 22, flexShrink: 0 }}
              >
                {dayName}
              </div>
              <div className="flex gap-[2px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const min = grid[w][h];
                  return (
                    <div
                      key={h}
                      title={`${dayName} ${h.toString().padStart(2, "0")}:00–${(h + 1).toString().padStart(2, "0")}:00 · ${min} min`}
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: 2,
                        background: cellColor(min),
                        transition: "background 200ms var(--ease)",
                        boxShadow: min > 0 && min === max
                          ? `0 0 8px color-mix(in srgb, var(--accent) 55%, transparent)`
                          : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-2 mt-2 pl-7">
            <span className="font-mono text-[9px] text-fg-tertiary uppercase tracking-widest">Weniger</span>
            {[0.05, 0.2, 0.5, 0.8, 1].map((t, i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: cellColor(t * max),
                }}
              />
            ))}
            <span className="font-mono text-[9px] text-fg-tertiary uppercase tracking-widest">Mehr</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-fg-tertiary mt-3">
        Tipp: Lege wichtige Klausur-Themen in deine Peak-Slots — das ist wo du am produktivsten bist.
      </p>
    </FlatSection>
  );
}

// ── Klausur countdown — days remaining + required vs projected hours ──────────

type ExamCountdownProps = {
  events: ImportantEvent[];
  sessions: Session[];
  subjects: Subject[];
};

function ExamCountdownCard({ events, sessions, subjects }: ExamCountdownProps) {
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const exams = useMemo(() => {
    const result: Array<{
      ev: ImportantEvent;
      subject: Subject | null;
      daysLeft: number;
      hoursLearned: number;        // total studied for this subject (last 30 days, used as recent baseline)
      hoursLearnedTotal: number;   // ALL time studied for this subject
      avgPerDay: number;           // recent average min/day in this subject
      projectedHours: number;      // hours we'd get if avg holds till exam
      requiredHours: number;
      shortfall: number;           // requiredHours - (hoursLearnedTotal + projected)
    }> = [];

    for (const ev of events) {
      if (ev.kind !== "exam" || ev.dismissed) continue;
      const examDate = new Date(ev.date);
      examDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((examDate.getTime() - today.getTime()) / 86400000);
      if (daysLeft < 0) continue; // past exam

      const subject = subjects.find((s) => s.id === ev.subjectId) ?? null;

      // Filter sessions for this subject
      const subSessions = ev.subjectId
        ? sessions.filter((s) => s.subjectId === ev.subjectId)
        : [];

      const hoursLearnedTotal = subSessions.reduce((a, s) => a + s.durationMin, 0) / 60;

      // Recent baseline: last 14 days
      const fourteenDaysAgo = new Date(today);
      fourteenDaysAgo.setDate(today.getDate() - 14);
      const recent = subSessions.filter((s) => new Date(s.date) >= fourteenDaysAgo);
      const recentMin = recent.reduce((a, s) => a + s.durationMin, 0);
      const avgPerDayMin = recentMin / 14;
      const projectedMin = avgPerDayMin * Math.max(0, daysLeft);
      const projectedHours = projectedMin / 60;

      const requiredHours = ev.requiredHours ?? 0;
      const shortfall = requiredHours - (hoursLearnedTotal + projectedHours);

      result.push({
        ev,
        subject,
        daysLeft,
        hoursLearned: recent.reduce((a, s) => a + s.durationMin, 0) / 60,
        hoursLearnedTotal,
        avgPerDay: avgPerDayMin,
        projectedHours,
        requiredHours,
        shortfall,
      });
    }

    // Sort by daysLeft ascending (closest first)
    result.sort((a, b) => a.daysLeft - b.daysLeft);
    // Cap to next 6 exams
    return result.slice(0, 6);
  }, [events, sessions, subjects, today]);

  if (exams.length === 0) {
    return null; // hide if no upcoming exams configured
  }

  return (
    <FlatSection title="Klausur-Countdown" icon="🎯" size="large">
      <p className="text-[11px] text-fg-tertiary mb-3">
        Hochrechnung basierend auf deinen letzten 14 Tagen. Setze ein Stunden-Ziel pro Klausur in „Termine verwalten".
      </p>
      <ul className="flex flex-col gap-2.5">
        {exams.map((e) => {
          const onTrack = e.requiredHours === 0 || e.shortfall <= 0;
          const tone = e.requiredHours === 0
            ? "var(--text-3)"
            : onTrack
              ? "var(--ok)"
              : e.daysLeft <= 7
                ? "var(--crit)"
                : "var(--warn)";

          // Progress: how much of requiredHours is "covered" by learned + projected
          const cover = e.requiredHours > 0
            ? Math.min(1.2, (e.hoursLearnedTotal + e.projectedHours) / e.requiredHours)
            : 0;

          return (
            <li
              key={e.ev.id}
              className="rounded-card p-3.5 flex flex-col gap-2"
              style={{
                background: "color-mix(in srgb, var(--ink-3) 70%, transparent)",
                border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {e.subject && (
                    <SubjectMark name={e.subject.name} color={e.subject.color} size="sm" />
                  )}
                  <span className="font-display font-semibold text-[14px] text-fg truncate">
                    {e.ev.title}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className="font-mono text-[11px] tabular-nums rounded-full px-2 py-0.5"
                    style={{
                      background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                      color: tone,
                      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
                    }}
                  >
                    {e.daysLeft === 0 ? "HEUTE" : e.daysLeft === 1 ? "MORGEN" : `${e.daysLeft} TAGE`}
                  </span>
                </div>
              </div>

              {/* Hours math line */}
              <div className="flex items-baseline gap-3 flex-wrap text-[12px]">
                <span className="text-fg-secondary">
                  <span className="font-mono text-fg tabular-nums">{e.hoursLearnedTotal.toFixed(1)} h</span>
                  <span className="text-fg-tertiary"> gelernt</span>
                </span>
                {e.requiredHours > 0 && (
                  <>
                    <span className="text-fg-tertiary">·</span>
                    <span className="text-fg-secondary">
                      <span className="font-mono text-fg tabular-nums">{e.requiredHours.toFixed(0)} h</span>
                      <span className="text-fg-tertiary"> Ziel</span>
                    </span>
                  </>
                )}
                <span className="text-fg-tertiary">·</span>
                <span className="text-fg-secondary">
                  <span className="font-mono tabular-nums">+{e.projectedHours.toFixed(1)} h</span>
                  <span className="text-fg-tertiary"> hochgerechnet</span>
                </span>
              </div>

              {/* Progress bar against required hours */}
              {e.requiredHours > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, cover * 100)}%`,
                        background: tone,
                        boxShadow: `0 0 6px color-mix(in srgb, ${tone} 50%, transparent)`,
                      }}
                    />
                    {/* "Schon gelernt" marker */}
                    {e.hoursLearnedTotal > 0 && (
                      <div
                        style={{
                          position: "relative",
                          top: -6,
                          width: 2,
                          height: 8,
                          marginLeft: `${Math.min(100, (e.hoursLearnedTotal / e.requiredHours) * 100)}%`,
                          background: "rgba(255,255,255,0.55)",
                          transform: "translateX(-1px)",
                        }}
                      />
                    )}
                  </div>
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: tone }}>
                    {Math.round(cover * 100)}%
                  </span>
                </div>
              )}

              {/* Verdict line */}
              {e.requiredHours === 0 ? (
                <p className="text-[11px] text-fg-tertiary">
                  Kein Stunden-Ziel gesetzt — füge eines hinzu für die Hochrechnung.
                </p>
              ) : onTrack ? (
                <p className="text-[11px]" style={{ color: tone }}>
                  ✓ Auf Kurs — mit aktuellem Tempo schaffst du das.
                </p>
              ) : (
                <p className="text-[11px]" style={{ color: tone }}>
                  Noch {e.shortfall.toFixed(1)} h fehlend — du müsstest{" "}
                  <span className="font-semibold">
                    {(e.shortfall / Math.max(1, e.daysLeft) * 60).toFixed(0)} min/Tag
                  </span>{" "}
                  mehr machen.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </FlatSection>
  );
}
