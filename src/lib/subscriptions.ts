// Abo-Übersicht für die Karte ganz unten. Bedient von GET /api/subscriptions
// (electron/subscriptions.cjs) — dort steht, warum die drei Dienste auf drei
// verschiedenen Wegen kommen.
//
// WARUM HIER GEPRÜFT WIRD
// Ein Teil der Antwort stammt aus einer fremden API (z.ai) und ein Teil aus
// einem JWT, das ein anderer Rechner geschickt hat. Beides ist nichts, worauf
// man ungeprüft `.toFixed()` aufruft.

export type AboStatus = "ok" | "unbekannt";

export type AboVerbrauch = {
  wocheProzent: number;
  fuenfStundenProzent: number | null;
  resetAt: string | null;
  credits: { verbraucht: number; gesamt: number; uebrig: number } | null;
};

export type AboKosten = {
  betrag: number;
  waehrung: string;
  zyklus: "monatlich" | "jaehrlich";
};

export type Abo = {
  id: string;
  name: string;
  anbieter: string;
  status: AboStatus;
  plan: string | null;
  verbrauch: AboVerbrauch | null;
  kosten: AboKosten | null;
  quelle: string | null;
  standVon: string | null;
  hinweis: string | null;
  laufzeitBis?: string | null;
};

export type AboUebersicht = {
  serverDate: string;
  gesamt: { betragProMonat: number; waehrung: string; vollstaendig: boolean } | null;
  kostenHinweis: string | null;
  dienste: Abo[];
};

function zahl(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function prozent(v: unknown): number {
  const n = zahl(v);
  return n === null ? 0 : Math.max(0, Math.min(100, n));
}

function zuVerbrauch(v: unknown): AboVerbrauch | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const c = o.credits as Record<string, unknown> | null | undefined;
  return {
    wocheProzent: prozent(o.wocheProzent),
    fuenfStundenProzent: zahl(o.fuenfStundenProzent) === null ? null : prozent(o.fuenfStundenProzent),
    resetAt: text(o.resetAt),
    credits:
      c && zahl(c.gesamt) !== null
        ? { verbraucht: zahl(c.verbraucht) ?? 0, gesamt: zahl(c.gesamt) ?? 0, uebrig: zahl(c.uebrig) ?? 0 }
        : null,
  };
}

function zuKosten(v: unknown): AboKosten | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const betrag = zahl(o.betrag);
  if (betrag === null) return null;
  return {
    betrag,
    waehrung: text(o.waehrung) ?? "EUR",
    zyklus: o.zyklus === "jaehrlich" ? "jaehrlich" : "monatlich",
  };
}

function zuAbo(v: unknown): Abo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = text(o.id);
  if (!id) return null;
  // Alles, was nicht ausdrücklich "ok" meldet, gilt als unbekannt. Der Zweifel
  // fällt zugunsten der Ehrlichkeit aus, nicht zugunsten eines grünen Balkens.
  const status: AboStatus = o.status === "ok" ? "ok" : "unbekannt";
  return {
    id,
    name: text(o.name) ?? id,
    anbieter: text(o.anbieter) ?? "",
    status,
    plan: text(o.plan),
    verbrauch: status === "ok" ? zuVerbrauch(o.verbrauch) : null,
    kosten: zuKosten(o.kosten),
    quelle: text(o.quelle),
    standVon: text(o.standVon),
    hinweis: text(o.hinweis),
    laufzeitBis: text(o.laufzeitBis),
  };
}

export async function fetchAbos(): Promise<AboUebersicht | null> {
  try {
    const res = await fetch("/api/subscriptions?t=" + Date.now());
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;
    const dienste = Array.isArray(o.dienste)
      ? o.dienste.map(zuAbo).filter((d): d is Abo => d !== null)
      : [];
    if (dienste.length === 0) return null;
    const g = o.gesamt as Record<string, unknown> | null | undefined;
    return {
      serverDate: text(o.serverDate) ?? "",
      gesamt:
        g && zahl(g.betragProMonat) !== null
          ? {
              betragProMonat: zahl(g.betragProMonat) ?? 0,
              waehrung: text(g.waehrung) ?? "EUR",
              vollstaendig: g.vollstaendig === true,
            }
          : null,
      kostenHinweis: text(o.kostenHinweis),
      dienste,
    };
  } catch {
    return null;
  }
}
