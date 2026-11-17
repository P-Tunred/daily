import { useMemo } from "react";
import { isoDate, useTracker } from "./store";
import { useTagesziel } from "../lib/tagesziel";

/**
 * Tints the Lernzeit background from a deep, calm tone up to the theme's full
 * accent as the day's study goal fills in — Setzling: forest green → new-growth
 * green; Abendrot: dark ember → glowing sunset orange. Same 0/50/100 % ramp
 * either way, just riding whichever theme is active (--accent-dim/-deep/plain
 * are all re-themed in index.css), via CSS color-mix() — no JS color math.
 */
/** Today's progress tone — the tinted color (plus intensity/ratio) that drives
 *  the background. Exported so the page can bind the SAME color to foreground
 *  accents (ring, kickers): the whole tab breathes one state. */
export function useProgressTone() {
  const { sessions } = useTracker();
  const goal = useTagesziel().ziel;

  return useMemo(() => {
    const today = isoDate();
    const todayMin = sessions
      .filter((s) => s.date === today)
      .reduce((a, s) => a + s.durationMin, 0);
    // Allow ratio up to 2.0 so the gold layer keeps growing past 100 %
    const r = goal > 0 ? Math.min(2.0, todayMin / goal) : 0;

    // 0→50%: --accent-dim → --accent-deep. 50→100%: --accent-deep → --accent.
    // color-mix() lets the browser resolve this against whichever theme is
    // active, so no JS hex math and no parallel per-theme color lists.
    let col: string;
    if (r >= 1) {
      col = "var(--accent)";
    } else if (r >= 0.5) {
      const t = Math.round(((r - 0.5) / 0.5) * 100);
      col = `color-mix(in srgb, var(--accent) ${t}%, var(--accent-deep))`;
    } else if (r > 0) {
      const t = Math.round((r / 0.5) * 100);
      col = `color-mix(in srgb, var(--accent-deep) ${t}%, var(--accent-dim))`;
    } else {
      col = "var(--accent-dim)";
    }

    // Base intensity grows up to ratio 1.0 — capped so we don't blow out the page
    const baseR = Math.min(1, r);
    const intensity = 0.25 + Math.min(0.50, baseR * 0.55);

    // Over-goal: fades in 0 → 1 between ratio 1.0 and 1.5,
    // saturates at 1.0 beyond that. Drives the golden glow + lively motion.
    const overGoal = Math.max(0, Math.min(1, (r - 1) / 0.5));

    return { color: col, intensity, ratio: r, overGoal };
  }, [sessions, goal]);
}

export function LernzeitProgressBackground() {
  const { color, intensity, ratio, overGoal } = useProgressTone();

  return (
    <>
      <div
        className="lernzeit-progress-bg"
        style={{
          ["--progress-color" as string]: color,
          ["--progress-intensity" as string]: String(intensity),
          ["--over-goal" as string]: String(overGoal),
        }}
        aria-hidden="true"
        data-ratio={ratio.toFixed(2)}
      />
      {overGoal > 0 && (
        <div
          className="lernzeit-progress-bg-gold"
          style={{ ["--gold-intensity" as string]: String(overGoal * 0.55) }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
