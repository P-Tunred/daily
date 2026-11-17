import { sameVersion, currentVersion, type ScoreDay } from "./scoreHistory.ts";

// Auswertungen für die Score-Seite im Stil G. Paul (2026-11-03): „mach es
// etwas schöner und mehr Daten, die man sehen kann." Alles rein und ohne
// Speicherzugriff: ScorePanel lädt den Verlauf, hier wird nur gerechnet.
//
// Mittelwerte gehen wie in scoreHistory nur über Tage derselben Formel —
// sonst sähe ein Wochentag nur deshalb stärker aus, weil er öfter vor der
// Umstellung auf den Routine-Bonus lag.

/** Ab hier gilt ein Tag als stark — dieselbe Schwelle wie „Tage über 70". */
export const STARK = 70;

/** Der Verlauf mit dem Live-Stand von heute statt des zuletzt gespeicherten. */
export function mitHeute(history: ScoreDay[], heute: ScoreDay): ScoreDay[] {
  return [...history.filter((d) => d.date !== heute.date), heute].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const ausIso = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoVon = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusTage = (iso: string, n: number) => { const d = ausIso(iso); d.setDate(d.getDate() + n); return isoVon(d); };

/** Starke Tage in Folge bis heute. Heute zählt mit, sobald er stark ist —
 *  solange er es noch nicht ist, läuft die Serie ab gestern weiter. */
export function serie(history: ScoreDay[], todayIso: string, schwelle = STARK): number {
  const werte = new Map(history.map((d) => [d.date, d.score]));
  let iso = (werte.get(todayIso) ?? 0) >= schwelle ? todayIso : plusTage(todayIso, -1);
  let n = 0;
  while ((werte.get(iso) ?? -1) >= schwelle) {
    n++;
    iso = plusTage(iso, -1);
  }
  return n;
}

export type WochentagWert = { schnitt: number | null; n: number };

/** Schnitt je Wochentag, Montag zuerst. */
export function wochentagSchnitt(history: ScoreDay[]): WochentagWert[] {
  const tage = sameVersion(history, currentVersion(history));
  return Array.from({ length: 7 }, (_, i) => {
    const am = tage.filter((d) => (ausIso(d.date).getDay() + 6) % 7 === i);
    return { schnitt: am.length ? Math.round(am.reduce((a, d) => a + d.score, 0) / am.length) : null, n: am.length };
  });
}

export type Herkunft = { tage: number; time: number; tasks: number; routine: number; drag: number };

/** Woher die Punkte im Schnitt kommen — Lernzeit, Aufgaben, Routinen, Altlasten. */
export function punkteHerkunft(days: ScoreDay[]): Herkunft | null {
  const tage = sameVersion(days, currentVersion(days));
  if (tage.length === 0) return null;
  const mittel = (f: (d: ScoreDay) => number) => Math.round(tage.reduce((a, d) => a + f(d), 0) / tage.length);
  return {
    tage: tage.length,
    time: mittel((d) => d.time),
    tasks: mittel((d) => d.tasks),
    routine: mittel((d) => d.routineBonus ?? 0),
    drag: mittel((d) => d.drag),
  };
}

export type ZielQuote = { erreicht: number; tage: number; minuten: number; schnittMin: number };

/** An wie vielen Tagen mit Lernziel das Ziel stand, und wie viel gelernt wurde. */
export function zielQuote(days: ScoreDay[]): ZielQuote {
  const mitZiel = days.filter((d) => d.goalMin > 0);
  const minuten = days.reduce((a, d) => a + d.studyMin, 0);
  return {
    erreicht: mitZiel.filter((d) => d.studyMin >= d.goalMin).length,
    tage: mitZiel.length,
    minuten,
    schnittMin: days.length ? Math.round(minuten / days.length) : 0,
  };
}

export type KalenderTag = { iso: string; score: number | null; zukunft: boolean };

/** Die letzten `wochen` Kalenderwochen (Mo–So) bis einschließlich der von heute. */
export function kalenderWochen(history: ScoreDay[], todayIso: string, wochen: number): KalenderTag[][] {
  const werte = new Map(history.map((d) => [d.date, d.score]));
  const heute = ausIso(todayIso);
  const montag = plusTage(todayIso, -((heute.getDay() + 6) % 7));
  const start = plusTage(montag, -7 * (wochen - 1));
  return Array.from({ length: wochen }, (_, w) =>
    Array.from({ length: 7 }, (_, t) => {
      const iso = plusTage(start, w * 7 + t);
      return { iso, score: werte.get(iso) ?? null, zukunft: iso > todayIso };
    }),
  );
}
