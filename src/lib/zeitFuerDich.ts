// „Ein bisschen Zeit für dich" — was die Routinen-Karte zusätzlich zeigt.
//
// Pauls Wunsch (2026-10-31): die Karte aufwerten, und Briefing wie Stimme
// sollen wissen, was seine Routinen sind und was er daran anpassen will.
// Drei Dinge, alle aus dem bestehenden Buch (lib/bewusst.ts) gelesen, nichts
// davon schreibt von selbst:
//
//   verlauf      — die letzten sieben Tage je Routine, als Punkte.
//   hinweise     — Routinen, die fast nie klappen: anpassen oder behalten?
//                  Nicht als Vorwurf. Eine Routine, die seit zwei Wochen
//                  liegen bleibt, ist meist am falschen Platz, nicht faul.
//   vorschlag    — ein freier Block heute und was hineinpassen würde.
//
// Was NICHT zählt: unbesuchte Tage. Das Buch trägt nichts nach (siehe
// bewusst.ts) — ein Tag ohne Eintrag ist „unbekannt", nicht „nicht gemacht".

import { CATALOG, periodFor, shiftDay, type BewusstState } from "./bewusst.ts";

export type Punkt = "ja" | "nein" | "offen" | "pause" | "unbekannt";

export type RoutinenVerlauf = { id: string; titel: string; punkte: { tag: string; stand: Punkt }[]; erledigt: number; erfasst: number };

/** Die heutigen Routinen mit ihren letzten `tage` Tagen (älteste zuerst). */
export function verlauf(state: BewusstState, heute: string, tage = 7): RoutinenVerlauf[] {
  const jetzt = periodFor(state, "day", heute);
  return jetzt.goals.filter(g => !g.paused).map(g => {
    const punkte: { tag: string; stand: Punkt }[] = [];
    let erledigt = 0;
    let erfasst = 0;
    for (let i = tage - 1; i >= 0; i--) {
      const tag = shiftDay(heute, -i);
      const p = tag === heute ? jetzt : state.periods[`day:${tag}`];
      const e = p?.goals.find(x => x.id === g.id);
      let stand: Punkt;
      if (!p || !e) stand = "unbekannt";
      else if (e.paused) stand = "pause";
      else if (e.value >= e.target) stand = "ja";
      else stand = tag === heute ? "offen" : "nein";
      if (stand === "ja") erledigt++;
      if (stand === "ja" || stand === "nein") erfasst++;
      punkte.push({ tag, stand });
    }
    return { id: g.id, titel: g.title, punkte, erledigt, erfasst };
  });
}

export type Anpassung = { id: string; titel: string; erledigt: number; erfasst: number };

export const HINWEIS_TAGE = 14;
export const HINWEIS_MIN_ERFASST = 6;
export const HINWEIS_QUOTE = 0.3;
const RUHE_TAGE = 14;

/** Routinen, die in den letzten zwei Wochen an weniger als 30 % der
 *  erfassten Tage geklappt haben — erst ab sechs erfassten Tagen, sonst ist
 *  es Zufall. „Behalten" lässt einen Hinweis zwei Wochen ruhen. */
export function hinweise(state: BewusstState, heute: string, behalten: Record<string, string> = {}): Anpassung[] {
  return verlauf(state, shiftDay(heute, -1), HINWEIS_TAGE)
    .filter(v => v.erfasst >= HINWEIS_MIN_ERFASST && v.erledigt / v.erfasst < HINWEIS_QUOTE)
    .filter(v => !behalten[v.id] || shiftDay(behalten[v.id], RUHE_TAGE) <= heute)
    .map(v => ({ id: v.id, titel: v.titel, erledigt: v.erledigt, erfasst: v.erfasst }));
}

export type Block = { tag: string; von: string; bis: string; minuten: number };
export type Vorschlag = { block: Block; idee: string | null; offeneRoutinen: number };

/** Wochenideen, die sich für einen freien Block eignen — Dinge mit Körper
 *  oder Menschen, keine Notizzettel-Aufgaben. */
const FUER_BLOCK = ["gym", "run", "meal", "conversation"];

/** Der nächste freie Block heute — und die Wochenidee mit dem meisten
 *  Rückstand dazu („Gym 1/3"). Ohne freien Block kein Vorschlag. */
export function vorschlag(state: BewusstState, heute: string, bloecke: Block[]): Vorschlag | null {
  const block = bloecke.find(b => b.tag === heute && b.minuten >= 30);
  if (!block) return null;
  const woche = periodFor(state, "week", heute);
  const kandidaten = CATALOG.week
    .filter(g => FUER_BLOCK.includes(g.id))
    .map(g => {
      const e = woche.goals.find(x => x.id === g.id);
      return { g, rest: g.target - (e?.value ?? 0), wert: e?.value ?? 0, pause: !!e?.paused };
    })
    .filter(k => k.rest > 0 && !k.pause)
    .sort((a, b) => b.rest / b.g.target - a.rest / a.g.target);
  const k = kandidaten[0];
  const offeneRoutinen = periodFor(state, "day", heute).goals.filter(g => !g.paused && g.value < g.target).length;
  return {
    block,
    idee: k ? `${k.g.title.replace(/\.$/, "")} (${k.wert}/${k.g.target} diese Woche)` : null,
    offeneRoutinen,
  };
}

// ── Diese Woche für dich ────────────────────────────────────────────────────
// Pauls Wunsch (2026-10-31): die Wochensachen genauso aufbauen wie die
// täglichen Routinen — abhaken bzw. hochzählen direkt in der Karte, und als
// Punkte, wie die letzten Wochen liefen. Grundlage sind die sechs Wochenideen
// aus dem Katalog; eingetragen wird wie bisher über recordSuggestion, eine
// Auswahl ist nicht nötig („Ideen, kein Muss").

export type WochenPunkt = "ja" | "teil" | "nein" | "offen" | "pause" | "unbekannt";

export type WochenSache = {
  id: string;
  titel: string;
  ziel: number;
  einheit: string;
  wert: number;
  pausiert: boolean;
  /** Die letzten Wochen, älteste zuerst; die letzte ist diese Woche. */
  punkte: { start: string; stand: WochenPunkt }[];
};

/** Die Wochenideen mit ihrem Stand diese Woche und den letzten `wochen` Wochen.
 *  Eine Woche ohne jeden Eintrag ist „unbekannt" — wie ein unbesuchter Tag. */
export function wochenSachen(state: BewusstState, heute: string, wochen = 6): WochenSache[] {
  const jetzt = periodFor(state, "week", heute);
  return CATALOG.week.map(g => {
    const e = jetzt.goals.find(x => x.id === g.id);
    const punkte: { start: string; stand: WochenPunkt }[] = [];
    for (let i = wochen - 1; i >= 0; i--) {
      const start = shiftDay(jetzt.start, -7 * i);
      const p = i === 0 ? jetzt : state.periods[`week:${start}`];
      const x = p?.goals.find(y => y.id === g.id);
      let stand: WochenPunkt;
      if (i > 0 && !p) stand = "unbekannt";
      else if (x?.paused) stand = "pause";
      else if (x && x.value >= x.target) stand = "ja";
      else if (x && x.value > 0) stand = "teil";
      else stand = i === 0 ? "offen" : "nein";
      punkte.push({ start, stand });
    }
    return { id: g.id, titel: g.title, ziel: g.target, einheit: g.unit, wert: e?.value ?? 0, pausiert: !!e?.paused, punkte };
  });
}

/** Wie viele Tage diese Woche noch hat, heute mitgezählt (Mo = 7 … So = 1). */
export function restTage(heute: string): number {
  return 7 - ((new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7);
}
