// Gestern nachtragen — die Rechnung, ohne Speicher und ohne Uhr.
//
// WOZU
// Paul war im Gym, hat eine Aufgabe erledigt, hat eine Stunde gelernt — und
// es abends nicht mehr eingetragen. Bisher war das verloren: der Tagesscore
// wird in dem Moment festgehalten, in dem der Tag läuft, und am nächsten
// Morgen gab es keinen Weg zurück. Ein Score, der falsch steht, weil man
// vergessen hat zu klicken, misst das Klicken und nicht den Tag.
//
// WARUM NUR GESTERN
// Pauls Entscheidung (2026-10-13). Gestern weiss man noch, was war. Vor einer
// Woche rekonstruiert man — und ein Score, den man nach Belieben nachbessern
// kann, ist keine Rückmeldung mehr, sondern eine Erzählung.
//
// WARUM NACHRECHNEN UND NICHT NEU RECHNEN
// Gesterns Aufgabenliste gibt es nicht mehr: Erledigtes räumt der 2-Uhr-Lauf
// weg, Offenes wandert in den heutigen Tag. Neu berechnen ginge also nur mit
// einer erfundenen Liste. Stattdessen nimmt der Nachtrag den festgehaltenen
// Stand von gestern und ändert genau das, was Paul nachträgt:
//   - Lernzeit: exakt, aus allen Sitzungen mit gestrigem Datum.
//   - Aufgabe erledigt: ihr Gewicht wandert in den erledigten Teil, und ihr
//     Liegenbleiber-Abzug fällt weg — „Erledigtes zieht nie" gilt auch hier.
// Einträge von vor dem 13.10. kennen ihre Gewichte nicht. Dort bleibt der
// Aufgabenteil stehen, statt geraten zu werden.

import type { Task } from "../types";
// Mit Endung: die Tests laden diese Datei direkt in Node, ohne Bundler.
import { DRAG_MAX, ROUTINE_BONUS, TASKS_MAX, dragCost, taskWeight, timePart } from "./dayScore.ts";
import type { ScoreDay } from "./scoreHistory";

/** Der Kalendertag vor `heute`. Mittags UTC, damit keine Zeitzone kippt. */
export function gesternVon(heute: string): string {
  const d = new Date(heute + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Lokaler Tagesbeginn, 00:00. */
export function anfangDesTags(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).getTime();
}

/** Lokales Tagesende, 23:59:59. Zeitstempel für „gestern erledigt" und der
 *  Zeitpunkt, zu dem das Alter einer Aufgabe für gestern gemessen wird. */
export function endeDesTags(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).getTime();
}

/** Aufgaben, die gestern schon auf der Liste standen und noch offen sind.
 *
 *  Nur was VOR heute angelegt wurde: eine Aufgabe von heute früh kann gestern
 *  nicht erledigt worden sein. Ohne `createdAt` lässt sich das nicht belegen —
 *  solche Altlasten bleiben deshalb draussen. Routinen auch: die werden in
 *  „Bewusst leben" nachgetragen, nicht als Aufgabe. */
export function nachtragbareAufgaben(todos: Task[], heute: string): Task[] {
  const start = anfangDesTags(heute);
  return todos.filter((t) =>
    !t.done
    && (t.scope ?? "day") === "day"
    && t.origin !== "bewusst"
    && typeof t.createdAt === "number"
    && t.createdAt < start,
  );
}

export type Nachtrag = {
  /** Der Tag, der nachgerechnet wird (gestern). */
  date: string;
  /** Summe ALLER Sitzungen mit diesem Datum — nicht nur der neuen. */
  studyMin: number;
  /** Ziel für den Tag, falls es keinen Eintrag gibt. Sonst gilt das
   *  festgehaltene Ziel — eine spätere Zieländerung schreibt gestern nicht um. */
  goalMin: number;
  /** Aufgaben, die Paul jetzt als „gestern erledigt" markiert. */
  erledigt: Task[];
  /** Routine-Haken von gestern (Routinen + Gym, bewusst.routineHakenAm).
   *  undefined = unbekannt (Bewusst noch nicht geladen): dann bleibt der
   *  festgehaltene Wert stehen. Eine 0 an dieser Stelle hätte den Bonus von
   *  gestern gelöscht, nur weil der Zustand noch unterwegs war. */
  routineHaken?: number;
  /** Zeitpunkt des Nachtrags (ISO). */
  am: string;
  /** Darf ein fehlender Tag angelegt werden? Nur bei einem ausdrücklichen
   *  Eintrag. Der automatische Abgleich der Lernzeit legt nie einen Tag an —
   *  „Tage, die die App nie sah, zählen nicht" (scoreHistory.ts) gilt weiter. */
  anlegen: boolean;
};

/** Der nachgerechnete Tag — oder derselbe Eintrag, wenn sich nichts ändert,
 *  oder undefined, wenn es nichts festzuhalten gibt. Rein: liest und schreibt
 *  nichts, die Uhr kommt über `endeDesTags(date)` und `am`. */
export function nachgerechneterTag(prev: ScoreDay | undefined, n: Nachtrag): ScoreDay | undefined {
  if (!prev && !n.anlegen) return undefined;

  const schon = new Set(prev?.nachgetragen?.todoIds ?? []);
  // Dieselbe Aufgabe zweimal gutschreiben wäre ein geschenkter Punkt.
  const neu = n.erledigt.filter((t, i, alle) =>
    !schon.has(t.id) && alle.findIndex((x) => x.id === t.id) === i && t.origin !== "bewusst");

  const haken = n.routineHaken ?? prev?.routineHaken ?? 0;
  if (!prev && neu.length === 0 && n.studyMin <= 0 && haken === 0) return undefined;
  // Nichts eingetragen, nichts geändert → derselbe Eintrag. Unbekannte Haken
  // (Bewusst lädt noch) zählen als „unverändert" — sonst würde schon das
  // Öffnen des Dialogs einen Tag umschreiben und als nachgetragen markieren.
  const hakenGleich = n.routineHaken === undefined || n.routineHaken === (prev?.routineHaken ?? 0);
  if (prev && neu.length === 0 && prev.studyMin === n.studyMin && hakenGleich) return prev;

  const goalMin = prev?.goalMin ?? n.goalMin;
  // Ohne Eintrag kennt der Tag nur, was Paul jetzt nachträgt — gewichtet,
  // ohne erfundene offene Aufgaben daneben.
  const gewichteBekannt = !prev || (prev.weightedDone !== undefined && prev.weightedTotal !== undefined);
  let wd = prev?.weightedDone ?? 0;
  let wt = prev?.weightedTotal ?? 0;
  let dragRaw = prev ? prev.dragRaw : 0;
  const ende = endeDesTags(n.date);

  for (const t of neu) {
    const w = taskWeight(t);
    wd += w;
    // Stand die Aufgabe gestern auf der Liste, steckt ihr Gewicht schon im
    // Gesamt. Fehlt es dort (kein Eintrag, oder sie kam nach dem letzten
    // Mitschreiben dazu), gehört es dazu — erledigt kann nicht mehr sein als
    // insgesamt.
    if (wd > wt) wt = wd;
    if (dragRaw !== undefined) dragRaw = Math.max(0, dragRaw - dragCost(t, ende));
  }

  const tasksPart = gewichteBekannt
    ? (wt > 0 ? TASKS_MAX * (wd / wt) : 0)
    : (prev?.tasks ?? 0);
  const time = timePart(n.studyMin, goalMin);
  const capped = dragRaw !== undefined ? Math.min(DRAG_MAX, dragRaw) : -(prev?.drag ?? 0);
  const routineBonus = ROUTINE_BONUS * haken;
  const score = Math.max(0, Math.min(100, Math.round(tasksPart + time + routineBonus - capped)));
  const tasksDone = (prev?.tasksDone ?? 0) + neu.length;

  return {
    date: n.date,
    score,
    tasks: Math.round(tasksPart),
    time: Math.round(time),
    drag: capped > 0 ? -Math.round(capped) : 0,
    studyMin: n.studyMin,
    goalMin,
    tasksDone,
    tasksTotal: Math.max(prev?.tasksTotal ?? 0, tasksDone),
    ...(gewichteBekannt ? { weightedDone: wd, weightedTotal: wt } : {}),
    ...(dragRaw !== undefined ? { dragRaw: Math.round(dragRaw * 10) / 10 } : {}),
    routineHaken: haken,
    routineBonus,
    v: 2,
    nachgetragen: { am: n.am, todoIds: [...schon, ...neu.map((t) => t.id)] },
  };
}

/** Einen festgehaltenen Tag mit Routine-Bonus neu rechnen — für das einmalige
 *  Nachrechnen ab dem 13.10. (scripts/routinebonus-nachrechnen.mjs).
 *
 *  Nur Tage MIT Gewichten und ungedeckeltem Abzug: aus den gerundeten Punkten
 *  allein liesse sich der Score nicht exakt neu bilden. Ohne diese Felder
 *  kommt undefined zurück, und der Tag bleibt bei der alten Formel.
 *  Kein `nachgetragen`-Vermerk: Paul hat an dem Tag nichts nachgetragen, nur
 *  die Rechnung hat sich geändert — das sagt `v`. */
export function mitRoutineBonus(day: ScoreDay, haken: number): ScoreDay | undefined {
  if (day.weightedDone === undefined || day.weightedTotal === undefined || day.dragRaw === undefined) return undefined;
  const h = Math.max(0, Math.floor(haken));
  const tasksPart = day.weightedTotal > 0 ? TASKS_MAX * (day.weightedDone / day.weightedTotal) : 0;
  const time = timePart(day.studyMin, day.goalMin);
  const capped = Math.min(DRAG_MAX, day.dragRaw);
  const routineBonus = ROUTINE_BONUS * h;
  return {
    ...day,
    score: Math.max(0, Math.min(100, Math.round(tasksPart + time + routineBonus - capped))),
    routineHaken: h,
    routineBonus,
    v: 2,
  };
}
