// Kulisse Tiefsee — für die Quallen, von der Seite gesehen: Tang wiegt sich
// vom Grund herauf, Blasen steigen, Meeresschnee rieselt, und von oben fallen
// schräge Lichtstrahlen, die nach unten verblassen.
//
// Berührt der Mauszeiger eine Blase, platzt sie.

import type { Kapsel, Punkt, Zufall } from "./asciiTeich.ts";
import { rasternGestalten, umlaufend, type Gestalt, type Kulisse, type Teilchen, type Weiter } from "./kulisse.ts";

const TANG = 13;
const GLIEDER = 9;
const TANG_TAKT = 0.1;             // s: so oft wird der Tang neu gerastert
const BLASEN_JE_S = 0.9;
const PLATZT_PX = 12;
const FUNKE_LEBEN = 0.3;           // s: so lange bleibt eine geplatzte Blase sichtbar
const BLASEN_FARBE = "200, 230, 246";
const SCHNEE_FARBE = "196, 208, 228";
export const LICHT_FARBE = "190, 226, 240";
const STRAHL_AB = 0.95;
const STRAHL_NEIGUNG = 0.32;       // px nach rechts je px nach unten

export interface Tang {
  readonly x: number;
  readonly lang: number;
  readonly dicke: number;
  readonly phase: number;
}

interface Blase {
  readonly x: number;
  readonly y: number;
  readonly groesse: number;        // 0..1
  readonly phase: number;
  readonly platzt: number;         // > 0: geplatzt, Restzeit in s
}

interface Flocke {
  readonly x: number;
  readonly y: number;
  readonly tempo: number;
  readonly phase: number;
  readonly staerke: number;
}

export interface Tiefsee {
  readonly breite: number;
  readonly hoehe: number;
  readonly zeit: number;
  readonly tang: readonly Tang[];
  readonly blasen: readonly Blase[];
  readonly schnee: readonly Flocke[];
}

export function neueTiefsee(breite: number, hoehe: number, zufall: Zufall = Math.random): Tiefsee {
  const flaeche = breite * hoehe;
  const stiele = Math.min(7, Math.max(3, Math.round(breite / 260)));
  const tang: Tang[] = Array.from({ length: stiele }, (_, i) => ({
    x: ((i + 0.2 + 0.6 * zufall()) / stiele) * breite,
    lang: hoehe * (0.22 + 0.22 * zufall()),
    dicke: 3 + 2 * zufall(),
    phase: zufall() * Math.PI * 2,
  }));
  const schnee = Array.from({ length: Math.min(90, Math.max(30, Math.round(flaeche / 16_000))) }, () => ({
    x: zufall() * breite, y: zufall() * hoehe, tempo: 4 + 8 * zufall(), phase: zufall() * Math.PI * 2, staerke: 0.25 + 0.5 * zufall(),
  }));
  return { breite, hoehe, zeit: 0, tang, blasen: [], schnee };
}

/** Ein Tangstängel: Glieder vom Grund herauf, die Welle läuft nach oben. */
export function tangGestalt(t: Tang, hoehe: number, zeit: number): Gestalt {
  const glied = t.lang / GLIEDER;
  const kapseln: Kapsel[] = [];
  let x = t.x;
  let y = hoehe + 6;
  let winkel = -Math.PI / 2;
  for (let j = 0; j < GLIEDER; j++) {
    winkel += Math.sin(zeit * 0.5 + t.phase - j * 0.45) * 0.07;
    const nx = x + Math.cos(winkel) * glied;
    const ny = y + Math.sin(winkel) * glied;
    const r = t.dicke * (1 - (0.6 * j) / GLIEDER);
    kapseln.push({ ax: x, ay: y, bx: nx, by: ny, ra: r, rb: r * 0.92 });
    // Ab und zu ein Blatt zur Seite, abwechselnd links und rechts.
    if (j % 2 === 1) {
      const seite = j % 4 === 1 ? 1 : -1;
      const bw = winkel + seite * 0.9;
      kapseln.push({ ax: x, ay: y, bx: x + Math.cos(bw) * glied * 1.3, by: y + Math.sin(bw) * glied * 1.3, ra: r * 0.6, rb: r * 1.1 });
    }
    x = nx;
    y = ny;
  }
  return { palette: TANG, kapseln };
}

function blasenSchritt(b: Blase, dt: number, maus: Punkt | null): Blase | null {
  if (b.platzt > 0) return b.platzt - dt > 0 ? { ...b, platzt: b.platzt - dt } : null;
  if (maus && Math.hypot(maus.x - b.x, maus.y - b.y) < PLATZT_PX) return { ...b, platzt: FUNKE_LEBEN };
  const phase = b.phase + dt * 3;
  const y = b.y - (20 + 30 * b.groesse) * dt;
  return y < -10 ? null : { ...b, phase, y, x: b.x + Math.sin(phase) * 10 * dt };
}

export function tiefseeSchritt(see: Tiefsee, dt: number, maus: Punkt | null, zufall: Zufall): Tiefsee {
  const blasen = see.blasen.map((b) => blasenSchritt(b, dt, maus)).filter((b): b is Blase => b !== null);
  if (zufall() < BLASEN_JE_S * dt) {
    // Die Hälfte steigt am Fuß eines Tangs auf, der Rest irgendwo am Grund.
    const vomTang = see.tang.length > 0 && zufall() < 0.5;
    const x = vomTang ? see.tang[Math.floor(zufall() * see.tang.length) % see.tang.length].x : zufall() * see.breite;
    blasen.push({ x, y: see.hoehe + 4, groesse: zufall(), phase: zufall() * Math.PI * 2, platzt: 0 });
  }
  const schnee = see.schnee.map((f) => {
    const phase = f.phase + dt * 0.5;
    return { ...f, phase, x: umlaufend(f.x + Math.sin(phase) * 4 * dt, see.breite, 4), y: umlaufend(f.y + f.tempo * dt, see.hoehe, 4) };
  });
  return { ...see, zeit: see.zeit + dt, blasen, schnee };
}

function teilchen(see: Tiefsee): Teilchen[] {
  const blasen = see.blasen.map((b) => b.platzt > 0
    ? { x: b.x, y: b.y, zeichen: "'", staerke: b.platzt / FUNKE_LEBEN, farbe: BLASEN_FARBE }
    : { x: b.x, y: b.y, zeichen: b.groesse < 0.4 ? "." : b.groesse < 0.8 ? "o" : "O", staerke: 0.5 + 0.5 * b.groesse, farbe: BLASEN_FARBE });
  const schnee = see.schnee.map((f) => ({ x: f.x, y: f.y, zeichen: ".", staerke: f.staerke, farbe: SCHNEE_FARBE }));
  return [...schnee, ...blasen];
}

/**
 * Lichtstrahlen von oben: schräge, langsam wandernde Bänder, die nach unten
 * schwächer werden. Je Zelle 0 = nichts, sonst 0..1.
 */
export function strahlenFeld(spalten: number, zeilen: number, zelleB: number, zelleH: number, zeit: number): Float32Array {
  const feld = new Float32Array(spalten * zeilen);
  const hoehe = zeilen * zelleH;
  for (let z = 0; z < zeilen; z++) {
    const y = z * zelleH;
    const tief = Math.max(0, 1 - y / (hoehe * 0.85));
    if (tief <= 0) continue;
    const blasser = tief * tief;
    for (let c = 0; c < spalten; c++) {
      const s = c * zelleB - y * STRAHL_NEIGUNG;
      const v = Math.sin(s * 0.019 + Math.sin(s * 0.0031 + zeit * 0.06) * 2.4 + zeit * 0.05);
      if (v > STRAHL_AB) feld[z * spalten + c] = ((v - STRAHL_AB) / (1 - STRAHL_AB)) * blasser;
    }
  }
  return feld;
}

function bauen(see: Tiefsee, stand: number, gerastertUm: number): Kulisse {
  const takt = Math.floor(see.zeit / TANG_TAKT) * TANG_TAKT;
  return {
    wasser: false,
    unten: {
      stand,
      rastern: (sp, ze, zb, zh, punkte) => rasternGestalten(see.tang.map((t) => tangGestalt(t, see.hoehe, takt)), sp, ze, zb, zh, punkte),
    },
    oben: null,
    teilchen: teilchen(see),
    ziele: [],
    feld: strahlenFeld,
    feldZeichen: [".", "\\"],
    feldFarbe: LICHT_FARBE,
    weiter: ({ dt, maus, zufall }: Weiter) => {
      const neu = tiefseeSchritt(see, dt, maus, zufall);
      const neuerTakt = Math.floor(neu.zeit / TANG_TAKT) * TANG_TAKT;
      const faellig = neuerTakt !== gerastertUm;
      return { kulisse: bauen(neu, faellig ? stand + 1 : stand, neuerTakt), anstoesse: [] };
    },
    aufGroesse: (fx, fy, breite, hoehe) => bauen({
      ...see, breite, hoehe,
      tang: see.tang.map((t) => ({ ...t, x: t.x * fx, lang: t.lang * fy })),
      blasen: see.blasen.map((b) => ({ ...b, x: b.x * fx, y: b.y * fy })),
      schnee: see.schnee.map((f) => ({ ...f, x: f.x * fx, y: f.y * fy })),
    }, stand + 1, gerastertUm),
  };
}

export function tiefseeKulisse(breite: number, hoehe: number, zufall: Zufall = Math.random): Kulisse {
  return bauen(neueTiefsee(breite, hoehe, zufall), 0, 0);
}
