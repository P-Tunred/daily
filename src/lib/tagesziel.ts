// Das Tagesziel — EINE Stelle für alle, die es zeigen oder damit rechnen.
//
// Pauls Entscheidung (2026-10-31): die Zeit in der Wochenzeile ist das BUDGET.
// Das Ziel ist, was heute wirklich nötig ist, höchstens das Budget:
//   Bedarf = Klausurpläne bei Pauls Tempo (lib/lernHeute.ts)
//          + feste Wochenstunden der Fächer OHNE Klausurplan (Subject.stundenProWoche)
// Ein Tagesziel, das Paul für genau diesen Tag gesetzt hat (goalOverrides),
// gewinnt immer. Ohne jeden Bedarf bleibt alles wie vorher: Ziel = Budget.
//
// Das berechnete Ziel wird NIE in die Einstellungen zurückgeschrieben — es gilt
// für heute und wird laufend neu gerechnet. Ein vergessenes Einzelziel, das die
// Wochenziele überdeckt, hat es in diesem Projekt schon gegeben (CONTEXT.md).
//
// Score (HeuteJarvis), Verlauf (useScoreSnapshot) und die Lernzeit-Seite
// müssen dieselbe Zahl sehen — deshalb dieser Hook statt sechs Rechnungen.

import { useMemo } from "react";
import { goalMinForDate, isoDate, useTracker } from "../tracker/store";
import { fachZurKlausur } from "./klausurPlaner";
import { useLernHeute, type LernHeute } from "./lernHeute";
import { fachMinutenHeute, tagesziel, type Tagesziel } from "./lernTempo";

export type TageszielStand = Tagesziel & {
  /** Fächer ohne Klausurplan, die mit festen Stunden in den Bedarf eingehen. */
  feste: { name: string; minuten: number }[];
  lern: LernHeute | null;
};

export function useTagesziel(datum: Date = new Date()): TageszielStand {
  const { goalsByWeekday, goalMin, goalMinWeekend, goalOverrides, subjects, sessions } = useTracker();
  const heute = isoDate(datum);
  const lern = useLernHeute(subjects, sessions, heute);
  return useMemo(() => {
    const budget = goalMinForDate(datum, goalsByWeekday, goalMin, goalMinWeekend);
    const eigenes = Object.prototype.hasOwnProperty.call(goalOverrides, heute) ? goalOverrides[heute] : undefined;
    const mitPlan = new Set(
      (lern?.zeilen ?? []).map((z) => fachZurKlausur(subjects, z.klausur)?.id).filter((x): x is string => !!x),
    );
    const tageMitBudget = goalsByWeekday.filter((m) => m > 0).length;
    const feste = subjects
      .filter((s) => !s.archiviert && !mitPlan.has(s.id) && (s.stundenProWoche ?? 0) > 0)
      .map((s) => ({ name: s.name, minuten: fachMinutenHeute(s.stundenProWoche ?? 0, tageMitBudget) }))
      .filter((f) => f.minuten > 0);
    const bedarfKlausuren = lern && lern.zeilen.length ? lern.zeilen.reduce((s, z) => s + z.ziel, 0) : null;
    const t = tagesziel({
      budget, eigenes, bedarfKlausuren,
      fachMinuten: budget > 0 ? feste.reduce((s, f) => s + f.minuten, 0) : 0,
    });
    return { ...t, feste, lern };
    // datum: nur der Tag zählt — heute steht dafür.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heute, goalsByWeekday, goalMin, goalMinWeekend, goalOverrides, subjects, lern]);
}
