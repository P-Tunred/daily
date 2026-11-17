// Kulisse Teich — für Koi und Libellen: Wasser mit Tropfen, Glanz und
// Seerosen (lib/teichSeerosen.ts, lib/teichWellen.ts).
//
// Koi schwimmen unter den Blättern (Ebene oben, sie verdeckt), Libellen
// fliegen darüber (Ebene unten) und landen gern auf einem Blatt. Wo eine
// Libelle anderswo ankommt, tippt sie aufs Wasser — ein kleiner Ring.

import type { Art, Punkt, Teich, Zufall } from "./asciiTeich.ts";
import type { Ebene, Kulisse, Weiter } from "./kulisse.ts";
import {
  blattDeckung, neueSeerosen, rasternSeerosen, seerosenAufGroesse, seerosenSchritt, seerosenVerschoben, type Seerose,
} from "./teichSeerosen.ts";
import { anstoesse, glanzFeld, tropfen, type Anstoss } from "./teichWellen.ts";

export const WASSER_FARBE = "175, 205, 230";
const TIPPEN = 0.9;                // Ring, wo eine Libelle aufs Wasser tippt

/** Wo eine Libelle gerade angekommen ist und nicht auf einem Blatt sitzt. */
export function eintauchen(vorher: Teich, nachher: Teich, rosen: readonly Seerose[]): Anstoss[] {
  const ringe: Anstoss[] = [];
  nachher.wesen.forEach((w, i) => {
    const alt = vorher.wesen[i];
    if (w.art !== "libelle" || !alt || alt.warten > 0 || w.warten <= 0) return;
    if (rosen.some((s) => blattDeckung(s, w.x, w.y) > 0)) return;
    ringe.push({ x: w.x, y: w.y, hoehe: TIPPEN });
  });
  return ringe;
}

/** Landeplätze: auf jedem Blatt etwas neben der Mitte, wo keine Blüte ist. */
function landeplaetze(rosen: readonly Seerose[]): Punkt[] {
  return rosen.map((s) => ({ x: s.x + Math.cos(s.kerbe + Math.PI * 0.8) * s.r * 0.35, y: s.y + Math.sin(s.kerbe + Math.PI * 0.8) * s.r * 0.35 }));
}

function bauen(art: Art, rosen: readonly Seerose[], gerastert: readonly Seerose[], stand: number): Kulisse {
  const ebene: Ebene = { stand, rastern: (sp, ze, zb, zh, punkte) => rasternSeerosen(rosen, sp, ze, zb, zh, punkte) };
  const koi = art === "koi";
  return {
    wasser: true,
    unten: koi ? null : ebene,
    oben: koi ? ebene : null,
    teilchen: [],
    ziele: koi ? [] : landeplaetze(rosen),
    feld: glanzFeld,
    feldZeichen: ["-", "~"],
    feldFarbe: WASSER_FARBE,
    weiter: ({ dt, vorher, nachher, maus, wellen, zufall }: Weiter) => {
      const blaetter = seerosenSchritt(rosen, dt, nachher.breite, nachher.hoehe, maus, wellen);
      const neu = [
        ...anstoesse(vorher, nachher),
        ...eintauchen(vorher, nachher, blaetter.rosen),
        ...blaetter.anstoesse,
        ...tropfen(nachher.breite, nachher.hoehe, dt, zufall),
      ];
      const faellig = seerosenVerschoben(gerastert, blaetter.rosen);
      return {
        kulisse: bauen(art, blaetter.rosen, faellig ? blaetter.rosen : gerastert, faellig ? stand + 1 : stand),
        anstoesse: neu,
      };
    },
    aufGroesse: (fx, fy) => {
      const neu = seerosenAufGroesse(rosen, fx, fy);
      return bauen(art, neu, neu, stand + 1);
    },
  };
}

/** Teich für Koi oder Libellen. */
export function teichKulisse(art: Art, breite: number, hoehe: number, zufall: Zufall = Math.random): Kulisse {
  const rosen = neueSeerosen(breite, hoehe, zufall);
  return bauen(art, rosen, rosen, 0);
}
