// ASCII-Teich — die Tiere: wie jedes sich bewegt und woraus sein Körper
// besteht. Der Teich selbst (anlegen, rastern, Zeichen) steht in asciiTeich.ts.
//
// Jedes Tier ist eine Handvoll Kapseln (Strecke mit Radius an beiden Enden).
// Was groß ist, gilt als nah: schneller und deutlicher. Alle Funktionen geben
// neue Objekte zurück.

import type { Kapsel, Teich, Wesen, Zufall } from "./asciiTeich.ts";

export type Art = "koi" | "libelle" | "qualle" | "schmetterling" | "vogel";

// So weit dürfen Tiere aus dem Bild, bevor sie gegenüber auftauchen. Ein Koi
// braucht mehr: sonst verschwände er, solange sein Schwanz noch zu sehen ist.
export const RAND = 120;

// ── Farben ──────────────────────────────────────────────────────────────────
// Je Palette fünf Töne, vom lichten Rand zur dichten Mitte. Die lichten
// Ränder bleiben in der Textfarbe, nur das dichte Innere trägt Farbe — so
// bleibt es leise und bekommt trotzdem einen Ton.
const TEXT = "237, 237, 244";
export const PALETTEN: readonly (readonly string[])[] = [
  [TEXT, TEXT, "240, 214, 190", "236, 150, 96", "232, 122, 74"],     // 0 Koi orange
  [TEXT, TEXT, TEXT, "226, 110, 98", "214, 86, 78"],                 // 1 Koi weiß-rot
  [TEXT, TEXT, "238, 222, 180", "226, 186, 106", "220, 170, 80"],    // 2 Koi gold
  [TEXT, "190, 226, 214", "120, 210, 180", "88, 196, 160", "70, 184, 150"],   // 3 Libelle
  [TEXT, "200, 196, 240", "170, 160, 236", "176, 150, 232", "206, 150, 226"], // 4 Qualle
  [TEXT, "240, 220, 170", "232, 190, 110", "228, 160, 80", "222, 140, 64"],   // 5 Falter orange
  [TEXT, "200, 220, 244", "140, 186, 240", "104, 160, 236", "84, 140, 230"],  // 6 Falter blau
  [TEXT, TEXT, "200, 210, 224", "176, 190, 212", "160, 176, 204"],   // 7 Vogel
  ["196, 222, 196", "160, 210, 160", "126, 196, 132", "104, 184, 116", "90, 172, 104"], // 8 Seerosenblatt
  ["246, 226, 236", "244, 204, 222", "240, 176, 206", "236, 150, 192", "246, 214, 120"], // 9 Seerosenblüte
  ["250, 236, 170", "248, 224, 140", "244, 210, 110", "240, 196, 90", "236, 184, 70"],    // 10 Blütenmitte
  [TEXT, "248, 246, 240", "244, 242, 236", "240, 238, 230", "236, 234, 226"],             // 11 Margerite
  ["220, 210, 244", "204, 188, 240", "186, 166, 236", "170, 146, 232", "156, 130, 228"],  // 12 Glockenblume
  ["170, 214, 196", "130, 196, 170", "96, 176, 146", "76, 160, 128", "62, 146, 116"],     // 13 Tang
  ["222, 232, 246", "214, 226, 244", "206, 220, 242", "200, 214, 240", "194, 210, 238"],  // 14 Wolke
];

/** Ab hier gehören die Paletten zur Kulisse (Pflanzen, Wolken), nicht zu Tieren. */
export const KULISSE_AB = 8;

// ── Hilfen ──────────────────────────────────────────────────────────────────
export function zwischen(zufall: Zufall, a: number, b: number): number {
  return a + (b - a) * zufall();
}

export function umlauf(wert: number, groesse: number, rand: number = RAND): number {
  const spanne = groesse + 2 * rand;
  return ((((wert + rand) % spanne) + spanne) % spanne) - rand;
}

function winkelDifferenz(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

function kapsel(ax: number, ay: number, bx: number, by: number, ra: number, rb: number): Kapsel {
  return { ax, ay, bx, by, ra, rb };
}

/** Strecke vom Punkt aus in Richtung `winkel`. */
function strahl(x: number, y: number, winkel: number, lang: number, ra: number, rb: number): Kapsel {
  return kapsel(x, y, x + Math.cos(winkel) * lang, y + Math.sin(winkel) * lang, ra, rb);
}

/** Träge S-Kurve: die Drehrate selbst schwingt langsam hin und her. */
function sKurve(w: Wesen, zeit: number, dt: number, staerke: number): number {
  return w.winkel + Math.sin(zeit * w.kurve * Math.PI * 2 + w.versatz) * staerke * dt;
}

const ZIEL_ANTEIL = 0.6;   // so oft fliegen Libellen und Falter einen Landeplatz an

/** Zum Ziel fliegen, dort schweben, dann ein neues Ziel (Libelle, Falter). */
function zielFlug(w: Wesen, dt: number, teich: Teich, zufall: Zufall, tempo: number, schweben: [number, number]): Wesen {
  if (w.warten > 0) {
    const rest = w.warten - dt;
    if (rest > 0) return { ...w, warten: rest };
    // Meist geht es zu einem Landeplatz der Kulisse (Seerose, Blüte), sonst irgendwohin.
    const ziele = teich.ziele ?? [];
    if (ziele.length > 0 && zufall() < ZIEL_ANTEIL) {
      const ziel = ziele[Math.floor(zufall() * ziele.length) % ziele.length];
      return { ...w, warten: 0, zielX: ziel.x, zielY: ziel.y };
    }
    return {
      ...w,
      warten: 0,
      zielX: zwischen(zufall, teich.breite * 0.08, teich.breite * 0.92),
      zielY: zwischen(zufall, teich.hoehe * 0.08, teich.hoehe * 0.92),
    };
  }
  const dx = w.zielX - w.x;
  const dy = w.zielY - w.y;
  if (Math.hypot(dx, dy) < tempo * dt + 2) {
    return { ...w, x: w.zielX, y: w.zielY, warten: zwischen(zufall, schweben[0], schweben[1]) };
  }
  const winkel = w.winkel + winkelDifferenz(w.winkel, Math.atan2(dy, dx)) * Math.min(1, dt * 4);
  return { ...w, winkel, x: w.x + Math.cos(winkel) * tempo * dt, y: w.y + Math.sin(winkel) * tempo * dt };
}

// ── Koi ─────────────────────────────────────────────────────────────────────
const KOI_GLIEDER = 12;

export function koiLaenge(tiefe: number): number {
  return 140 + 140 * tiefe;
}

function koiProfil(t: number): number {
  if (t < 0.15) return 0.65 + (t / 0.15) * 0.35;            // Kopf
  if (t < 0.78) return 1 - ((t - 0.15) / 0.63) * 0.78;      // Leib bis Schwanzstiel
  return 0.22 + ((t - 0.78) / 0.22) * 0.5;                  // Schwanzflosse
}

function koiSchritt(w: Wesen, zeit: number, dt: number, teich: Teich): Wesen {
  const winkel = sKurve(w, zeit, dt, 0.35);
  const tempo = 12 + 16 * w.tiefe;
  return {
    ...w,
    winkel,
    x: umlauf(w.x + Math.cos(winkel) * tempo * dt, teich.breite, koiLaenge(w.tiefe) + 20),
    y: umlauf(w.y + Math.sin(winkel) * tempo * dt, teich.hoehe, koiLaenge(w.tiefe) + 20),
    phase: w.phase + dt * (2.2 + 1.6 * w.tiefe),
  };
}

function koiKapseln(w: Wesen): Kapsel[] {
  const laenge = koiLaenge(w.tiefe);
  const glied = laenge / (KOI_GLIEDER - 1);
  const dx = Math.cos(w.winkel);
  const dy = Math.sin(w.winkel);
  const punkte = Array.from({ length: KOI_GLIEDER }, (_, i) => {
    const t = i / (KOI_GLIEDER - 1);
    const seit = Math.sin(w.phase - i * 0.55) * laenge * 0.1 * Math.pow(t, 1.3);
    return { x: w.x - dx * i * glied - dy * seit, y: w.y - dy * i * glied + dx * seit, r: laenge * 0.22 * koiProfil(t) };
  });
  const leib = punkte.slice(1).map((b, i) => kapsel(punkte[i].x, punkte[i].y, b.x, b.y, punkte[i].r, b.r));
  // Brustflossen: schräg nach hinten, paddeln leicht mit der Welle.
  const ansatz = punkte[2];
  const paddeln = Math.sin(w.phase * 0.5) * 0.25;
  const flossen = [1, -1].map((seite) =>
    strahl(ansatz.x, ansatz.y, w.winkel + Math.PI + seite * (Math.PI * 0.62 + paddeln * seite), laenge * 0.24, laenge * 0.07, laenge * 0.035),
  );
  return [...leib, ...flossen];
}

// ── Libelle ─────────────────────────────────────────────────────────────────
function libelleSchritt(w: Wesen, dt: number, teich: Teich, zufall: Zufall): Wesen {
  const weiter = zielFlug(w, dt, teich, zufall, 85 * w.tiefe, [1.5, 5]);
  return { ...weiter, phase: w.phase + dt * 38 };
}

function libelleKapseln(w: Wesen): Kapsel[] {
  const s = 1.4 + 0.8 * w.tiefe;
  const leibLang = 44 * s;
  const leib = strahl(w.x, w.y, w.winkel + Math.PI, leibLang, 7 * s, 4 * s);
  const schlag = Math.sin(w.phase) * 0.22;
  const fluegel = [0.22, 0.36].flatMap((abKopf, paar) => {
    const ax = w.x - Math.cos(w.winkel) * leibLang * abKopf;
    const ay = w.y - Math.sin(w.winkel) * leibLang * abKopf;
    const spanne = (paar === 0 ? 34 : 30) * s;
    return [1, -1].map((seite) =>
      strahl(ax, ay, w.winkel + seite * (Math.PI / 2 + (paar === 0 ? -0.25 : 0.2) + schlag * seite), spanne, 6.5 * s, 4 * s),
    );
  });
  return [leib, ...fluegel];
}

// ── Qualle ──────────────────────────────────────────────────────────────────
// Steigt in Stößen nach oben: zieht sich der Schirm zusammen, geht es voran.
export function quallenRadius(tiefe: number): number {
  return 26 + 28 * tiefe;
}

function qualleSchritt(w: Wesen, zeit: number, dt: number, teich: Teich): Wesen {
  const stoss = 0.35 + 0.65 * Math.max(0, Math.sin(w.phase));
  const tempo = (8 + 12 * w.tiefe) * stoss;
  const seit = Math.sin(zeit * w.kurve * Math.PI * 2 + w.versatz) * 7;
  return {
    ...w,
    x: umlauf(w.x + seit * dt, teich.breite),
    y: umlauf(w.y - tempo * dt, teich.hoehe),
    phase: w.phase + dt * (1.1 + 0.6 * w.tiefe),
  };
}

function qualleKapseln(w: Wesen): Kapsel[] {
  const r = quallenRadius(w.tiefe);
  const zug = Math.sin(w.phase);
  const breit = r * (1.12 - 0.14 * zug);   // zusammengezogen = schmaler
  const s = r / 30;
  // Schirm: breiter Leib, darüber eine runde Kuppel, unten ein schmaler Saum.
  const schirm = kapsel(w.x - breit * 0.45, w.y, w.x + breit * 0.45, w.y, breit * 0.55, breit * 0.55);
  const kuppel = kapsel(w.x - breit * 0.15, w.y - breit * 0.35, w.x + breit * 0.15, w.y - breit * 0.35, breit * 0.5, breit * 0.5);
  const saum = kapsel(w.x - breit * 0.95, w.y + breit * 0.4, w.x + breit * 0.95, w.y + breit * 0.4, breit * 0.16, breit * 0.16);
  const glieder = 5;
  const lang = r * 2.8;
  const arme = [-0.6, -0.2, 0.2, 0.6].flatMap((ab, k) => {
    const punkte = Array.from({ length: glieder + 1 }, (_, j) => {
      const t = j / glieder;
      return {
        x: w.x + ab * breit + Math.sin(w.phase * 0.8 - j * 0.8 + k * 1.3) * 7 * s * t,
        y: w.y + breit * 0.45 + t * lang,
        r: (4.5 - 2.5 * t) * s,
      };
    });
    return punkte.slice(1).map((b, j) => kapsel(punkte[j].x, punkte[j].y, b.x, b.y, punkte[j].r, b.r));
  });
  return [kuppel, schirm, saum, ...arme];
}

// ── Schmetterling ───────────────────────────────────────────────────────────
function schmetterlingSchritt(w: Wesen, dt: number, teich: Teich, zufall: Zufall): Wesen {
  const weiter = zielFlug(w, dt, teich, zufall, 22 + 34 * w.tiefe, [0.4, 2]);
  const gaukeln = Math.sin(w.phase * 0.35) * 14 * dt;   // das typische Auf und Ab
  return { ...weiter, y: weiter.y + gaukeln, phase: w.phase + dt * 13 };
}

function schmetterlingKapseln(w: Wesen): Kapsel[] {
  const s = 1.6 + 1.1 * w.tiefe;
  const offen = 0.45 + 0.55 * Math.abs(Math.cos(w.phase));   // Flügel hoch = von oben schmal
  const leib = strahl(w.x, w.y, w.winkel + Math.PI, 18 * s, 3.5 * s, 2.5 * s);
  const ax = w.x - Math.cos(w.winkel) * 6 * s;
  const ay = w.y - Math.sin(w.winkel) * 6 * s;
  // Vorderflügel groß und zur Spitze breit, Hinterflügel kleiner und rund.
  const fluegel = [1, -1].flatMap((seite) => [
    strahl(ax, ay, w.winkel + seite * (Math.PI / 2 - 0.45), 24 * s * offen, 5 * s, 11 * s * offen + 2),
    strahl(ax, ay, w.winkel + seite * (Math.PI / 2 + 0.6), 17 * s * offen, 5 * s, 9 * s * offen + 2),
  ]);
  return [leib, ...fluegel];
}

// ── Vogel ───────────────────────────────────────────────────────────────────
function vogelSchritt(w: Wesen, zeit: number, dt: number, teich: Teich): Wesen {
  const winkel = sKurve(w, zeit, dt, 0.12);
  const tempo = 38 + 40 * w.tiefe;
  return {
    ...w,
    winkel,
    x: umlauf(w.x + Math.cos(winkel) * tempo * dt, teich.breite),
    y: umlauf(w.y + Math.sin(winkel) * tempo * dt, teich.hoehe),
    phase: w.phase + dt * (5 + 2 * w.tiefe),
  };
}

function vogelKapseln(w: Wesen): Kapsel[] {
  const s = 1.6 + 1.0 * w.tiefe;
  const leib = strahl(w.x, w.y, w.winkel + Math.PI, 16 * s, 5 * s, 3 * s);
  const schlag = Math.sin(w.phase);
  const mx = w.x - Math.cos(w.winkel) * 5 * s;
  const my = w.y - Math.sin(w.winkel) * 5 * s;
  // Geknickte Flügel: Oberarm fast quer, Hand weiter nach hinten — von oben
  // gesehen das flache „M" ziehender Vögel. Der Schlag hebt und senkt beides.
  const fluegel = [1, -1].flatMap((seite) => {
    const oben = strahl(mx, my, w.winkel + seite * (Math.PI / 2 + 0.15 + schlag * 0.25), 15 * s, 6 * s, 4.5 * s);
    const hand = strahl(oben.bx, oben.by, w.winkel + seite * (Math.PI / 2 + 0.7 + schlag * 0.4), 16 * s, 4.5 * s, 1.5 * s);
    return [oben, hand];
  });
  return [leib, ...fluegel];
}

// ── Steckbriefe ─────────────────────────────────────────────────────────────
export interface Steckbrief {
  /** Wie viele bei dieser Fensterfläche (px²). */
  readonly anzahl: (flaeche: number) => number;
  readonly tiefe: readonly [number, number];
  readonly paletten: readonly number[];
  readonly schritt: (w: Wesen, zeit: number, dt: number, teich: Teich, zufall: Zufall) => Wesen;
  readonly kapseln: (w: Wesen) => Kapsel[];
}

function proFlaeche(je: number, min: number, max: number): (flaeche: number) => number {
  return (flaeche) => Math.min(max, Math.max(min, Math.round(flaeche / je)));
}

export const STECKBRIEFE: Record<Art, Steckbrief> = {
  koi: {
    anzahl: proFlaeche(300_000, 3, 5),
    tiefe: [0.45, 1],
    paletten: [0, 1, 2],
    schritt: (w, zeit, dt, teich) => koiSchritt(w, zeit, dt, teich),
    kapseln: koiKapseln,
  },
  libelle: {
    anzahl: proFlaeche(240_000, 3, 5),
    tiefe: [0.5, 1],
    paletten: [3],
    schritt: (w, _zeit, dt, teich, zufall) => libelleSchritt(w, dt, teich, zufall),
    kapseln: libelleKapseln,
  },
  qualle: {
    anzahl: proFlaeche(220_000, 3, 6),
    tiefe: [0.4, 1],
    paletten: [4],
    schritt: (w, zeit, dt, teich) => qualleSchritt(w, zeit, dt, teich),
    kapseln: qualleKapseln,
  },
  schmetterling: {
    anzahl: proFlaeche(200_000, 4, 7),
    tiefe: [0.45, 1],
    paletten: [5, 6],
    schritt: (w, _zeit, dt, teich, zufall) => schmetterlingSchritt(w, dt, teich, zufall),
    kapseln: schmetterlingKapseln,
  },
  vogel: {
    anzahl: proFlaeche(160_000, 5, 9),
    tiefe: [0.4, 1],
    paletten: [7],
    schritt: (w, zeit, dt, teich) => vogelSchritt(w, zeit, dt, teich),
    kapseln: vogelKapseln,
  },
};
