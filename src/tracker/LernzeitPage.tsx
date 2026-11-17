import { useEffect, useState } from "react";
import { useStil } from "../lib/stil";
import { GLernzeit } from "../components/g/GLernzeit";
import { useHashRoute, navigate } from "../lib/router";
import { TrackerDashboard } from "./TrackerDashboard";
import { TrackerTimer } from "./TrackerTimer";
import { TrackerCalendar } from "./TrackerCalendar";
import { TrackerSettings } from "./TrackerSettings";
import { ScorePanel } from "./ScorePanel";
import { LernzeitProgressBackground, useProgressTone } from "./LernzeitProgressBackground";
import { TimerWidget } from "./TimerWidget";
import { LearnHarnessThemen } from "./LearnHarnessThemen";
import { ExamPlanner } from "./ExamPlanner";
import { isoDate, useTracker, WEEKDAY_LABELS_FULL } from "./store";
import { useTagesziel } from "../lib/tagesziel";

const SUB_TABS = [
  { id: "dashboard", label: "Dashboard", hash: "#/lernzeit" },
  { id: "timer", label: "Timer", hash: "#/lernzeit/timer" },
  { id: "score", label: "Score", hash: "#/lernzeit/score" },
  { id: "calendar", label: "Kalender", hash: "#/lernzeit/kalender" },
  { id: "settings", label: "Einstellungen", hash: "#/lernzeit/einstellungen" },
] as const;

type SubTabId = (typeof SUB_TABS)[number]["id"];

function activeSubTab(hash: string): SubTabId {
  if (hash.startsWith("#/lernzeit/timer")) return "timer";
  if (hash.startsWith("#/lernzeit/score")) return "score";
  if (hash.startsWith("#/lernzeit/kalender")) return "calendar";
  if (hash.startsWith("#/lernzeit/einstellungen")) return "settings";
  return "dashboard";
}

function fmtHM(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m}`;
}

/** Tiny live header strip: today's progress text + ring color marker. */
function ProgressHeaderStat() {
  const { sessions } = useTracker();
  const goal = useTagesziel().ziel;
  const today = isoDate();
  const todayMin = sessions
    .filter((s) => s.date === today)
    .reduce((a, s) => a + s.durationMin, 0);
  const pct = goal > 0 ? Math.round(Math.min(120, (todayMin / goal) * 100)) : 0;
  const dayName = WEEKDAY_LABELS_FULL[new Date().getDay()];

  const tone =
    pct >= 100 ? "var(--ok)" :
    pct >= 50  ? "var(--warn)" :
    pct > 0    ? "color-mix(in srgb, var(--crit) 80%, var(--warn))" :
                 "var(--crit)";

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: "9999px",
          background: tone,
          boxShadow: `0 0 12px ${tone}`,
        }}
      />
      <div className="flex flex-col">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary leading-none">
          {dayName} · Tagesfortschritt
        </span>
        <span className="font-display font-semibold tabular-nums leading-tight mt-1" style={{ fontSize: "15px", color: "var(--text-1)" }}>
          {fmtHM(todayMin)} <span style={{ color: "var(--text-4)" }}>/</span> {fmtHM(goal)} <span style={{ color: tone, marginLeft: 6 }}>· {pct}%</span>
        </span>
      </div>
    </div>
  );
}

export function LernzeitPage() {
  const hash = useHashRoute();
  const active = activeSubTab(hash);

  // Hourly re-render so the progress bg + header stat track real time
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // The day's tone (red→amber→green) feeds foreground accents too:
  // ring, kickers and section numbers carry the same state as the sky.
  const { color: lzAccent } = useProgressTone();
  // Stil G: Dashboard im Aufbau von Seite G; Klausur-Planer und LearnHarness-
  // Themen wandern in den Kalender, der Timer schwebt unten rechts (App.tsx).
  const g = useStil() === "g";

  return (
    <div className="lernzeit-page relative flex flex-col gap-5" style={{ ["--lz-accent" as string]: lzAccent }}>
      <LernzeitProgressBackground />

      {/* Flat hero header — mirrors the Daily tab: mono kicker + serif title on
          the page surface, no boxed card around it. */}
      <section className="flex flex-col gap-4 px-1 pt-2">
        <div className="lz-kopf flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          {/* Titel: in der Still-Sprache ausgeblendet — dort steht oben kein Satz und kein Titel (still-app.css). */}
          <div className="lz-titel">
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--accent)", letterSpacing: "0.2em" }}>
              WINFO · TUM
            </span>
            <h1
              className="leading-tight mt-1"
              style={{
                fontFamily: "var(--font-serif, ui-serif, 'New York', Georgia, serif)",
                fontWeight: 400,
                fontSize: "clamp(30px, 3.4vw, 44px)",
                letterSpacing: "-0.025em",
                color: "var(--text-1)",
              }}
            >
              Lernzeit
            </h1>
          </div>

          <ProgressHeaderStat />

          <nav className="pill-track lz-tabs" aria-label="Tracker-Navigation">
            {SUB_TABS.map((t) => {
              const isActive = t.id === active;
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(t.hash)}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    (isActive ? "an " : "") +
                    "rounded-full px-3.5 py-1.5 text-[12px] font-display font-semibold transition-colors duration-150 " +
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
                    (isActive ? "" : "text-fg-secondary hover:text-fg")
                  }
                  style={isActive
                    ? { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid rgba(122,162,255,0.3)" }
                    : { border: "1px solid transparent" }}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Unified active-timer window — single source of truth for both Focus and Stopwatch */}
        <TimerWidget className="timer-im-kopf" />
        {!g && <ExamPlanner />}
        {!g && <LearnHarnessThemen />}
      </section>

      {active === "dashboard" && (g ? <GLernzeit /> : <TrackerDashboard />)}
      {g && active === "calendar" && <ExamPlanner />}
      {g && active === "calendar" && <LearnHarnessThemen />}
      {active === "timer" && <TrackerTimer />}
      {active === "score" && <ScorePanel />}
      {active === "calendar" && <TrackerCalendar />}
      {active === "settings" && <TrackerSettings />}
    </div>
  );
}
