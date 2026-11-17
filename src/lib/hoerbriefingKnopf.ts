// Was der Hörbriefing-Knopf im Intro zeigt — reine Regeln, ohne React, damit
// sie sich testen lassen (tests/hoerbriefing-knopf.test.mjs).
//
// Seit 2026-11-01 ist das Hörbriefing nur noch EIN Knopf: Abspielen und
// Dauer. Kein Text, kein Mitlesen, keine Leiste, kein Tempo. Gibt es heute
// keine fertige Aufnahme, zeigt das Intro gar nichts — dass eine Stimme
// ausgefallen ist, meldet die Kanäle-Übersicht, nicht der Morgengruss.

export type HoerbriefingStand = {
  datum: string | null;
  status?: "erzeuge" | "fertig" | "fehler";
  dauerSek?: number;
  /** Die natürliche Stimme ist ausgefallen, Seraphina hat übernommen. */
  ersatz?: boolean;
};

export type Abspielbar = { datum: string; dauerSek: number; ersatz: boolean };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Solange die Aufnahme entsteht: bald wieder nachsehen. */
export const NACHSEHEN_ERZEUGE_MS = 8_000;
/** Noch gar kein Hörbriefing für heute (Hermes schreibt es um 06:00 UTC):
 *  ab und zu nachsehen. Sonst bliebe ein Fenster, das vor dem Lauf geöffnet
 *  wurde, den ganzen Morgen leer. */
export const NACHSEHEN_FEHLT_MS = 5 * 60_000;

/** Die Aufnahme, die der Knopf abspielt — oder null, dann zeigt er nichts. */
export function abspielbar(stand: HoerbriefingStand | null | undefined): Abspielbar | null {
  if (!stand || typeof stand.datum !== "string" || !ISO.test(stand.datum)) return null;
  if (stand.status !== "fertig") return null;
  const dauerSek = Number.isFinite(stand.dauerSek) && (stand.dauerSek as number) > 0 ? (stand.dauerSek as number) : 0;
  return { datum: stand.datum, dauerSek, ersatz: stand.ersatz === true };
}

/** Wann wieder beim Server nachsehen (ms), oder null: nicht mehr. Fertig und
 *  Fehler sind für heute endgültig; ein neuer Tag kommt über das
 *  Wieder-sichtbar-Werden des Fensters. */
export function naechsterBlick(stand: HoerbriefingStand | null | undefined): number | null {
  if (!stand || !stand.datum) return NACHSEHEN_FEHLT_MS;
  if (stand.status === "erzeuge") return NACHSEHEN_ERZEUGE_MS;
  return null;
}

export function zeit(sek: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sek) ? sek : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Die Zahl auf dem Knopf: vor dem Start die Dauer, danach die Restzeit.
 *  Ohne bekannte Dauer steht keine Zahl da — „0:00" wäre falsch. */
export function knopfZeit(pos: number, gesamt: number): string | null {
  if (!(gesamt > 0)) return null;
  return pos > 0 ? `−${zeit(gesamt - pos)}` : zeit(gesamt);
}
