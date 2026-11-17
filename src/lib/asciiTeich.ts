// ASCII-Teich — Tiere aus Schriftzeichen, leise hinter dem Thema „Glas".
//
// WARUM
// Paul, 2026-11-16: „in the form of this … in the transparent version very
// subtle only" — Vorbild war ein Video, in dem ASCII-Koi hinter einer
// Begrüßung schwimmen. Danach: „etwas stärker … etwas mehr Farbe … mehr Tiere,
// zwischen denen ich wechseln kann". Deshalb gibt es Motive (lib/teichMotiv.ts),
// je eines mit einer Tierart.
//
// WIE
// · Jedes Tier ist eine Kette aus Kapseln (Strecke mit Radius an beiden
//   Enden); wie die einzelnen Arten aussehen und sich bewegen, steht in
//   asciiTiere.ts.
// · rastern() fragt je Zelle des Zeichenrasters: wie tief liegt sie in einem
//   Körper? Mitte → 1, Rand → knapp über 0. zeichenStufe() macht daraus
//   # % o : . — und die Palette des Tiers gibt der Stufe ihre Farbe.
// · Kleine Tiere gelten als „weiter weg": langsamer und blasser.
// Hier steht nur die Rechnung, ohne DOM; gezeichnet wird in
// src/components/AsciiTeich.tsx. Alle Funktionen geben neue Objekte zurück.

import { STECKBRIEFE, koiLaenge, umlauf, zwischen, type Art } from "./asciiTiere.ts";

export type { Art } from "./asciiTiere.ts";
export { koiLaenge, quallenRadius, KULISSE_AB, PALETTEN } from "./asciiTiere.ts";

export interface Wesen {
  readonly art: Art;
  readonly x: number;
  readonly y: number;
  readonly winkel: number;   // Blickrichtung in Bogenmaß
  readonly tiefe: number;    // ~0.4 (fern) … 1 (nah)
  readonly phase: number;    // Schwimmwelle, Schirmschlag oder Flügelschlag
  readonly kurve: number;    // eigene Frequenz der S-Kurve
  readonly versatz: number;  // eigener Startpunkt der S-Kurve
  readonly zielX: number;    // Ziel beim Zielflug (Libelle, Falter)
  readonly zielY: number;
  readonly warten: number;   // Sekunden Schweben, bevor es weitergeht
  readonly farbe: number;    // Index in PALETTEN
  readonly schreck: number;  // 0 ruhig … 1 voller Schreck (Mauszeiger nah)
  readonly fluchtWinkel: number; // wohin es gerade flieht
}

export interface Teich {
  readonly breite: number;
  readonly hoehe: number;
  readonly zeit: number;
  readonly wesen: readonly Wesen[];
  /** Wo Libellen und Falter gern landen: Seerosen, Blüten (lib/kulisse.ts). */
  readonly ziele?: readonly Punkt[];
}

export interface Kapsel {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly ra: number;
  readonly rb: number;
}

export interface Raster {
  readonly dichte: Float32Array;   // 0..1, mit der Sichtbarkeit der Tiefe verrechnet
  readonly farbe: Uint8Array;      // Palette des Tiers, das die Zelle füllt
}

export type Zufall = () => number;

/** Wie deutlich ein Tier dieser Tiefe erscheint (0..1). */
export function sichtbarkeit(tiefe: number): number {
  return 0.35 + 0.65 * tiefe;
}

function neuesWesen(art: Art, breite: number, hoehe: number, zufall: Zufall, winkel: number): Wesen {
  const brief = STECKBRIEFE[art];
  const x = zwischen(zufall, 0, breite);
  const y = zwischen(zufall, 0, hoehe);
  return {
    art,
    x,
    y,
    winkel,
    tiefe: zwischen(zufall, brief.tiefe[0], brief.tiefe[1]),
    phase: zwischen(zufall, 0, Math.PI * 2),
    kurve: zwischen(zufall, 0.07, 0.16),
    versatz: zwischen(zufall, 0, Math.PI * 2),
    zielX: x,
    zielY: y,
    warten: zwischen(zufall, 0.5, 3),
    farbe: brief.paletten[Math.floor(zufall() * brief.paletten.length) % brief.paletten.length],
    schreck: 0,
    fluchtWinkel: winkel,
  };
}

export function neuerTeich(breite: number, hoehe: number, art: Art = "koi", zufall: Zufall = Math.random): Teich {
  const anzahl = STECKBRIEFE[art].anzahl(breite * hoehe);
  // Vögel ziehen als Schwarm: alle ungefähr in dieselbe Richtung.
  const schwarm = zufall() < 0.5 ? 0 : Math.PI;
  const wesen = Array.from({ length: anzahl }, () => {
    const winkel = art === "vogel" ? schwarm + zwischen(zufall, -0.25, 0.25) : zwischen(zufall, 0, Math.PI * 2);
    return neuesWesen(art, breite, hoehe, zufall, winkel);
  });
  return { breite, hoehe, zeit: 0, wesen };
}

/** Neue Fenstergröße: Tiere bleiben, wo sie relativ waren. */
export function teichAufGroesse(teich: Teich, breite: number, hoehe: number): Teich {
  if (teich.breite <= 0 || teich.hoehe <= 0) return { ...teich, breite, hoehe };
  const fx = breite / teich.breite;
  const fy = hoehe / teich.hoehe;
  return {
    ...teich,
    breite,
    hoehe,
    wesen: teich.wesen.map((w) => ({ ...w, x: w.x * fx, y: w.y * fy, zielX: w.zielX * fx, zielY: w.zielY * fy })),
  };
}

// ── Scheu vor der Maus ──────────────────────────────────────────────────────
// Paul, 2026-11-16: „can they react when my mouse comes close to them?",
// „make their movement away from my mouse more natural" und dann: „they
// should be more scared of it — run / swim / fly away as soon as I touch them".
//
// Wie echte Tiere: kein Wegschieben, sondern ein Schreck. Berührt der Zeiger
// den Körper, ist der Schreck sofort voll (1) und klingt erst nach ein paar
// Sekunden ab — so lange flieht das Tier. Kommt der Zeiger nur nah, wird es
// lediglich etwas unruhig. Koi und Vögel machen einen Fluchtstart: blitzschnell
// abdrehen, dann davonschießen. Quallen pumpen und treiben weg. Libellen und
// Falter schießen direkt vom Zeiger weg und nehmen sich ein fernes Ziel.
export interface Punkt {
  readonly x: number;
  readonly y: number;
}

export const BERUEHRT = 18;      // px vom Körperrand: zählt als Berührung
export const WACH_RADIUS = 90;   // px vom Körperrand: hier wird es nur unruhig
const WACH_DRUCK = 0.2;          // so viel Schreck macht bloße Nähe höchstens
const SCHRECK_AB = 0.35;         // je Sekunde: Flucht dauert ~3 s
const FLUCHT_WENDE = 6;          // rad/s: wie schnell die Fluchtrichtung nachzieht
const FLUCHT_ZIEL = 500;         // so weit weg setzen Flieger ihr neues Ziel

interface Fluchtart {
  readonly drehung: number;    // rad/s bei vollem Schreck
  readonly spurt: number;      // px/s zusätzlich bei vollem Schreck
  readonly schlag: number;     // wie viel hastiger Flosse/Flügel schlagen
}

const FLUCHT: Record<Art, Fluchtart> = {
  koi: { drehung: 9, spurt: 280, schlag: 14 },
  vogel: { drehung: 6, spurt: 320, schlag: 10 },
  qualle: { drehung: 0, spurt: 140, schlag: 6 },
  libelle: { drehung: 0, spurt: 380, schlag: 0 },
  schmetterling: { drehung: 0, spurt: 220, schlag: 12 },
};

function winkelDiff(von: number, nach: number): number {
  return Math.atan2(Math.sin(nach - von), Math.cos(nach - von));
}

function begrenzt(wert: number, grenze: number): number {
  return Math.max(-grenze, Math.min(grenze, wert));
}

/** Wie weit der Zeiger vom Körperrand weg ist (≤ 0 = im Körper) — an den Kapseln gemessen. */
function abstandZumKoerper(w: Wesen, maus: Punkt, teile: readonly Kapsel[]): number {
  let abstand = Math.hypot(w.x - maus.x, w.y - maus.y);
  for (const k of teile) {
    const vx = k.bx - k.ax;
    const vy = k.by - k.ay;
    const len2 = vx * vx + vy * vy;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((maus.x - k.ax) * vx + (maus.y - k.ay) * vy) / len2)) : 0;
    const d = Math.hypot(maus.x - (k.ax + vx * u), maus.y - (k.ay + vy * u)) - (k.ra + (k.rb - k.ra) * u);
    abstand = Math.min(abstand, d);
  }
  return abstand;
}

/** Mitte des Körpers: Mittel der Kapselmitten. */
function koerperMitte(w: Wesen, teile: readonly Kapsel[]): Punkt {
  if (teile.length === 0) return w;
  const summe = teile.reduce((s, k) => ({ x: s.x + k.ax + k.bx, y: s.y + k.ay + k.by }), { x: 0, y: 0 });
  return { x: summe.x / (teile.length * 2), y: summe.y / (teile.length * 2) };
}

/** Berührung → 1; bloße Nähe → höchstens WACH_DRUCK, weich ansteigend. */
function druckBei(abstand: number): number {
  if (abstand <= BERUEHRT) return 1;
  if (abstand >= WACH_RADIUS) return 0;
  const t = 1 - (abstand - BERUEHRT) / (WACH_RADIUS - BERUEHRT);
  return WACH_DRUCK * t * t * (3 - 2 * t);
}

function zielflieger(art: Art): boolean {
  return art === "libelle" || art === "schmetterling";
}

/** Schreck und Fluchtrichtung nachführen — auch ohne Zeiger, dann klingt es ab. */
function erschrecken(w: Wesen, maus: Punkt | null, dt: number): Wesen {
  if (!maus) return w.schreck > 0 ? { ...w, schreck: Math.max(0, w.schreck - SCHRECK_AB * dt) } : w;
  const teile = kapseln(w);
  const druck = druckBei(abstandZumKoerper(w, maus, teile));
  // Schreck setzt sofort ein, klingt aber langsam ab.
  const schreck = Math.max(druck, w.schreck - SCHRECK_AB * dt);
  if (druck <= 0) return { ...w, schreck };
  // Weg vom Zeiger, durch die Körpermitte: am Schwanz berührt geht es nach
  // vorn, am Kopf berührt kehrt das Tier um.
  const mitte = koerperMitte(w, teile);
  const weg = Math.hypot(mitte.x - maus.x, mitte.y - maus.y) > 0.5
    ? Math.atan2(mitte.y - maus.y, mitte.x - maus.x)
    : w.winkel;
  // Bei Berührung und beim ersten Schreck zeigt die Flucht sofort weg vom
  // Zeiger; sonst folgt sie ihm nur weich, damit ein zuckender Zeiger keine
  // Zickzack-Flucht macht.
  const fluchtWinkel = druck >= 1 || w.schreck < 0.05
    ? weg
    : w.fluchtWinkel + begrenzt(winkelDiff(w.fluchtWinkel, weg), FLUCHT_WENDE * dt);
  return { ...w, schreck, fluchtWinkel };
}

/** Den Schreck in Bewegung umsetzen: Bogen + Spurt, Schirmstoß oder neues Ziel. */
function fliehen(w: Wesen, dt: number, teich: Teich): Wesen {
  if (w.schreck <= 0.001) return w;
  const art = FLUCHT[w.art];
  const k = w.schreck;
  const phase = w.phase + dt * art.schlag * k;
  if (w.art === "qualle") {
    return {
      ...w,
      phase,
      x: umlauf(w.x + Math.cos(w.fluchtWinkel) * art.spurt * k * dt, teich.breite),
      y: umlauf(w.y + Math.sin(w.fluchtWinkel) * art.spurt * k * dt, teich.hoehe),
    };
  }
  if (zielflieger(w.art)) {
    const zumZiel = (w.zielX - w.x) * Math.cos(w.fluchtWinkel) + (w.zielY - w.y) * Math.sin(w.fluchtWinkel);
    const neuesZiel = k > 0.25 && (w.warten > 0 || zumZiel < 80);
    const ziel = neuesZiel
      ? {
          warten: 0,
          zielX: Math.min(teich.breite * 0.92, Math.max(teich.breite * 0.08, w.x + Math.cos(w.fluchtWinkel) * FLUCHT_ZIEL)),
          zielY: Math.min(teich.hoehe * 0.92, Math.max(teich.hoehe * 0.08, w.y + Math.sin(w.fluchtWinkel) * FLUCHT_ZIEL)),
        }
      : {};
    // Flieger können in jede Richtung starten: direkt weg vom Zeiger.
    return {
      ...w,
      ...ziel,
      phase,
      x: umlauf(w.x + Math.cos(w.fluchtWinkel) * art.spurt * k * dt, teich.breite),
      y: umlauf(w.y + Math.sin(w.fluchtWinkel) * art.spurt * k * dt, teich.hoehe),
    };
  }
  // Koi und Vögel: Fluchtstart — erst blitzschnell abdrehen, dann davonschießen.
  // Solange sie noch zum Zeiger schauen, spurten sie kaum; sonst würden sie
  // erst auf ihn zu schießen.
  const winkel = w.winkel + begrenzt(winkelDiff(w.winkel, w.fluchtWinkel), art.drehung * k * dt);
  const ausgerichtet = Math.max(0, Math.cos(winkelDiff(winkel, w.fluchtWinkel)));
  const tempo = art.spurt * k * (0.15 + 0.85 * ausgerichtet);
  const rand = w.art === "koi" ? koiLaenge(w.tiefe) + 20 : undefined;
  return {
    ...w,
    winkel,
    phase,
    x: umlauf(w.x + Math.cos(winkel) * tempo * dt, teich.breite, rand),
    y: umlauf(w.y + Math.sin(winkel) * tempo * dt, teich.hoehe, rand),
  };
}

/** Ein Tier reagiert auf den Zeiger (oder dessen Fehlen) — ein Zeitschritt. */
export function reagieren(w: Wesen, maus: Punkt | null, dt: number, teich: Teich): Wesen {
  return fliehen(erschrecken(w, maus, dt), dt, teich);
}

/**
 * Den Teich um dt Sekunden weiterrechnen. Große Sprünge (Fenster war weg)
 * werden gekappt. `maus` = Zeiger über dem Fenster, sonst null.
 */
export function schritt(teich: Teich, dt: number, zufall: Zufall = Math.random, maus: Punkt | null = null): Teich {
  const d = Math.min(Math.max(dt, 0), 0.1);
  const zeit = teich.zeit + d;
  return {
    ...teich,
    zeit,
    wesen: teich.wesen.map((w) => reagieren(STECKBRIEFE[w.art].schritt(w, zeit, d, teich, zufall), maus, d, teich)),
  };
}

export function kapseln(w: Wesen): Kapsel[] {
  return STECKBRIEFE[w.art].kapseln(w);
}

/** 0..1: wie tief der Punkt (px, py) in der Kapsel liegt; 0 = draußen. */
export function inKapsel(k: Kapsel, px: number, py: number): number {
  const vx = k.bx - k.ax;
  const vy = k.by - k.ay;
  const len2 = vx * vx + vy * vy;
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - k.ax) * vx + (py - k.ay) * vy) / len2)) : 0;
  const r = k.ra + (k.rb - k.ra) * u;
  if (r <= 0) return 0;
  const d = Math.hypot(px - (k.ax + vx * u), py - (k.ay + vy * u));
  return d >= r ? 0 : 1 - d / r;
}

/**
 * Das Zeichenraster füllen: je Zelle die Dichte 0..1 (eine Probe in der
 * Zellmitte) und die Palette des Tiers, das dort am dichtesten ist.
 */
export function rastern(teich: Teich, spalten: number, zeilen: number, zelleB: number, zelleH: number): Raster {
  const { proben, farbe } = rasternProben(teich, spalten, zeilen, zelleB, zelleH, [{ x: zelleB / 2, y: zelleH / 2 }]);
  return { dichte: proben, farbe };
}

/** Mittel der Proben je Zelle — die Dichte, nach der Sichtbarkeit, Licht und Farbe gehen. */
export function zellMittel(proben: Float32Array, jeZelle: number): Float32Array {
  const mittel = new Float32Array(proben.length / jeZelle);
  for (let i = 0; i < mittel.length; i++) {
    let summe = 0;
    for (let j = 0; j < jeZelle; j++) summe += proben[i * jeZelle + j];
    mittel[i] = summe / jeZelle;
  }
  return mittel;
}

export interface Proben {
  readonly proben: Float32Array;   // je Zelle punkte.length Werte 0..1, Zelle für Zelle hintereinander
  readonly farbe: Uint8Array;      // Palette des Tiers, das die Zelle am stärksten füllt
}

/**
 * Wie rastern, aber an mehreren Stellen je Zelle (`punkte`, relativ zur
 * linken oberen Ecke der Zelle) — für die Zeichenwahl nach Form
 * (lib/glyphenForm.ts). Geprüft werden nur Zellen im Umkreis jeder Kapsel.
 */
export function rasternProben(
  teich: Teich, spalten: number, zeilen: number, zelleB: number, zelleH: number, punkte: readonly Punkt[],
): Proben {
  const n = punkte.length;
  const proben = new Float32Array(spalten * zeilen * n);
  const farbe = new Uint8Array(spalten * zeilen);
  const staerkste = new Float32Array(spalten * zeilen);
  for (const w of teich.wesen) {
    const faktor = sichtbarkeit(w.tiefe);
    for (const k of kapseln(w)) {
      const r = Math.max(k.ra, k.rb);
      const c0 = Math.max(0, Math.floor((Math.min(k.ax, k.bx) - r) / zelleB));
      const c1 = Math.min(spalten - 1, Math.floor((Math.max(k.ax, k.bx) + r) / zelleB));
      const z0 = Math.max(0, Math.floor((Math.min(k.ay, k.by) - r) / zelleH));
      const z1 = Math.min(zeilen - 1, Math.floor((Math.max(k.ay, k.by) + r) / zelleH));
      for (let z = z0; z <= z1; z++) {
        for (let c = c0; c <= c1; c++) {
          const zelle = z * spalten + c;
          for (let j = 0; j < n; j++) {
            const v = inKapsel(k, c * zelleB + punkte[j].x, z * zelleH + punkte[j].y) * faktor;
            const i = zelle * n + j;
            if (v > proben[i]) proben[i] = v;
            if (v > staerkste[zelle]) {
              staerkste[zelle] = v;
              farbe[zelle] = w.farbe;
            }
          }
        }
      }
    }
  }
  return { proben, farbe };
}

/**
 * Dichte → Zeichen: innen dicht, am Rand licht. Zehn Stufen statt fünf, damit
 * der Übergang vom Rand zur Mitte weich wird statt in Bändern.
 */
export const ZEICHEN = [".", ":", "-", "=", "+", "o", "*", "%", "#", "@"] as const;
const SCHWELLEN = ZEICHEN.map((_, i) => 0.05 + i * 0.075);

/** Stufe 0..9 für ZEICHEN, oder -1 = nichts zeichnen. */
export function zeichenStufe(v: number): number {
  for (let i = SCHWELLEN.length - 1; i >= 0; i--) {
    if (v >= SCHWELLEN[i]) return i;
  }
  return -1;
}

// ── Licht und Schatten ──────────────────────────────────────────────────────
// Nach a1k0n, „Donut math: how donut.c
// works": Helligkeit = Flächennormale · Lichtrichtung. Die Normale liefert hier
// das Gefälle der Dichte (sie zeigt aus dem Körper heraus); das Licht kommt
// von links oben. Die beleuchtete Seite wird eine Spur dichter, die
// abgewandte eine Spur lichter — die Tiere wirken rund statt flach.
const LICHT_X = -0.6;            // Richtung zum Licht: links oben
const LICHT_Y = -0.8;
const LICHT_TIEFE = 12;          // px: wie weit das Gefälle in Helligkeit umgerechnet wird
const LICHT_STAERKE = 0.5;
const SICHTBAR_AB = 0.05;        // = erste Schwelle von zeichenStufe

/** Neue Dichte mit Licht von links oben; was sichtbar war, bleibt sichtbar. */
export function beleuchten(dichte: Float32Array, spalten: number, zeilen: number, zelleB: number, zelleH: number): Float32Array {
  const hell = Float32Array.from(dichte);
  for (let z = 1; z < zeilen - 1; z++) {
    for (let c = 1; c < spalten - 1; c++) {
      const i = z * spalten + c;
      const d = dichte[i];
      if (d < SICHTBAR_AB) continue;
      const gx = (dichte[i + 1] - dichte[i - 1]) / (2 * zelleB);
      const gy = (dichte[i + spalten] - dichte[i - spalten]) / (2 * zelleH);
      // Normale = −Gefälle; zum Licht gewandt → positiv.
      const zumLicht = -(gx * LICHT_X + gy * LICHT_Y) * LICHT_TIEFE;
      hell[i] = Math.min(1, Math.max(SICHTBAR_AB, d + LICHT_STAERKE * zumLicht));
    }
  }
  return hell;
}
