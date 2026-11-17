// Wellen auf dem Koi-Teich — leise Kreise, wo ein Koi erschrickt.
//
// WARUM
// Paul, 2026-11-16: „make it look even better". Ein Koi, der beim Berühren
// davonschießt, macht im echten Teich einen Schwall. Hier: ein Ring, der sich
// ausbreitet, und eine schwache Kielwelle, solange er flieht. Nur beim Koi —
// Libellen, Falter und Vögel sind in der Luft, Quallen tief im Wasser.
//
// WIE
// Das klassische 2D-Wasser von Hugo Elias: zwei Höhenfelder im Wechsel; neue
// Höhe = halbe Summe der vier Nachbarn − Höhe von vorvorhin, dann gedämpft.
// Das Feld hat quadratische Zellen (WELLE_PX), damit die Ringe rund bleiben,
// obwohl die Schriftzellen doppelt so hoch wie breit sind. Jeder Schritt gibt
// neue Felder zurück.

import type { Punkt, Teich, Zufall } from "./asciiTeich.ts";

export const WELLE_PX = 12;
const DAEMPFUNG = 0.955;         // je Schritt; ein Ring ist nach ~1,5 s verebbt
const SCHWALL = 2.4;             // Höhe beim Berühren
const KIELWELLE = 0.5;           // Höhe hinter einem fliehenden Koi
const KIEL_AB_SCHRECK = 0.35;
const RUHIGE_KIELWELLE = 0.05;   // ruhiger Koi dicht unter der Oberfläche
const RUHIG_AB_TIEFE = 0.75;
const TROPFEN_JE_S = 0.9;        // Tropfen, Mücken, ein fallendes Blatt …
const TROPFEN = 1.1;

export interface Wellen {
  readonly spalten: number;
  readonly zeilen: number;
  readonly jetzt: Float32Array;
  readonly vorher: Float32Array;
}

export interface Anstoss {
  readonly x: number;
  readonly y: number;
  readonly hoehe: number;
}

export function neueWellen(breite: number, hoehe: number): Wellen {
  const spalten = Math.max(3, Math.ceil(breite / WELLE_PX));
  const zeilen = Math.max(3, Math.ceil(hoehe / WELLE_PX));
  return { spalten, zeilen, jetzt: new Float32Array(spalten * zeilen), vorher: new Float32Array(spalten * zeilen) };
}

/** Wo dieser Zeitschritt das Wasser anstößt: Schwall beim Schreck, Kielwelle beim Fliehen. */
export function anstoesse(vorher: Teich, nachher: Teich): Anstoss[] {
  const liste: Anstoss[] = [];
  nachher.wesen.forEach((w, i) => {
    if (w.art !== "koi") return;
    const alt = vorher.wesen[i];
    if (alt && alt.schreck < 0.99 && w.schreck >= 0.99) {
      liste.push({ x: w.x, y: w.y, hoehe: SCHWALL });
    } else if (w.schreck > KIEL_AB_SCHRECK) {
      liste.push({ x: w.x, y: w.y, hoehe: KIELWELLE * w.schreck });
    } else if (w.tiefe > RUHIG_AB_TIEFE) {
      // Auch ein ruhiger Koi nah an der Oberfläche kräuselt das Wasser leicht.
      liste.push({ x: w.x, y: w.y, hoehe: RUHIGE_KIELWELLE * w.tiefe });
    }
  });
  return liste;
}

/** Einen Zeitschritt weiterrechnen; Anstöße wirken auf eine Zelle und ihre Nachbarn. */
export function wellenSchritt(wellen: Wellen, neu: readonly Anstoss[]): Wellen {
  const { spalten, zeilen, jetzt, vorher } = wellen;
  const feld = new Float32Array(jetzt.length);
  for (let z = 1; z < zeilen - 1; z++) {
    for (let c = 1; c < spalten - 1; c++) {
      const i = z * spalten + c;
      feld[i] = ((jetzt[i - 1] + jetzt[i + 1] + jetzt[i - spalten] + jetzt[i + spalten]) / 2 - vorher[i]) * DAEMPFUNG;
    }
  }
  for (const a of neu) {
    const c = Math.round(a.x / WELLE_PX);
    const z = Math.round(a.y / WELLE_PX);
    if (c < 1 || c >= spalten - 1 || z < 1 || z >= zeilen - 1) continue;
    const i = z * spalten + c;
    feld[i] += a.hoehe;
    feld[i - 1] += a.hoehe / 2;
    feld[i + 1] += a.hoehe / 2;
    feld[i - spalten] += a.hoehe / 2;
    feld[i + spalten] += a.hoehe / 2;
  }
  return { spalten, zeilen, jetzt: feld, vorher: jetzt };
}

/** Höhe der Welle unter einem Punkt (für die Schriftzellen). */
export function welleBei(wellen: Wellen, p: Punkt): number {
  const c = Math.floor(p.x / WELLE_PX);
  const z = Math.floor(p.y / WELLE_PX);
  if (c < 0 || c >= wellen.spalten || z < 0 || z >= wellen.zeilen) return 0;
  return wellen.jetzt[z * wellen.spalten + c];
}

/** Zeichen für eine Wellenhöhe: Kamm ~, Tal _ ; zu flach → null. */
export const WELLEN_ZEICHEN = ["~", "-", "_"] as const;
const WELLE_SICHTBAR = 0.09;

export function wellenZeichen(h: number): (typeof WELLEN_ZEICHEN)[number] | null {
  if (Math.abs(h) < WELLE_SICHTBAR) return null;
  if (h > WELLE_SICHTBAR * 3) return "~";
  if (h < -WELLE_SICHTBAR * 3) return "_";
  return "-";
}

/** Deckkraft 0..1 für eine Wellenhöhe — sanft, nie so deutlich wie ein Tier. */
export function wellenStaerke(h: number): number {
  return Math.min(1, Math.abs(h) / 1.2);
}

// ── Mehr Wasser ─────────────────────────────────────────────────────────────
// Paul, 2026-11-16: „make there be more water". Ein echter Teich ist nie ganz
// still: ab und zu fällt ein Tropfen (ein kleiner Ring), und Licht spiegelt
// sich in langen, langsam ziehenden Bändern auf der Oberfläche.

/** Zufällige Tropfen in diesem Zeitschritt — im Mittel TROPFEN_JE_S je Sekunde. */
export function tropfen(breite: number, hoehe: number, dt: number, zufall: Zufall): Anstoss[] {
  if (zufall() >= TROPFEN_JE_S * dt) return [];
  return [{ x: zufall() * breite, y: zufall() * hoehe, hoehe: TROPFEN * (0.6 + 0.4 * zufall()) }];
}

const GLANZ_AB = 0.8;            // nur die hellsten Stellen glänzen
export const GLANZ_ZEICHEN = ["-", "~"] as const;

/**
 * Lichtglanz auf dem Wasser an (x, y) zur Zeit t: 0 = nichts, sonst 0..1.
 * Zwei schräg laufende, leicht gewellte Bänder, die sich überlagern — so
 * entstehen kurze, waagerechte Glanzstriche, die langsam wandern.
 */
export function glanz(x: number, y: number, t: number): number {
  return glanzAus(spaltenWelle(x, t), zeilenWelle(y, t), x, y, t);
}

// Die inneren Wellen hängen nur von x bzw. y ab: einmal je Spalte und Zeile.
function spaltenWelle(x: number, t: number): number {
  return Math.sin(x * 0.011 + t * 0.23) * 1.6;
}
function zeilenWelle(y: number, t: number): number {
  return Math.sin(y * 0.017 - t * 0.17) * 2.1;
}
// Mit b ≤ 1 kann v die Schwelle nur erreichen, wenn a groß genug ist.
const A_MINDESTENS = (GLANZ_AB - 0.35) / 0.65;

function glanzAus(spalte: number, zeile: number, x: number, y: number, t: number): number {
  const a = Math.sin(y * 0.045 + x * 0.006 + spalte - t * 0.31);
  if (a <= A_MINDESTENS) return 0;
  const b = Math.sin(y * 0.021 - x * 0.009 + zeile + t * 0.19);
  const v = a * 0.65 + b * 0.35;
  return v <= GLANZ_AB ? 0 : (v - GLANZ_AB) / (1 - GLANZ_AB);
}

/** Glanz für ein ganzes Zeichenraster (je Zelle an ihrer linken oberen Ecke) — gleiche Werte wie glanz(). */
export function glanzFeld(spalten: number, zeilen: number, zelleB: number, zelleH: number, t: number): Float32Array {
  const feld = new Float32Array(spalten * zeilen);
  const sw = Array.from({ length: spalten }, (_, c) => spaltenWelle(c * zelleB, t));
  for (let z = 0; z < zeilen; z++) {
    const y = z * zelleH;
    const zw = zeilenWelle(y, t);
    for (let c = 0; c < spalten; c++) feld[z * spalten + c] = glanzAus(sw[c], zw, c * zelleB, y, t);
  }
  return feld;
}
