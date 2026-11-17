// Speicher und Hook fürs Prioritäten-Lernen. Die Rechnung steht in
// lib/prioLernen.ts; hier wird nur gelesen, geschrieben und Bescheid gesagt.
//
// Geschrieben wird über das Register (lib/store.ts) und damit über
// localStorage.setItem — dort hängt der Abgleich mit dem Server. So landet
// das Gelernte in state.json und Hermes kann es lesen.

import { useEffect, useMemo, useState } from "react";
import type { Task } from "../types";
import { SCHLUESSEL, lies, schreib, type PrioStand } from "./store";
import { baueModell, mitSignal, profilText, signalAus, type PrioModell, type Signal, type SignalArt } from "./prioLernen.ts";
import type { EmpfehlungArt } from "./empfehlung.ts";

export const PRIO_EVENT = "morning:prioritaeten-changed";

const ARTEN: SignalArt[] = ["erledigt", "geloescht", "hochgestuft", "runtergestuft", "nachHeute", "zurueckWoche", "vorschlagJa", "vorschlagNein"];

function istSignal(v: Record<string, unknown>): boolean {
  return typeof v.ts === "number" && typeof v.text === "string" && ARTEN.includes(v.art as SignalArt);
}

function stand(): PrioStand {
  return lies(SCHLUESSEL.prioritaeten);
}

export function ladeSignale(s: PrioStand = stand()): Signal[] {
  return s.signale.filter(istSignal) as unknown as Signal[];
}

/** Fach-ID → Name, für lesbare Gründe („Analysis ziehst du durch"). */
export function fachNamen(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of lies(SCHLUESSEL.faecher)) {
    if (typeof f.id === "string" && typeof f.name === "string") out[f.id] = f.name;
  }
  return out;
}

function speichere(s: PrioStand): void {
  const signale = ladeSignale(s);
  const text = profilText(baueModell(signale), fachNamen());
  schreib(SCHLUESSEL.prioritaeten, { ...s, profil: text, profilAm: new Date().toISOString() });
  try { window.dispatchEvent(new Event(PRIO_EVENT)); } catch { /* kein Fenster (Test) */ }
}

type Lernbar = Pick<Task, "id" | "text" | "category" | "subjectId" | "ausTermin" | "ausWoche">;

/** Eine Handlung von Paul vermerken. Routinen lernen hier nicht mit — die
 *  haben ihr eigenes Buch in „Bewusst leben". */
export function lerne(t: Lernbar, art: SignalArt, extra: { empfehlung?: string } = {}): void {
  if (t.id.startsWith("routine:")) return;
  const s = stand();
  speichere({ ...s, signale: mitSignal(ladeSignale(s), signalAus(t, art, extra)) as unknown as Record<string, unknown>[] });
}

/** Eine Empfehlung beantworten — das Ja/Nein ist selbst ein Signal. */
export function beantworteEmpfehlung(t: Lernbar, art: EmpfehlungArt, ja: boolean, heute: string): void {
  const s = stand();
  const signale = mitSignal(ladeSignale(s), signalAus(t, ja ? "vorschlagJa" : "vorschlagNein", { empfehlung: art }));
  const abgelehnt = ja ? s.abgelehnt : { ...s.abgelehnt, [`${t.id}:${art}`]: heute };
  speichere({ ...s, signale: signale as unknown as Record<string, unknown>[], abgelehnt });
}

/** Alles Gelernte vergessen — Pauls Notausgang, wenn es danebenliegt. */
export function vergiss(): void {
  speichere({ version: 1, signale: [], abgelehnt: {} });
}

/** Das aktuelle Modell, neu gerechnet bei jeder Änderung (auch aus einem
 *  anderen Fenster über den Abgleich). */
export function usePrioModell(): { modell: PrioModell; abgelehnt: Record<string, string>; anzahl: number } {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    const vonAussen = (e: StorageEvent) => { if (e.key === SCHLUESSEL.prioritaeten.name) bump(); };
    window.addEventListener(PRIO_EVENT, bump);
    window.addEventListener("storage", vonAussen);
    return () => { window.removeEventListener(PRIO_EVENT, bump); window.removeEventListener("storage", vonAussen); };
  }, []);
  return useMemo(() => {
    const s = stand();
    const signale = ladeSignale(s);
    return { modell: baueModell(signale), abgelehnt: s.abgelehnt, anzahl: signale.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version löst das Neulesen aus
  }, [version]);
}
