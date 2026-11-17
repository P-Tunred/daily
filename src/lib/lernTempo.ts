// Lerntempo — wie viel Paul wirklich schafft, und ob der Klausurplan damit aufgeht.
//
// Pauls Wunsch (2026-10-31): „Heute dran" soll aus dem Klausur-Planer kommen
// und mitlernen — wie viel habe ich gemacht, wie viel schaffe ich, ist das
// realistisch, wie lange brauche ich im Schnitt für ein Thema.
//
// DREI MESSUNGEN, ALLE AUS DATEN, DIE SCHON DA SIND
//   tempo       — Wie lange ein Schwerpunkt bei Paul wirklich dauert, gemessen
//                 an LearnHarness: gelernte Minuten ÷ erledigter Anteil, hoch-
//                 gerechnet auf 100 %. Im Verhältnis zum geplanten Aufwand
//                 ergibt das den Faktor („du brauchst 1,3× so lange").
//                 Erst ab zwei Schwerpunkten mit ≥ 25 % und ≥ 30 min — ein
//                 einzelnes Thema ist eine Anekdote, kein Tempo.
//   kapazitaet  — Lernminuten pro Tag im Schnitt der letzten 14 Tage (ohne
//                 heute): was Paul tatsächlich schafft, nicht was er plant.
//   zielQuote   — An wie vielen der letzten Tage das Tagesziel erreicht wurde.
//                 Dafür hält Daily das Tagesziel jeden Morgen fest
//                 (`morning.lernplan.verlauf`), sonst gäbe es nichts zu vergleichen.
//
// Daraus: `realistisch` — das Tagesziel bei Pauls Tempo, und ob es zu seiner
// Kapazität passt. Nichts davon ändert den Planer selbst; er bleibt die
// Rechnung aus dem Auftrag. Das hier ist die ehrliche Gegenrechnung.
//
// Reine Funktionen, kein Speicher, kein Datum von aussen ausser `heute`.

const tag = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const plusTage = (iso: string, n: number) => new Date(tag(iso) + n * 86_400_000).toISOString().slice(0, 10);
const auf15 = (min: number) => Math.max(0, Math.ceil(min / 15) * 15);

export const STANDARD_AUFWAND_H = 4;
const MIN_ERLEDIGT = 0.25;
const MIN_MINUTEN = 30;
const MIN_SCHWERPUNKTE = 2;

export type TempoFokus = { aufwandStunden: number | null; erledigt: number; minuten: number };

export type Tempo = {
  /** Tatsächlich ÷ geplant, 0,5…3. null = noch zu wenig gemessen. */
  faktor: number | null;
  /** Wie lange ein Schwerpunkt bei Paul im Schnitt dauert (hochgerechnet). */
  schnittMinuten: number | null;
  /** Geplanter Aufwand derselben Schwerpunkte im Schnitt — zum Vergleich. */
  schnittGeplant: number | null;
  gemessen: number;
};

export function tempo(fokusse: readonly TempoFokus[]): Tempo {
  const messbar = fokusse.filter(f => f.erledigt >= MIN_ERLEDIGT && f.minuten >= MIN_MINUTEN);
  if (messbar.length < MIN_SCHWERPUNKTE) return { faktor: null, schnittMinuten: null, schnittGeplant: null, gemessen: messbar.length };
  const hoch = messbar.map(f => f.minuten / Math.min(1, f.erledigt));
  const geplant = messbar.map(f => (f.aufwandStunden ?? STANDARD_AUFWAND_H) * 60);
  const summe = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const faktor = Math.min(3, Math.max(0.5, summe(hoch) / summe(geplant)));
  return {
    faktor: Math.round(faktor * 100) / 100,
    schnittMinuten: Math.round(summe(hoch) / hoch.length),
    schnittGeplant: Math.round(summe(geplant) / geplant.length),
    gemessen: messbar.length,
  };
}

export type Kapazitaet = { schnitt: number; schnittLerntage: number; lerntage: number; tage: number };

/** Lernminuten pro Tag über die letzten `tage` Tage vor heute. */
export function kapazitaet(minutenProTag: Readonly<Record<string, number>>, heute: string, tage = 14): Kapazitaet {
  let summe = 0;
  let lerntage = 0;
  for (let i = 1; i <= tage; i++) {
    const m = minutenProTag[plusTage(heute, -i)] ?? 0;
    summe += m;
    if (m > 0) lerntage++;
  }
  return {
    schnitt: Math.round(summe / tage),
    schnittLerntage: lerntage ? Math.round(summe / lerntage) : 0,
    lerntage,
    tage,
  };
}

/** An wie vielen der letzten `tage` Tage (vor heute) mit Ziel es erreicht
 *  wurde. 90 % zählt als erreicht — 85 statt 90 Minuten ist kein Versagen. */
export function zielQuote(
  ziele: Readonly<Record<string, number>>,
  ist: Readonly<Record<string, number>>,
  heute: string,
  tage = 7,
): { erreicht: number; von: number } {
  let erreicht = 0;
  let von = 0;
  for (let i = 1; i <= tage; i++) {
    const d = plusTage(heute, -i);
    const z = ziele[d];
    if (!z || z <= 0) continue;
    von++;
    if ((ist[d] ?? 0) >= z * 0.9) erreicht++;
  }
  return { erreicht, von };
}

export type Realistisch = {
  /** Tagesziel bei Pauls Tempo (auf 15 min). */
  ziel: number;
  /** passt = in der Kapazität, knapp = bis 1,5×, zu-viel = darüber. */
  urteil: "passt" | "knapp" | "zu-viel" | "unbekannt";
  /** Lerntage, die es bei Pauls Kapazität bräuchte. null ohne Kapazität. */
  tageNoetig: number | null;
};

/** Das Tagesziel bei Pauls Tempo und ob es zu dem passt, was er schafft.
 *  `bedarfAndere` = was andere Klausuren am selben Tag schon beanspruchen. */
export function realistisch(opt: {
  restStunden: number;
  tageUebrig: number;
  minutenHeute: number;
  faktor: number | null;
  kapazitaet: number;
  bedarfAndere?: number;
  /** Rest in Minuten bei Pauls Tempo (restMinuten) — ersetzt restStunden × faktor. */
  restMinuten?: number;
}): Realistisch {
  const f = opt.faktor ?? 1;
  const tage = Math.max(1, opt.tageUebrig);
  const rest = opt.restMinuten ?? opt.restStunden * 60 * f;
  const noetig = (rest + opt.minutenHeute) / tage;
  const ziel = auf15(noetig);
  if (opt.kapazitaet <= 0) return { ziel, urteil: "unbekannt", tageNoetig: null };
  const gesamt = noetig + (opt.bedarfAndere ?? 0);
  const urteil = gesamt <= opt.kapazitaet * 1.1 ? "passt" : gesamt <= opt.kapazitaet * 1.5 ? "knapp" : "zu-viel";
  return { ziel, urteil, tageNoetig: Math.ceil(rest / opt.kapazitaet) };
}

/** Das Tagesziel des Tages festhalten — nur das erste des Tages, damit ein
 *  Ziel, das im Lauf des Tages schrumpft (weil gelernt wurde), die Quote nicht
 *  schönt. Behält höchstens `tage` Tage. */
export function mitZiel(
  verlauf: Readonly<Record<string, Record<string, number>>>,
  heute: string,
  klausur: string,
  ziel: number,
  tage = 60,
): Record<string, Record<string, number>> {
  if (verlauf[heute]?.[klausur] !== undefined) return verlauf as Record<string, Record<string, number>>;
  const grenze = plusTage(heute, -tage);
  const out: Record<string, Record<string, number>> = {};
  for (const [d, z] of Object.entries(verlauf)) if (d > grenze) out[d] = { ...z };
  out[heute] = { ...(out[heute] ?? {}), [klausur]: ziel };
  return out;
}

// ── Restaufwand bei Pauls Tempo — je Untereinheit lernend ───────────────────
// Pauls Wunsch (2026-10-31): „wenn man merkt, dass eine Subeinheit eine Stunde
// braucht und die KI dachte 30 Minuten, dann sollte das angepasst werden".
// Deshalb zählt bei jedem Schwerpunkt, der schon Fortschritt hat, SEIN
// gemessenes Tempo (Minuten ÷ erledigter Anteil) — gemischt mit der Schätzung,
// solange erst wenig erledigt ist, damit 10 % Fortschritt nicht wild
// hochgerechnet werden. Ab der Hälfte zählt nur noch das Gemessene.
// Unangefangenes rechnet mit dem Tempo des Fachs, sonst dem allgemeinen.

const ZUSCHLAG_JE_FRAGE_MIN = 15;
const ZUSCHLAG_MAX_MIN = 120;
const FERTIG_AB = 0.9;
const EIGENES_TEMPO_AB = { erledigt: 0.15, minuten: 20 };

export type RestFokus = TempoFokus & { offeneFragen: number };

/** Minuten, die ein Schwerpunkt bei Paul voraussichtlich noch braucht. */
export function restMinutenFokus(f: RestFokus, faktor: number | null): number {
  const zuschlag = Math.min(f.offeneFragen * ZUSCHLAG_JE_FRAGE_MIN, ZUSCHLAG_MAX_MIN);
  if (f.erledigt >= FERTIG_AB && f.offeneFragen === 0) return 0;
  const geschaetzt = (f.aufwandStunden ?? STANDARD_AUFWAND_H) * 60 * (faktor ?? 1);
  let proGanzes = geschaetzt;
  if (f.erledigt >= EIGENES_TEMPO_AB.erledigt && f.minuten >= EIGENES_TEMPO_AB.minuten) {
    const eigenes = f.minuten / Math.min(1, f.erledigt);
    const w = Math.min(1, f.erledigt / 0.5);
    proGanzes = w * eigenes + (1 - w) * geschaetzt;
  }
  return Math.round(proGanzes * Math.max(0, 1 - f.erledigt) + zuschlag);
}

export function restMinuten(fokusse: readonly RestFokus[], faktor: number | null): number {
  return fokusse.reduce((s, f) => s + restMinutenFokus(f, faktor), 0);
}

// ── Das Tagesziel: Budget als Obergrenze, Bedarf als Ziel ───────────────────
// Pauls Entscheidung (2026-10-31): die Zeit in der Wochenzeile ist das BUDGET
// („so viel habe ich"). Das Ziel ist, was heute wirklich nötig ist — höchstens
// das Budget. Ein Tagesziel, das Paul für genau diesen Tag selbst gesetzt hat,
// gewinnt immer. Ohne jeden Bedarf (keine Klausurpläne, keine festen Fach-
// zeiten) bleibt alles wie vorher: Ziel = Budget.

export type Tagesziel = {
  ziel: number;
  budget: number;
  /** Bedarf aus Klausurplänen + festen Fachzeiten; null = keiner bekannt. */
  bedarf: number | null;
  /** true, wenn das Ziel unter dem Budget liegt (berechnet). */
  angepasst: boolean;
  quelle: "eigenes" | "bedarf" | "budget";
};

export function tagesziel(opt: { budget: number; eigenes?: number; bedarfKlausuren: number | null; fachMinuten: number }): Tagesziel {
  const budget = Math.max(0, Math.round(opt.budget));
  if (opt.eigenes !== undefined) return { ziel: opt.eigenes, budget, bedarf: null, angepasst: false, quelle: "eigenes" };
  if (opt.bedarfKlausuren === null && opt.fachMinuten <= 0) return { ziel: budget, budget, bedarf: null, angepasst: false, quelle: "budget" };
  const bedarf = auf15((opt.bedarfKlausuren ?? 0) + opt.fachMinuten);
  const ziel = Math.min(budget, bedarf);
  return { ziel, budget, bedarf, angepasst: ziel < budget, quelle: ziel < budget ? "bedarf" : "budget" };
}

/** Feste Wochenstunden eines Fachs ohne Klausurplan als Minuten für heute:
 *  gleichmässig auf die Tage der Woche mit Budget verteilt. */
export function fachMinutenHeute(stundenProWoche: number, tageMitBudget: number): number {
  if (stundenProWoche <= 0 || tageMitBudget <= 0) return 0;
  return Math.round((stundenProWoche * 60) / tageMitBudget);
}
