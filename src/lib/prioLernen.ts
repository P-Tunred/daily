// Was Paul wichtig ist — gelernt aus dem, was er mit seinen Aufgaben TUT.
//
// WARUM ES DAS GIBT
// Pauls Wunsch (2026-10-31): „Wenn ich Aufgaben lösche, wegmache oder die
// Priorität vergrößere, soll es daraus lernen und ein System bauen, was ich
// wichtig und was ich nicht wichtig finde." Bisher vergass Daily jede dieser
// Handlungen sofort wieder — eine gelöschte Aufgabe war einfach weg, und die
// nächste gleicher Art bekam dieselbe Behandlung.
//
// WIE
// Jede bewusste Handlung wird ein SIGNAL mit den Merkmalen der Aufgabe:
// Rubrik, Fach, Herkunft und ein paar Stichwörter aus dem Text. Aus allen
// Signalen entsteht pro Merkmal ein Gewicht zwischen −1 (räumst du weg) und +1
// (ziehst du durch). Ältere Signale zählen weniger (Halbwertszeit 30 Tage) —
// was im Sommer wichtig war, muss es im Winter nicht mehr sein.
//
// WAS ES BEWUSST NICHT IST
// - Kein Automat. Es löscht und verschiebt nichts selbst; es liefert Gründe
//   für Empfehlungen (lib/empfehlung.ts), entscheiden tut Paul.
// - Keine Zählung von Aufräum-Läufen. Was der 2-Uhr-Lauf oder der
//   Tagesabschluss entfernen, ist keine Aussage über Wichtigkeit. Signale
//   entstehen nur dort, wo Paul selbst klickt oder spricht.
//
// Reine Rechenlogik ohne Speicher — der liegt in lib/prioSpeicher.ts.

import type { Task, TaskPriority } from "../types";
import { CATEGORY_META } from "./categories.ts";

export type SignalArt =
  | "erledigt"        // abgehakt
  | "geloescht"       // offen gelöscht (nicht: erledigt weggeräumt)
  | "hochgestuft"     // Priorität erhöht
  | "runtergestuft"   // Priorität gesenkt
  | "nachHeute"       // aus der Woche in den Tag gezogen
  | "zurueckWoche"    // aus dem Tag zurück in die Woche
  | "vorschlagJa"     // Empfehlung angenommen
  | "vorschlagNein";  // Empfehlung abgelehnt ("heute rein?" → nein)

export type Signal = {
  ts: number;
  art: SignalArt;
  /** Gekürzter Aufgabentext — für die Stichwörter und damit man später
   *  nachvollziehen kann, woraus gelernt wurde. */
  text: string;
  category?: string;
  subjectId?: string;
  quelle?: Quelle;
  /** Nur bei vorschlagJa/-Nein: welche Art Empfehlung es war. Ein abgelehntes
   *  „streichen?" heisst das Gegenteil eines abgelehnten „heute rein?". */
  empfehlung?: string;
};

export type Quelle = "selbst" | "hermes" | "termin" | "frist" | "woche";

/** Wie stark jede Handlung zählt. Hochstufen ist die deutlichste Aussage —
 *  Paul nimmt sich extra die Zeit, es zu sagen. Ablehnen eines Vorschlags ist
 *  die schwächste: oft heisst es nur „nicht jetzt". */
const WERT: Record<SignalArt, number> = {
  erledigt: 1,
  geloescht: -1.2,
  hochgestuft: 1.3,
  runtergestuft: -0.9,
  nachHeute: 0.7,
  zurueckWoche: -0.4,
  vorschlagJa: 0.8,
  vorschlagNein: -0.5,
};

export const HALBWERT_TAGE = 30;
export const MAX_SIGNALE = 500;
/** Unter so viel (abgeklungener) Erfahrung sagt ein Merkmal noch nichts. */
const MIN_EVIDENZ = 1.5;

const STOPP = new Set([
  "und", "oder", "aber", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
  "für", "fuer", "mit", "von", "vom", "zum", "zur", "bei", "auf", "aus", "nach", "noch", "mal", "auch",
  "ich", "mir", "mich", "mein", "meine", "dir", "dich", "sich", "nicht", "kein", "keine", "bis", "heute",
  "morgen", "diese", "dieser", "dieses", "woche", "machen", "erledigen", "kurz", "schnell", "wegen", "über",
  "ueber", "unter", "alle", "alles", "etwas", "dann", "wenn", "dass", "the", "and", "for", "to",
]);

/** Stichwörter einer Aufgabe: kleingeschrieben, ohne Füllwörter, höchstens 5. */
export function stichwoerter(text: string): string[] {
  const roh = text.toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(w => w.length >= 4 && !STOPP.has(w) && !/^\d+$/.test(w));
  return [...new Set(roh)].slice(0, 5);
}

/** Woher eine Aufgabe kam — aus ihren Spuren abgelesen. */
export function quelleVon(t: Pick<Task, "id" | "ausTermin" | "ausWoche">): Quelle {
  if (t.ausTermin) return "termin";
  if (t.id.startsWith("brain:") || t.id.includes("frist")) return "frist";
  if (t.ausWoche) return "woche";
  return t.id.startsWith("local-") ? "selbst" : "hermes";
}

export function signalAus(
  t: Pick<Task, "id" | "text" | "category" | "subjectId" | "ausTermin" | "ausWoche">,
  art: SignalArt,
  extra: { empfehlung?: string; ts?: number } = {},
): Signal {
  return {
    ts: extra.ts ?? Date.now(),
    art,
    text: t.text.slice(0, 140),
    ...(t.category ? { category: t.category } : {}),
    ...(t.subjectId ? { subjectId: t.subjectId } : {}),
    quelle: quelleVon(t),
    ...(extra.empfehlung ? { empfehlung: extra.empfehlung } : {}),
  };
}

/** Der Wert eines Signals. Ein abgelehntes „streichen?" ist ein Ja zur
 *  Aufgabe, kein Nein — Paul hat sie behalten wollen. */
function wertVon(s: Signal): number {
  if (s.art === "vorschlagNein" && (s.empfehlung === "streichen" || s.empfehlung === "woche")) return 0.6;
  if (s.art === "vorschlagJa" && (s.empfehlung === "streichen" || s.empfehlung === "woche")) return -0.8;
  return WERT[s.art] ?? 0;
}

/** Die Merkmale eines Signals bzw. einer Aufgabe als Schlüssel. */
export function merkmale(x: { text: string; category?: string; subjectId?: string; quelle?: Quelle }): string[] {
  return [
    ...(x.category ? [`kat:${x.category}`] : []),
    ...(x.subjectId ? [`fach:${x.subjectId}`] : []),
    ...(x.quelle ? [`quelle:${x.quelle}`] : []),
    ...stichwoerter(x.text).map(w => `wort:${w}`),
  ];
}

export type Merkmal = {
  schluessel: string;
  /** −1 … +1: räumst du weg … ziehst du durch. */
  gewicht: number;
  /** Abgeklungene Erfahrung — wie belastbar das Gewicht ist. */
  evidenz: number;
  zaehler: Partial<Record<SignalArt, number>>;
};

export type PrioModell = { merkmale: Map<string, Merkmal>; signale: number };

export function baueModell(signale: Signal[], jetzt = Date.now()): PrioModell {
  const roh = new Map<string, { pos: number; neg: number; zaehler: Partial<Record<SignalArt, number>> }>();
  for (const s of signale) {
    const alterTage = Math.max(0, (jetzt - s.ts) / 86_400_000);
    const abkling = Math.pow(0.5, alterTage / HALBWERT_TAGE);
    const v = wertVon(s) * abkling;
    for (const k of merkmale(s)) {
      const m = roh.get(k) ?? { pos: 0, neg: 0, zaehler: {} };
      if (v >= 0) m.pos += v; else m.neg -= v;
      m.zaehler[s.art] = (m.zaehler[s.art] ?? 0) + 1;
      roh.set(k, m);
    }
  }
  const out = new Map<string, Merkmal>();
  for (const [k, m] of roh) {
    const evidenz = m.pos + m.neg;
    // +2 im Nenner: ein einzelnes Signal soll nicht gleich ±1 bedeuten.
    out.set(k, { schluessel: k, gewicht: (m.pos - m.neg) / (evidenz + 2), evidenz, zaehler: m.zaehler });
  }
  return { merkmale: out, signale: signale.length };
}

export type Bewertung = {
  /** −1 … +1, 0 = keine Ahnung. */
  wert: number;
  /** Wie sicher (Summe der Evidenz der beteiligten Merkmale). */
  sicherheit: number;
  /** Das Merkmal, das am meisten zur Bewertung beiträgt — für den Grund. */
  grund: Merkmal | null;
};

/** Wie wichtig Paul eine Aufgabe dieser Art bisher war. */
export function bewerte(
  t: Pick<Task, "id" | "text" | "category" | "subjectId" | "ausTermin" | "ausWoche">,
  modell: PrioModell,
): Bewertung {
  // Gewichtet nach AUSSAGEKRAFT (Evidenz × |Gewicht|), nicht nur nach Menge:
  // „selbst eingetragen" trifft fast jede Aufgabe und ist meist neutral — nach
  // reiner Menge würde es jedes klare Merkmal wie „Uni" zur Mitte verwässern.
  let summe = 0;
  let gewichte = 0;
  let evidenz = 0;
  let grund: Merkmal | null = null;
  for (const k of merkmale({ ...t, quelle: quelleVon(t) })) {
    const m = modell.merkmale.get(k);
    if (!m || m.evidenz < 0.5) continue;
    const w = m.evidenz * Math.abs(m.gewicht);
    summe += m.gewicht * w;
    gewichte += w;
    evidenz += m.evidenz;
    // „Selbst eingetragen" trifft fast alles — als BEGRÜNDUNG sagt es nichts.
    if (k !== "quelle:selbst" && (!grund || w > grund.evidenz * Math.abs(grund.gewicht))) grund = m;
  }
  if (evidenz < MIN_EVIDENZ || gewichte === 0) return { wert: 0, sicherheit: evidenz, grund: null };
  return { wert: summe / gewichte, sicherheit: evidenz, grund };
}

/** Lesbarer Name eines Merkmals. `faecher` übersetzt Fach-IDs in Namen. */
export function merkmalName(schluessel: string, faecher: Record<string, string> = {}): string {
  const [art, ...rest] = schluessel.split(":");
  const wert = rest.join(":");
  if (art === "kat") return CATEGORY_META[wert as keyof typeof CATEGORY_META]?.label ?? wert;
  if (art === "fach") return faecher[wert] ?? "ein Fach";
  if (art === "quelle") {
    return ({ selbst: "selbst eingetragene Aufgaben", hermes: "Aufgaben von Hermes", termin: "Aufgaben aus Terminen", frist: "Fristen aus dem Brain", woche: "Aufgaben aus der Wochenliste" } as Record<string, string>)[wert] ?? wert;
  }
  return `„${wert.charAt(0).toUpperCase()}${wert.slice(1)}"`;
}

function zaehlerText(z: Partial<Record<SignalArt, number>>): string {
  const teile: string[] = [];
  const plus = (z.erledigt ?? 0);
  const hoch = (z.hochgestuft ?? 0);
  const weg = (z.geloescht ?? 0);
  if (plus) teile.push(`${plus}× erledigt`);
  if (hoch) teile.push(`${hoch}× hochgestuft`);
  if (weg) teile.push(`${weg}× gelöscht`);
  return teile.join(", ");
}

/** Ein Satz, warum eine Aufgabe so bewertet wird — oder null. */
export function grundSatz(b: Bewertung, faecher: Record<string, string> = {}): string | null {
  // Nur deutliche Gründe nennen; ein knappes Gewicht wäre eine Behauptung.
  if (!b.grund || Math.abs(b.grund.gewicht) < 0.25 || Math.sign(b.grund.gewicht) !== Math.sign(b.wert)) return null;
  const name = merkmalName(b.grund.schluessel, faecher);
  return b.wert >= 0
    ? `${name} ziehst du meist durch`
    : `${name} räumst du oft weg`;
}

export type ProfilZeile = { name: string; gewicht: number; belege: string };

/** Was Daily gelernt hat — für die Anzeige und für Hermes. */
export function profil(modell: PrioModell, faecher: Record<string, string> = {}): { wichtig: ProfilZeile[]; unwichtig: ProfilZeile[] } {
  const belastbar = [...modell.merkmale.values()].filter(m => m.evidenz >= MIN_EVIDENZ && Math.abs(m.gewicht) >= 0.25);
  const zeile = (m: Merkmal): ProfilZeile => ({ name: merkmalName(m.schluessel, faecher), gewicht: Math.round(m.gewicht * 100) / 100, belege: zaehlerText(m.zaehler) });
  const nachStaerke = (a: Merkmal, b: Merkmal) => Math.abs(b.gewicht) * b.evidenz - Math.abs(a.gewicht) * a.evidenz;
  return {
    wichtig: belastbar.filter(m => m.gewicht > 0).sort(nachStaerke).slice(0, 5).map(zeile),
    unwichtig: belastbar.filter(m => m.gewicht < 0).sort(nachStaerke).slice(0, 5).map(zeile),
  };
}

/** Das Profil als knapper Text — für Prompts (Stimme, Hermes). */
export function profilText(modell: PrioModell, faecher: Record<string, string> = {}): string {
  const p = profil(modell, faecher);
  if (!p.wichtig.length && !p.unwichtig.length) return "";
  const z = (l: ProfilZeile[]) => l.map(x => `${x.name}${x.belege ? ` (${x.belege})` : ""}`).join("; ");
  return [
    p.wichtig.length ? `Wichtig für Paul: ${z(p.wichtig)}.` : "",
    p.unwichtig.length ? `Eher unwichtig für Paul: ${z(p.unwichtig)}.` : "",
  ].filter(Boolean).join("\n");
}

/** Priorität als Zahl — zum Vergleichen beim Hoch-/Runterstufen. */
export function prioRang(p: TaskPriority | undefined): number {
  return p === "dringend" ? 2 : p === "wichtig" ? 1 : 0;
}

/** Neue Liste mit dem Signal, auf MAX_SIGNALE gekappt (älteste fallen raus). */
export function mitSignal(liste: Signal[], s: Signal): Signal[] {
  return [...liste, s].slice(-MAX_SIGNALE);
}
