import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { FlatSection } from "../components/FlatSection";
import { ProgressRing } from "./ProgressRing";
import { SubjectMark } from "./SubjectDot";
import { isoDate, useTracker } from "./store";
import { useStil } from "../lib/stil";
import { GTimer } from "../components/g/GTimer";
import {
  FOCUS_PRESETS,
  useTimerContext,
  type FocusMode,
} from "./TimerContext";
import type { BlockCategory } from "./types";

// ── Labels / colours ──────────────────────────────────────────────────────────

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

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function fmtHMS(totalMs: number): string {
  const s = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

// ── Subject selector (shared) ─────────────────────────────────────────────────

type SubjectLite = { id: string; name: string; color: string; archiviert?: boolean };

function SubjectSelector({
  subjects,
  selected,
  onSelect,
  disabled,
}: {
  subjects: SubjectLite[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  if (subjects.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        Lege erst ein Fach unter „Einstellungen" an.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {/* Nur aktive Faecher — archivierte bleiben in Statistik und Verlauf,
          aber man startet keine neue Sitzung mehr auf ihnen. */}
      {subjects.filter((s) => !s.archiviert).map((s) => {
        const active = s.id === selected;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            disabled={disabled}
            className={
              "rounded-full px-3 py-1.5 text-[12px] font-display font-semibold transition-colors duration-150 inline-flex items-center gap-2 " +
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] " +
              "disabled:opacity-40 disabled:cursor-not-allowed " +
              (active ? "text-bg" : "text-fg-secondary hover:text-fg")
            }
            style={
              active
                ? { backgroundColor: s.color }
                : { backgroundColor: "rgba(255,255,255,0.06)" }
            }
          >
            <SubjectMark name={s.name} color={s.color} size="sm" />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const LAST_SUBJECT_KEY = "morning.tracker.lastSubject";

function loadLastSubject(): string {
  try { return localStorage.getItem(LAST_SUBJECT_KEY) ?? ""; }
  catch { return ""; }
}

export function TrackerTimer() {
  const { subjects } = useTracker();
  const { requestManualSave } = useTimerContext();
  const stil = useStil();
  // Initialise from persisted last-used subject so the chip selection survives
  // navigations and reloads instead of always snapping back to the first fach.
  const [selectedSubject, setSelectedSubject] = useState(() => {
    const last = loadLastSubject();
    if (last && (subjects.length === 0 || subjects.some((s) => s.id === last))) return last;
    return subjects[0]?.id ?? "";
  });

  // If the stored subject no longer exists (deleted), fall back to first.
  // If we have no subject yet but subjects loaded, pick the first.
  useEffect(() => {
    if (subjects.length === 0) return;
    if (selectedSubject && !subjects.some((s) => s.id === selectedSubject)) {
      setSelectedSubject(subjects[0].id);
    } else if (!selectedSubject) {
      setSelectedSubject(subjects[0].id);
    }
  }, [subjects, selectedSubject]);

  // Persist user choice across mounts / reloads
  useEffect(() => {
    if (selectedSubject) {
      try { localStorage.setItem(LAST_SUBJECT_KEY, selectedSubject); } catch { /* quota */ }
    }
  }, [selectedSubject]);

  if (stil === "g") {
    return <GTimer subjects={subjects} selectedSubject={selectedSubject} onSelectSubject={setSelectedSubject} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FocusTimerCard
        subjects={subjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />
      <div className="flex flex-col gap-6">
        <StopwatchCard
          subjects={subjects}
          selectedSubject={selectedSubject}
          onSelectSubject={setSelectedSubject}
        />
        <ManualEntryCard
          subjects={subjects}
          defaultSubject={selectedSubject}
          onSave={requestManualSave}
        />
      </div>
    </div>
  );
}

// ── Focus Timer ───────────────────────────────────────────────────────────────

function FocusTimerCard({
  subjects,
  selectedSubject,
  onSelectSubject,
}: {
  subjects: SubjectLite[];
  selectedSubject: string;
  onSelectSubject: (id: string) => void;
}) {
  const ctx = useTimerContext();

  // Use the dedicated focusTimer state — independent from stopwatch
  const focusTimer = ctx.focusTimer;

  // Local UI state (only used when no focus timer is active)
  const [localMode, setLocalMode] = useState<FocusMode>("focus");
  const [customMin, setCustomMin] = useState("");

  const mode = focusTimer?.mode ?? localMode;
  const duration = focusTimer?.duration ?? FOCUS_PRESETS[localMode];
  const remaining = focusTimer ? ctx.remainingSec : FOCUS_PRESETS[localMode];
  const running = focusTimer ? focusTimer.startedAt !== null : false;
  const pomodoroCount = focusTimer?.pomodoroCount ?? 0;
  const progress = duration > 0 ? 1 - remaining / duration : 0;

  const effectiveSubject = focusTimer?.subjectId ?? selectedSubject;

  // The stage takes the color of what you study: in focus mode the ring wears
  // the selected subject's color; breaks keep their own calm tones.
  const stageColor = mode === "focus"
    ? (subjects.find((s) => s.id === effectiveSubject)?.color ?? MODE_COLOR.focus)
    : MODE_COLOR[mode];

  const handleChangeMode = (m: FocusMode, customSec?: number) => {
    if (focusTimer) {
      ctx.resetFocus(m, customSec);
    } else {
      const dur = customSec ?? FOCUS_PRESETS[m];
      setLocalMode(m);
      ctx.setFocusMode(m, dur);
    }
  };

  const handleStart = () => {
    if (!selectedSubject && !focusTimer?.subjectId) return;
    ctx.startFocus(selectedSubject, mode, duration);
  };

  const applyCustom = () => {
    const m = parseInt(customMin, 10);
    if (Number.isFinite(m) && m > 0 && m <= 240) {
      handleChangeMode("focus", m * 60);
      setCustomMin("");
    }
  };

  return (
    <FlatSection
      title="Fokus"
      icon="🎯"
      meta={`${pomodoroCount % 4}/4`}
      className="flat-hero"
    >
      {/* Mode picker */}
      <div className="pill-track flex-wrap mb-6">
        {(["focus", "shortBreak", "longBreak"] as FocusMode[]).map((m) => (
          <button
            key={m}
            onClick={() => handleChangeMode(m)}
            className={
              "rounded-full px-3 py-1.5 text-[12px] font-display font-semibold transition-colors duration-150 " +
              (mode === m ? "" : "text-fg-secondary hover:text-fg")
            }
            style={mode === m
              ? { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid rgba(122,162,255,0.3)" }
              : { border: "1px solid transparent" }}
          >
            {MODE_LABEL[m]} · {Math.round((FOCUS_PRESETS[m]) / 60)}
          </button>
        ))}
      </div>

      {/* Ring */}
      <div className="flex flex-col items-center gap-6">
        <ProgressRing
          progress={progress}
          color={stageColor}
          size={290}
          strokeWidth={10}
        >
          <span className="metric text-6xl text-fg tabular-nums" style={{ letterSpacing: "-0.03em" }}>
            {fmtMMSS(remaining)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mt-2">
            {MODE_LABEL[mode]}
          </span>
        </ProgressRing>

        {/* Controls */}
        <div className="flex gap-2.5 flex-wrap justify-center">
          {/* Primary action: Start / Pause */}
          {!running ? (
            <button
              onClick={handleStart}
              disabled={!selectedSubject && !focusTimer?.subjectId}
              data-sound="confirm"
              className="
                font-display font-semibold text-sm text-[#0A0C12]
                bg-[var(--color-blue)] hover:bg-[var(--color-blue)]/90
                rounded-full px-7 py-3 transition-colors duration-150
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              ▶ {focusTimer ? "Weiter" : "Start"}
            </button>
          ) : (
            <button
              onClick={ctx.pauseFocus}
              className="
                font-display font-semibold text-sm text-fg
                bg-white/10 hover:bg-white/15
                rounded-full px-7 py-3 transition-colors duration-150
              "
            >
              ⏸ Pause
            </button>
          )}

          {/* Save — always visible during a focus session, works without pausing */}
          {focusTimer && focusTimer.mode === "focus" && (
            <button
              onClick={ctx.stopFocus}
              title="Zeit jetzt speichern — kein Pause nötig"
              data-sound="confirm"
              className="
                font-display font-semibold text-sm
                rounded-full px-5 py-3 transition-all duration-150
              "
              style={{
                color: "var(--ok)",
                background: "color-mix(in srgb, var(--ok) 14%, transparent)",
                border: "1px solid color-mix(in srgb, var(--ok) 35%, transparent)",
              }}
            >
              ✓ Speichern
            </button>
          )}

          {/* Reset round */}
          <button
            onClick={() => ctx.resetFocus()}
            title="Runde neu starten"
            className="
              font-display font-semibold text-sm text-fg-secondary
              bg-white/5 hover:bg-white/10 hover:text-fg
              rounded-full px-4 py-3 transition-colors duration-150
            "
          >
            ↺
          </button>

          {/* Discard (break mode or cancel) */}
          {focusTimer && (
            <button
              onClick={ctx.discardFocus}
              title="Timer verwerfen"
              data-sound="dismiss"
              className="
                font-display font-semibold text-sm text-fg-tertiary
                bg-white/5 hover:bg-[var(--color-red)]/20 hover:text-[var(--color-red)]
                rounded-full px-4 py-3 transition-colors duration-150
              "
            >
              ✕
            </button>
          )}
        </div>

        {/* Custom duration */}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
        >
          <span className="text-xs text-fg-tertiary">Eigene Dauer</span>
          <input
            type="number"
            min={1}
            max={240}
            placeholder="min"
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
            className="field w-20 text-center"
          />
          <button
            type="submit"
            className="
              font-display font-semibold text-[12px] text-fg-secondary
              bg-white/8 hover:bg-white/15 hover:text-fg
              rounded-full px-3 py-1.5 transition-colors duration-150
            "
          >
            Setzen
          </button>
        </form>
      </div>

      {/* Subject selector */}
      <div className="mt-6 pt-5 border-t border-[var(--color-hairline)]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-3">
          Fach
        </p>
        <SubjectSelector
          subjects={subjects}
          selected={effectiveSubject}
          onSelect={(id) => {
            onSelectSubject(id);
            if (focusTimer) ctx.setFocusSubject(id);
          }}
          disabled={running}
        />
        {mode === "focus" && !effectiveSubject && subjects.length > 0 && (
          <p className="text-xs text-[var(--color-orange)] mt-3">
            Wähle ein Fach, bevor du den Fokus-Timer startest.
          </p>
        )}
      </div>
    </FlatSection>
  );
}

// ── Stopwatch ─────────────────────────────────────────────────────────────────

function StopwatchCard({
  subjects,
  selectedSubject,
  onSelectSubject,
}: {
  subjects: SubjectLite[];
  selectedSubject: string;
  onSelectSubject: (id: string) => void;
}) {
  const ctx = useTimerContext();

  // Use the dedicated stopwatch state — independent from focus timer
  const sw = ctx.stopwatch;

  // Local note state — synced into context on start/update
  const [note, setNote] = useState(sw?.note ?? "");

  // Keep local note in sync if context changes it from outside
  useEffect(() => {
    if (sw) setNote(sw.note);
  }, [sw?.note]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = sw ? sw.startedAt !== null : false;
  const effectiveSubject = sw?.subjectId ?? selectedSubject;

  return (
    <Card title="Stoppuhr" icon="⏱️">
      {/* Time display — flat on the card surface, no filled box (Aurora) */}
      <div className="py-6 mb-4 text-center">
        <div className="metric text-5xl text-fg tabular-nums" style={{ letterSpacing: "-0.02em" }}>
          {fmtHMS(ctx.elapsedMs)}
        </div>
      </div>

      {/* Subject */}
      <div className="mb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-2">
          Fach
        </p>
        <SubjectSelector
          subjects={subjects}
          selected={effectiveSubject}
          onSelect={(id) => {
            onSelectSubject(id);
            if (sw) ctx.setStopwatchSubject(id);
          }}
          disabled={running}
        />
      </div>

      {/* Note */}
      <input
        className="field w-full mb-4"
        placeholder="Notiz (optional)"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (sw) ctx.setStopwatchNote(e.target.value);
        }}
      />

      {/* Controls */}
      <div className="flex gap-2 flex-wrap">
        {!running ? (
          <button
            onClick={() => ctx.startStopwatch(effectiveSubject, note)}
            disabled={!effectiveSubject}
            data-sound="confirm"
            className="
              flex-1 font-display font-semibold text-sm text-[#0A0C12]
              bg-[var(--color-blue)] hover:bg-[var(--color-blue)]/90
              rounded-full px-4 py-2.5 transition-colors duration-150
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            ▶ Start
          </button>
        ) : (
          <button
            onClick={ctx.pauseStopwatch}
            className="
              flex-1 font-display font-semibold text-sm text-fg
              bg-white/10 hover:bg-white/15
              rounded-full px-4 py-2.5 transition-colors duration-150
            "
          >
            ⏸ Pause
          </button>
        )}
        <button
          onClick={ctx.saveStopwatch}
          disabled={!sw || ctx.elapsedMs < 1000}
          data-sound="confirm"
          className="
            font-display font-semibold text-sm
            rounded-full px-4 py-2.5 transition-all duration-150
            disabled:opacity-40 disabled:cursor-not-allowed
          "
          style={{
            color: "var(--ok)",
            background: "color-mix(in srgb, var(--ok) 14%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ok) 35%, transparent)",
          }}
        >
          ✓ Speichern
        </button>
        <button
          onClick={ctx.resetStopwatch}
          disabled={!sw}
          title="Verwerfen ohne zu speichern"
          data-sound="dismiss"
          className="
            font-display font-semibold text-sm text-fg-tertiary
            bg-white/5 hover:bg-[var(--color-red)]/20 hover:text-[var(--color-red)]
            rounded-full px-3 py-2.5 transition-colors duration-150
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          ✕
        </button>
      </div>
    </Card>
  );
}

// ── Manual entry (unchanged) ──────────────────────────────────────────────────

const MANUAL_CATEGORIES: { id: BlockCategory; label: string; emoji: string }[] = [
  { id: "lern",       label: "Lernen",     emoji: "📚" },
  { id: "uni",        label: "Uni",        emoji: "🎓" },
  { id: "privat",     label: "Privat",     emoji: "🌿" },
  { id: "sport",      label: "Sport",      emoji: "💪" },
  { id: "sonstiges",  label: "Sonstiges",  emoji: "✨" },
];

/** Parse HH:MM into minutes-from-midnight. Returns null if invalid. */
function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function ManualEntryCard({
  subjects,
  defaultSubject,
  onSave,
}: {
  subjects: SubjectLite[];
  defaultSubject: string;
  onSave: (
    subjectId: string,
    date: string,
    durationMin: number,
    note?: string,
    extras?: { startedAtMs?: number; category?: BlockCategory },
  ) => void;
}) {
  const [category, setCategory] = useState<BlockCategory>("lern");
  const [subjectId, setSubjectId] = useState(defaultSubject);
  const [date, setDate] = useState(isoDate());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!subjectId && defaultSubject) setSubjectId(defaultSubject);
  }, [defaultSubject, subjectId]);

  // Derived duration in minutes from start/end (handles end-before-start = invalid)
  const startMin = parseHHMM(startTime);
  const endMin = parseHHMM(endTime);
  const durationMin =
    startMin !== null && endMin !== null && endMin > startMin ? endMin - startMin : 0;

  const needsSubject = category === "lern";
  const canSubmit =
    durationMin > 0 && (!needsSubject || !!subjectId) && (!needsSubject || !!subjectId);

  const submit = () => {
    if (!canSubmit) return;
    // Build a startedAtMs from date + startTime (local time)
    const [y, mo, d] = date.split("-").map((n) => parseInt(n, 10));
    const startD = new Date(y, (mo || 1) - 1, d || 1, Math.floor((startMin ?? 0) / 60), (startMin ?? 0) % 60);
    onSave(
      needsSubject ? subjectId : "",
      date,
      durationMin,
      note,
      { startedAtMs: startD.getTime(), category },
    );
    // Reset times forward 1 hour for the next entry
    setNote("");
  };

  return (
    <Card title="Manuell eintragen" icon="✍️">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Kategorie */}
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
            Kategorie
          </label>
          <div className="flex flex-wrap gap-1.5">
            {MANUAL_CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className="rounded-full px-3 py-1.5 text-[11px] font-display font-medium transition-colors inline-flex items-center gap-1.5"
                  style={{
                    background: active
                      ? "color-mix(in srgb, var(--color-accent) 24%, transparent)"
                      : "rgba(255,255,255,0.06)",
                    border: active
                      ? "1px solid color-mix(in srgb, var(--color-accent) 55%, transparent)"
                      : "1px solid transparent",
                    color: active ? "var(--color-accent)" : "var(--text-2)",
                  }}
                >
                  <span>{c.emoji}</span>{c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fach — nur für Lernen */}
        {needsSubject && (
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
              Fach
            </label>
            <select
              className="field appearance-none"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Bitte wählen…</option>
              {subjects.filter((s) => !s.archiviert).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Titel — nur für Nicht-Lern */}
        {!needsSubject && (
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
              Titel
            </label>
            <input
              className="field"
              placeholder={MANUAL_CATEGORIES.find(c => c.id === category)?.label}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        {/* Datum + Startzeit + Endzeit */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
              Datum
            </label>
            <input
              type="date"
              className="field"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
              Start · HH:MM
            </label>
            <input
              type="time"
              className="field"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
              Ende · HH:MM
            </label>
            <input
              type="time"
              className="field"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        {/* Notiz — nur für Lernen (bei Nicht-Lern ist Titel oben das Pendant) */}
        {needsSubject && (
          <input
            className="field"
            placeholder="Notiz (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}

        {/* Live-Anzeige der berechneten Dauer */}
        <div className="font-mono text-[11px] text-fg-tertiary">
          {durationMin > 0
            ? `Dauer: ${Math.floor(durationMin / 60)}h ${durationMin % 60}min  ·  → erscheint im Wochenplan`
            : "Endzeit muss nach Startzeit liegen"}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          data-sound="confirm"
          className="
            self-start font-display font-semibold text-sm text-[#0A0C12]
            bg-[var(--color-blue)] hover:bg-[var(--color-blue)]/90
            rounded-full px-5 py-2.5 transition-colors duration-150
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          Eintrag speichern
        </button>
      </form>
    </Card>
  );
}
