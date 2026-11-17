// „Heute dran" fürs Lernen — Klausur-Planer + Lerntempo für die Morgens-Seite.
//
// Liefert je Klausur eine Zeile für „Was heute zählt" (Ziel, Ist, was dran ist,
// was bei Pauls Tempo realistisch wäre) und die Zahlen fürs Mitlernen
// (lib/lernTempo.ts). Dieselbe Planer-Rechnung wie auf der Lernzeit-Seite
// (planeAlle) — zwei Seiten mit zwei Rechnungen würden sich bald widersprechen.
//
// Die Zeilen sind PROJEKTIONEN, keine gespeicherten Todos: sie entstehen jeden
// Tag neu aus dem Planer und haken sich selbst ab, wenn Timer oder LearnHarness
// das Tagesziel gemessen haben. Ein liegengelassenes Lern-Todo, das sich Tag für
// Tag weiterschiebt, wäre genau die Liste, die Paul nicht will.

import { useEffect, useMemo, useState } from "react";
import { ladeLearnHarness, type Klausur } from "./learnHarness";
import { planeAlle } from "./klausurPlaner";
import { kapazitaet, mitZiel, realistisch, restMinuten, tempo, zielQuote, type Kapazitaet, type Realistisch, type Tempo } from "./lernTempo";
import { SCHLUESSEL, lies, schreib } from "./store";
import { klausurStand, type KlausurStand } from "./klausurStand";

export type LernZeile = {
  id: string;
  klausur: string;
  /** Tagesziel bei Pauls Tempo — in der Lernphase aus dem gemessenen Tempo
   *  je Untereinheit (restMinuten), in der Wiederholung das Mass des Plans.
   *  Das ist der Bedarf, der ins Tagesziel eingeht. */
  ziel: number;
  /** Tagesziel laut Auftrag (Planer ohne Tempo) — zum Vergleich. */
  planZiel: number;
  /** Tempo dieses Fachs (tatsächlich ÷ geplant), sonst das allgemeine. */
  faktor: number | null;
  /** Heute gelernt (Timer des Fachs / LearnHarness, das Größere). */
  ist: number;
  dran: string[];
  lage: "im-plan" | "knapp" | "zu-knapp";
  phase: "lernen" | "wiederholung";
  tageBisKlausur: number;
  /** Lerntage bis zur Wiederholung (lernen) bzw. Klausur (wiederholung). */
  tageUebrig: number;
  real: Realistisch;
  quote: { erreicht: number; von: number };
  /** Zeit übrig, Arbeit übrig, Puffer und was zu schieben ist (lib/klausurStand.ts). */
  stand: KlausurStand;
};

export type LernHeute = { zeilen: LernZeile[]; tempo: Tempo; kap: Kapazitaet };

export function useLernHeute(
  faecher: readonly { id: string; name: string }[],
  sitzungen: readonly { subjectId?: string; date: string; durationMin: number }[],
  heute: string,
): LernHeute | null {
  const [klausuren, setKlausuren] = useState<Klausur[]>([]);
  useEffect(() => {
    let alive = true;
    const hole = () => ladeLearnHarness().then((d) => { if (alive && d.ok) setKlausuren(d.klausuren.filter((k) => k.fokusse.length > 0)); });
    void hole();
    // LearnHarness schreibt nach jeder Session; die Spiegelung zieht stündlich nach.
    const t = setInterval(hole, 15 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const ergebnis = useMemo<LernHeute | null>(() => {
    if (klausuren.length === 0) return null;
    const plaene = planeAlle(klausuren, faecher, sitzungen, heute);
    const aktiv = plaene.filter((p) => p.plan.phase === "lernen" || p.plan.phase === "wiederholung");
    if (aktiv.length === 0) return null;

    // Kapazität: alles Lernen pro Tag, quer über die Fächer — Timer gesamt
    // gegen die Summe der Harness-Minuten, je Tag das Größere.
    const timerGesamt: Record<string, number> = {};
    for (const s of sitzungen) timerGesamt[s.date] = (timerGesamt[s.date] ?? 0) + s.durationMin;
    const harnessGesamt: Record<string, number> = {};
    for (const k of klausuren) for (const [d, m] of Object.entries(k.minutenProTag)) harnessGesamt[d] = (harnessGesamt[d] ?? 0) + m;
    const gesamt: Record<string, number> = {};
    for (const d of new Set([...Object.keys(timerGesamt), ...Object.keys(harnessGesamt)])) gesamt[d] = Math.max(timerGesamt[d] ?? 0, harnessGesamt[d] ?? 0);
    const kap = kapazitaet(gesamt, heute);
    const t = tempo(klausuren.flatMap((k) => k.fokusse.map((f) => ({ aufwandStunden: f.aufwandStunden, erledigt: f.erledigt, minuten: f.minuten }))));

    const verlauf = lies(SCHLUESSEL.lernplanVerlauf);
    const roh = aktiv.map((p) => {
      const plan = p.plan as Extract<typeof p.plan, { phase: "lernen" | "wiederholung" }>;
      const ist = p.istProTag[heute] ?? 0;
      // Tempo DIESES Fachs, sonst das allgemeine — Statistik kann langsamer
      // gehen als KM. Der Rest wird je Untereinheit mit ihrem gemessenen
      // Tempo gerechnet (restMinuten), nicht pauschal mal Faktor.
      const faktor = tempo(p.k.fokusse).faktor ?? t.faktor;
      const rest = restMinuten(p.k.fokusse, faktor);
      const ohneAndere = realistisch({ restStunden: plan.restStunden, restMinuten: rest, tageUebrig: plan.tageUebrig, minutenHeute: ist, faktor, kapazitaet: kap.schnittLerntage });
      // In der Wiederholung gilt das Mass des Auftrags — Neues wird dann
      // nicht mehr hochgerechnet, sondern wiederholt.
      const ziel = plan.phase === "lernen" ? ohneAndere.ziel : plan.tagesziel;
      return { p, plan, ist, ohneAndere, faktor, rest, ziel };
    });
    const bedarf = roh.reduce((s, r) => s + r.ziel, 0);
    const zeilen: LernZeile[] = roh.map(({ p, plan, ist, faktor, rest, ziel }) => {
      const ziele: Record<string, number> = {};
      for (const [d, z] of Object.entries(verlauf)) if (z[p.k.name] !== undefined) ziele[d] = z[p.k.name];
      return {
        id: `lern:${p.k.name}`,
        klausur: p.k.name,
        ziel,
        planZiel: plan.tagesziel,
        faktor,
        ist,
        dran: plan.heuteDran.map((h) => h.titel),
        lage: plan.lage,
        phase: plan.phase,
        tageBisKlausur: plan.tageBisKlausur,
        tageUebrig: plan.tageUebrig,
        real: realistisch({
          restStunden: plan.restStunden, restMinuten: rest, tageUebrig: plan.tageUebrig, minutenHeute: ist, faktor,
          kapazitaet: kap.schnittLerntage, bedarfAndere: bedarf - ziel,
        }),
        quote: zielQuote(ziele, p.istProTag, heute),
        stand: klausurStand({
          klausur: p.k.name, phase: plan.phase, tageBisKlausur: plan.tageBisKlausur, tageUebrig: plan.tageUebrig,
          planProTag: plan.planProTag, erledigt: plan.gesamtErledigt, fokusse: p.k.fokusse, faktor,
        }),
      };
    });
    return { zeilen, tempo: t, kap };
  }, [klausuren, faecher, sitzungen, heute]);

  // Das Tagesziel des Morgens festhalten — einmal pro Tag und Klausur.
  useEffect(() => {
    if (!ergebnis) return;
    let v = lies(SCHLUESSEL.lernplanVerlauf);
    const vorher = JSON.stringify(v);
    for (const z of ergebnis.zeilen) if (z.ziel > 0) v = mitZiel(v, heute, z.klausur, z.ziel);
    if (JSON.stringify(v) !== vorher) schreib(SCHLUESSEL.lernplanVerlauf, v);
  }, [ergebnis, heute]);

  return ergebnis;
}
