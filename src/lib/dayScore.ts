import type { Task, TaskPriority } from "../types";

// The daily score, reworked. The old version counted todos by HEAD (60%) plus
// study time capped at the goal (40%) — so three trivial ticks beat the one
// thing that mattered, a task rotting for three weeks cost nothing, and any
// minute past the goal was worth zero.
//
// Three ideas now shape it:
//   1. WEIGHT — an urgent task counts triple a routine one.
//   2. DRAG   — tasks left open for days pull the score down, the longer and
//               the more urgent, the harder. Doing nothing has a price.
//   3. EXTRA  — going past the study goal still earns, with diminishing
//               returns so the day can't be farmed by sheer hours.
//
// Everything is pure and side-effect free so it can be unit-tested and reused
// by the score panel.

// Study time carries ~65% of the day (Paul's call — the hours are the point;
// todos are the supporting cast), tasks the remaining 35%.
export const TASKS_MAX = 35;
/** Erreichen des Tagesziels. Zusammen mit TIME_BONUS_MAX traegt die Lernzeit
 *  unveraendert 65 der 100 Punkte — nur anders verteilt als frueher.
 *
 *  WARUM 52 UND NICHT 60
 *  Die Regel "100 Punkte erst bei anderthalbfacher Lernzeit" gab es schon; sie
 *  war nur unsichtbar. Mit 60/5 brachte das Ziel 95 Punkte und 150 % dann 100 —
 *  fuenf Punkte fuer fuenfzig Prozent mehr Arbeit. Das liest sich wie "Ueberzeit
 *  zaehlt nicht", und genau so wurde es wahrgenommen.
 *
 *  52/13 haelt dieselbe Aussage, macht sie aber spuerbar: Ziel punktgenau
 *  getroffen und alle Aufgaben erledigt ergibt 87, die vollen 100 gibt es bei
 *  150 %. Der Abstand ist jetzt gross genug, um eine Entscheidung zu sein. */
export const TIME_BASE = 52;
/** Ueberzeit oben drauf, voll ausgeschoepft bei 150 % des Ziels.
 *
 *  DIE ZAHL IST NICHT GEGRIFFEN: 13 ist genau ein Viertel von 52, und weil die
 *  Ueberzeit-Strecke (0,5 × Ziel) halb so lang ist wie die Grundstrecke, ist
 *  eine Ueberminute damit exakt eine halbe Pflichtminute wert. Das ist die
 *  ganze Regel, und sie laesst sich in einem Satz sagen. */
export const TIME_BONUS_MAX = 13;
export const DRAG_MAX = 8;       // hard floor on how much old tasks can cost

/** Punkte je Routine-Haken (Bewusst leben), OBEN DRAUF.
 *
 *  Pauls Entscheidung vom 2026-10-22: Routinen und Gym sollen den Tagesscore
 *  bewegen — vorher zählten sie gar nicht, und ein nachgetragener Haken für
 *  gestern änderte nichts. Gewählt hat er den Bonus, nicht einen eigenen
 *  Anteil: Aufgaben (35) und Lernzeit (65) bleiben unverändert, jede Routine
 *  bringt +2, ein Tag mit Gym ebenfalls +2. Gedeckelt wird nur bei 100.
 *
 *  Der Preis ist bewusst: 100 wird leichter erreichbar. Dafür verschiebt sich
 *  an Tagen ohne Routinen nichts, und die Zahl bleibt mit den alten Tagen
 *  vergleichbar — bis auf den Bonus, den der Verlauf getrennt mitschreibt. */
export const ROUTINE_BONUS = 2;

/** What a task is worth — the same ladder the mail triage uses. */
const WEIGHT: Record<TaskPriority, number> = { dringend: 3, wichtig: 2, normal: 1 };
/** How much an OPEN task's age hurts, scaled by how urgent it is. Softened —
 *  old tasks should nag, not dominate the day. */
const DRAG_FACTOR: Record<TaskPriority, number> = { dringend: 1, wichtig: 0.6, normal: 0.3 };

/** Was eine Aufgabe im Aufgabenteil wiegt. Exportiert, weil der Nachtrag für
 *  gestern (lib/gestern.ts) eine einzelne Aufgabe nachrechnen muss — mit
 *  derselben Leiter, nicht mit einer zweiten Fassung davon. */
export const taskWeight = (t: Task) => WEIGHT[t.priority ?? "normal"] ?? 1;

/** Whole days a task has been open. */
export function taskAgeDays(t: Task, now = Date.now()): number {
  if (!t.createdAt) return 0;
  return Math.max(0, Math.floor((now - t.createdAt) / 86_400_000));
}

/** Grace period before an open task starts costing anything. */
export const DRAG_GRACE_DAYS = 3;

/** Age → raw penalty steps. Nothing for the first days, then it ratchets. */
function agePenalty(days: number): number {
  if (days <= DRAG_GRACE_DAYS) return 0;
  if (days <= 7) return 1;
  if (days <= 14) return 2;
  return 3;
}

/** Was eine OFFENE Aufgabe zum Zeitpunkt `now` vom Score abzieht (ungedeckelt).
 *  Erledigte ziehen nie — das entscheidet der Aufrufer. */
export function dragCost(t: Task, now = Date.now()): number {
  return agePenalty(taskAgeDays(t, now)) * (DRAG_FACTOR[t.priority ?? "normal"] ?? 0.5);
}

export type ScoreParts = {
  /** 0–35 — weighted share of today's tasks that are done. */
  tasks: number;
  /** 0–65 — study time, incl. overtime bonus. */
  time: number;
  /** 0 to −8 — the pull of tasks left lying around. */
  drag: number;
  /** Der Abzug VOR dem Deckel, eine Nachkommastelle. Wird im Verlauf
   *  mitgespeichert: hakt Paul eine Aufgabe für gestern nach, fällt genau ihr
   *  Anteil weg — und das lässt sich nur vom ungedeckelten Wert abziehen. */
  dragRaw: number;
  /** Routine-Haken des Tages (Routinen + Gym) und was sie bringen. */
  routineHaken: number;
  routineBonus: number;
  /** Clamped 0–100. */
  score: number;
  // Context for the score panel, so it never has to recompute.
  weightedDone: number;
  weightedTotal: number;
  studyMin: number;
  goalMin: number;
  /** Open tasks past the grace period, worst first. */
  stale: { id: string; text: string; days: number; cost: number }[];
};

/** Lernanteil: linear bis zum Ziel, danach flacher weiter fuer die Ueberzeit.
 *
 *  Eine Ueberminute ist genau halb so viel wert wie eine Pflichtminute (siehe
 *  TIME_BONUS_MAX). Bei 150 % des Ziels ist der Bonus ausgeschoepft; alles
 *  darueber bringt nichts mehr — sonst liesse sich der Tag mit blossen Stunden
 *  erkaufen, und das waere kein Mass fuer einen guten Tag. */
export function timePart(studyMin: number, goalMin: number): number {
  if (goalMin <= 0) return studyMin > 0 ? TIME_BASE : 0;
  const base = TIME_BASE * Math.min(1, studyMin / goalMin);
  const over = Math.max(0, studyMin - goalMin);
  if (over <= 0) return base;
  // Full bonus at +50% of the goal, approached smoothly.
  const bonus = TIME_BONUS_MAX * Math.min(1, over / (goalMin * 0.5));
  return base + bonus;
}

/** The whole day in one number, plus every part it was built from. */
export function computeDayScore(
  dayTasks: Task[],
  studyMin: number,
  goalMin: number,
  now = Date.now(),
  routineHaken = 0,
): ScoreParts {
  let weightedDone = 0;
  let weightedTotal = 0;
  let drag = 0;
  const stale: ScoreParts["stale"] = [];

  for (const t of dayTasks) {
    if (t.origin === 'bewusst') continue;
    const w = taskWeight(t);
    weightedTotal += w;
    if (t.done) {
      weightedDone += w;
      continue;
    }
    // Only OPEN tasks drag — finishing something old is a relief, not a debt.
    const days = taskAgeDays(t, now);
    const cost = dragCost(t, now);
    if (cost > 0) {
      drag += cost;
      stale.push({ id: t.id, text: t.text, days, cost: Math.round(cost * 10) / 10 });
    }
  }

  const tasks = weightedTotal > 0 ? TASKS_MAX * (weightedDone / weightedTotal) : 0;
  const time = timePart(studyMin, goalMin);
  const cappedDrag = Math.min(DRAG_MAX, drag);
  const haken = Number.isFinite(routineHaken) ? Math.max(0, Math.floor(routineHaken)) : 0;
  const routineBonus = ROUTINE_BONUS * haken;
  const score = Math.max(0, Math.min(100, Math.round(tasks + time + routineBonus - cappedDrag)));

  stale.sort((a, b) => b.cost - a.cost || b.days - a.days);

  return {
    tasks: Math.round(tasks),
    time: Math.round(time),
    // `-Math.round(0)` ist in JavaScript -0, nicht 0. Angezeigt wird beides als
    // "0", aber Object.is und strikte Vergleiche unterscheiden sie — ein Test
    // auf "kein Abzug" schlaegt dann fehl, obwohl nichts abgezogen wurde.
    drag: cappedDrag > 0 ? -Math.round(cappedDrag) : 0,
    dragRaw: Math.round(drag * 10) / 10,
    routineHaken: haken,
    routineBonus,
    score,
    weightedDone,
    weightedTotal,
    studyMin,
    goalMin,
    stale,
  };
}
