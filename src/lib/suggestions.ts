// Die Vorschläge im Morgendialog — Browser-Seite.
//
// Die Regeln liegen alle im Server (electron/suggestionStore.cjs): höchstens
// drei, Kennung aus der Quelle, einmal entschieden nie wieder, ein Dialog pro
// Tag. Hier wird nichts davon nachgebaut — der Browser fragt, was gilt.
//
// WARUM `dialogErledigt` VOM SERVER KOMMT UND NICHT AUS DEM BROWSERSPEICHER
// Ein Merker im localStorage wäre pro Gerät. Paul öffnet Daily auf dem Mac und
// später im Browser — und bekäme denselben Dialog zweimal. Der Server weiss es
// einmal, für alle.

export type Vorschlag = {
  id: string;
  art: "todo" | "termin";
  titel: string;
  warum: string;
  datum: string | null;
  quelle: string;
};

export type VorschlagZustand = {
  serverDate: string;
  vorschlaege: Vorschlag[];
  dialogErledigt: boolean;
  entschiedeneGesamt: number;
};

const LEER: VorschlagZustand = {
  serverDate: "",
  vorschlaege: [],
  dialogErledigt: true, // im Zweifel NICHT stören
  entschiedeneGesamt: 0,
};

function istVorschlag(v: unknown): v is Vorschlag {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string"
    && (o.art === "todo" || o.art === "termin")
    && typeof o.titel === "string"
    && typeof o.warum === "string";
}

/** Holt den Stand. Bei jedem Fehler kommt "nichts zu tun" zurück — ein Dialog,
 *  der wegen eines Netzfehlers erscheint und nichts anzeigen kann, ist
 *  schlimmer als keiner. */
export async function ladeVorschlaege(): Promise<VorschlagZustand> {
  try {
    const res = await fetch("/api/suggestions", { headers: { Accept: "application/json" } });
    if (!res.ok) return LEER;
    const v = (await res.json()) as Record<string, unknown>;
    return {
      serverDate: typeof v.serverDate === "string" ? v.serverDate : "",
      vorschlaege: Array.isArray(v.vorschlaege) ? v.vorschlaege.filter(istVorschlag) : [],
      dialogErledigt: v.dialogErledigt === true,
      entschiedeneGesamt: typeof v.entschiedeneGesamt === "number" ? v.entschiedeneGesamt : 0,
    };
  } catch {
    return LEER;
  }
}

/** Ja oder Nein. Der Server legt bei Ja selbst an — der Browser braucht dafür
 *  kein Hermes-Token, das läge sonst im ausgelieferten JavaScript. */
export async function entscheide(id: string, ja: boolean): Promise<{ ok: boolean; fehler?: string }> {
  try {
    const res = await fetch("/api/suggestions/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ja }),
    });
    const v = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, fehler: typeof v.error === "string" ? v.error : `Server ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Netzwerkfehler" };
  }
}

/** "Fertig" — für heute durch. "Später" ruft das bewusst NICHT auf: dann kommt
 *  der Dialog morgen wieder, und nichts ist entschieden. Wer nicht folgenlos
 *  vertagen kann, klickt irgendwann alles weg. */
export async function quittiereDialog(): Promise<void> {
  try {
    await fetch("/api/suggestions/ack", { method: "POST" });
  } catch {
    /* Beim nächsten Öffnen eben nochmal — schlimmer wäre ein Absturz. */
  }
}
