// Ein Bild des ASCII-Teichs zeichnen: Kulisse unten (Pflanzen, Wolken), die
// Tiere, Kulisse oben (Seerosen über den Koi), dann auf freien Zellen Wasser
// oder Lichtfeld und die einzelnen Teilchen. Wird von AsciiTeich.tsx je Bild
// aufgerufen; die Rechnung steckt in src/lib.

import {
  beleuchten, rasternProben, zeichenStufe, zellMittel, KULISSE_AB, PALETTEN, ZEICHEN, type Punkt, type Teich,
} from "../lib/asciiTeich";
import { glyphenBild, GLYPHEN, ZEICHEN_BAND } from "../lib/glyphenForm";
import type { Ebene, Kulisse, Teilchen } from "../lib/kulisse";
import { verdecken } from "../lib/teichSeerosen";
import { welleBei, wellenStaerke, wellenZeichen, type Wellen } from "../lib/teichWellen";

export const SCHRIFT_PX = 10;
export const ZEILE_PX = 12;
export const SCHRIFT = `${SCHRIFT_PX}px ui-monospace, SFMono-Regular, Menlo, monospace`;
const DECKKRAFT_MIN = 0.1;    // lichtester Rand
const DECKKRAFT_MAX = 0.3;    // dichteste Mitte
const STUFEN = ZEICHEN.length;
const FARBSTUFEN = 5;         // jede Palette hat fünf Töne, vom Rand zur Mitte
const KULISSE_LEISER = 0.8;   // Pflanzen und Wolken liegen ruhig da, leiser als die Tiere
const WASSER = "175, 205, 230";
const WELLE_DECKKRAFT = [0.05, 0.16] as const;   // leiser als jedes Tier
const WELLE_STUFEN = 4;
const FELD_DECKKRAFT = [0.05, 0.1] as const;     // Glanz, Strahlen, Wind: noch leiser
const TEILCHEN_DECKKRAFT = [0.06, 0.22] as const;
const DECKT_AB = 0.3;         // ab so viel Deckung gilt eine Zelle als belegt
// Die Zeichen füllen nur das obere Band der Schrift; sie werden senkrecht in
// der Zeile mittig gesetzt, und die sechs Proben liegen genau in diesem Band.
const BAND_PX = SCHRIFT_PX * ZEICHEN_BAND;
const OBEN_PX = (ZEILE_PX - BAND_PX) / 2;
const SICHTBAR_AB = 0.05;     // = erste Schwelle von zeichenStufe

/** Sechs Probenstellen je Zelle: 2 Spalten × 3 Zeilen über dem Zeichenband. */
export function probenStellen(zelleB: number): Punkt[] {
  return [1, 3, 5].flatMap((zeile) => [1, 3].map((spalte) => ({
    x: (zelleB * spalte) / 4,
    y: OBEN_PX + (BAND_PX * zeile) / 6,
  })));
}

function deckkraft(stufe: number): number {
  return DECKKRAFT_MIN + ((DECKKRAFT_MAX - DECKKRAFT_MIN) * stufe) / (STUFEN - 1);
}

function farbstufe(stufe: number): number {
  return Math.min(FARBSTUFEN - 1, Math.floor((stufe * FARBSTUFEN) / STUFEN));
}

interface Bild {
  readonly glyphen: Uint8Array;
  readonly hell: Float32Array;
  readonly farbe: Uint8Array;
}

/** Sechs Proben je Zelle → Zeichen nach Form, Helligkeit mit Licht. */
function bildAus(proben: Float32Array, farbe: Uint8Array, spalten: number, zeilen: number, zelleB: number, jeZelle: number): Bild {
  const dichte = zellMittel(proben, jeZelle);
  const hell = beleuchten(dichte, spalten, zeilen, zelleB, ZEILE_PX);
  return { glyphen: glyphenBild(proben, dichte, hell, SICHTBAR_AB), hell, farbe };
}

/** Wo `oben` ein Zeichen hat, gilt `oben`; sonst `unten`. */
function ueberlagern(unten: Bild, oben: Bild): Bild {
  const glyphen = new Uint8Array(unten.glyphen.length);
  const hell = new Float32Array(unten.hell.length);
  const farbe = new Uint8Array(unten.farbe.length);
  for (let i = 0; i < glyphen.length; i++) {
    const quelle = oben.glyphen[i] !== 0 ? oben : unten;
    glyphen[i] = quelle.glyphen[i];
    hell[i] = quelle.hell[i];
    farbe[i] = quelle.farbe[i];
  }
  return { glyphen, hell, farbe };
}

/** Eine gerasterte Ebene der Kulisse — bleibt, bis ihr `stand` weiterzählt. */
export interface Ebenenbild {
  readonly stand: number;
  readonly spalten: number;
  readonly zeilen: number;
  readonly deckung: Float32Array;    // je Probe
  readonly belegt: Float32Array;     // je Zelle
  readonly bild: Bild;
}

export interface Zwischenspeicher {
  readonly unten: Ebenenbild | null;
  readonly oben: Ebenenbild | null;
}

export const LEERER_SPEICHER: Zwischenspeicher = { unten: null, oben: null };

function ebenenbild(
  alt: Ebenenbild | null, ebene: Ebene, spalten: number, zeilen: number, zelleB: number, stellen: readonly Punkt[],
): Ebenenbild {
  if (alt && alt.stand === ebene.stand && alt.spalten === spalten && alt.zeilen === zeilen) return alt;
  const n = stellen.length;
  const r = ebene.rastern(spalten, zeilen, zelleB, ZEILE_PX, stellen);
  return {
    stand: ebene.stand, spalten, zeilen,
    deckung: r.deckung,
    belegt: zellMittel(r.deckung, n),
    bild: bildAus(r.proben, r.farbe, spalten, zeilen, zelleB, n),
  };
}

type Eintrag = { z: string; x: number; y: number };

/** Gebündelt zeichnen: je Stufe einmal die Farbe setzen. */
function zeichneStufen(ctx: CanvasRenderingContext2D, stufen: readonly Eintrag[][], farbe: string, [min, max]: readonly [number, number]): void {
  stufen.forEach((liste, s) => {
    if (liste.length === 0) return;
    ctx.fillStyle = `rgba(${farbe}, ${min + ((max - min) * s) / Math.max(1, stufen.length - 1)})`;
    for (const e of liste) ctx.fillText(e.z, e.x, e.y + OBEN_PX);
  });
}

/**
 * Auf freien Zellen: Wellen, wo welche laufen, sonst das Lichtfeld der
 * Kulisse (Glanz, Strahlen, Wind) — in wenigen Deckkraftstufen gebündelt.
 */
function zeichneUmgebung(
  ctx: CanvasRenderingContext2D, kulisse: Kulisse, wellen: Wellen | null, zeit: number,
  frei: (i: number) => boolean, spalten: number, zeilen: number, zelleB: number,
): void {
  const wellenStufen: Eintrag[][] = Array.from({ length: WELLE_STUFEN }, () => []);
  const feldStufen: Eintrag[][] = [[], [], []];
  const feld = kulisse.feld ? kulisse.feld(spalten, zeilen, zelleB, ZEILE_PX, zeit) : null;
  if (!feld && !wellen) return;
  for (let z = 0; z < zeilen; z++) {
    for (let c = 0; c < spalten; c++) {
      const i = z * spalten + c;
      if (!frei(i)) continue;
      const x = c * zelleB;
      const y = z * ZEILE_PX;
      if (wellen) {
        const h = welleBei(wellen, { x: x + zelleB / 2, y: y + ZEILE_PX / 2 });
        const zeichen = wellenZeichen(h);
        if (zeichen) {
          wellenStufen[Math.min(WELLE_STUFEN - 1, Math.floor(wellenStaerke(h) * WELLE_STUFEN))].push({ z: zeichen, x, y });
          continue;
        }
      }
      const g = feld ? feld[i] : 0;
      if (g <= 0) continue;
      feldStufen[Math.min(feldStufen.length - 1, Math.floor(g * feldStufen.length))].push({ z: kulisse.feldZeichen[g > 0.5 ? 1 : 0], x, y });
    }
  }
  zeichneStufen(ctx, feldStufen, kulisse.feldFarbe, FELD_DECKKRAFT);
  zeichneStufen(ctx, wellenStufen, WASSER, WELLE_DECKKRAFT);
}

/** Einzelne Zeichen (Blasen, Samen, Schnee) — nur auf freien Zellen, ins Raster gesetzt. */
function zeichneTeilchen(
  ctx: CanvasRenderingContext2D, teilchen: readonly Teilchen[], frei: (i: number) => boolean, spalten: number, zeilen: number, zelleB: number,
): void {
  const buendel = new Map<string, Eintrag[][]>();
  for (const t of teilchen) {
    const c = Math.floor(t.x / zelleB);
    const z = Math.floor(t.y / ZEILE_PX);
    if (c < 0 || c >= spalten || z < 0 || z >= zeilen || !frei(z * spalten + c)) continue;
    const stufen = buendel.get(t.farbe) ?? [[], [], [], []];
    stufen[Math.min(3, Math.floor(Math.max(0, t.staerke) * 4))].push({ z: t.zeichen, x: c * zelleB, y: z * ZEILE_PX });
    buendel.set(t.farbe, stufen);
  }
  buendel.forEach((stufen, farbe) => zeichneStufen(ctx, stufen, farbe, TEILCHEN_DECKKRAFT));
}

/** Zeichen nach Palette und Stufe gebündelt: die Farbe wird je Bündel einmal gesetzt. */
function zeichneZeichen(ctx: CanvasRenderingContext2D, bild: Bild, spalten: number, zelleB: number): void {
  const buendel = new Map<number, number[]>();
  for (let i = 0; i < bild.glyphen.length; i++) {
    if (bild.glyphen[i] === 0) continue;
    const schluessel = bild.farbe[i] * STUFEN + Math.max(0, zeichenStufe(bild.hell[i]));
    const liste = buendel.get(schluessel);
    if (liste) liste.push(i);
    else buendel.set(schluessel, [i]);
  }
  buendel.forEach((zellen, schluessel) => {
    const s = schluessel % STUFEN;
    const p = Math.floor(schluessel / STUFEN);
    const palette = PALETTEN[p] ?? PALETTEN[0];
    const leiser = p >= KULISSE_AB ? KULISSE_LEISER : 1;
    ctx.fillStyle = `rgba(${palette[farbstufe(s)]}, ${deckkraft(s) * leiser})`;
    for (const i of zellen) {
      ctx.fillText(GLYPHEN[bild.glyphen[i]], (i % spalten) * zelleB, Math.floor(i / spalten) * ZEILE_PX + OBEN_PX);
    }
  });
}

/** Ein ganzes Bild; gibt die (vielleicht wiederverwendeten) Ebenenbilder zurück. */
export function zeichne(
  ctx: CanvasRenderingContext2D, teich: Teich, zelleB: number, stellen: readonly Punkt[],
  kulisse: Kulisse, wellen: Wellen | null, speicher: Zwischenspeicher,
): Zwischenspeicher {
  const spalten = Math.ceil(teich.breite / zelleB);
  const zeilen = Math.ceil(teich.hoehe / ZEILE_PX);
  const n = stellen.length;
  const tiere = rasternProben(teich, spalten, zeilen, zelleB, ZEILE_PX, stellen);
  const unten = kulisse.unten ? ebenenbild(speicher.unten, kulisse.unten, spalten, zeilen, zelleB, stellen) : null;
  const oben = kulisse.oben ? ebenenbild(speicher.oben, kulisse.oben, spalten, zeilen, zelleB, stellen) : null;
  // Was oben liegt, verdeckt die Tiere; die Tiere verdecken, was unten liegt.
  let bild = bildAus(oben ? verdecken(tiere.proben, oben.deckung) : tiere.proben, tiere.farbe, spalten, zeilen, zelleB, n);
  if (unten) bild = ueberlagern(unten.bild, bild);
  if (oben) bild = ueberlagern(bild, oben.bild);
  ctx.clearRect(0, 0, teich.breite, teich.hoehe);
  zeichneZeichen(ctx, bild, spalten, zelleB);
  // Wasser, Licht und Teilchen nur dort, wo nichts liegt.
  const frei = (i: number) => bild.glyphen[i] === 0
    && (!unten || unten.belegt[i] < DECKT_AB) && (!oben || oben.belegt[i] < DECKT_AB);
  zeichneUmgebung(ctx, kulisse, wellen, teich.zeit, frei, spalten, zeilen, zelleB);
  zeichneTeilchen(ctx, kulisse.teilchen, frei, spalten, zeilen, zelleB);
  return { unten, oben };
}
