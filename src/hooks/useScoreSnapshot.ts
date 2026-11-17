import { useEffect, useMemo, useState } from "react";
import type { Task } from "../types";
import { useTracker, isoDate } from "../tracker/store";
import { useTagesziel } from "../lib/tagesziel";
import { recordScoreDay } from "../lib/scoreHistory";
import { tagesStand } from "../lib/scoreSnapshot";
import { dayInZone, routineHakenAm } from "../lib/bewusst";
import { lies, SCHLUESSEL } from "../lib/store";

const TAKT_MS = 30_000;

function ladeTodos(): Task[] {
  try {
    const v = JSON.parse(localStorage.getItem("morning.todos") ?? "[]") as unknown;
    return Array.isArray(v) ? (v as Task[]) : [];
  } catch {
    return [];
  }
}

/**
 * Hält den Score des Tages in morning.scoreHistory fest — app-weit.
 *
 * WARUM NICHT MEHR IM DASHBOARD
 * Bis 2026-10-27 schrieb HeuteJarvis den Schnappschuss, also nur, solange das
 * Dashboard offen war. Wer danach auf der Lernzeit-Seite oder einem anderen
 * Gerät lernte, behielt einen Score von vorher: an 9 der letzten 40 Tage
 * stand zu wenig Lernzeit im Verlauf, am 26.10. sogar 0 min bei 367 gelernten.
 * Derselbe Weg wie beim Aufräumen erledigter Todos (useDoneTodoCleanup).
 *
 * WOHER DIE DATEN KOMMEN
 * Sitzungen und Ziele aus dem Tracker (liest nach jedem Abgleich neu ein),
 * Todos und Routinen aus dem localStorage — der Abgleich hält beide aktuell.
 * Neu gerechnet wird alle 30 s und sofort, wenn sich Todos oder Routinen
 * melden. recordScoreDay schreibt nur, wenn sich etwas bewegt hat.
 *
 * Einmal einbinden, in der App-Hülle — nicht in einer Seite.
 */
export function useScoreSnapshot(): void {
  const { sessions } = useTracker();
  const [takt, setTakt] = useState(() => Date.now());

  useEffect(() => {
    const weiter = () => setTakt(Date.now());
    const id = setInterval(weiter, TAKT_MS);
    window.addEventListener("morning:todos-changed", weiter);
    window.addEventListener("morning:bewusst-changed", weiter);
    document.addEventListener("visibilitychange", weiter);
    return () => {
      clearInterval(id);
      window.removeEventListener("morning:todos-changed", weiter);
      window.removeEventListener("morning:bewusst-changed", weiter);
      document.removeEventListener("visibilitychange", weiter);
    };
  }, []);

  // Dasselbe Tagesziel wie im Dashboard (lib/tagesziel.ts) — Budget als
  // Obergrenze, Bedarf als Ziel. Sonst zeigte der Verlauf eine andere Zahl.
  const ziel = useTagesziel(new Date(takt)).ziel;
  const stand = useMemo(() => {
    const now = new Date(takt);
    // Dieselbe Rechnung wie in HeuteJarvis — sonst zeigte das Dashboard eine
    // andere Zahl als der Verlauf.
    const goal = ziel;
    const haken = routineHakenAm(lies(SCHLUESSEL.bewusst), dayInZone(now));
    return { datum: isoDate(now), ...tagesStand(ladeTodos(), sessions, isoDate(now), goal, takt, haken) };
  }, [takt, sessions, ziel]);

  useEffect(() => {
    recordScoreDay(stand.datum, stand.parts, stand.tasksDone, stand.tasksTotal);
  }, [stand]);
}
