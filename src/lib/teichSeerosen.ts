// Seerosen auf dem Koi-Teich — ein paar Blätter, die auf dem Wasser liegen.
//
// WARUM
// Paul, 2026-11-16: „make there be more water and make there be a few
// lilypads". Die Blätter liegen oben auf dem Wasser: Koi schwimmen darunter
// durch und verschwinden dort (AsciiTeich.tsx verdeckt sie). Ein Blatt dreht
// sich kaum merklich, wird von Wellen leicht geschoben, und wer es mit dem
// Mauszeiger berührt, stößt es an — es treibt ein Stück und zieht einen Ring.
//
// FORM
// Ein runder Schild mit Kerbe bis zur Mitte (wie ein echtes Seerosenblatt),
// als Strichzeichnung: Rand und feine Adern von der Mitte aus, innen frei. Auf manchen eine
// Blüte: rosa Blätter, innen gelb. Gezeichnet wird mit denselben sechs Proben
// je Zelle wie die Tiere (lib/glyphenForm.ts). Jeder Schritt gibt neue
// Objekte zurück.

import type { Proben, Punkt, Zufall } from "./asciiTeich.ts";
import { welleBei, type Anstoss, type Wellen } from "./teichWellen.ts";

export const BLATT_PALETTE = 8;
export const BLUETE_PALETTE = 9;

const KERBE = 0.3;               // halbe Breite der Kerbe in rad
const RAND_PX = 4.5;             // so breit ist der erhöhte Rand
const ADERN = 8; 
const RAND = 0.55;
const ADER = 0.26;
const BLUETE_PX = 15;            // Radius der Blüte
const DREHUNG = 0.025;           // rad/s höchstens — kaum merklich
const BREMSE = 0.6;              // je Sekunde: Anstoß verebbt in ~3 s
const ANSTOSS = 34;              // px/s, wenn der Zeiger ein Blatt berührt
const RING = 1.3;                // Wellenhöhe, wenn ein Blatt angestoßen wird
const WELLEN_SCHUB = 26;         // px/s je Wellengefälle
const ABSTAND = 10;              // px Wasser zwischen zwei Blättern

export interface Seerose {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly kerbe: number;        // Richtung der Kerbe
  readonly dreh: number;         // rad/s
  readonly vx: number;
  readonly vy: number;
  readonly bluete: boolean;
  readonly beruehrt: boolean;    // Zeiger liegt gerade darauf
}

/** Wie viele Blätter bei dieser Fensterfläche: wenige, 4–7. */
export function seerosenAnzahl(flaeche: number): number {
  return Math.min(7, Math.max(4, Math.round(flaeche / 220_000)));
}

/**
 * Neue Blätter, nicht übereinander. Seerosen wachsen in Gruppen: die Hälfte
 * liegt nah an einem gemeinsamen Punkt, der Rest verstreut.
 */
export function neueSeerosen(breite: number, hoehe: number, zufall: Zufall = Math.random): Seerose[] {
  const anzahl = seerosenAnzahl(breite * hoehe);
  const gruppe = { x: breite * (0.15 + 0.7 * zufall()), y: hoehe * (0.2 + 0.6 * zufall()) };
  const rosen: Seerose[] = [];
  // Kleine Fenster bekommen kleinere Blätter, damit alle Platz finden.
  const groesse = Math.min(1, Math.sqrt(breite * hoehe) / 1100);
  for (let versuch = 0; rosen.length < anzahl && versuch < 400; versuch++) {
    const r = (56 + 34 * zufall()) * groesse;
    const nah = rosen.length < Math.ceil(anzahl / 2);
    const x = nah ? gruppe.x + (zufall() - 0.5) * 420 : r + zufall() * (breite - 2 * r);
    const y = nah ? gruppe.y + (zufall() - 0.5) * 300 : r + zufall() * (hoehe - 2 * r);
    if (x < r || y < r || x > breite - r || y > hoehe - r) continue;
    if (rosen.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + r + ABSTAND)) continue;
    rosen.push({
      x, y, r,
      kerbe: zufall() * Math.PI * 2,
      dreh: (zufall() - 0.5) * 2 * DREHUNG,
      vx: 0, vy: 0,
      bluete: rosen.length % 3 === 0,
      beruehrt: false,
    });
  }
  return rosen;
}

/** Neue Fenstergröße: Blätter bleiben, wo sie relativ waren. */
export function seerosenAufGroesse(rosen: readonly Seerose[], fx: number, fy: number): Seerose[] {
  return rosen.map((s) => ({ ...s, x: s.x * fx, y: s.y * fy }));
}

function winkelAbstand(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Wo die Blüte sitzt: etwas von der Kerbe weg. */
function blueteMitte(s: Seerose): Punkt {
  return { x: s.x - Math.cos(s.kerbe) * s.r * 0.18, y: s.y - Math.sin(s.kerbe) * s.r * 0.18 };
}

/** Wie sehr der Punkt auf dem Blatt liegt (0..1): 1 auf dem Blatt, 0 im Wasser und in der Kerbe. */
export function blattDeckung(s: Seerose, px: number, py: number): number {
  const d = Math.hypot(px - s.x, py - s.y);
  return d >= s.r ? 0 : deckungAus(s, d, Math.atan2(py - s.y, px - s.x));
}

// d = Abstand zur Mitte, a = Richtung von der Mitte — einmal je Probe gerechnet.
function deckungAus(s: Seerose, d: number, a: number): number {
  const aussen = Math.min(1, (s.r - d) / 1.5);
  if (d < 3) return aussen;
  // Abstand in px zur Kante der Kerbe; weich über 2 px.
  const kerbe = d * Math.sin(Math.max(0, winkelAbstand(a, s.kerbe) - KERBE));
  return aussen * Math.min(1, kerbe / 2);
}

function linienAus(s: Seerose, d: number, a: number): number {
  const rand = s.r - d < RAND_PX ? RAND : 0;
  let ader = Math.max(0, Math.cos((a - s.kerbe) * ADERN));
  ader *= ader; ader *= ader; ader *= ader; ader *= ader;   // hoch 16: schmale Adern
  // Adern nur im mittleren Ring und dort am deutlichsten — reichen sie von
  // der Mitte bis zum Rand, sieht das Blatt aus wie ein Wagenrad.
  const ring = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (d / s.r - 0.2) / 0.65))));
  return rand + ader * ADER * ring;
}

/**
 * Was vom Blatt gezeichnet wird (0..1): nur der Rand und feine Adern von der
 * Mitte aus — wie eine Strichzeichnung. Eine gefüllte Fläche wählte in jeder
 * Zelle dasselbe Zeichen („]]]]"), das wirkte unruhig.
 */
export function blattDichte(s: Seerose, px: number, py: number): number {
  const d = Math.hypot(px - s.x, py - s.y);
  if (d >= s.r) return 0;
  const a = Math.atan2(py - s.y, px - s.x);
  return Math.min(1, linienAus(s, d, a) * deckungAus(s, d, a));
}

/** Dichte der Blüte (0..1): sechs runde Blütenblätter, innen am dichtesten. */
export function blueteDichte(s: Seerose, px: number, py: number): number {
  if (!s.bluete) return 0;
  const m = blueteMitte(s);
  const dx = px - m.x;
  const dy = py - m.y;
  const d = Math.hypot(dx, dy);
  if (d >= BLUETE_PX) return 0;
  const a = Math.atan2(dy, dx) + s.kerbe;
  const umriss = BLUETE_PX * (0.72 + 0.28 * Math.abs(Math.cos(a * 3)));
  return d >= umriss ? 0 : Math.min(1, 0.55 + 0.6 * (1 - d / umriss));
}

export interface BlattRaster extends Proben {
  readonly deckung: Float32Array;  // je Probe: liegt sie auf einem Blatt (0..1)
}

/**
 * Die Blätter rastern wie die Tiere (asciiTeich.rasternProben): je Zelle die
 * Proben an `punkte`; `farbe` ist Blatt oder Blüte, je nachdem, was überwiegt;
 * `deckung` sagt, wo ein Blatt liegt — dort verschwinden Koi und Wasser.
 */
export function rasternSeerosen(
  rosen: readonly Seerose[], spalten: number, zeilen: number, zelleB: number, zelleH: number, punkte: readonly Punkt[],
): BlattRaster {
  const n = punkte.length;
  const proben = new Float32Array(spalten * zeilen * n);
  const deckung = new Float32Array(spalten * zeilen * n);
  const farbe = new Uint8Array(spalten * zeilen);
  for (const s of rosen) {
    const c0 = Math.max(0, Math.floor((s.x - s.r) / zelleB));
    const c1 = Math.min(spalten - 1, Math.floor((s.x + s.r) / zelleB));
    const z0 = Math.max(0, Math.floor((s.y - s.r) / zelleH));
    const z1 = Math.min(zeilen - 1, Math.floor((s.y + s.r) / zelleH));
    for (let z = z0; z <= z1; z++) {
      for (let c = c0; c <= c1; c++) {
        const zelle = z * spalten + c;
        let blatt = 0;
        let bluete = 0;
        for (let j = 0; j < n; j++) {
          const px = c * zelleB + punkte[j].x;
          const py = z * zelleH + punkte[j].y;
          const d = Math.hypot(px - s.x, py - s.y);
          if (d >= s.r) continue;
          const a = Math.atan2(py - s.y, px - s.x);
          const deckt = deckungAus(s, d, a);
          const b = deckt > 0 ? Math.min(1, linienAus(s, d, a) * deckt) : 0;
          const f = blueteDichte(s, px, py);
          const i = zelle * n + j;
          proben[i] = Math.max(proben[i], b, f);
          deckung[i] = Math.max(deckung[i], deckt);
          blatt += b;
          bluete += f;
        }
        if (blatt + bluete > 0) farbe[zelle] = bluete > blatt * 0.5 ? BLUETE_PALETTE : BLATT_PALETTE;
      }
    }
  }
  return { proben, farbe, deckung };
}

/** Koi unter einem Blatt verdecken (`deckung` 0..1): gibt neue Proben zurück. */
export function verdecken(tiere: Float32Array, deckung: Float32Array): Float32Array {
  const sichtbar = new Float32Array(tiere.length);
  for (let i = 0; i < tiere.length; i++) sichtbar[i] = tiere[i] * (1 - deckung[i]);
  return sichtbar;
}

const NEU_AB_PX = 0.75;           // so weit darf ein Rand wandern, bevor neu gerastert wird

/**
 * Haben sich Blätter so weit bewegt oder gedreht, dass ihr Zeichenbild neu
 * gerechnet werden muss? Meist liegen sie still — dann reicht das alte Bild.
 */
export function seerosenVerschoben(alt: readonly Seerose[], neu: readonly Seerose[]): boolean {
  if (alt.length !== neu.length) return true;
  return neu.some((s, i) => {
    const a = alt[i];
    return Math.hypot(s.x - a.x, s.y - a.y) > NEU_AB_PX || Math.abs(s.kerbe - a.kerbe) * s.r > NEU_AB_PX;
  });
}

export interface SeerosenSchritt {
  readonly rosen: Seerose[];
  readonly anstoesse: Anstoss[];
}

function haltImBild(wert: number, geschw: number, rand: number, groesse: number): number {
  if (wert < rand) return Math.abs(geschw);
  if (wert > groesse - rand) return -Math.abs(geschw);
  return geschw;
}

/**
 * Die Blätter um dt Sekunden weiterrechnen: langsam drehen, von Wellen und
 * vom Zeiger geschoben treiben, nicht aus dem Bild und nicht übereinander.
 * Gibt auch die Wellen zurück, die ein angestoßenes Blatt macht.
 */
export function seerosenSchritt(
  rosen: readonly Seerose[], dt: number, breite: number, hoehe: number, maus: Punkt | null, wellen: Wellen | null,
): SeerosenSchritt {
  const anstoesse: Anstoss[] = [];
  const bremse = Math.exp(-BREMSE * dt);
  const bewegt = rosen.map((s) => {
    let vx = s.vx * bremse;
    let vy = s.vy * bremse;
    const abstand = maus ? Math.hypot(maus.x - s.x, maus.y - s.y) : Infinity;
    const beruehrt = maus !== null && abstand < s.r;
    if (beruehrt && !s.beruehrt && maus) {
      const ax = abstand > 0 ? (s.x - maus.x) / abstand : 1;
      const ay = abstand > 0 ? (s.y - maus.y) / abstand : 0;
      vx += ax * ANSTOSS;
      vy += ay * ANSTOSS;
      anstoesse.push({ x: maus.x, y: maus.y, hoehe: RING });
    }
    if (wellen) {
      const gx = welleBei(wellen, { x: s.x + s.r, y: s.y }) - welleBei(wellen, { x: s.x - s.r, y: s.y });
      const gy = welleBei(wellen, { x: s.x, y: s.y + s.r }) - welleBei(wellen, { x: s.x, y: s.y - s.r });
      vx -= gx * WELLEN_SCHUB * dt;
      vy -= gy * WELLEN_SCHUB * dt;
    }
    vx = haltImBild(s.x, vx, s.r * 0.5, breite);
    vy = haltImBild(s.y, vy, s.r * 0.5, hoehe);
    return { ...s, x: s.x + vx * dt, y: s.y + vy * dt, vx, vy, kerbe: s.kerbe + s.dreh * dt, beruehrt };
  });
  // Überlappende Blätter schieben sich sanft auseinander.
  const rosenNeu = bewegt.map((s, i) => {
    let { vx, vy } = s;
    bewegt.forEach((o, j) => {
      if (i === j) return;
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const ueber = s.r + o.r + 2 - d;
      if (ueber > 0) {
        vx += (dx / d) * ueber * 4 * dt;
        vy += (dy / d) * ueber * 4 * dt;
      }
    });
    return vx === s.vx && vy === s.vy ? s : { ...s, vx, vy };
  });
  return { rosen: rosenNeu, anstoesse };
}
