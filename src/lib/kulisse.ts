// Kulisse — was um die Tiere herum ist: Wasser und Seerosen beim Koi, eine
// Wiese für die Falter, Tiefsee für die Quallen, Wolken unter den Vögeln.
//
// WARUM
// Paul, 2026-11-16, nach den Seerosen im Koi-Teich: „Now try to make things
// as nice for all the other aspects". Jedes Tier bekommt seine Umgebung, in
// derselben leisen Art: Pflanzen und Wolken aus Zeichen nach Form
// (lib/glyphenForm.ts), dazu einzelne Teilchen (Blasen, Samen, Schnee) und ein
// ziehendes Lichtfeld (Glanz, Lichtstrahlen, Wind).
//
// WIE
// Eine Kulisse ist ein unveränderlicher Wert: `weiter` gibt die nächste
// zurück. Die Ebenen „unten" (unter den Tieren) und „oben" (verdeckt sie)
// tragen einen `stand`, der nur weiterzählt, wenn sich das Bild merklich
// ändert — so rastert AsciiTeich.tsx Pflanzen und Wolken nur dann neu.
// Die einzelnen Kulissen: kulisseTeich.ts, kulisseWiese.ts,
// kulisseTiefsee.ts, kulisseHimmel.ts; welche zu welchem Tier: kulissen.ts.

import { inKapsel, type Kapsel, type Proben, type Punkt, type Teich, type Zufall } from "./asciiTeich.ts";
import type { Anstoss, Wellen } from "./teichWellen.ts";

/** Gerasterte Ebene: Proben und Farbe wie bei den Tieren, dazu wo sie etwas verdeckt. */
export interface Schichtraster extends Proben {
  readonly deckung: Float32Array;  // je Probe 0..1
}

export interface Ebene {
  readonly stand: number;
  readonly rastern: (spalten: number, zeilen: number, zelleB: number, zelleH: number, punkte: readonly Punkt[]) => Schichtraster;
}

/** Ein einzelnes Zeichen: Blase, Samen, Schneeflocke, Pollen. */
export interface Teilchen {
  readonly x: number;
  readonly y: number;
  readonly zeichen: string;
  readonly staerke: number;   // 0..1 → Deckkraft
  readonly farbe: string;     // "r, g, b"
}

/** Ein ziehendes Lichtfeld je Zelle: 0 = nichts, sonst 0..1. */
export type Feld = (spalten: number, zeilen: number, zelleB: number, zelleH: number, zeit: number) => Float32Array;

export interface Weiter {
  readonly dt: number;
  readonly vorher: Teich;
  readonly nachher: Teich;
  readonly maus: Punkt | null;
  readonly wellen: Wellen | null;
  readonly zufall: Zufall;
}

export interface Kulisse {
  readonly wasser: boolean;               // Wellen laufen (Koi, Libellen)
  readonly unten: Ebene | null;
  readonly oben: Ebene | null;
  readonly teilchen: readonly Teilchen[];
  readonly ziele: readonly Punkt[];       // Landeplätze für Libellen und Falter
  readonly feld: Feld | null;
  readonly feldZeichen: readonly [string, string];   // schwach, stark
  readonly feldFarbe: string;
  readonly weiter: (w: Weiter) => { readonly kulisse: Kulisse; readonly anstoesse: readonly Anstoss[] };
  /** Neue Fenstergröße: fx, fy = neu / alt; alles bleibt, wo es relativ war. */
  readonly aufGroesse: (fx: number, fy: number, breite: number, hoehe: number) => Kulisse;
}

/** Eine Pflanze oder Wolke aus Kapseln in einer Palette. */
export interface Gestalt {
  readonly kapseln: readonly Kapsel[];
  readonly palette: number;
}

const UMRISS_BAND = 0.16;   // Anteil des Radius, der als Umriss gezeichnet wird

/**
 * Gestalten rastern wie die Tiere (asciiTeich.rasternProben). Mit `umriss`
 * wird nur der Rand gezeichnet (Wolken) — über alle Gestalten zusammen, damit
 * sich überlappende Wolken nicht gegenseitig durchschneiden.
 */
export function rasternGestalten(
  gestalten: readonly Gestalt[], spalten: number, zeilen: number, zelleB: number, zelleH: number,
  punkte: readonly Punkt[], umriss = false,
): Schichtraster {
  const n = punkte.length;
  const roh = new Float32Array(spalten * zeilen * n);
  const farbe = new Uint8Array(spalten * zeilen);
  const staerkste = new Float32Array(spalten * zeilen);
  for (const g of gestalten) {
    for (const k of g.kapseln) {
      const r = Math.max(k.ra, k.rb);
      const c0 = Math.max(0, Math.floor((Math.min(k.ax, k.bx) - r) / zelleB));
      const c1 = Math.min(spalten - 1, Math.floor((Math.max(k.ax, k.bx) + r) / zelleB));
      const z0 = Math.max(0, Math.floor((Math.min(k.ay, k.by) - r) / zelleH));
      const z1 = Math.min(zeilen - 1, Math.floor((Math.max(k.ay, k.by) + r) / zelleH));
      for (let z = z0; z <= z1; z++) {
        for (let c = c0; c <= c1; c++) {
          const zelle = z * spalten + c;
          for (let j = 0; j < n; j++) {
            const v = inKapsel(k, c * zelleB + punkte[j].x, z * zelleH + punkte[j].y);
            const i = zelle * n + j;
            if (v > roh[i]) roh[i] = v;
            if (v > staerkste[zelle]) {
              staerkste[zelle] = v;
              farbe[zelle] = g.palette;
            }
          }
        }
      }
    }
  }
  const deckung = new Float32Array(roh.length);
  const proben = umriss ? new Float32Array(roh.length) : roh;
  for (let i = 0; i < roh.length; i++) {
    const v = roh[i];
    if (v <= 0) continue;
    deckung[i] = Math.min(1, v * 10);
    if (umriss) proben[i] = v < UMRISS_BAND ? 0.6 * Math.sin((Math.PI * v) / UMRISS_BAND) : 0;
  }
  return { proben, farbe, deckung };
}

/** Kapsel als Strecke vom Punkt in Richtung `winkel`. */
export function strecke(x: number, y: number, winkel: number, lang: number, ra: number, rb: number): Kapsel {
  return { ax: x, ay: y, bx: x + Math.cos(winkel) * lang, by: y + Math.sin(winkel) * lang, ra, rb };
}

/** Einen Wert in [-rand, groesse + rand) umlaufen lassen. */
export function umlaufend(wert: number, groesse: number, rand: number): number {
  const spanne = groesse + 2 * rand;
  return ((((wert + rand) % spanne) + spanne) % spanne) - rand;
}

/** Ein Stand, der weiterzählt, sobald seit dem letzten Rastern `faellig` gilt. */
export function naechsterStand(stand: number, faellig: boolean): number {
  return faellig ? stand + 1 : stand;
}
