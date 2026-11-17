// Merken, dass Paul dazwischenredet — während das Hörbriefing läuft oder
// Hermes antwortet.
//
// DAS PROBLEM: DAS ECHO
// Über Lautsprecher hört das Mikrofon das Briefing mit. Die Echo-Unterdrückung
// des Browsers nimmt viel davon weg, aber nicht alles. Eine feste Schwelle
// würde deshalb entweder beim Echo auslösen (das Briefing unterbricht sich
// selbst) oder Paul überhören.
//
// DIE LÖSUNG: EINE HÜLLE, DIE DAS ECHO LERNT
// Gemerkt wird, wie laut es zuletzt höchstens war (eine Hüllkurve, die mit
// 1,5 s Halbwertszeit abfällt). Ausgelöst wird erst, wenn der Pegel eine
// Weile deutlich DARÜBER liegt — Paul ist näher am Mikrofon als der
// Lautsprecher. Solange ein Kandidat läuft, lernt die Hülle nicht mit, sonst
// hielte sie Pauls eigene Stimme für Echo. Mit Kopfhörern gibt es kaum Echo,
// dann reicht die Mindestschwelle.
//
// Rein und unveränderlich (tests/stimme-dazwischen.test.mjs). Die Werte sind
// ein Anfang; mit Pauls echtem Mikrofon nachzustellen.

export const MIN_PEGEL = 0.03;
export const FAKTOR = 2.2;
export const AUSLOESEN_MS = 300;
export const EINSCHWINGEN_MS = 800;
const HALBWERT_MS = 1500;

export interface LauschZustand {
  readonly huelle: number;
  readonly lautMs: number;
  readonly seitMs: number;
}

export const LAUSCHEN: LauschZustand = Object.freeze({ huelle: 0, lautMs: 0, seitMs: 0 });

export function lauschSchritt(z: LauschZustand, pegel: number, dtMs: number): { zustand: LauschZustand; ausgeloest: boolean } {
  const seitMs = z.seitMs + dtMs;
  const schwelle = Math.max(MIN_PEGEL, z.huelle * FAKTOR);
  if (seitMs > EINSCHWINGEN_MS && pegel > schwelle) {
    const lautMs = z.lautMs + dtMs;
    if (lautMs >= AUSLOESEN_MS) return { zustand: { ...z, lautMs: 0, seitMs }, ausgeloest: true };
    return { zustand: { ...z, lautMs, seitMs }, ausgeloest: false };
  }
  const abfall = Math.pow(0.5, dtMs / HALBWERT_MS);
  return { zustand: { huelle: Math.max(pegel, z.huelle * abfall), lautMs: 0, seitMs }, ausgeloest: false };
}
