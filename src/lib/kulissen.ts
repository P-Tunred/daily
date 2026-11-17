// Welche Kulisse zu welchem Tier gehört (lib/kulisse.ts erklärt, was eine Kulisse ist).

import type { Art, Teich, Zufall } from "./asciiTeich.ts";
import type { Kulisse } from "./kulisse.ts";
import { himmelKulisse } from "./kulisseHimmel.ts";
import { teichKulisse } from "./kulisseTeich.ts";
import { tiefseeKulisse } from "./kulisseTiefsee.ts";
import { wiesenKulisse } from "./kulisseWiese.ts";

/** Wohin der Schwarm im Mittel zieht: +1 rechts, −1 links. */
function zugrichtung(teich: Teich): number {
  const summe = teich.wesen.reduce((s, w) => s + Math.cos(w.winkel), 0);
  return summe >= 0 ? 1 : -1;
}

export function neueKulisse(art: Art, teich: Teich, zufall: Zufall = Math.random): Kulisse {
  const { breite, hoehe } = teich;
  switch (art) {
    case "koi":
    case "libelle":
      return teichKulisse(art, breite, hoehe, zufall);
    case "schmetterling":
      return wiesenKulisse(breite, hoehe, zufall);
    case "qualle":
      return tiefseeKulisse(breite, hoehe, zufall);
    case "vogel":
      return himmelKulisse(breite, hoehe, zugrichtung(teich), zufall);
  }
}
