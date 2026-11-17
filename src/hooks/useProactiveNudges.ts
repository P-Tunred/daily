import { useEffect, useRef } from "react";
import type { ImportantEvent } from "../important/types";

// Proactive native notifications — the "feels alive" layer. Fires at most a
// couple of gentle nudges per day via the Web Notification API (shown as native
// macOS notifications in the packaged app). Throttled hard: each nudge key fires
// once per day, max 2 per session, and the whole thing can be muted.
const MUTE_KEY = "morning.jarvis.nudges"; // value "off" = muted
const FIRED_KEY = "morning.jarvis.nudges.fired"; // { [key]: todayIso }
const MAX_PER_SESSION = 2;
const FIRST_CHECK_MS = 4000; // let the UI settle before prompting/notifying
const INTERVAL_MS = 15 * 60 * 1000;

export type NudgeInput = {
  importantEvents: ImportantEvent[];
  totalMin: number;
  dayGoal: number;
  todayIso: string;
};

function loadFired(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}"); } catch { return {}; }
}
function saveFired(f: Record<string, string>) {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(f)); } catch { /* quota */ }
}
function diffDays(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86400000);
}

export function isNudgesMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "off"; } catch { return false; }
}
export function setNudgesMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? "off" : "on"); } catch { /* quota */ }
}

export function useProactiveNudges(input: NudgeInput) {
  // Keep inputs fresh without re-subscribing the effect on every data tick.
  const inputRef = useRef(input);
  inputRef.current = input;
  const firedThisSession = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    let cancelled = false;

    const run = async () => {
      if (cancelled || isNudgesMuted()) return;
      if (Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      if (cancelled || Notification.permission !== "granted") return;

      const { importantEvents, totalMin, dayGoal, todayIso } = inputRef.current;
      const fired = loadFired();
      const candidates: { key: string; body: string }[] = [];

      // 1) Exam within the next 3 days.
      const exam = importantEvents
        .filter((e) => e.kind === "exam" && !e.dismissed)
        .map((e) => ({ e, d: diffDays(todayIso, e.date) }))
        .filter((x) => x.d >= 0 && x.d <= 3)
        .sort((a, b) => a.d - b.d)[0];
      if (exam) {
        candidates.push({
          key: `exam-${exam.e.id}-${todayIso}`,
          body: exam.d === 0
            ? `Heute: ${exam.e.title}.`
            : `${exam.e.title} in ${exam.d} ${exam.d === 1 ? "Tag" : "Tagen"}.`,
        });
      }

      // 2) Past midday and no study logged yet.
      if (new Date().getHours() >= 12 && dayGoal > 0 && totalMin === 0) {
        candidates.push({
          key: `nostudy-${todayIso}`,
          body: "Noch keine Lernzeit heute — ein kleiner Block reicht für den Anfang.",
        });
      }

      for (const c of candidates) {
        if (firedThisSession.current >= MAX_PER_SESSION) break;
        if (fired[c.key]) continue; // already fired today
        try {
          new Notification("Hermes", { body: c.body });
          fired[c.key] = todayIso;
          firedThisSession.current += 1;
        } catch { /* notification construction failed — ignore */ }
      }

      // Keep only today's keys so the store doesn't grow unbounded.
      const pruned: Record<string, string> = {};
      for (const [k, v] of Object.entries(fired)) if (v === todayIso) pruned[k] = v;
      saveFired(pruned);
    };

    const first = setTimeout(() => void run(), FIRST_CHECK_MS);
    const id = setInterval(() => void run(), INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(first); clearInterval(id); };
  }, []);
}
