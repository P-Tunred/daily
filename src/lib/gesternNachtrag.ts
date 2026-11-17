// Gestern nachtragen — der Teil, der speichert. Die Rechnung steht in
// gestern.ts und ist dort ohne Speicher getestet.
//
// WARUM KEIN AUTOMATISCHER ABGLEICH BEIM LADEN
// Naheliegend wäre: sobald sich die Lernzeit von gestern ändert, den Score von
// gestern nachziehen. Beim Start der App kommen der Score-Verlauf und die
// Sitzungen aber nicht im selben Moment an — für einen Augenblick sähe gestern
// aus wie „0 Minuten gelernt", und ein Abgleich genau dann schriebe das fest.
// Abgeglichen wird deshalb nur im Dialog, also nach einem bewussten Klick, wenn
// längst alles geladen ist.

import type { Task } from "../types";
import type { Session } from "../tracker/types";
import { todosDB, notifyTodosChanged } from "./db";
import { loadScoreDay, writeScoreDay, type ScoreDay } from "./scoreHistory";
import { nachgerechneterTag } from "./gestern";

const TODO_KEY = "morning.todos";

function loadTodos(): Task[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TODO_KEY) ?? "[]");
    return Array.isArray(v) ? (v as Task[]) : [];
  } catch {
    return [];
  }
}

/** Gelernte Minuten an einem Tag, aus ALLEN Sitzungen mit diesem Datum. */
export function studyMinAm(sessions: Session[], day: string): number {
  return sessions.reduce((a, s) => (s.date === day ? a + s.durationMin : a), 0);
}

export type Ergebnis = { ok: true; tag: ScoreDay | undefined } | { ok: false; fehler: string };

export type GesternStand = {
  studyMin: number;
  goalMin: number;
  /** undefined = Bewusst noch nicht geladen; der festgehaltene Wert bleibt. */
  routineHaken?: number;
};

/** Score von gestern an Lernzeit und Routine-Haken von gestern angleichen.
 *  `anlegen` nur, wenn Paul im Dialog gerade selbst etwas eingetragen hat. */
export function gleicheGesternAb(gestern: string, stand: GesternStand, anlegen: boolean): Ergebnis {
  const prev = loadScoreDay(gestern);
  const neu = nachgerechneterTag(prev, {
    date: gestern, ...stand, erledigt: [], am: new Date().toISOString(), anlegen,
  });
  if (!neu || neu === prev) return { ok: true, tag: prev };
  if (!writeScoreDay(neu)) return { ok: false, fehler: "Der Score von gestern ließ sich nicht speichern." };
  return { ok: true, tag: neu };
}

/** Eine heute noch offene Aufgabe als gestern erledigt verbuchen.
 *
 *  Sie verschwindet dabei aus der heutigen Liste — genau wie es der 2-Uhr-Lauf
 *  mit einer gestern abgehakten Aufgabe getan hätte. Bliebe sie als erledigt
 *  stehen, zählte sie heute UND gestern. */
export async function aufgabeGesternErledigt(
  task: Task,
  gestern: string,
  stand: GesternStand,
): Promise<Ergebnis> {
  try {
    await todosDB.remove(task.id);
  } catch {
    return { ok: false, fehler: "Die Aufgabe ließ sich nicht verbuchen. Nichts wurde geändert." };
  }
  try {
    localStorage.setItem(TODO_KEY, JSON.stringify(loadTodos().filter((t) => t.id !== task.id)));
  } catch { /* der Speicher-Spiegel — die Datenbank ist schon richtig */ }
  notifyTodosChanged();

  // Hängt an der Aufgabe ein Vorgang als „nächster Schritt", hat er sich
  // bewegt — dieselbe Meldung wie beim normalen Abhaken (HeuteJarvis).
  // `erledigtAm`: kam die Aufgabe aus einer Frist, zählt für das Vorlaufbuch
  // der Tag, an dem sie wirklich erledigt war — nicht der des Nachtragens.
  void fetch("/api/focus/todo-done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ todoId: task.id, erledigtAm: gestern }),
  }).catch(() => { /* folgenlos — das Abhaken ist gespeichert */ });

  const prev = loadScoreDay(gestern);
  const neu = nachgerechneterTag(prev, {
    date: gestern, ...stand, erledigt: [task], am: new Date().toISOString(), anlegen: true,
  });
  if (neu && neu !== prev && !writeScoreDay(neu)) {
    return { ok: false, fehler: "Aufgabe verbucht, aber der Score von gestern ließ sich nicht speichern." };
  }
  return { ok: true, tag: neu ?? prev };
}
