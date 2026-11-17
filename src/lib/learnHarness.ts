// Woran Paul gerade in LearnHarness lernt — für die Zeile auf der Lernzeit-Seite.
//
// Der Server (electron/learnHarness.cjs) liest den groben Lernstand, den
// LearnHarness ins Brain schreibt; hier wird nur abgeholt, geprüft und kurz
// gemerkt. LearnHarness schreibt nach jeder Session neu, die Spiegelung auf
// die VM läuft stündlich — fünf Minuten Cache verpassen also nichts.

export type LernThema = {
  titel: string;
  /** Ordner in LearnHarness, z. B. „FODS / Woche 5“. */
  rahmen: string | null;
  /** Lernzeit in LearnHarness innerhalb der letzten `tage` Tage. */
  minuten: number;
  zuletzt: string;
  offeneFragen: number;
  ueben: boolean;
  /** Nur mit Fach: passt das Thema zum Fach im Timer? */
  passtZumFach?: boolean;
};

import type { PlanerFokus } from "./klausurPlaner";

export type Klausur = {
  name: string;
  /** JJJJ-MM-TT oder null, wenn der Auftrag kein Datum nennt. */
  datum: string | null;
  /** Tage bis zur Klausur; 0 = heute. */
  tage: number | null;
  schwerpunkte: number;
  angefangen: number;
  minuten: number;
  offeneFragen: number;
  stundenProWoche: number | null;
  wiederholungAb: string | null;
  /** Lernminuten je Tag, die LearnHarness in den Klausur-Sessions gemessen
   *  hat (letzte 14 Tage) — leer bei älteren Ständen. */
  minutenProTag: Record<string, number>;
  /** Schwerpunkte mit Aufwand und Fortschritt — leer bei älteren Ständen. */
  fokusse: PlanerFokus[];
};

export type LearnHarnessStand =
  | {
      ok: true; stand: string; veraltet: boolean; tage: number; minuten: number; themen: LernThema[]; klausuren: Klausur[];
      /** Fächer aus dem LearnHarness-Timer, deren gespeicherte Sitzungen kein
       *  passendes Daily-Fach fanden (electron/learnHarnessSitzungen.cjs). */
      ohneFach: string[];
    }
  | { ok: false; grund?: string };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: LearnHarnessStand }>();

function istFokus(x: unknown): x is PlanerFokus {
  const f = x as PlanerFokus;
  return !!f && typeof f.titel === "string" && typeof f.erledigt === "number"
    && typeof f.fortschritt === "number" && typeof f.offeneFragen === "number";
}

function istKlausur(x: unknown): x is Klausur {
  const k = x as Klausur;
  return !!k && typeof k.name === "string" && typeof k.schwerpunkte === "number"
    && typeof k.angefangen === "number" && (k.tage === null || typeof k.tage === "number");
}

/** Ältere Server-Stände kennen die Planer-Felder noch nicht. */
function mitPlanerFeldern(k: Klausur): Klausur {
  return {
    ...k,
    stundenProWoche: typeof k.stundenProWoche === "number" ? k.stundenProWoche : null,
    wiederholungAb: typeof k.wiederholungAb === "string" ? k.wiederholungAb : null,
    minutenProTag: k.minutenProTag && typeof k.minutenProTag === "object" && !Array.isArray(k.minutenProTag)
      ? Object.fromEntries(Object.entries(k.minutenProTag).filter(([, m]) => typeof m === "number" && m > 0))
      : {},
    fokusse: Array.isArray(k.fokusse) ? k.fokusse.filter(istFokus) : [],
  };
}

function istThema(x: unknown): x is LernThema {
  const t = x as LernThema;
  return !!t && typeof t.titel === "string" && typeof t.minuten === "number"
    && typeof t.zuletzt === "string" && (t.rahmen === null || typeof t.rahmen === "string");
}

export async function ladeLearnHarness(fach?: string): Promise<LearnHarnessStand> {
  const key = (fach ?? "").trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const r = await fetch(`/api/learnharness${key ? `?fach=${encodeURIComponent(fach!.trim())}` : ""}`);
    if (!r.ok) return { ok: false };
    const raw = (await r.json()) as Record<string, unknown>;
    const data: LearnHarnessStand = raw.ok === true && Array.isArray(raw.themen)
      ? {
          ok: true,
          stand: String(raw.stand),
          veraltet: raw.veraltet === true,
          tage: typeof raw.tage === "number" ? raw.tage : 14,
          minuten: typeof raw.minuten === "number" ? raw.minuten : 0,
          themen: raw.themen.filter(istThema),
          klausuren: Array.isArray(raw.klausuren) ? raw.klausuren.filter(istKlausur).map(mitPlanerFeldern) : [],
          ohneFach: Array.isArray(raw.sitzungenOhneFach)
            ? raw.sitzungenOhneFach.filter((f): f is string => typeof f === "string").slice(0, 5)
            : [],
        }
      : { ok: false, grund: typeof raw.grund === "string" ? raw.grund : undefined };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return { ok: false };
  }
}

/** „1 h 05“ / „40 min“ — wie überall in Daily. */
export function fmtMinuten(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
