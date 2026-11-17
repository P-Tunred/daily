import type { ScoreParts } from "./dayScore";

// One snapshot per day so the score panel can show an average and a trend.
// The score itself is derived state (recomputed from tasks + sessions on every
// render), which means it exists only in the moment — without recording it,
// "how am I developing" is unanswerable. Written on change, last write of a day
// wins, so a day ends up holding its final standing.

const KEY = "morning.scoreHistory";
const KEEP_DAYS = 120;

export type ScoreDay = {
  date: string;      // YYYY-MM-DD
  score: number;
  tasks: number;
  time: number;
  drag: number;      // negative
  studyMin: number;
  goalMin: number;
  tasksDone: number;
  tasksTotal: number;
  // Ab 2026-10-13 mitgeschrieben, damit sich ein Tag NACHRECHNEN lässt.
  // Die gerundeten Punkte oben reichen dafür nicht: aus „Aufgaben 18" lässt
  // sich nicht ablesen, was eine weitere erledigte dringende Aufgabe bringt.
  // Ältere Einträge haben die Felder nicht; dort bleibt der Aufgabenteil beim
  // Nachtragen unverändert, statt geraten zu werden.
  weightedDone?: number;
  weightedTotal?: number;
  dragRaw?: number;
  /** Gesetzt, wenn der Tag nachträglich geändert wurde (lib/gestern.ts). Die
   *  ids verhindern, dass dieselbe Aufgabe zweimal gutgeschrieben wird. */
  nachgetragen?: { am: string; todoIds: string[] };
  /** Routine-Haken (Routinen + Gym) und ihr Bonus — seit 2026-10-22. */
  routineHaken?: number;
  routineBonus?: number;
  /** Nach welcher Formel der Tag gerechnet ist: fehlt = ohne Routine-Bonus,
   *  2 = mit. Schnitt und Trend vergleichen nur Tage derselben Formel — sonst
   *  zeigte der Trend am Umstellungstag einen Sprung, der nur aus der neuen
   *  Rechnung käme, nicht aus einem anderen Tag. */
  v?: 2;
};

/** Die Formel, nach der ein Tag gerechnet wurde. */
export const versionOf = (d: ScoreDay): 1 | 2 => (d.v === 2 ? 2 : 1);

/** Nur die Tage derselben Formel. Jede Mittelung geht durch diesen Filter. */
export const sameVersion = (days: ScoreDay[], v: 1 | 2): ScoreDay[] =>
  days.filter((d) => versionOf(d) === v);

/** Die Formel des jüngsten Tags — Maßstab für jeden Vergleich. */
export function currentVersion(history: ScoreDay[]): 1 | 2 {
  const last = history[history.length - 1];
  return last ? versionOf(last) : 1;
}

/** Erster Tag mit Routine-Bonus — der Balkenverlauf markiert ihn. */
export function switchDate(history: ScoreDay[]): string | null {
  return history.find((d) => versionOf(d) === 2)?.date ?? null;
}

type HistoryMap = Record<string, ScoreDay>;

export function loadScoreHistory(): ScoreDay[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as HistoryMap;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    return Object.values(raw)
      .filter((d): d is ScoreDay => !!d && typeof d.date === "string" && typeof d.score === "number")
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch {
    return [];
  }
}

/** Records today's standing. Cheap and idempotent — safe to call on re-render. */
export function recordScoreDay(
  date: string,
  parts: ScoreParts,
  tasksDone: number,
  tasksTotal: number,
): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as HistoryMap;
    const map: HistoryMap = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const prev = map[date];
    const next: ScoreDay = {
      date,
      score: parts.score,
      tasks: parts.tasks,
      time: parts.time,
      drag: parts.drag,
      studyMin: parts.studyMin,
      goalMin: parts.goalMin,
      tasksDone,
      tasksTotal,
      weightedDone: parts.weightedDone,
      weightedTotal: parts.weightedTotal,
      dragRaw: parts.dragRaw,
      routineHaken: parts.routineHaken,
      routineBonus: parts.routineBonus,
      v: 2,
      // Ein Nachtrag von gestern bleibt sichtbar, auch wenn der Tag (bei einem
      // Datumswechsel mit offener App) noch einmal mitgeschrieben wird.
      ...(prev?.nachgetragen ? { nachgetragen: prev.nachgetragen } : {}),
    };
    // Skip the write when nothing moved — avoids churning localStorage on
    // every render tick. Die Gewichte stehen mit drin: ein Eintrag von vor dem
    // 13.10. hat sie nicht und wird dadurch einmal neu geschrieben — sonst
    // liesse sich ausgerechnet der erste Tag danach nicht nachrechnen.
    if (prev && prev.score === next.score && prev.studyMin === next.studyMin
      && prev.tasksDone === next.tasksDone && prev.tasksTotal === next.tasksTotal
      && prev.weightedTotal === next.weightedTotal && prev.weightedDone === next.weightedDone
      && prev.dragRaw === next.dragRaw && prev.routineHaken === next.routineHaken
      && prev.v === next.v) return;
    map[date] = next;

    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const k of Object.keys(map)) if (k < cutoff) delete map[k];

    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota — the score still works, only the history stops growing */
  }
}

/** Mean score across the last `days` recorded days (not calendar days — days
 *  the app never saw simply don't count, rather than faking a zero). */
export function averageScore(history: ScoreDay[], days: number): number | null {
  // Nur Tage der Formel des jüngsten Tags. Nach der Umstellung ist der Schnitt
  // deshalb erst dünn — ehrlicher als ein Mittel aus zwei Rechnungen.
  const recent = sameVersion(history.slice(-days), currentVersion(history));
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((a, d) => a + d.score, 0) / recent.length);
}

/** Difference between the last `days` and the `days` before them. */
export function scoreTrend(history: ScoreDay[], days = 7): number | null {
  // Beide Hälften aus derselben Formel. Ist die Vorperiode noch die alte,
  // gibt es KEINEN Trend — lieber „—" als ein Sprung, den es nie gab.
  const gleich = sameVersion(history, currentVersion(history));
  if (gleich.length < 2) return null;
  const recent = gleich.slice(-days);
  const previous = gleich.slice(-days * 2, -days);
  if (recent.length === 0 || previous.length === 0) return null;
  const mean = (xs: ScoreDay[]) => xs.reduce((a, d) => a + d.score, 0) / xs.length;
  return Math.round(mean(recent) - mean(previous));
}

/** Ein einzelner Tag aus dem Verlauf, oder undefined. */
export function loadScoreDay(date: string): ScoreDay | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as HistoryMap;
    const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw[date] : undefined;
    return d && typeof d.score === "number" ? d : undefined;
  } catch {
    return undefined;
  }
}

/** Schreibt einen Tag, den nicht recordScoreDay errechnet hat — den Nachtrag
 *  für gestern. Gibt zurück, ob es geklappt hat: anders als beim laufenden
 *  Mitschreiben hat Paul hier ausdrücklich etwas eingetragen, und ein stilles
 *  Scheitern sähe aus wie ein Score, der sich nicht bewegt. */
export function writeScoreDay(day: ScoreDay): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as HistoryMap;
    const map: HistoryMap = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    localStorage.setItem(KEY, JSON.stringify({ ...map, [day.date]: day }));
    return true;
  } catch {
    return false;
  }
}
