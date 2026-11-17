// Wann eine geplante Aufgabe „später" ist — für die Wochenliste.
//
// Hermes kann eine Aufgabe für einen bestimmten Tag eintragen (`geplantAm`,
// siehe electron/hermesApi.cjs). Bis zu diesem Tag wartet sie in der
// Wochenliste; electron/dayStart.cjs schiebt sie am Morgen in den Tag. Liegt
// der Tag erst nach dieser Woche, gehört sie aber nicht zwischen die Dinge,
// die DIESE Woche dran sind — sonst wird „Diese Woche" zur Liste von allem.

/** Sonntag der Woche (Mo–So), in der `heute` liegt. */
export function endeDerWoche(heute: string): string {
  const d = new Date(heute + "T12:00:00Z");
  const wochentag = (d.getUTCDay() + 6) % 7; // 0 = Montag
  d.setUTCDate(d.getUTCDate() + (6 - wochentag));
  return d.toISOString().slice(0, 10);
}

/** Erst nach dieser Woche dran? Ohne Datum nie — dann ist es ein Wochenpunkt. */
export function spaeterAlsDieseWoche(geplantAm: string | undefined, heute: string): boolean {
  return typeof geplantAm === "string" && geplantAm > endeDerWoche(heute);
}

const TAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

/** „Do 12.11." — kurz genug für eine Zeile in der Wochenliste. Von Hand statt
 *  toLocaleDateString: das liefert „Do., 12.11." mit einem Punkt, der in der
 *  versalen Meta-Zeile wie ein Fehler aussieht. */
export function kurzesDatum(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return `${TAG_KURZ[d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}
