// ── Das Morgen-Briefing, wie der Browser es sieht ───────────────────────────
//
// Geschrieben wird es von Hermes über POST /api/hermes/briefing, gespeichert
// unter `morning.briefing` — von dort holt der Abgleich (lib/sync.ts) es in den
// localStorage. Diese Datei ist die einzige Stelle, die den Schlüssel kennt;
// Karte und Pop-up lesen ausschliesslich hier.
//
// WARUM EIN EIGENER HOOK STATT useState IN JEDER KOMPONENTE
// Das Briefing entsteht ausserhalb der App. Wer es nur beim Aufbau liest, zeigt
// bis zum nächsten Neuladen einen leeren Kasten, obwohl der Text längst da ist.
// Der Hook hört deshalb auf dieselben Signale, die auch der Abgleich auslöst.

import { useEffect, useState } from "react";

const BRIEFING_KEY = "morning.briefing";
const ACK_KEY = "morning.assistant.acknowledgedEvents";
const RELOAD_MS = 60_000;

export type BriefingAlert = {
  id: string;
  title: string;
  why?: string;
  deadline?: string;
};

/** Die kurzen Zeilen im Dashboard, geschrieben von Hermes.
 *  Jedes Feld ist einzeln optional: fehlt eines, greift für genau dieses die
 *  lokale Berechnung weiter — nicht für alle drei. */
export type BriefingLines = {
  headerGreeting?: string;
  tagline?: string;
  todayLead?: string;
};

export type Briefing = {
  date: string;
  text: string;
  alert?: BriefingAlert;
  lines?: BriefingLines;
  updatedAt?: string;
};

/** Heute in Berlin — dieselbe Zeitzone, die auch der Server benutzt. Ohne das
 *  gilt ein um 00:30 geschriebenes Briefing je nach Rechnerzeitzone schon als
 *  von gestern und stünde grundlos als veraltet da. */
export function heuteIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

export function loadBriefing(): Briefing | null {
  try {
    const raw = localStorage.getItem(BRIEFING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.text !== "string" || typeof o.date !== "string") return null;
    const out: Briefing = { date: o.date, text: o.text };
    if (typeof o.updatedAt === "string") out.updatedAt = o.updatedAt;
    const a = o.alert as Record<string, unknown> | undefined;
    if (a && typeof a.id === "string" && typeof a.title === "string") {
      out.alert = { id: a.id, title: a.title };
      if (typeof a.why === "string") out.alert.why = a.why;
      if (typeof a.deadline === "string") out.alert.deadline = a.deadline;
    }
    const l = o.lines as Record<string, unknown> | undefined;
    if (l && typeof l === "object") {
      const zeilen: BriefingLines = {};
      // Leerstrings absichtlich verwerfen: sonst gewänne ein "" gegen die
      // lokale Berechnung und die Zeile bliebe einfach leer stehen.
      if (typeof l.headerGreeting === "string" && l.headerGreeting.trim()) zeilen.headerGreeting = l.headerGreeting.trim();
      if (typeof l.tagline === "string" && l.tagline.trim()) zeilen.tagline = l.tagline.trim();
      if (typeof l.todayLead === "string" && l.todayLead.trim()) zeilen.todayLead = l.todayLead.trim();
      if (Object.keys(zeilen).length) out.lines = zeilen;
    }
    return out;
  } catch {
    return null;
  }
}

export function loadAcknowledged(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return new Set();
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

/** Quittieren — `morning.assistant.acknowledgedEvents`, dieselbe Liste, die
 *  auch der Server beim Speichern eines Briefings prüft (hermesApi.cjs).
 *  Bewusst dieselbe: was Paul einmal abgehakt hat, soll ihm nirgends erneut
 *  vorgelegt werden, egal über welchen Weg es kam. */
export function acknowledgeAlert(id: string): void {
  const next = loadAcknowledged();
  next.add(id);
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(Array.from(next)));
  } catch {
    /* Speicher voll — dann bleibt es beim nächsten Start eben stehen */
  }
}

/** Tage bis zur Frist. Gerechnet wird auf Kalendertagen, nicht auf Stunden:
 *  "morgen" soll auch um 23:50 noch "morgen" heissen und nicht "in 0 Tagen". */
export function tageBis(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [jy, jm, jd] = heuteIso().split("-").map(Number);
  const [zy, zm, zd] = iso.split("-").map(Number);
  const heute = Date.UTC(jy, jm - 1, jd);
  const ziel = Date.UTC(zy, zm - 1, zd);
  return Math.round((ziel - heute) / 86_400_000);
}

export function fristText(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = tageBis(iso);
  if (d === null) return null;
  if (d < -1) return `seit ${Math.abs(d)} Tagen überfällig`;
  if (d === -1) return "seit gestern überfällig";
  if (d === 0) return "heute fällig";
  if (d === 1) return "noch 1 Tag";
  return `noch ${d} Tage`;
}

/** Die Zeilen für HEUTE — oder null.
 *
 *  WARUM DIE DATUMSPRÜFUNG HIER STEHT UND NICHT IN DEN KOMPONENTEN
 *  Ein Briefing von gestern bleibt im Speicher liegen, bis Hermes das nächste
 *  schreibt. Läuft er einmal nicht, stünde morgens noch die Zeile von gestern
 *  im Header — schlimmer als die Formel, weil sie so aussieht, als wäre sie
 *  von heute. Drei Komponenten müssten dieselbe Prüfung machen; eine würde sie
 *  über kurz oder lang vergessen. Deshalb genau einmal, hier.
 *
 *  Der Text der Karte bleibt davon unberührt: der darf alt sein, weil die
 *  Karte ihr Alter ausdrücklich anzeigt. Die kurzen Zeilen können das nicht. */
export function useTagesZeilen(): BriefingLines | null {
  const briefing = useBriefing();
  if (!briefing || !briefing.lines) return null;
  if (briefing.date !== heuteIso()) return null;
  return briefing.lines;
}

/** Liest das Briefing und bleibt dran.
 *
 *  Drei Signale, weil jedes für sich Lücken hat: `storage` feuert nur in
 *  ANDEREN Tabs, die Abgleich-Ereignisse nur wenn wirklich etwas übernommen
 *  wurde, und der Takt fängt den Rest. Zusammen kostet das fast nichts und
 *  verhindert den Fall "Text ist da, Karte zeigt ihn nicht". */
export function useBriefing(): Briefing | null {
  const [briefing, setBriefing] = useState<Briefing | null>(() => loadBriefing());

  useEffect(() => {
    const lesen = () => setBriefing(loadBriefing());
    const beiSichtbar = () => { if (document.visibilityState === "visible") lesen(); };

    window.addEventListener("storage", lesen);
    window.addEventListener("morning:todos-changed", lesen);
    window.addEventListener("morning:events-changed", lesen);
    document.addEventListener("visibilitychange", beiSichtbar);
    const takt = setInterval(lesen, RELOAD_MS);

    return () => {
      window.removeEventListener("storage", lesen);
      window.removeEventListener("morning:todos-changed", lesen);
      window.removeEventListener("morning:events-changed", lesen);
      document.removeEventListener("visibilitychange", beiSichtbar);
      clearInterval(takt);
    };
  }, []);

  return briefing;
}
