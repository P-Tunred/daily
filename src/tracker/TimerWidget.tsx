import { useTracker } from "./store";
import { useTimerContext, type FocusMode } from "./TimerContext";
import { BrainFachHinweis } from "./BrainFachHinweis";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

const MODE_ICON: Record<FocusMode, string> = {
  focus: "🎯",
  shortBreak: "☕",
  longBreak: "🌙",
};

const MODE_LABEL: Record<FocusMode, string> = {
  focus: "Fokus",
  shortBreak: "Kurze Pause",
  longBreak: "Lange Pause",
};

const MODE_COLOR: Record<FocusMode, string> = {
  focus: "var(--color-blue)",
  shortBreak: "var(--color-mint)",
  longBreak: "var(--color-purple)",
};

const btn = `
  h-7 rounded-full font-display font-semibold text-[11px] px-3
  transition-colors duration-150
  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
  inline-flex items-center gap-1
`;

// ── Progress fill — the pill "fills up" as time passes ───────────────────────
// The outline (pill border) is already there; this paints the inside from the
// left. Stopwatch: full at one hour (30 min = half). Focus: full when the
// phase completes. scaleX instead of width so the per-second update animates
// on the compositor.
function PillFill({ fraction, color }: { fraction: number; color: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-10 pointer-events-none"
      style={{
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        transform: `scaleX(${f})`,
        transformOrigin: "left",
        transition: "transform 1s linear",
      }}
    />
  );
}

const HOUR_MS = 3_600_000;

// ── Widget ────────────────────────────────────────────────────────────────────

export function TimerWidget({ className }: { className?: string }) {
  const ctx = useTimerContext();
  const { subjects } = useTracker();

  const { focusTimer, stopwatch, remainingSec, elapsedMs,
          isFocusRunning, isStopwatchRunning } = ctx;

  // Nothing running at all — hide widget
  if (!focusTimer && !stopwatch) return null;

  const focusSubject = focusTimer
    ? subjects.find((s) => s.id === focusTimer.subjectId)
    : null;
  const swSubject = stopwatch
    ? subjects.find((s) => s.id === stopwatch.subjectId)
    : null;
  // Ein Hinweis, nicht zwei: laufen Fokus-Timer und Stoppuhr gleichzeitig,
  // gewinnt das Fach, an dem gerade fokussiert gelernt wird. In der Pause
  // bleibt der Hinweis weg — da soll nichts ans Lernen erinnern.
  const brainFach = (focusTimer?.mode === "focus" ? focusSubject : null) ?? swSubject ?? null;

  return (
    <div className={`flex flex-col gap-2${className ? ` ${className}` : ""}`}>
      {/* ── Focus timer row ─────────────────────────────────────────────── */}
      {focusTimer && (
        <div className="
          relative isolate overflow-hidden
          flex items-center gap-3 flex-wrap
          px-4 py-2 rounded-2xl
          border border-white/[0.08] bg-white/[0.04]
          text-sm
        ">
          <PillFill
            fraction={focusTimer.duration > 0 ? 1 - remainingSec / focusTimer.duration : 0}
            color={MODE_COLOR[focusTimer.mode]}
          />
          <span className="text-base leading-none">{MODE_ICON[focusTimer.mode]}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
            {MODE_LABEL[focusTimer.mode]}
          </span>

          {focusTimer.mode === "focus" && focusSubject && (
            <>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: focusSubject.color }}
              />
              <span className="font-display font-semibold text-[13px] text-fg truncate max-w-[140px]">
                {focusSubject.name}
              </span>
            </>
          )}

          <span className="text-fg-tertiary/40 hidden sm:inline">·</span>

          <span
            className="metric text-[22px] tabular-nums leading-none"
            style={{ color: MODE_COLOR[focusTimer.mode] }}
          >
            {fmt(remainingSec)}
          </span>

          {focusTimer.mode === "focus" && (
            <span className="font-mono text-[10px] text-fg-tertiary tabular-nums">
              {focusTimer.pomodoroCount % 4}/4
            </span>
          )}

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={isFocusRunning ? ctx.pauseFocus : ctx.resumeFocus}
              className={btn + " bg-white/10 hover:bg-white/15 text-fg"}
            >
              {isFocusRunning ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => ctx.resetFocus()}
              className={btn + " bg-white/5 hover:bg-white/10 text-fg-tertiary hover:text-fg"}
              title="Zurücksetzen"
            >
              ↺
            </button>
          </div>
        </div>
      )}

      {/* ── Stopwatch row ───────────────────────────────────────────────── */}
      {stopwatch && (
        <div className="
          relative isolate overflow-hidden
          flex items-center gap-3 flex-wrap
          px-4 py-2 rounded-2xl
          border border-white/[0.08] bg-white/[0.04]
          text-sm
        ">
          {/* Fills over one hour: 30 min = half, 60+ min = full. */}
          <PillFill
            fraction={elapsedMs / HOUR_MS}
            color={swSubject?.color ?? "var(--color-orange)"}
          />
          <span className="text-base leading-none">⏱</span>

          {swSubject && (
            <>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: swSubject.color }}
              />
              <span className="font-display font-semibold text-[13px] text-fg truncate max-w-[140px]">
                {swSubject.name}
              </span>
            </>
          )}

          {stopwatch.note && (
            <span className="text-[11px] text-fg-tertiary truncate max-w-[100px]">
              {stopwatch.note}
            </span>
          )}

          <span className="text-fg-tertiary/40 hidden sm:inline">·</span>

          <span className="metric text-[22px] tabular-nums leading-none text-[var(--color-orange)]">
            {fmtMs(elapsedMs)}
          </span>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={isStopwatchRunning ? ctx.pauseStopwatch : ctx.resumeStopwatch}
              className={btn + " bg-white/10 hover:bg-white/15 text-fg"}
            >
              {isStopwatchRunning ? "⏸" : "▶"}
            </button>
            <button
              onClick={ctx.saveStopwatch}
              data-sound="confirm"
              className={btn + " bg-[var(--color-positive)] hover:bg-[var(--color-positive)]/90 text-white"}
            >
              ✓ Speichern
            </button>
            <button
              onClick={ctx.resetStopwatch}
              className={btn + " bg-white/5 hover:bg-white/10 text-fg-tertiary hover:text-fg"}
              title="Verwerfen"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {brainFach && <BrainFachHinweis key={brainFach.id} fach={brainFach.name} />}
    </div>
  );
}
