// Klausur-Stand — wie viel Zeit bleibt, wie weit Paul ist, wo er mehr
// schieben muss. Für den Score (Lernzeit › Score) und „Heute".
//
// Pauls Wunsch (2026-11-13): „sehen, wie viel Zeit ich noch habe und wie weit
// ich bin, und was ich mehr pushen muss" — keine Fehlerzählerei.
//
// DREI ZAHLEN, ALLE AUS DEM, WAS SCHON DA IST
//   zeit   — Lernzeit, die bis zur Wiederholung (bzw. bis zur Klausur) noch
//            bleibt: Lerntage × geplantes Tagesmass aus dem Auftrag.
//   rest   — Arbeit, die noch fehlt, bei Pauls gemessenem Tempo
//            (lernTempo.restMinuten — dieselbe Rechnung wie das Tagesziel).
//   puffer — zeit − rest. Positiv: Luft. Negativ: so viel fehlt.
// Die Lage folgt aus dem Verhältnis rest ÷ zeit, damit 2 h Puffer bei einer
// Klausur in drei Tagen etwas anderes heissen als bei einer in acht Wochen.
//
// MEHR SCHIEBEN
// Höchstens drei Schwerpunkte, je mit einem Grund in Worten. Lernphase: erst
// die angefangenen mit Lücken (offene Arbeit × Klausurgewicht, wacklig
// Verstandenes zählt mehr), dann die nächsten neuen in der Reihenfolge des
// Auftrags — erst fertig machen, dann dem Lernpfad folgen.
// Wiederholung: was am wackligsten ist.
//
// Reine Funktion, kein Speicher, kein Datum.

import type { Gewicht, PlanerFokus } from "./klausurPlaner.ts";
import { restMinuten, restMinutenFokus } from "./lernTempo.ts";

export type Lage = "vorne" | "im-plan" | "knapp" | "hinten";

export type Schieben = { titel: string; warum: string };

export type KlausurStand = {
  klausur: string;
  phase: "lernen" | "wiederholung";
  tageBisKlausur: number;
  /** Lerntage bis zur Wiederholung (lernen) bzw. bis zur Klausur. */
  tageUebrig: number;
  /** 0…1: Anteil des geplanten Aufwands, der hinter Paul liegt. */
  erledigt: number;
  /** Lernzeit, die noch bleibt (Minuten). */
  zeitMin: number;
  /** Arbeit, die noch fehlt, bei Pauls Tempo (Minuten). */
  restMin: number;
  /** zeit − rest (Minuten); negativ = zu wenig Zeit. */
  pufferMin: number;
  lage: Lage;
  /** Was es am Tag bräuchte, und was der Auftrag vorsieht (Minuten). */
  proTagNoetig: number;
  proTagPlan: number;
  schieben: Schieben[];
};

export type StandEingabe = {
  klausur: string;
  phase: "lernen" | "wiederholung";
  tageBisKlausur: number;
  tageUebrig: number;
  /** Geplantes Tagesmass laut Auftrag (Minuten). */
  planProTag: number;
  erledigt: number;
  fokusse: readonly PlanerFokus[];
  /** Pauls Tempo (tatsächlich ÷ geplant); null = noch nicht gemessen. */
  faktor: number | null;
};

const MAX_SCHIEBEN = 3;
/** Grenzen für rest ÷ zeit. */
const VORNE_BIS = 0.85;
const KNAPP_BIS = 1.25;
const GEWICHT: Record<Gewicht, number> = { hoch: 3, mittel: 2, niedrig: 1 };
const gewichtVon = (g: Gewicht | null) => (g ? GEWICHT[g] : 2);
const WACKLIG_UNTER = 0.7;
const VIELE_FRAGEN = 10;
const WENIG_DURCH = 0.6;

const pct = (x: number) => `${Math.round(x * 100)} %`;
const stunden = (min: number) => {
  const h = min / 60;
  return h >= 10 ? `${Math.round(h)} h` : `${Math.round(h * 10) / 10} h`.replace(".", ",");
};

export function lageAus(restMin: number, zeitMin: number): Lage {
  if (restMin <= 0) return "vorne";
  if (zeitMin <= 0) return "hinten";
  const q = restMin / zeitMin;
  if (q <= VORNE_BIS) return "vorne";
  if (q <= 1) return "im-plan";
  if (q <= KNAPP_BIS) return "knapp";
  return "hinten";
}

/** Der eine Grund, warum ein Schwerpunkt geschoben werden sollte. */
export function grundFuer(f: PlanerFokus, restMin: number): string {
  if (!f.angefangen || f.fortschritt === 0) return `noch nicht angefangen · ~${stunden(restMin)}`;
  if (f.verstaendnis !== null && f.verstaendnis < WACKLIG_UNTER) return `erst ${pct(f.verstaendnis)} verstanden`;
  if (f.fortschritt < WENIG_DURCH) return `erst ${pct(f.fortschritt)} durchgearbeitet`;
  if (f.offeneFragen >= VIELE_FRAGEN) return `${f.offeneFragen} offene Fragen`;
  return `noch ~${stunden(restMin)}`;
}

function schiebenLernphase(fokusse: readonly PlanerFokus[], faktor: number | null): Schieben[] {
  return fokusse
    .map((f, i) => ({ f, i, rest: restMinutenFokus(f, faktor) }))
    .filter((x) => x.rest > 0)
    .map((x) => {
      const wacklig = x.f.verstaendnis !== null && x.f.verstaendnis < WACKLIG_UNTER;
      const angefangen = x.f.angefangen && x.f.fortschritt > 0;
      const druck = gewichtVon(x.f.gewicht) * x.rest * (wacklig ? 1.5 : 1);
      return { ...x, angefangen, druck };
    })
    // Angefangene mit Lücken zuerst (nach Druck), dann die nächsten neuen in
    // der Reihenfolge des Auftrags — das ist Pauls Lernpfad (LearnHarness).
    .sort((a, b) => Number(b.angefangen) - Number(a.angefangen) || (a.angefangen ? b.druck - a.druck : 0) || a.i - b.i)
    .slice(0, MAX_SCHIEBEN)
    .map((x) => ({ titel: x.f.titel, warum: grundFuer(x.f, x.rest) }));
}

function schiebenWiederholung(fokusse: readonly PlanerFokus[], faktor: number | null): Schieben[] {
  const wackel = (f: PlanerFokus) => (1 - (f.verstaendnis ?? f.erledigt)) + f.offeneFragen * 0.1 + (f.gewicht === "hoch" ? 0.2 : 0);
  return [...fokusse]
    .map((f, i) => ({ f, i, w: wackel(f) }))
    .filter((x) => x.w > 0.15)
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, MAX_SCHIEBEN)
    .map(({ f }) => ({ titel: f.titel, warum: grundFuer(f, restMinutenFokus(f, faktor)) }));
}

export function klausurStand(e: StandEingabe): KlausurStand {
  const tage = Math.max(1, e.tageUebrig);
  const zeitMin = Math.round(tage * e.planProTag);
  const restMin = restMinuten(e.fokusse, e.faktor);
  const schieben = e.phase === "lernen" ? schiebenLernphase(e.fokusse, e.faktor) : schiebenWiederholung(e.fokusse, e.faktor);
  return {
    klausur: e.klausur,
    phase: e.phase,
    tageBisKlausur: e.tageBisKlausur,
    tageUebrig: e.tageUebrig,
    erledigt: e.erledigt,
    zeitMin,
    restMin,
    pufferMin: zeitMin - restMin,
    lage: lageAus(restMin, zeitMin),
    proTagNoetig: Math.round(restMin / tage),
    proTagPlan: Math.round(e.planProTag),
    schieben,
  };
}

/** Die Klausur, die am meisten Aufmerksamkeit braucht: die schlechteste Lage,
 *  bei gleicher Lage die mit dem kleinsten Puffer im Verhältnis zur Zeit. */
export function dringendste(staende: readonly KlausurStand[]): KlausurStand | null {
  const rang: Record<Lage, number> = { hinten: 0, knapp: 1, "im-plan": 2, vorne: 3 };
  const anteil = (s: KlausurStand) => (s.zeitMin > 0 ? s.pufferMin / s.zeitMin : -Infinity);
  return [...staende].sort((a, b) => rang[a.lage] - rang[b.lage] || anteil(a) - anteil(b))[0] ?? null;
}

/** „+3 h Puffer" / „6 h zu wenig" — für Zeilen und Hebel. */
export function pufferText(min: number): string {
  if (Math.abs(min) < 30) return "genau passend";
  return min > 0 ? `${stunden(min)} Puffer` : `${stunden(-min)} zu wenig`;
}

export const LAGE_TEXT: Record<Lage, string> = {
  vorne: "vorne",
  "im-plan": "im Plan",
  knapp: "knapp",
  hinten: "hinten",
};

/** „24 h" / „6,5 h" — Stunden für Anzeigen, eine Nachkommastelle unter 10 h. */
export { stunden as stundenText };

/** „1 h 45" / „40 min" — Tagesmengen, auf 15 min aufgerundet. */
function tagesMenge(min: number): string {
  const m = Math.ceil(min / 15) * 15;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

/** Ein Satz, der sagt, was die Zahlen bedeuten. */
export function standSatz(s: KlausurStand): string {
  if (s.restMin <= 0) return "Alles durch — jetzt nur noch wiederholen.";
  if (s.phase === "wiederholung") {
    return s.lage === "hinten" || s.lage === "knapp"
      ? `Wiederholung läuft, aber ${stunden(s.restMin)} Arbeit sind noch offen.`
      : "Wiederholung läuft — das Wackligste zuerst.";
  }
  const noetig = tagesMenge(s.proTagNoetig);
  const plan = tagesMenge(s.proTagPlan);
  switch (s.lage) {
    case "vorne": return `Du brauchst ${noetig} am Tag, geplant sind ${plan}. Luft da.`;
    case "im-plan": return `Du brauchst ${noetig} am Tag, geplant sind ${plan}. Genau im Plan.`;
    case "knapp": return `Du brauchst ${noetig} am Tag statt ${plan}. Wird eng.`;
    case "hinten": return `Du brauchst ${noetig} am Tag statt ${plan}. So reicht die Zeit nicht.`;
  }
}

/** Der Hebel für „Was gerade bremst", wenn eine Klausur eng wird. */
export function klausurHebel(staende: readonly KlausurStand[]): { titel: string; warum: string } | null {
  const eng = staende.filter((s) => s.lage === "knapp" || s.lage === "hinten")
    .sort((a, b) => a.pufferMin - b.pufferMin)[0];
  if (!eng) return null;
  const was = eng.schieben.slice(0, 2).map((x) => x.titel).join(", ");
  return {
    titel: `${eng.klausur}: ${pufferText(eng.pufferMin)}`,
    warum: was ? `mehr schieben: ${was}` : `braucht ${tagesMenge(eng.proTagNoetig)} am Tag`,
  };
}
