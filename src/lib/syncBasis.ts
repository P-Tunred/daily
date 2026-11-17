// Die Versionsmarke, mit der der Browser seinen Gesamtstand hochschickt —
// und die Sprünge, die er selbst ausgelöst hat.
//
// DAS PROBLEM
// src/lib/sync.ts schickt den ganzen Browserstand mit `baseUpdatedAt` hoch.
// Passt die Marke nicht zum Server, kommt 409, und der Browser übernimmt den
// Serverstand ERSETZEND. Alles, was er seit dem letzten Upload geändert hat,
// ist dann weg.
//
// „Bewusst leben" schreibt aber an diesem Weg vorbei, direkt über
// /api/bewusst — und setzt dabei die Marke auf dem Server weiter. Nach jedem
// Routine-Haken kannte der Browser also eine veraltete Marke, und der nächste
// Upload verlor still, was dazwischen passiert war. Gefunden am 2026-10-13:
// Routine abgehakt, dann eine Aufgabe abgehakt — die Aufgabe kam zurück.
//
// DIE LÖSUNG, SO ENG WIE MÖGLICH
// Der Server meldet beim Bewusst-Schreiben, von welcher Marke auf welche er
// gesprungen ist. Der Browser zieht nur nach, wenn er GENAU die Vorher-Marke
// kannte: dann ist der Unterschied zwischen beiden Ständen nur sein eigener
// Bewusst-Wert. Hat dazwischen jemand anderes geschrieben (Hermes, ein zweites
// Gerät), passt die Kette nicht, und der bisherige Schutz greift unverändert.
//
// Ein Sprung, der ankommt, BEVOR der Browser die Vorher-Marke kennt (ein
// eigener Upload war gerade unterwegs), wird gemerkt und eingelöst, sobald
// die Marke stimmt.

export type Spruenge = Readonly<Record<string, string>>;

/** Höchstens so viele offene Sprünge merken — ein Sprung, der nie eingelöst
 *  wird, soll nicht für immer mitlaufen. */
const MAX_SPRUENGE = 20;

/** Folgt allen gemerkten eigenen Sprüngen ab `stand`. */
export function folgeSpruengen(stand: string | null, spruenge: Spruenge): { stand: string | null; spruenge: Spruenge } {
  let aktuell = stand;
  let rest: Record<string, string> = { ...spruenge };
  const gesehen = new Set<string>();
  while (aktuell !== null && rest[aktuell] !== undefined && !gesehen.has(aktuell)) {
    gesehen.add(aktuell);
    const naechster = rest[aktuell];
    const eingeloest = aktuell;
    rest = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== eingeloest));
    aktuell = naechster;
  }
  return { stand: aktuell, spruenge: rest };
}

/** Einen eigenen Sprung merken. Ungültiges wird ignoriert, nicht geraten. */
export function mitSprung(spruenge: Spruenge, vorher: unknown, nachher: unknown): Spruenge {
  if (typeof vorher !== "string" || typeof nachher !== "string" || !vorher || !nachher || vorher === nachher) {
    return spruenge;
  }
  const eintraege = Object.entries({ ...spruenge, [vorher]: nachher });
  return Object.fromEntries(eintraege.slice(-MAX_SPRUENGE));
}

/** Name des Ereignisses, mit dem useBewusst einen Sprung meldet. */
export const STAND_WEITER = "morning:state-advanced";
