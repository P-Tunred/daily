// Ein Ort, an dem über das Briefing entschieden wird.
//
// WARUM ZENTRAL UND NICHT JE KOMPONENTE
// Vorher entschied jede Fläche für sich, ob die Hermes-Zeilen gelten: die
// Karte las das Briefing, HeuteJarvis prüfte das Datum, TodayCorner prüfte es
// gar nicht und zeigte die Zeile nur, wenn zufällig Aufgaben dastanden. Drei
// Meinungen über dieselbe Frage — und die dritte war falsch. Genau so entsteht
// ein Dashboard, das teils Hermes zeigt und teils die Formel, ohne dass jemand
// sagen könnte, warum.
//
// Hier fällt die Entscheidung EINMAL: Was ist von heute? Was kommt von Hermes,
// was ist lokaler Rückfall? Die Komponenten fragen nur noch ab.
//
// WARUM DER PROVIDER DEM SERVER MELDET, WAS ER GERENDERT HAT
// Der Server weiss, dass er geschrieben hat. Ob je ein Browser es angezeigt
// hat, weiss nur der Browser. Ohne diese Rückmeldung endet die Beweiskette bei
// "persistiert" — und genau dort lag der Fehler vom 15.08.: gespeichert,
// gemeldet, nie sichtbar. Gemeldet wird die REVISION (sha256), nicht ein
// blosses "ja": damit lässt sich nichts bestätigen, was nie geschrieben wurde.

import { createContext, useContext, useEffect } from "react";
import { heuteIso, type Briefing, type BriefingLines } from "./briefing";

/** Welche Flächen eine Revision tragen müssen, damit sie als gerendert gilt. */
export type Surface = "card" | "greeting" | "tagline" | "todayLead";

export type BriefingQuelle = "hermes" | "lokal";

export type BriefingStatus = {
  serverDate: string;
  state: "fresh" | "missing" | "stale" | "error";
  revision: string | null;
  persistedAt: string | null;
  eligibleNow: boolean;
  renderedAt?: string | null;
  hermesFields?: string[];
  fallbackFields?: string[];
  reason?: string;
};

export type BriefingSicht = {
  /** Das rohe Briefing — auch wenn es alt ist. Die Karte zeigt sein Alter an. */
  briefing: Briefing | null;
  /** Die Zeilen, die HEUTE gelten. Null, wenn es keine gibt oder sie alt sind. */
  zeilen: BriefingLines | null;
  /** Serverzustand; null solange nicht abgefragt (oder Server nicht erreichbar). */
  status: BriefingStatus | null;
  /** Kurzform für die sichtbare Markierung an der Karte. */
  herkunft: {
    quelle: BriefingQuelle;
    /** "Hermes · aktuell · 06:04" / "Heute kein Hermes-Briefing · lokale Texte" … */
    text: string;
    /** true, wenn einzelne Zeilen von Hermes und andere lokal sind. */
    gemischt: boolean;
  };
  /** Meldet, dass eine Fläche die aktuelle Revision wirklich gerendert hat. */
  meldeGerendert: (surface: Surface) => void;
};

export const BriefingCtx = createContext<BriefingSicht | null>(null);


/** Sichtbarer Zustandstext. Bewusst nüchtern — er soll informieren, nicht
 *  alarmieren. Aber er darf NIE so aussehen, als käme ein lokaler Text von
 *  Hermes; genau diese Verwechslung hat den Fehler vom 15.08. verdeckt. */
export function herkunftText(
  briefing: Briefing | null,
  zeilen: BriefingLines | null,
  status: BriefingStatus | null,
): { quelle: BriefingQuelle; text: string; gemischt: boolean } {
  const uhr = (iso?: string | null) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); }
    catch { return null; }
  };

  if (status?.state === "error") {
    return { quelle: "lokal", text: "Serverzustand nicht lesbar · lokale Texte", gemischt: false };
  }
  if (!briefing) {
    // Kein Briefing UND kein Server erreichbar sind zwei verschiedene Dinge.
    if (status === null) return { quelle: "lokal", text: "Sync offline · lokale Texte", gemischt: false };
    return { quelle: "lokal", text: "Heute kein Hermes-Briefing · lokale Texte", gemischt: false };
  }
  if (briefing.date !== heuteIso()) {
    return { quelle: "lokal", text: `Stand von ${briefing.date} · lokale Texte`, gemischt: false };
  }
  const felder: Array<keyof BriefingLines> = ["headerGreeting", "tagline", "todayLead"];
  const vorhanden = felder.filter((f) => zeilen?.[f]);
  const zeit = uhr(briefing.updatedAt ?? status?.persistedAt);
  if (vorhanden.length === felder.length) {
    return { quelle: "hermes", text: `Hermes · aktuell${zeit ? ` · ${zeit}` : ""}`, gemischt: false };
  }
  if (vorhanden.length === 0) {
    return { quelle: "hermes", text: `Hermes · nur Text${zeit ? ` · ${zeit}` : ""}`, gemischt: true };
  }
  return { quelle: "hermes", text: `Teilweise lokal ergänzt${zeit ? ` · ${zeit}` : ""}`, gemischt: true };
}


/** Die eine Abfrage für alle Flächen.
 *
 *  Ohne Provider (etwa in einem Test, der nur eine Komponente montiert) gibt
 *  es einen neutralen Rückfall statt eines Absturzes — die Komponente zeigt
 *  dann ihre lokalen Texte, was genau das gewünschte Verhalten ist. */
export function useBriefingSicht(): BriefingSicht {
  const v = useContext(BriefingCtx);
  if (v) return v;
  return {
    briefing: null, zeilen: null, status: null,
    herkunft: { quelle: "lokal", text: "lokale Texte", gemischt: false },
    meldeGerendert: () => {},
  };
}

/** Meldet beim Rendern, dass diese Fläche die aktuelle Revision trägt.
 *  `aktiv` ist false, wenn die Fläche gerade den lokalen Rückfall zeigt —
 *  dann darf nichts gemeldet werden, sonst hiesse "rendered" nur noch
 *  "irgendein Text stand da". */
export function useMeldeGerendert(surface: Surface, aktiv: boolean): void {
  const { meldeGerendert, status } = useBriefingSicht();
  useEffect(() => {
    if (!aktiv) return;
    if (!status?.revision) return;
    meldeGerendert(surface);
  }, [aktiv, surface, meldeGerendert, status?.revision]);
}
