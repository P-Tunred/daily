// Ein Lernblock über einem Termin heisst: da war ich nicht.
//
// WARUM DAS EINE REGEL IST UND KEINE ANSICHTSSACHE
// Im Wochenplan liegen Termine und Lernzeit auf demselben Raster. Wer einen
// Lernblock über eine Vorlesung legt, hat damit schon entschieden — er sitzt zu
// der Zeit nicht in der Vorlesung. Bisher blieben beide stehen: der Plan zeigte
// zwei Dinge gleichzeitig, und die Wochenauswertung zählte eine Vorlesung mit,
// die nie stattgefunden hat.
//
// WARUM NICHT JEDE BERÜHRUNG ZÄHLT
// Blöcke rasten auf 30 Minuten. Ein Lernblock, der eine zweistündige Vorlesung
// um eine halbe Stunde überlappt, ist eine Randberührung — vielleicht kommt er
// später. Ein Block, der die halbe Vorlesung überdeckt, ist eine Entscheidung.
// Die Schwelle liegt deshalb bei der HÄLFTE der Termindauer, nicht bei einer
// Minute: lieber einmal nicht gelöscht als einmal zu Unrecht.

export type Zeitraum = { startMin: number; endMin: number };

/** Gemeinsame Minuten zweier Zeiträume. 0, wenn sie sich nicht berühren. */
export function ueberschneidung(a: Zeitraum, b: Zeitraum): number {
  return Math.max(0, Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin));
}

/** Anteil des Termins, den der Lernblock überdeckt (0…1). */
export function anteilVerdeckt(lern: Zeitraum, termin: Zeitraum): number {
  const dauer = termin.endMin - termin.startMin;
  if (dauer <= 0) return 0;
  return ueberschneidung(lern, termin) / dauer;
}

/** Ab hier gilt der Termin als abgesagt. Genau die Hälfte zählt schon mit —
 *  wer die halbe Vorlesung verlernt, geht nicht für den Rest hin. */
export const VERDRAENGT_AB = 0.5;

export function verdraengt(lern: Zeitraum, termin: Zeitraum): boolean {
  return anteilVerdeckt(lern, termin) >= VERDRAENGT_AB;
}

/** Etwas, das im Wochenplan Zeit belegt und einem Kalendertermin entspricht. */
export type Terminartig = { id: string; startMin: number; endMin: number; titel: string };

/**
 * Welche Termine ein Lernblock verdrängt.
 *
 * Rein und ohne Nebenwirkung — das Löschen macht der Aufrufer. Damit lässt sich
 * die Regel prüfen, ohne einen Kalender anzufassen, und sie steht an genau
 * einer Stelle statt an den drei Orten, an denen ein Block entstehen kann
 * (neu anlegen, verschieben, ziehen).
 */
export function verdraengteTermine(lern: Zeitraum, termine: Terminartig[]): Terminartig[] {
  if (lern.endMin <= lern.startMin) return [];
  return termine.filter((t) => verdraengt(lern, t));
}
