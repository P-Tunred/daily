// Klausur-Planer: wie viel heute und diese Woche für eine Klausur dran ist.
//
// Die Klausur kommt aus einem LearnHarness-Auftrag (Datum, Stunden pro Woche,
// Schwerpunkte mit Aufwand). LearnHarness sagt je Schwerpunkt, wie weit er ist
// (Plan-Knoten durchgearbeitet) und ob er sitzt (richtige Antworten). Daily
// liefert, wie viel Paul heute und diese Woche für das Fach gelernt hat.
//
// SO RECHNET ER
// Restaufwand je Schwerpunkt = Aufwand × (1 − erledigt), plus 15 min je offene
// Frage (höchstens 2 h): Unverstandenes bleibt Arbeit. Der Rest verteilt sich
// auf die Lerntage bis zum Beginn der Wiederholung (Auftrag, sonst 14 Tage vor
// der Klausur). Jeden Tag neu — wer gestern mehr geschafft hat, hat heute ein
// kleineres Ziel, und umgekehrt. Die heutigen Minuten werden dafür zum Rest
// dazugezählt, sonst schrumpfte das Ziel doppelt (einmal über den Fortschritt
// in LearnHarness, einmal über die gemessene Zeit).
//
// Reine Funktion: kein Fetch, kein Datum von aussen ausser `heute`.

export type Gewicht = "hoch" | "mittel" | "niedrig";

export type PlanerFokus = {
  titel: string;
  gewicht: Gewicht | null;
  aufwandStunden: number | null;
  /** 0…1: Plan-Knoten in LearnHarness durchgearbeitet. */
  fortschritt: number;
  /** 0…1 richtige Antworten; null, solange zu wenige bewertet sind. */
  verstaendnis: number | null;
  /** 0…1: fortschritt × verstaendnis. */
  erledigt: number;
  offeneFragen: number;
  minuten: number;
  angefangen: boolean;
};

export type PlanerKlausur = {
  name: string;
  datum: string | null;
  stundenProWoche: number | null;
  wiederholungAb: string | null;
  fokusse: PlanerFokus[];
};

export type PlanerEingabe = {
  klausur: PlanerKlausur;
  /** JJJJ-MM-TT, Ortszeit. */
  heute: string;
  /** Daily-Lernzeit für das Fach heute bzw. seit Montag (inkl. heute). */
  minutenHeute: number;
  minutenWoche: number;
};

export type HeuteFokus = { titel: string; minuten: number; wiederholen: boolean };

export type PlanerErgebnis =
  | { phase: "ohne-datum" | "vorbei" }
  | {
      phase: "lernen" | "wiederholung";
      tageBisKlausur: number;
      /** Lerntage bis zur Wiederholung (lernen) bzw. bis zur Klausur (wiederholung). */
      tageUebrig: number;
      restStunden: number;
      /** Heutiges Ziel in Minuten, auf 15 min gerundet. */
      tagesziel: number;
      heuteNoch: number;
      wochenziel: number;
      wocheIst: number;
      /** Geplantes Tagesmass laut Auftrag (Stunden pro Woche / 7), in Minuten. */
      planProTag: number;
      lage: "im-plan" | "knapp" | "zu-knapp";
      heuteDran: HeuteFokus[];
      /** Anteil des Gesamtaufwands, der schon hinter Paul liegt (0…1). */
      gesamtErledigt: number;
    };

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ohne Aufwandsangabe rechnet der Planer mit so vielen Stunden. */
const STANDARD_AUFWAND_H = 4;
const ZUSCHLAG_JE_FRAGE_H = 0.25;
const ZUSCHLAG_MAX_H = 2;
const STANDARD_WIEDERHOLUNG_TAGE = 14;
const STANDARD_STUNDEN_PRO_WOCHE = 14;
const MAX_FOKUSSE_HEUTE = 3;
const MIN_BLOCK_MIN = 30;
/** Ein Schwerpunkt gilt als fertig, wenn so viel erledigt und nichts offen ist. */
const FERTIG_AB = 0.9;
const WIEDERHOLEN_AB_FRAGEN = 3;

const tag = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const tageZwischen = (von: string, bis: string) => Math.round((tag(bis) - tag(von)) / DAY_MS);
const plusTage = (iso: string, n: number) => new Date(tag(iso) + n * DAY_MS).toISOString().slice(0, 10);
const auf15 = (min: number) => Math.max(0, Math.ceil(min / 15) * 15);

/** Restaufwand eines Schwerpunkts in Stunden. */
export function restStunden(f: PlanerFokus): number {
  const aufwand = f.aufwandStunden ?? STANDARD_AUFWAND_H;
  const zuschlag = Math.min(f.offeneFragen * ZUSCHLAG_JE_FRAGE_H, ZUSCHLAG_MAX_H);
  return aufwand * (1 - f.erledigt) + zuschlag;
}

const istFertig = (f: PlanerFokus) => f.erledigt >= FERTIG_AB && f.offeneFragen === 0;

/** Lernphase: angefangene, unfertige Schwerpunkte zuerst (nicht ständig neu
 *  anfangen), dann die Reihenfolge des Auftrags. */
function lernReihenfolge(fokusse: PlanerFokus[]): PlanerFokus[] {
  const offen = fokusse.filter((f) => !istFertig(f));
  return [...offen.filter((f) => f.angefangen), ...offen.filter((f) => !f.angefangen)];
}

/** Wiederholung: was am wackligsten ist zuerst. */
function wiederholReihenfolge(fokusse: PlanerFokus[]): PlanerFokus[] {
  const wackel = (f: PlanerFokus) => (1 - (f.verstaendnis ?? f.erledigt)) + f.offeneFragen * 0.1 + (f.gewicht === "hoch" ? 0.2 : 0);
  return [...fokusse].sort((a, b) => wackel(b) - wackel(a));
}

function verteilen(reihe: PlanerFokus[], budget: number, wiederholung: boolean): HeuteFokus[] {
  const out: HeuteFokus[] = [];
  let rest = budget;
  for (const f of reihe) {
    if (rest < MIN_BLOCK_MIN || out.length >= MAX_FOKUSSE_HEUTE) break;
    const bedarf = wiederholung ? rest : Math.max(MIN_BLOCK_MIN, auf15(restStunden(f) * 60));
    const minuten = Math.min(bedarf, auf15(rest));
    out.push({ titel: f.titel, minuten, wiederholen: wiederholung || f.offeneFragen >= WIEDERHOLEN_AB_FRAGEN });
    rest -= minuten;
  }
  return out;
}

export function planeKlausur({ klausur, heute, minutenHeute, minutenWoche }: PlanerEingabe): PlanerErgebnis {
  if (!klausur.datum) return { phase: "ohne-datum" };
  const tageBisKlausur = tageZwischen(heute, klausur.datum);
  if (tageBisKlausur < 0) return { phase: "vorbei" };

  const wiederholungAb = klausur.wiederholungAb ?? plusTage(klausur.datum, -STANDARD_WIEDERHOLUNG_TAGE);
  const stundenProWoche = klausur.stundenProWoche ?? STANDARD_STUNDEN_PRO_WOCHE;
  const planProTag = (stundenProWoche * 60) / 7;
  const rest = klausur.fokusse.reduce((s, f) => s + restStunden(f), 0);
  const gesamt = klausur.fokusse.reduce((s, f) => s + (f.aufwandStunden ?? STANDARD_AUFWAND_H), 0);
  const gesamtErledigt = gesamt > 0 ? klausur.fokusse.reduce((s, f) => s + (f.aufwandStunden ?? STANDARD_AUFWAND_H) * f.erledigt, 0) / gesamt : 0;
  const lernphase = heute < wiederholungAb;

  let tagesziel: number;
  let tageUebrig: number;
  let lage: "im-plan" | "knapp" | "zu-knapp";
  if (lernphase) {
    tageUebrig = Math.max(1, tageZwischen(heute, wiederholungAb));
    const noetig = (rest * 60 + minutenHeute) / tageUebrig;
    tagesziel = auf15(noetig);
    lage = noetig <= planProTag * 1.05 ? "im-plan" : noetig <= planProTag * 1.5 ? "knapp" : "zu-knapp";
  } else {
    // Wiederholung: das geplante Mass, verteilt auf das Wackligste.
    tageUebrig = Math.max(1, tageBisKlausur);
    tagesziel = auf15(planProTag);
    // Hier zählt, wie viel Neues noch fehlt: bis 10 % ist das normal, bis 25 % knapp.
    const anteilOffen = gesamt > 0 ? rest / gesamt : 0;
    lage = anteilOffen <= 0.1 ? "im-plan" : anteilOffen <= 0.25 ? "knapp" : "zu-knapp";
  }
  const heuteNoch = Math.max(0, tagesziel - minutenHeute);
  const reihe = lernphase ? lernReihenfolge(klausur.fokusse) : wiederholReihenfolge(klausur.fokusse);

  return {
    phase: lernphase ? "lernen" : "wiederholung",
    tageBisKlausur,
    tageUebrig,
    restStunden: Math.round(rest * 10) / 10,
    tagesziel,
    heuteNoch,
    wochenziel: Math.round(stundenProWoche * 60),
    wocheIst: minutenWoche,
    planProTag: Math.round(planProTag),
    lage,
    heuteDran: verteilen(reihe, heuteNoch, !lernphase),
    gesamtErledigt: Math.round(gesamtErledigt * 100) / 100,
  };
}

/** Lernzeit heute und seit Montag. Zwei Uhren messen dasselbe Lernen: der
 *  Daily-Timer des Fachs und LearnHarness (Nachrichtenzeiten in den
 *  Klausur-Sessions). Je Tag zählt die größere — wer im Harness lernt und
 *  dabei den Timer laufen lässt, zählt nicht doppelt; wer nur eins von
 *  beiden nutzt, verliert nichts. */
export function lernminuten(
  timer: Readonly<Record<string, number>>,
  harness: Readonly<Record<string, number>>,
  heute: string,
): { heute: number; woche: number } {
  const montag = wochenbeginn(heute);
  const tage = new Set([...Object.keys(timer), ...Object.keys(harness)]);
  const amTag = (t: string) => Math.max(timer[t] ?? 0, harness[t] ?? 0);
  let woche = 0;
  for (const t of tage) if (t >= montag && t <= heute) woche += amTag(t);
  return { heute: amTag(heute), woche };
}

/** Montag der Woche von `iso` (Wochen beginnen in Daily am Montag). */
export function wochenbeginn(iso: string): string {
  const wochentag = new Date(tag(iso)).getUTCDay(); // 0 = Sonntag
  return plusTage(iso, -((wochentag + 6) % 7));
}

/** Das Daily-Fach zur Klausur: ein Fachname, der als ganzes Wort im
 *  Klausurnamen steht („FODS“ in „FODS Theorie“). */
export function fachZurKlausur<T extends { name: string }>(faecher: readonly T[], klausurName: string): T | null {
  const wort = (s: string) => s.toLowerCase().normalize("NFC").trim();
  const name = ` ${wort(klausurName).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return faecher.find((f) => wort(f.name).length >= 2 && name.includes(` ${wort(f.name).replace(/[^\p{L}\p{N}]+/gu, " ")} `)) ?? null;
}

/** Ist-Lernzeit je Tag für eine Klausur — je Tag das Größere aus Timer und
 *  LearnHarness, wie in `lernminuten`. */
export function istProTag(
  timer: Readonly<Record<string, number>>,
  harness: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of new Set([...Object.keys(timer), ...Object.keys(harness)])) {
    out[t] = Math.max(timer[t] ?? 0, harness[t] ?? 0);
  }
  return out;
}

export type PlanFuerKlausur<K> = {
  k: K;
  plan: PlanerErgebnis;
  fachGefunden: boolean;
  /** Ist-Minuten je Tag für diese Klausur (Timer des Fachs / Harness). */
  istProTag: Record<string, number>;
};

/** Alle Klausuren planen — EINE Rechnung für Lernzeit-Seite und Morgens-Seite.
 *  Die Fachzuordnung läuft über den Klausurnamen (fachZurKlausur). */
export function planeAlle<K extends { name: string; minutenProTag: Record<string, number> } & PlanerKlausur>(
  klausuren: readonly K[],
  faecher: readonly { id: string; name: string }[],
  sitzungen: readonly { subjectId?: string; date: string; durationMin: number }[],
  heute: string,
): PlanFuerKlausur<K>[] {
  return klausuren.map((k) => {
    const fach = fachZurKlausur(faecher, k.name);
    const timer: Record<string, number> = {};
    if (fach) {
      for (const s of sitzungen) {
        if (s.subjectId === fach.id) timer[s.date] = (timer[s.date] ?? 0) + s.durationMin;
      }
    }
    const minuten = lernminuten(timer, k.minutenProTag, heute);
    return {
      k,
      plan: planeKlausur({ klausur: k, heute, minutenHeute: minuten.heute, minutenWoche: minuten.woche }),
      fachGefunden: !!fach,
      istProTag: istProTag(timer, k.minutenProTag),
    };
  });
}
