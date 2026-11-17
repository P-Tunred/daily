// Kulisse Wiese — für die Falter: von oben gesehen ein paar Blüten und
// Grasbüschel, die im Wind nicken, dazu treibende Pusteblumen-Samen.
//
// Falter fliegen die Blüten gern an (Teich.ziele). Wer eine Blüte mit dem
// Mauszeiger berührt, bringt sie zum Wippen, und ein wenig Pollen stäubt.

import type { Punkt, Zufall } from "./asciiTeich.ts";
import { naechsterStand, rasternGestalten, strecke, umlaufend, type Gestalt, type Kulisse, type Teilchen, type Weiter } from "./kulisse.ts";

const BLATT = 8;
const MITTE = 10;
const BLUETEN = [11, 9, 12] as const;    // Margerite, Rosa, Glockenblume
const WIND_TAKT = 0.15;                 // s: so oft wird das Nicken neu gerastert
const WIPPEN = 0.5;                     // rad beim Berühren
const WIPP_FEDER = 9;                   // 1/s²: so schnell schwingt eine Blüte zurück
const WIPP_DAEMPFUNG = 2.2;             // 1/s
const SAMEN_TEMPO = 14;                 // px/s mit dem Wind
const POLLEN_LEBEN = 1.6;               // s
const BLUETEN_ABSTAND = 130;            // px zwischen zwei Blüten
const SAMEN_FARBE = "244, 240, 228";
const POLLEN_FARBE = "246, 222, 140";

export interface Blume {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly blaetter: number;       // Zahl der Blütenblätter
  readonly palette: number;
  readonly drehung: number;
  readonly wippen: number;         // Auslenkung nach dem Berühren
  readonly wippV: number;
  readonly beruehrt: boolean;
}

export interface Bueschel {
  readonly x: number;
  readonly y: number;
  readonly halme: readonly { readonly winkel: number; readonly lang: number }[];
}

interface Flug {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly leben: number;          // s; Samen leben ewig (Infinity)
  readonly phase: number;
  readonly samen: boolean;
}

export interface Wiese {
  readonly breite: number;
  readonly hoehe: number;
  readonly zeit: number;
  readonly blumen: readonly Blume[];
  readonly bueschel: readonly Bueschel[];
  readonly flug: readonly Flug[];
}

export function neueWiese(breite: number, hoehe: number, zufall: Zufall = Math.random): Wiese {
  const flaeche = breite * hoehe;
  const anzahl = Math.min(9, Math.max(5, Math.round(flaeche / 180_000)));
  const blumen: Blume[] = [];
  for (let versuch = 0; blumen.length < anzahl && versuch < 300; versuch++) {
    const r = 22 + 12 * zufall();
    const x = 40 + zufall() * (breite - 80);
    const y = 40 + zufall() * (hoehe - 80);
    if (blumen.some((b) => Math.hypot(b.x - x, b.y - y) < BLUETEN_ABSTAND)) continue;
    blumen.push({
      x, y, r,
      blaetter: zufall() < 0.5 ? 5 : 6,
      palette: BLUETEN[blumen.length % BLUETEN.length],
      drehung: zufall() * Math.PI * 2,
      wippen: 0, wippV: 0, beruehrt: false,
    });
  }
  const bueschel = Array.from({ length: Math.min(18, Math.max(8, Math.round(flaeche / 90_000))) }, () => {
    const halme = Array.from({ length: 3 + Math.floor(zufall() * 3) }, () => ({
      winkel: -Math.PI / 2 + (zufall() - 0.5) * 1.6,
      lang: 16 + zufall() * 14,
    }));
    return { x: zufall() * breite, y: zufall() * hoehe, halme };
  });
  const flug = Array.from({ length: Math.min(12, Math.max(5, Math.round(flaeche / 150_000))) }, () => ({
    x: zufall() * breite, y: zufall() * hoehe, vx: SAMEN_TEMPO * (0.6 + 0.8 * zufall()), vy: 0,
    leben: Infinity, phase: zufall() * Math.PI * 2, samen: true,
  }));
  return { breite, hoehe, zeit: 0, blumen, bueschel, flug };
}

/** Wind als Welle, die über die Wiese läuft: kleine Neigung je Ort und Zeit. */
function wind(x: number, y: number, zeit: number): number {
  return Math.sin(zeit * 0.8 - x * 0.006 - y * 0.002) * 0.12;
}

export function wiesenGestalten(wiese: Wiese, zeit: number): Gestalt[] {
  const gras = wiese.bueschel.map((b) => ({
    palette: BLATT,
    kapseln: b.halme.map((h) => strecke(b.x, b.y, h.winkel + wind(b.x, b.y, zeit), h.lang, 2.2, 0.8)),
  }));
  const blumen = wiese.blumen.flatMap((b) => {
    const neigung = b.drehung + wind(b.x, b.y, zeit) * 0.6 + b.wippen;
    const laub = {
      palette: BLATT,
      kapseln: [0.5, 2.6, 4.4].slice(0, 2 + (b.blaetter % 2)).map((a) => strecke(b.x, b.y, neigung + a, b.r * 1.55, 1.5, b.r * 0.3)),
    };
    const kranz = {
      palette: b.palette,
      kapseln: Array.from({ length: b.blaetter }, (_, k) =>
        strecke(b.x, b.y, neigung + (k * Math.PI * 2) / b.blaetter, b.r, b.r * 0.1, b.r * 0.3)),
    };
    const mitte = { palette: MITTE, kapseln: [strecke(b.x, b.y, 0, 0, b.r * 0.26, b.r * 0.26)] };
    return [laub, kranz, mitte];
  });
  return [...gras, ...blumen];
}

function blumenSchritt(b: Blume, dt: number, maus: Punkt | null, zufall: Zufall): { blume: Blume; pollen: Flug[] } {
  const beruehrt = maus !== null && Math.hypot(maus.x - b.x, maus.y - b.y) < b.r * 1.3;
  let wippV = b.wippV + (-WIPP_FEDER * b.wippen - WIPP_DAEMPFUNG * b.wippV) * dt;
  const pollen: Flug[] = [];
  if (beruehrt && !b.beruehrt) {
    wippV += WIPPEN * 6 * (zufall() < 0.5 ? -1 : 1);
    for (let k = 0; k < 4; k++) {
      const a = zufall() * Math.PI * 2;
      pollen.push({ x: b.x, y: b.y, vx: Math.cos(a) * 22, vy: Math.sin(a) * 22, leben: POLLEN_LEBEN, phase: a, samen: false });
    }
  }
  return { blume: { ...b, wippV, wippen: b.wippen + wippV * dt, beruehrt }, pollen };
}

function flugSchritt(f: Flug, dt: number, breite: number, hoehe: number): Flug {
  if (f.samen) {
    const phase = f.phase + dt * 0.7;
    return {
      ...f, phase,
      x: umlaufend(f.x + f.vx * dt, breite, 20),
      y: umlaufend(f.y + Math.sin(phase) * 9 * dt, hoehe, 20),
    };
  }
  const bremse = Math.exp(-1.5 * dt);
  return { ...f, x: f.x + f.vx * dt, y: f.y + f.vy * dt, vx: f.vx * bremse, vy: f.vy * bremse, leben: f.leben - dt };
}

export function wiesenSchritt(wiese: Wiese, dt: number, maus: Punkt | null, zufall: Zufall): Wiese {
  const schritte = wiese.blumen.map((b) => blumenSchritt(b, dt, maus, zufall));
  const flug = [...wiese.flug, ...schritte.flatMap((s) => s.pollen)]
    .map((f) => flugSchritt(f, dt, wiese.breite, wiese.hoehe))
    .filter((f) => f.leben > 0);
  return { ...wiese, zeit: wiese.zeit + dt, blumen: schritte.map((s) => s.blume), flug };
}

function teilchen(wiese: Wiese): Teilchen[] {
  return wiese.flug.map((f) => f.samen
    ? { x: f.x, y: f.y, zeichen: "+", staerke: 0.5 + 0.3 * Math.sin(f.phase), farbe: SAMEN_FARBE }
    : { x: f.x, y: f.y, zeichen: ".", staerke: Math.min(1, f.leben / POLLEN_LEBEN), farbe: POLLEN_FARBE });
}

function bauen(wiese: Wiese, stand: number, gerastertUm: number): Kulisse {
  const takt = Math.floor(wiese.zeit / WIND_TAKT) * WIND_TAKT;
  return {
    wasser: false,
    unten: { stand, rastern: (sp, ze, zb, zh, punkte) => rasternGestalten(wiesenGestalten(wiese, takt), sp, ze, zb, zh, punkte) },
    oben: null,
    teilchen: teilchen(wiese),
    ziele: wiese.blumen.map((b) => ({ x: b.x, y: b.y })),
    feld: null,
    feldZeichen: [".", "."],
    feldFarbe: SAMEN_FARBE,
    weiter: ({ dt, maus, zufall }: Weiter) => {
      const neu = wiesenSchritt(wiese, dt, maus, zufall);
      const neuerTakt = Math.floor(neu.zeit / WIND_TAKT) * WIND_TAKT;
      const wippt = neu.blumen.some((b) => Math.abs(b.wippen) > 0.01 || Math.abs(b.wippV) > 0.01);
      const faellig = neuerTakt !== gerastertUm || wippt;
      return { kulisse: bauen(neu, naechsterStand(stand, faellig), faellig ? neuerTakt : gerastertUm), anstoesse: [] };
    },
    aufGroesse: (fx, fy, breite, hoehe) => bauen({
      ...wiese, breite, hoehe,
      blumen: wiese.blumen.map((b) => ({ ...b, x: b.x * fx, y: b.y * fy })),
      bueschel: wiese.bueschel.map((b) => ({ ...b, x: b.x * fx, y: b.y * fy })),
      flug: wiese.flug.map((f) => ({ ...f, x: f.x * fx, y: f.y * fy })),
    }, stand + 1, gerastertUm),
  };
}

export function wiesenKulisse(breite: number, hoehe: number, zufall: Zufall = Math.random): Kulisse {
  return bauen(neueWiese(breite, hoehe, zufall), 0, 0);
}
