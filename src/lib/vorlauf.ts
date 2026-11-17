// Die offene Frage „wann soll das zur Aufgabe werden?" — siehe
// electron/vorlaufStore.cjs für das Warum.

export type VorlaufFrage = {
  eventId: string;
  titel: string;
  kind: string;
  datum: string;
  vorschlag: number;
  warum: string | null;
  gefragtAm: string;
};

export type VorlaufZustand = { offen: VorlaufFrage | null; gelernt: number };

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export async function fetchVorlauf(): Promise<VorlaufZustand | null> {
  try {
    const res = await fetch("/api/vorlauf?t=" + Date.now());
    if (!res.ok) return null;
    const d: unknown = await res.json();
    if (!d || typeof d !== "object") return null;
    const o = d as Record<string, unknown>;
    const f = o.offen as Record<string, unknown> | null | undefined;
    const gelernt = typeof o.gelernt === "number" ? o.gelernt : 0;
    if (!f || !text(f.eventId) || !text(f.datum)) return { offen: null, gelernt };
    return {
      gelernt,
      offen: {
        eventId: String(f.eventId),
        titel: text(f.titel) ?? "Ohne Titel",
        kind: text(f.kind) ?? "note",
        datum: String(f.datum),
        vorschlag: typeof f.vorschlag === "number" ? f.vorschlag : 0,
        warum: text(f.warum),
        gefragtAm: text(f.gefragtAm) ?? "",
      },
    };
  } catch {
    return null;
  }
}

export async function antworteVorlauf(vorlaufTage: number): Promise<string | null> {
  try {
    const res = await fetch("/api/vorlauf/antwort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vorlaufTage }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return (d as { error?: string }).error ?? `Server antwortete ${res.status}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Unbekannter Fehler";
  }
}

export async function verwirfVorlauf(): Promise<void> {
  try {
    await fetch("/api/vorlauf/verwerfen", { method: "POST" });
  } catch {
    /* stumm — beim nächsten Laden steht sie eben noch da */
  }
}
