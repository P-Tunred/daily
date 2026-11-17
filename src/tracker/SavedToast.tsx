import { useEffect, useState } from "react";
import { useTracker } from "./store";
import { useTimerContext } from "./TimerContext";
import type { MoodRating } from "./types";

// ── Mood options (shared) ─────────────────────────────────────────────────────

const MOOD_OPTIONS: { id: MoodRating; emoji: string; label: string; color: string }[] = [
  { id: "tired",   emoji: "😴", label: "Müde",          color: "var(--crit)" },
  { id: "okay",    emoji: "🙂", label: "Okay",          color: "var(--text-2)" },
  { id: "fit",     emoji: "⚡", label: "Fit",           color: "var(--warn)" },
  { id: "focused", emoji: "🎯", label: "Konzentriert",  color: "var(--ok)" },
];

// ── Session-saved toast ───────────────────────────────────────────────────────
// Mounted once at the app root (App.tsx) so it surfaces over whatever tab is
// active — not just while the Lernzeit/Tracker page happens to be open.

export function SavedToast() {
  const ctx = useTimerContext();
  const { subjects } = useTracker();
  const { lastSaved } = ctx;

  const [noteText, setNoteText] = useState("");
  const [focused, setFocused] = useState(false);
  // Reset the note field whenever a NEW session is saved (keyed on `at`).
  useEffect(() => { setNoteText(lastSaved?.note ?? ""); }, [lastSaved?.at]);

  if (!lastSaved) return null;

  const subject = subjects.find((s) => s.id === lastSaved.subjectId);
  const h = Math.floor(lastSaved.durationMin / 60);
  const m = lastSaved.durationMin % 60;
  const durationLabel = h > 0
    ? `${h} h${m > 0 ? ` ${m} min` : ""}`
    : `${m} min`;

  return (
    <>
      {/* Dim backdrop — makes the save prompt "in your face". Click = schließen. */}
      <div
        onClick={ctx.dismissLastSaved}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: "rgba(3,4,8,0.62)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          animation: "fadeIn 200ms ease",
        }}
      />
      <div
        key={lastSaved.at}
        className="saved-toast-anim"
        style={{
          position: "fixed",
          bottom: "2.5rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          padding: "22px 26px 20px",
          borderRadius: "var(--r-lg)",
          background: "var(--ink-1)",
          border: "1px solid var(--ok)",
          boxShadow: "0 0 0 1px var(--ok), 0 24px 64px rgba(0,0,0,0.6)",
          width: "min(94vw, 480px)",
          // Freeze the fade-out while the user is typing the note
          animationPlayState: focused ? "paused" : "running",
        }}
      >
      {/* Header row: ✓ Subject gespeichert · duration · X */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "9999px",
            background: "color-mix(in srgb, var(--ok) 18%, transparent)",
            color: "var(--ok)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          ✓
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--text-1)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}>
            {subject && (
              <span style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "9999px",
                backgroundColor: subject.color,
                flexShrink: 0,
              }} />
            )}
            <span>{subject?.name ?? "Session"} gespeichert</span>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--ok)",
            }}>· {durationLabel}</span>
          </div>
        </div>
        <button
          onClick={ctx.dismissLastSaved}
          title="Schließen"
          style={{
            width: 24,
            height: 24,
            borderRadius: "9999px",
            background: "rgba(255,255,255,0.06)",
            color: "var(--text-3)",
            fontSize: 11,
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >✕</button>
      </div>

      {/* Mood row + Undo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: "var(--text-3)",
            marginRight: 4,
          }}>
            Wie war's?
          </span>
          {MOOD_OPTIONS.map((m) => {
            const active = lastSaved.mood === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => ctx.setLastSavedMood(active ? undefined : m.id)}
                title={m.label}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "9999px",
                  background: active
                    ? `color-mix(in srgb, ${m.color} 22%, transparent)`
                    : "rgba(255,255,255,0.06)",
                  border: active
                    ? `1px solid color-mix(in srgb, ${m.color} 55%, transparent)`
                    : "1px solid transparent",
                  fontSize: 16,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 120ms, border-color 120ms",
                }}
              >
                {m.emoji}
              </button>
            );
          })}
        </div>
        <button
          onClick={ctx.undoLastSaved}
          data-sound="dismiss"
          title="Speichern rückgängig — Session wird gelöscht"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: "11px",
            padding: "5px 10px",
            borderRadius: "9999px",
            background: "rgba(255,255,255,0.06)",
            color: "var(--text-3)",
            border: "none",
            cursor: "pointer",
          }}
        >
          ↶ Rückgängig
        </button>
      </div>

      {/* "Was hast du gemacht?" — saved as the session note (light, no analysis) */}
      <input
        type="text"
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        onFocus={() => { setFocused(true); ctx.holdLastSaved(true); }}
        onBlur={() => { setFocused(false); ctx.holdLastSaved(false); ctx.setLastSavedNote(noteText); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="Was hast du gemacht? (optional)"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "7px 10px",
          borderRadius: "var(--r-md)",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid var(--line-1)",
          color: "var(--text-1)",
          fontSize: 13,
          outline: "none",
        }}
      />
    </div>
    </>
  );
}
