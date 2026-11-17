import type { Task } from "../types";
import type { Session } from "../tracker/types";
import { computeDayScore, type ScoreParts } from "./dayScore.ts";
import { mitRoutineBonus } from "./gestern.ts";
import type { ScoreDay } from "./scoreHistory";

/** Was recordScoreDay für einen Tag braucht — aus denselben Daten gerechnet,
 *  die das Dashboard anzeigt (HeuteJarvis), nur ohne dass es offen sein muss.
 *  Rein: liest nichts, schreibt nichts. */
export type TagesStand = { parts: ScoreParts; tasksDone: number; tasksTotal: number };

export function tagesStand(
  todos: readonly Task[],
  sessions: readonly Session[],
  dateIso: string,
  goalMin: number,
  nowMs: number,
  routineHaken: number,
): TagesStand {
  // Nur Tagesaufgaben — „Diese Woche" ist eine Ablage und zieht nicht am Score.
  const dayTodos = todos.filter((t) => (t.scope ?? "day") === "day");
  const studyMin = sessions
    .filter((s) => s.date === dateIso)
    .reduce((a, s) => a + (Number.isFinite(s.durationMin) ? s.durationMin : 0), 0);
  return {
    parts: computeDayScore(dayTodos, studyMin, goalMin, nowMs, routineHaken),
    tasksDone: dayTodos.filter((t) => t.done).length,
    tasksTotal: dayTodos.length,
  };
}

/** Ein festgehaltener Tag mit der GEMESSENEN Lernzeit neu gerechnet — für das
 *  einmalige Nachrechnen (scripts/score-lernzeit-nachrechnen.mjs).
 *
 *  Nur nach oben: Steht im Verlauf weniger Lernzeit als an Sitzungen
 *  gespeichert ist, war der Schnappschuss veraltet (siehe
 *  hooks/useScoreSnapshot.ts). Steht dort MEHR, ist unklar, welche Seite
 *  stimmt — möglicherweise sind Sitzungen verloren gegangen. Das rechnet
 *  diese Funktion nicht weg; sie gibt dann undefined zurück.
 *  Ohne Gewichte (Tage vor dem 13.10.) ebenfalls undefined: aus gerundeten
 *  Punkten liesse sich der Tag nicht exakt neu bilden. */
export function mitGemessenerLernzeit(day: ScoreDay, gemessenMin: number, routineHaken: number): ScoreDay | undefined {
  if (!(gemessenMin > day.studyMin)) return undefined;
  return mitRoutineBonus({ ...day, studyMin: gemessenMin }, routineHaken);
}
