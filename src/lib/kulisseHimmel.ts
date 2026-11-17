// Kulisse Himmel — für die Vögel, von oben gesehen: Wolken ziehen tief unter
// dem Schwarm, nur ihr Umriss ist gezeichnet; dazu feine Windstriche, die in
// Zugrichtung vorbeiwischen.
//
// Die Wolken ziehen langsamer als die Vögel in dieselbe Richtung — so wirkt
// der Schwarm hoch darüber.

import type { Zufall } from "./asciiTeich.ts";
import { naechsterStand, rasternGestalten, umlaufend, type Gestalt, type Kulisse, type Weiter } from "./kulisse.ts";

const WOLKE = 14;
const WOLKEN_RAND = 220;           // px: so weit dürfen Wolken aus dem Bild, bevor sie gegenüber auftauchen
const NEU_AB_PX = 0.75;
export const WIND_FARBE = "222, 230, 242";
const WIND_AB = 0.9;
const WIND_TEMPO = 70;             // px/s, mit denen die Windstriche wischen

interface Bausch {
  readonly dx: number;
  readonly dy: number;
  readonly r: number;
}

export interface Wolke {
  readonly x: number;
  readonly y: number;
  readonly tempo: number;
  readonly bausche: readonly Bausch[];
}

export interface Himmel {
  readonly breite: number;
  readonly hoehe: number;
  readonly zeit: number;
  readonly richtung: number;       // +1 nach rechts, −1 nach links
  readonly wolken: readonly Wolke[];
}

export function neuerHimmel(breite: number, hoehe: number, richtung: number, zufall: Zufall = Math.random): Himmel {
  const anzahl = Math.min(5, Math.max(3, Math.round((breite * hoehe) / 350_000)));
  const wolken = Array.from({ length: anzahl }, (_, i) => {
    const zahl = 4 + Math.floor(zufall() * 4);
    const bausche: Bausch[] = Array.from({ length: zahl }, (_, k) => ({
      dx: (k - zahl / 2) * 38 + (zufall() - 0.5) * 20,
      dy: (zufall() - 0.5) * 50,
      r: 30 + 32 * zufall(),
    }));
    return {
      x: ((i + zufall()) / anzahl) * breite,
      y: hoehe * (0.12 + 0.76 * zufall()),
      tempo: 7 + 6 * zufall(),
      bausche,
    };
  });
  return { breite, hoehe, zeit: 0, richtung: richtung >= 0 ? 1 : -1, wolken };
}

export function wolkenGestalten(himmel: Himmel): Gestalt[] {
  return himmel.wolken.map((w) => ({
    palette: WOLKE,
    kapseln: w.bausche.map((b) => ({ ax: w.x + b.dx, ay: w.y + b.dy, bx: w.x + b.dx, by: w.y + b.dy, ra: b.r, rb: b.r })),
  }));
}

export function himmelSchritt(himmel: Himmel, dt: number): Himmel {
  return {
    ...himmel,
    zeit: himmel.zeit + dt,
    wolken: himmel.wolken.map((w) => ({ ...w, x: umlaufend(w.x + w.tempo * himmel.richtung * dt, himmel.breite, WOLKEN_RAND) })),
  };
}

/** Windstriche: lange, dünne Streifen, die in Zugrichtung wischen. */
export function windFeld(richtung: number) {
  return (spalten: number, zeilen: number, zelleB: number, zelleH: number, zeit: number): Float32Array => {
    const feld = new Float32Array(spalten * zeilen);
    for (let z = 0; z < zeilen; z++) {
      const y = z * zelleH;
      const zeile = Math.sin(y * 0.13 + Math.sin(y * 0.011) * 3);
      if (zeile < 0.5) continue;   // nur jede paar Zeilen ein Strich
      for (let c = 0; c < spalten; c++) {
        const x = c * zelleB - zeit * WIND_TEMPO * richtung;
        const v = zeile * Math.sin(x * 0.009 + y * 0.37 + Math.sin(x * 0.0017 + y) * 2);
        if (v > WIND_AB) feld[z * spalten + c] = (v - WIND_AB) / (1 - WIND_AB);
      }
    }
    return feld;
  };
}

function verschoben(alt: Himmel, neu: Himmel): boolean {
  return neu.wolken.some((w, i) => Math.abs(w.x - alt.wolken[i].x) > NEU_AB_PX);
}

function bauen(himmel: Himmel, gerastert: Himmel, stand: number): Kulisse {
  return {
    wasser: false,
    unten: { stand, rastern: (sp, ze, zb, zh, punkte) => rasternGestalten(wolkenGestalten(himmel), sp, ze, zb, zh, punkte, true) },
    oben: null,
    teilchen: [],
    ziele: [],
    feld: windFeld(himmel.richtung),
    feldZeichen: ["-", "-"],
    feldFarbe: WIND_FARBE,
    weiter: ({ dt }: Weiter) => {
      const neu = himmelSchritt(himmel, dt);
      const faellig = verschoben(gerastert, neu);
      return { kulisse: bauen(neu, faellig ? neu : gerastert, naechsterStand(stand, faellig)), anstoesse: [] };
    },
    aufGroesse: (fx, fy, breite, hoehe) => {
      const neu = { ...himmel, breite, hoehe, wolken: himmel.wolken.map((w) => ({ ...w, x: w.x * fx, y: w.y * fy })) };
      return bauen(neu, neu, stand + 1);
    },
  };
}

/** `richtung`: wohin der Schwarm zieht (+1 rechts, −1 links). */
export function himmelKulisse(breite: number, hoehe: number, richtung: number, zufall: Zufall = Math.random): Kulisse {
  const himmel = neuerHimmel(breite, hoehe, richtung, zufall);
  return bauen(himmel, himmel, 0);
}
