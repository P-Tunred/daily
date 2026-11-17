// Empfehlungen für die Aufgaben — „reinnehmen oder nicht?"
//
// Pauls Wunsch (2026-10-31): Heute und Diese Woche sollen zusammenhängen, und
// Daily soll sagen, ob etwas heute rein sollte, warten kann oder weg darf.
//
// VIER ARTEN, JEDE MIT GRUND
//   heute     — aus der Woche in den Tag: geplant, dringend, oder Paul zieht
//               solche Aufgaben erfahrungsgemäss durch und die Woche läuft aus.
//   zuerst    — von den heutigen die, mit der der Tag anfangen sollte.
//   woche     — läuft seit Tagen mit, ohne dass etwas passiert: zurück in die
//               Woche, damit der Tag ehrlich bleibt.
//   streichen — Aufgaben dieser Art räumt Paul meist weg, und diese wartet
//               schon lange. Nur ein Vorschlag; gelöscht wird erst auf Klick.
//
// WAS EIN NEIN BEWIRKT
// Ein abgelehntes „heute rein?" ruht drei Tage. Ein abgelehntes „streichen?"
// oder „zurück in die Woche?" kommt für diese Aufgabe nie wieder — Paul hat
// gesagt, er will sie behalten. Beides fliesst ausserdem ins Lernen
// (lib/prioLernen.ts), damit die nächste Empfehlung besser passt.
//
// Reine Rechenlogik — testbar ohne Browser.

import type { Task } from "../types";
import { bewerte, grundSatz, prioRang, type PrioModell } from "./prioLernen.ts";

export type EmpfehlungArt = "heute" | "zuerst" | "woche" | "streichen";

export type Empfehlung = {
  id: string;
  text: string;
  art: EmpfehlungArt;
  grund: string;
  gewicht: number;
};

export const MAX_EMPFEHLUNGEN = 4;
/** Ab so vielen offenen Tagesaufgaben wird nichts mehr hineinempfohlen, was
 *  nicht fällig oder dringend ist — ein voller Tag wird nicht voller. */
export const TAG_VOLL_AB = 7;
const RUHE_TAGE = 3;

/** ISO-Wochentag (1 = Mo … 7 = So) eines JJJJ-MM-TT. */
export function isoWochentag(tag: string): number {
  return ((new Date(`${tag}T12:00:00`).getDay() + 6) % 7) + 1;
}

function tageZwischen(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000);
}

function alterTage(t: Task, jetzt: number): number {
  return t.createdAt ? Math.floor((jetzt - t.createdAt) / 86_400_000) : 0;
}

/** Ist ein früheres Nein noch in Kraft? */
export function ruht(abgelehnt: Record<string, string>, id: string, art: EmpfehlungArt, heute: string): boolean {
  const am = abgelehnt[`${id}:${art}`];
  if (!am) return false;
  if (art === "streichen" || art === "woche") return true;
  return tageZwischen(am, heute) < RUHE_TAGE;
}

/** Wie wichtig eine Aufgabe jetzt ist: Priorität + Gelerntes + Fälligkeit. */
export function wichtigkeit(t: Task, modell: PrioModell, heute: string): number {
  const b = bewerte(t, modell);
  const faellig = (t.geplantAm && t.geplantAm <= heute) || t.plannedDay === isoWochentag(heute) ? 1.5 : 0;
  return prioRang(t.priority) + b.wert * 1.5 + faellig;
}

export function empfehle(
  todos: Task[],
  modell: PrioModell,
  opt: { heute: string; jetzt?: number; abgelehnt?: Record<string, string>; faecher?: Record<string, string> },
): Empfehlung[] {
  const { heute } = opt;
  const jetzt = opt.jetzt ?? Date.now();
  const abgelehnt = opt.abgelehnt ?? {};
  const faecher = opt.faecher ?? {};
  const wtag = isoWochentag(heute);
  const offen = todos.filter(t => !t.done && !t.id.startsWith("routine:"));
  const tag = offen.filter(t => (t.scope ?? "day") === "day");
  const woche = offen.filter(t => t.scope === "week");
  const tagVoll = tag.length >= TAG_VOLL_AB;
  const out: Empfehlung[] = [];
  const dazu = (t: Task, art: EmpfehlungArt, grund: string, gewicht: number) => {
    if (!ruht(abgelehnt, t.id, art, heute)) out.push({ id: t.id, text: t.text, art, grund, gewicht });
  };

  // ── Aus der Woche in den Tag ──
  for (const t of woche) {
    const b = bewerte(t, modell);
    const gelernt = grundSatz(b, faecher);
    // Erst nach dieser Woche dran → kein Kandidat (WeekTodosCard „Später").
    if (t.geplantAm && t.geplantAm > heute) continue;
    if (t.geplantAm && t.geplantAm <= heute) { dazu(t, "heute", t.geplantAm < heute ? "war schon fällig" : "für heute geplant", 3); continue; }
    if (t.plannedDay === wtag) { dazu(t, "heute", "für heute geplant", 2.8); continue; }
    if (t.plannedDay && t.plannedDay < wtag) { dazu(t, "heute", "der geplante Tag ist vorbei", 2.4); continue; }
    if (t.priority === "dringend") { dazu(t, "heute", "als dringend markiert", 2.6); continue; }
    if (tagVoll) continue;
    // Die Woche läuft aus (ab Freitag) und es ist noch kein Tag geplant.
    const wocheLaeuftAus = wtag >= 5 && !t.plannedDay;
    if (b.wert >= 0.4 && (wocheLaeuftAus || t.priority === "wichtig")) {
      dazu(t, "heute", `${gelernt ?? "passt zu dem, was dir wichtig ist"}${wocheLaeuftAus ? " — und die Woche läuft aus" : ""}`, 1.5 + b.wert);
    } else if (b.wert <= -0.4 && alterTage(t, jetzt) >= 7) {
      dazu(t, "streichen", `${gelernt ?? "Ähnliches löschst du oft"} — und sie wartet seit ${alterTage(t, jetzt)} Tagen`, 1 - b.wert);
    }
  }

  // ── Im Tag: was zuerst, was zurück, was weg ──
  for (const t of tag) {
    const b = bewerte(t, modell);
    const gelernt = grundSatz(b, faecher);
    const mit = t.verschoben ?? 0;
    if (mit >= 3 && b.wert <= -0.3) {
      dazu(t, "streichen", `seit ${mit} Tagen offen, und ${gelernt ?? "Ähnliches räumst du oft weg"}`, 1.8 - b.wert);
    } else if (mit >= 3 && t.priority !== "dringend") {
      dazu(t, "woche", `läuft seit ${mit} Tagen mit — zurück in die Woche, damit der Tag ehrlich bleibt?`, 1.2 + mit / 10);
    }
  }
  if (tag.length >= 2) {
    const sortiert = [...tag].sort((a, b) => wichtigkeit(b, modell, heute) - wichtigkeit(a, modell, heute));
    const erste = sortiert[0];
    const b = bewerte(erste, modell);
    if (!out.some(e => e.id === erste.id) && (erste.priority === "dringend" || b.wert >= 0.3 || prioRang(erste.priority) > prioRang(sortiert[1].priority))) {
      const grund = erste.priority === "dringend" ? "dringend — damit anfangen"
        : grundSatz(b, faecher) ?? "die wichtigste der offenen";
      dazu(erste, "zuerst", grund, 2 + wichtigkeit(erste, modell, heute) / 4);
    }
  }

  return out.sort((a, b) => b.gewicht - a.gewicht).slice(0, MAX_EMPFEHLUNGEN);
}
