import { useMemo } from "react";
import { FlatSection } from "../components/FlatSection";
import { isoDate, totalsByDate, useTracker } from "./store";
import type { Session, Subject } from "./types";

const CELL = 13;
const GAP = 3;
const ROW = CELL + GAP;
const COL = CELL + GAP;

const MONTHS_DE = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];
const WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function intensity(min: number): number {
  if (min <= 0) return 0;
  if (min < 30) return 1;
  if (min < 60) return 2;
  if (min < 120) return 3;
  return 4;
}

function cellFill(level: number): string {
  if (level === 0) return "rgba(255,255,255,0.05)";
  const opacity = [0, 0.25, 0.45, 0.7, 1][level];
  return `rgba(10, 132, 255, ${opacity})`;
}

function buildBreakdown(
  daySessions: Session[],
  subjects: Subject[],
): string {
  const map = new Map<string, number>();
  for (const s of daySessions) {
    map.set(s.subjectId, (map.get(s.subjectId) ?? 0) + s.durationMin);
  }
  return [...map.entries()]
    .map(([id, min]) => {
      const subject = subjects.find((s) => s.id === id);
      return `${subject?.name ?? "?"}: ${min} min`;
    })
    .join("\n");
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function TrackerCalendar() {
  const { sessions, subjects } = useTracker();

  const data = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    const dayOfWeekMondayFirst = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOfWeekMondayFirst);

    const weeks: { iso: string; date: Date }[][] = [];
    const cur = new Date(start);
    while (cur <= today) {
      const week: { iso: string; date: Date }[] = [];
      for (let i = 0; i < 7; i++) {
        if (cur > today) break;
        week.push({ iso: isoDate(cur), date: new Date(cur) });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }
    return { weeks, totals: totalsByDate(sessions) };
  }, [sessions]);

  const monthLabels = useMemo(() => {
    const labels: { x: number; label: string }[] = [];
    let lastMonth = -1;
    data.weeks.forEach((w, i) => {
      const first = w[0]?.date;
      if (!first) return;
      if (first.getMonth() !== lastMonth) {
        labels.push({ x: i * COL, label: MONTHS_DE[first.getMonth()] });
        lastMonth = first.getMonth();
      }
    });
    return labels;
  }, [data]);

  const totalYearMin = useMemo(
    () => sessions.reduce((sum, s) => sum + s.durationMin, 0),
    [sessions],
  );
  const activeDays = useMemo(
    () => new Set(sessions.map((s) => s.date)).size,
    [sessions],
  );

  const width = data.weeks.length * COL + 4;
  const height = 7 * ROW + 24;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryTile
          label="Gesamt · Jahr"
          value={`${Math.round(totalYearMin / 60)} h`}
          sub={`${totalYearMin} min`}
          color="var(--color-blue)"
        />
        <SummaryTile
          label="Aktive Tage"
          value={`${activeDays}`}
          sub="von 365"
          color="var(--color-mint)"
        />
        <SummaryTile
          label="Ø pro aktivem Tag"
          value={
            activeDays > 0
              ? `${Math.round(totalYearMin / activeDays)} min`
              : "—"
          }
          color="var(--color-orange)"
        />
      </div>

      <FlatSection title="Heatmap" icon="📊" meta="letztes Jahr">
        <div className="overflow-x-auto -mx-2 px-2">
          <svg
            width={width + 32}
            height={height}
            role="img"
            aria-label="Lernzeit-Heatmap"
          >
            <g transform={`translate(0, 4)`}>
              {monthLabels.map((m, i) => (
                <text
                  key={i}
                  x={m.x + 32}
                  y={10}
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fill="var(--color-fg-tertiary)"
                >
                  {m.label}
                </text>
              ))}
            </g>

            <g transform={`translate(0, 24)`}>
              {WEEKDAYS_DE.map((w, i) =>
                i % 2 === 0 ? (
                  <text
                    key={w}
                    x={0}
                    y={i * ROW + CELL - 2}
                    fontSize={9}
                    fontFamily="var(--font-mono)"
                    fill="var(--color-fg-tertiary)"
                  >
                    {w}
                  </text>
                ) : null,
              )}
            </g>

            <g transform={`translate(28, 24)`}>
              {data.weeks.map((week, wi) =>
                week.map((day, di) => {
                  const min = data.totals.get(day.iso) ?? 0;
                  const lvl = intensity(min);
                  const fill = cellFill(lvl);
                  const x = wi * COL;
                  const y = di * ROW;
                  const daySessions = sessions.filter(
                    (s) => s.date === day.iso,
                  );
                  const breakdown = daySessions.length
                    ? buildBreakdown(daySessions, subjects)
                    : "";
                  const tooltip =
                    `${formatDateLong(day.iso)}\n${min} min gesamt` +
                    (breakdown ? `\n${breakdown}` : "");
                  return (
                    <rect
                      key={`${wi}-${di}`}
                      x={x}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx={3}
                      fill={fill}
                    >
                      <title>{tooltip}</title>
                    </rect>
                  );
                }),
              )}
            </g>
          </svg>
        </div>

        <div className="flex items-center gap-2 mt-4 text-xs text-fg-tertiary">
          <span>Wenig</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="inline-block rounded-[3px]"
              style={{ width: 12, height: 12, backgroundColor: cellFill(l) }}
            />
          ))}
          <span>Viel</span>
        </div>
      </FlatSection>
    </div>
  );
}

// Aurora stat tile: quiet glass surface, white value on top, mono label below.
// `color` stays in the props type for call-site compatibility but is no longer
// used — data reads white, accent colors are reserved for state and action.
function SummaryTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="flat-stat py-2">
      <div
        className="metric text-3xl tabular-nums"
        style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mt-1.5">
        {label}
      </div>
      {sub && <div className="text-[11px] text-fg-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}
