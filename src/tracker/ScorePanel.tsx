import { useMemo } from "react";
import { FlatSection } from "../components/FlatSection";
import { ProgressRing } from "./ProgressRing";
import { useTracker, isoDate } from "./store";
import { useTagesziel } from "../lib/tagesziel";
import { computeDayScore, DRAG_GRACE_DAYS, DRAG_MAX, ROUTINE_BONUS, TASKS_MAX, TIME_BASE, TIME_BONUS_MAX } from "../lib/dayScore";
import {
  loadScoreHistory, averageScore, scoreTrend, sameVersion, currentVersion, switchDate, type ScoreDay,
} from "../lib/scoreHistory";
import { routineHakenAm, routineTodos } from "../lib/bewusst";
import { lies, SCHLUESSEL } from "../lib/store";
import type { Task } from "../types";
import { useStil } from "../lib/stil";
import { GScore } from "../components/g/GScore";
import { mitHeute } from "../lib/scoreStats";

// The Score tab: where the daily number stops being a mood ring and becomes
// something you can argue with — what it's made of, where it's heading, and
// what is actively dragging it down right now.

function loadTodos(): Task[] {
  try {
    return JSON.parse(localStorage.getItem("morning.todos") ?? "[]") as Task[];
  } catch {
    return [];
  }
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** A stat with a big number and a quiet label, matching the Lernzeit panels. */
function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-display tabular-nums"
        style={{ fontSize: 28, fontWeight: 500, color: tone ?? "var(--text-1)", lineHeight: 1 }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--text-4)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** Label/value line for the month facts. */
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>{label}</span>
      <span className="font-mono tabular-nums" style={{ fontSize: 12.5, color: tone ?? "var(--text-1)" }}>
        {value}
      </span>
    </div>
  );
}

/** Monday-based start of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Schnitt über genau eine Formel (mit oder ohne Routine-Bonus). Tage der
 *  anderen fallen raus — aus „Vormonat nur alte Formel" wird ein ehrliches
 *  „—" statt eines Sprungs, den nur die Umstellung erzeugt hätte. */
function meanScore(days: ScoreDay[], v: 1 | 2): number | null {
  const gleich = sameVersion(days, v);
  if (gleich.length === 0) return null;
  return Math.round(gleich.reduce((a, d) => a + d.score, 0) / gleich.length);
}

/** Same trend vocabulary the Lernzeit dashboard uses, in score points. */
function trendMark(curr: number | null, prev: number | null) {
  if (curr === null || prev === null) return { icon: "—", cls: "text-fg-tertiary", diff: 0 };
  const diff = curr - prev;
  if (diff >= 3) return { icon: "↑", cls: "text-[var(--color-positive)]", diff };
  if (diff <= -3) return { icon: "↓", cls: "text-[var(--color-red)]", diff };
  return { icon: "→", cls: "text-fg-tertiary", diff };
}

const toneFor = (score: number) =>
  score >= 70 ? "var(--ok)" : score >= 40 ? "var(--warn)" : "var(--crit)";

/** Mon–Sun columns for one week, empty days shown as hollow slots so a gap
 *  reads as "nothing happened" rather than silently collapsing. */
function WeekBars({ days, weekStart }: { days: ScoreDay[]; weekStart: Date }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const labels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  return (
    <div className="flex items-end gap-2" style={{ height: 96 }}>
      {labels.map((lbl, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const iso = isoDate(d);
        const entry = byDate.get(iso);
        const h = entry ? Math.max(4, (entry.score / 100) * 80) : 4;
        return (
          <div key={iso} className="flex-1 flex flex-col items-center justify-end gap-1.5" style={{ maxWidth: 52 }} title={entry ? `${iso}: ${entry.score}` : `${iso}: kein Eintrag`}>
            <span className="font-mono tabular-nums" style={{ fontSize: 9, color: "var(--text-4)" }}>
              {entry ? entry.score : ""}
            </span>
            <div
              style={{
                width: "100%", height: h, borderRadius: 3,
                background: entry ? toneFor(entry.score) : "var(--line-1)",
                opacity: entry ? 0.8 : 1,
              }}
            />
            <span className="font-mono" style={{ fontSize: 9, color: "var(--text-4)" }}>{lbl}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Last 14 recorded days as bars — enough to see a slump, short enough to read. */
function History({ days, umstellung }: { days: ScoreDay[]; umstellung: string | null }) {
  const recent = days.slice(-14);
  if (recent.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-3)" }}>
        Noch keine Historie — ab heute wird jeder Tag festgehalten.
      </p>
    );
  }
  return (
    // maxWidth per bar: with only a day or two recorded, flex-1 would stretch
    // a single value across the whole panel and read like an error.
    <div className="flex items-end gap-1.5" style={{ height: 90 }}>
      {recent.map((d) => {
        const h = Math.max(3, (d.score / 100) * 84);
        const tone = d.score >= 70 ? "var(--ok)" : d.score >= 40 ? "var(--warn)" : "var(--crit)";
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col items-center justify-end gap-1"
            style={{
              maxWidth: 44,
              borderLeft: d.date === umstellung ? "1px solid var(--accent)" : undefined,
              paddingLeft: d.date === umstellung ? 4 : undefined,
            }}
            title={d.date === umstellung
              ? `${d.date}: ${d.score} · ab hier mit Routine-Bonus`
              : `${d.date}: ${d.score}`}
          >
            <div style={{ width: "100%", height: h, background: tone, opacity: 0.75, borderRadius: 3 }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-4)" }}>
              {d.date.slice(8)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ScorePanel() {
  const { sessions } = useTracker();
  const stil = useStil();
  const now = new Date();
  const todayIso = isoDate(now);

  const todos = loadTodos();
  const dayTodos = todos.filter((t) => (t.scope ?? "day") === "day");
  const studyMin = useMemo(
    () => sessions.filter((s) => s.date === todayIso).reduce((a, s) => a + s.durationMin, 0),
    [sessions, todayIso],
  );
  const tz = useTagesziel(now);
  const dayGoal = tz.ziel;
  // Routinen und Gym von heute, aus dem gespeicherten Bewusst-Stand — dieselbe
  // Zählung wie im Morgendialog, damit der Score an beiden Stellen gleich ist.
  const bewusstStand = lies(SCHLUESSEL.bewusst);
  const routineHaken = routineHakenAm(bewusstStand, todayIso);
  const routinenOffen = routineTodos(bewusstStand, todayIso).filter((r) => !r.done).length;
  const parts = computeDayScore(dayTodos, studyMin, dayGoal, now.getTime(), routineHaken);

  const history = loadScoreHistory();
  const avg7 = averageScore(history, 7);
  const avg30 = averageScore(history, 30);
  const trend = scoreTrend(history, 7);
  const formel = currentVersion(history);
  const umstellung = switchDate(history);

  // Calendar-aligned week and month (not "last N entries") so the overviews
  // match what the Lernzeit dashboard shows next door.
  const weekStart = startOfWeek(now);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const inRange = (d: ScoreDay, from: Date, to: Date) => d.date >= isoDate(from) && d.date < isoDate(to);

  const thisWeek = history.filter((d) => inRange(d, weekStart, new Date(weekStart.getTime() + 7 * 86_400_000)));
  const lastWeek = history.filter((d) => inRange(d, prevWeekStart, weekStart));
  const weekAvg = meanScore(thisWeek, formel);
  const weekTrend = trendMark(weekAvg, meanScore(lastWeek, formel));

  const monthPrefix = todayIso.slice(0, 7);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthPrefix = isoDate(prevMonthDate).slice(0, 7);
  const thisMonth = history.filter((d) => d.date.startsWith(monthPrefix));
  const lastMonth = history.filter((d) => d.date.startsWith(prevMonthPrefix));
  const monthAvg = meanScore(thisMonth, formel);
  const monthTrend = trendMark(monthAvg, meanScore(lastMonth, formel));
  const best = thisMonth.reduce<ScoreDay | null>((a, d) => (!a || d.score > a.score ? d : a), null);
  const worst = thisMonth.reduce<ScoreDay | null>((a, d) => (!a || d.score < a.score ? d : a), null);
  const strongDays = thisMonth.filter((d) => d.score >= 70).length;

  // What's actually hurting today — ranked, so the panel gives an answer
  // rather than a dashboard to interpret.
  const problems: string[] = [];
  if (parts.stale.length > 0) {
    const worst = parts.stale[0];
    problems.push(
      `${parts.stale.length} ${parts.stale.length === 1 ? "Aufgabe liegt" : "Aufgaben liegen"} zu lange — „${worst.text}" seit ${worst.days} Tagen (kostet ${Math.abs(parts.drag)} ${Math.abs(parts.drag) === 1 ? "Punkt" : "Punkte"}).`,
    );
  }
  if (dayGoal > 0 && studyMin < dayGoal) {
    problems.push(`Lernzeit ${fmtMin(studyMin)} von ${fmtMin(dayGoal)} — ${fmtMin(dayGoal - studyMin)} fehlen zum Ziel.`);
  } else if (dayGoal > 0 && studyMin < dayGoal * 1.5) {
    // Die Gegenrichtung zur Zeile darueber. Ohne sie steht nach dem Erreichen
    // des Ziels nur noch da, was fehlt — und die letzten Punkte saehen aus wie
    // ein Fehler statt wie die Regel, die sie sind.
    problems.push(
      `Ziel erreicht. Die vollen ${TIME_BASE + TIME_BONUS_MAX} Lernpunkte gibt es bei ${fmtMin(Math.round(dayGoal * 1.5))} — eine Überminute zählt halb.`,
    );
  }
  if (parts.weightedTotal === 0) {
    problems.push("Keine Aufgaben für heute eingetragen — der Aufgabenteil bleibt bei 0.");
  } else if (parts.weightedDone === 0) {
    problems.push(`Noch nichts abgehakt — der Aufgabenteil bringt bis zu ${TASKS_MAX} Punkte.`);
  }
  if (routinenOffen > 0) {
    problems.push(
      `${routinenOffen} ${routinenOffen === 1 ? "Routine ist" : "Routinen sind"} heute noch offen — je +${ROUTINE_BONUS} Punkte.`,
    );
  }
  if (trend !== null && trend <= -5) {
    problems.push(`Der Schnitt ist gegenüber der Vorwoche um ${Math.abs(trend)} Punkte gefallen.`);
  }

  const overtime = Math.max(0, studyMin - dayGoal);

  if (stil === "g") {
    return (
      <GScore
        parts={parts} dayGoal={dayGoal} routinenOffen={routinenOffen} todayIso={todayIso}
        weekStart={weekStart} verlauf={mitHeute(history, {
          date: todayIso, score: parts.score, tasks: parts.tasks, time: parts.time, drag: parts.drag,
          studyMin, goalMin: dayGoal, tasksDone: dayTodos.filter((t) => t.done).length, tasksTotal: dayTodos.length,
          routineHaken: parts.routineHaken, routineBonus: parts.routineBonus, v: 2,
        })}
        weekAvg={weekAvg} monthAvg={monthAvg} avg7={avg7} avg30={avg30} trend={trend}
        best={best}
        klausuren={tz.lern?.zeilen.map((z) => z.stand) ?? []}
        grenzen={{ tasksMax: TASKS_MAX, timeMax: TIME_BASE + TIME_BONUS_MAX, timeBase: TIME_BASE, dragMax: DRAG_MAX, routineBonus: ROUTINE_BONUS }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Hero — mirrors the Lernzeit dashboard: ring left, statement + parts right */}
      <FlatSection title="Heute" size="large" className="flat-hero" meta={`${parts.score} / 100`}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-center">
          <div className="flex flex-col items-center gap-3 justify-center">
            <ProgressRing progress={parts.score / 100} size={200} strokeWidth={12} color={toneFor(parts.score)}>
              <span
                className="metric text-5xl tabular-nums leading-none"
                style={{ color: "var(--text-1)", letterSpacing: "-0.03em" }}
              >
                {parts.score}
              </span>
            </ProgressRing>
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Score heute</span>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-4">
            <p className="lern-statement">
              {parts.score >= 70
                ? <>Starker Tag. <em>{fmtMin(studyMin)} gelernt, {parts.weightedDone > 0 ? "Aufgaben laufen" : "jetzt noch abhaken"}.</em></>
                : studyMin === 0
                  ? <>Noch nichts passiert. <em>Die Lernzeit trägt {TIME_BASE + TIME_BONUS_MAX} der 100 Punkte.</em></>
                  : <>{fmtMin(studyMin)} von {fmtMin(dayGoal)}. <em>Der größte Hebel liegt bei der Lernzeit.</em></>}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat value={String(parts.tasks)} label={`Aufgaben · max ${TASKS_MAX}`} />
              <Stat value={String(parts.time)} label={`Lernzeit · max ${TIME_BASE + TIME_BONUS_MAX}`} />
              <Stat
                value={parts.routineBonus > 0 ? `+${parts.routineBonus}` : "0"}
                label={`Routinen · +${ROUTINE_BONUS} je Haken`}
                tone={parts.routineBonus > 0 ? "var(--ok)" : undefined}
              />
              <Stat
                value={String(parts.drag)}
                label={`Altlasten · max −${DRAG_MAX}`}
                tone={parts.drag < 0 ? "var(--crit)" : undefined}
              />
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
              Dringende Aufgaben zählen dreifach, wichtige doppelt.
              {overtime > 0 && ` Überstunden: ${fmtMin(overtime)} über dem Ziel — bringen Bonuspunkte.`}
            </p>
          </div>
        </div>
      </FlatSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <FlatSection title="Diese Woche" meta={thisWeek.length > 0 ? `${thisWeek.length} Tage` : undefined}>
          <div className="flex items-end justify-between mb-3">
            <Stat value={weekAvg !== null ? String(weekAvg) : "—"} label="Schnitt" tone={weekAvg !== null ? toneFor(weekAvg) : undefined} />
            <div className="flex flex-col items-end gap-0.5 mb-1">
              <span className={`text-[13px] font-semibold tabular-nums ${weekTrend.cls}`}>
                {weekTrend.icon} {weekTrend.diff > 0 ? "+" : ""}{weekTrend.diff || ""}
              </span>
              <span className="text-[10px] text-fg-tertiary">
                vs. Vorwoche {meanScore(lastWeek, formel) !== null ? `(${meanScore(lastWeek, formel)})` : "(—)"}
              </span>
            </div>
          </div>
          <WeekBars days={thisWeek} weekStart={weekStart} />
        </FlatSection>

        <FlatSection title="Diesen Monat" meta={thisMonth.length > 0 ? `${thisMonth.length} Tage` : undefined}>
          <div className="flex items-end justify-between mb-4">
            <Stat value={monthAvg !== null ? String(monthAvg) : "—"} label="Schnitt" tone={monthAvg !== null ? toneFor(monthAvg) : undefined} />
            <div className="flex flex-col items-end gap-0.5 mb-1">
              <span className={`text-[13px] font-semibold tabular-nums ${monthTrend.cls}`}>
                {monthTrend.icon} {monthTrend.diff > 0 ? "+" : ""}{monthTrend.diff || ""}
              </span>
              <span className="text-[10px] text-fg-tertiary">
                vs. Vormonat {meanScore(lastMonth, formel) !== null ? `(${meanScore(lastMonth, formel)})` : "(—)"}
              </span>
            </div>
          </div>
          {thisMonth.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>Diesen Monat noch nichts erfasst.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <Row label="Bester Tag" value={best ? `${best.score} · ${best.date.slice(8)}.${best.date.slice(5, 7)}.` : "—"} tone="var(--ok)" />
              <Row label="Schwächster Tag" value={worst ? `${worst.score} · ${worst.date.slice(8)}.${worst.date.slice(5, 7)}.` : "—"} tone="var(--crit)" />
              <Row label="Tage über 70" value={`${strongDays} von ${thisMonth.length}`} />
            </div>
          )}
        </FlatSection>
      </div>

      <FlatSection title="Entwicklung" meta={history.length > 0 ? `${history.length} Tage erfasst` : undefined}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6" style={{ marginBottom: 20 }}>
          <Stat value={avg7 !== null ? String(avg7) : "—"} label="Schnitt 7 Tage" />
          <Stat value={avg30 !== null ? String(avg30) : "—"} label="Schnitt 30 Tage" />
          <Stat
            value={trend !== null ? (trend > 0 ? `+${trend}` : String(trend)) : "—"}
            label="vs. Vorwoche"
            tone={trend === null ? undefined : trend > 0 ? "var(--ok)" : trend < 0 ? "var(--crit)" : undefined}
          />
        </div>
        <History days={history} umstellung={umstellung} />
      </FlatSection>

      <FlatSection title="Was gerade bremst">
        {problems.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-2)" }}>
            Nichts Auffälliges. Ziel erreicht, nichts liegt zu lange — so darf es bleiben.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {problems.map((p, i) => (
              <li key={i} className="flex items-start gap-2" style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                <span aria-hidden="true" style={{ color: "var(--warn)", flexShrink: 0 }}>·</span>
                {p}
              </li>
            ))}
          </ul>
        )}

        {parts.stale.length > 0 && (
          <div style={{ marginTop: 18, borderTop: "1px solid var(--line-1)", paddingTop: 14 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em",
                textTransform: "uppercase", color: "var(--text-4)",
              }}
            >
              Liegt seit über {DRAG_GRACE_DAYS} Tagen
            </span>
            <ul className="flex flex-col gap-1" style={{ marginTop: 8 }}>
              {parts.stale.slice(0, 6).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3" style={{ fontSize: 13 }}>
                  <span className="truncate" style={{ color: "var(--text-2)" }}>{s.text}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--crit)", whiteSpace: "nowrap",
                    }}
                  >
                    {s.days} d · −{s.cost}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </FlatSection>
    </div>
  );
}
