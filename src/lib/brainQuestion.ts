// Die Brain-Frage, wie der Browser sie sieht.
//
// Gelesen wird über /api/question, geantwortet über /api/question/answer —
// beides hinter Basic-Auth, nicht über den Hermes-Zweig. Der Browser hat das
// HERMES_TOKEN nicht; läge die Route dort, bekäme jeder Klick ein stummes 401.
//
// Die Regeln (eine offene Frage, 7 Tage Ruhe, nie wieder) stehen bewusst NICHT
// hier, sondern in electron/questionStore.cjs. Sie hier zu wiederholen hiesse,
// dieselbe Regel zweimal zu pflegen — und zwei Fassungen driften auseinander.

import { useCallback, useEffect, useState } from "react";

export type QuestionQuelle = "brain" | "hermes";

export type BrainQuestion = {
  id: string;
  frage: string;
  warum: string;
  quelle: QuestionQuelle;
  seite: string;
  gestelltAm: string;
};

export type Reaktion = "antworten" | "spaeter" | "egal";

const RELOAD_MS = 5 * 60_000;
/** Jemand anderes hat die Frage beantwortet oder zurückgenommen — etwa Paul
 *  im Gespräch mit Hermes (HermesStimme.tsx). Die Karte lädt dann sofort neu. */
export const FRAGE_GEAENDERT = "morning:frage-changed";

async function lade(): Promise<BrainQuestion | null> {
  try {
    const res = await fetch("/api/question", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const v = (await res.json()) as { offen?: unknown };
    const o = v.offen as Record<string, unknown> | null | undefined;
    if (!o || typeof o.id !== "string" || typeof o.frage !== "string") return null;
    const quelle = o.quelle === "brain" || o.quelle === "hermes" ? o.quelle : null;
    // Ohne saubere Herkunft lieber gar nichts zeigen: der Hinweis "hast du
    // selbst markiert" vs. "Hermes ist es aufgefallen" ist der Punkt, an dem
    // Paul entscheidet, wie ernst er die Frage nimmt.
    if (!quelle) return null;
    return {
      id: o.id,
      frage: o.frage,
      warum: typeof o.warum === "string" ? o.warum : "",
      quelle,
      seite: typeof o.seite === "string" ? o.seite : "",
      gestelltAm: typeof o.gestelltAm === "string" ? o.gestelltAm : "",
    };
  } catch {
    return null;
  }
}

export function useBrainQuestion() {
  const [frage, setFrage] = useState<BrainQuestion | null>(null);
  const [busy, setBusy] = useState(false);

  const neu = useCallback(() => { void lade().then(setFrage); }, []);

  useEffect(() => {
    neu();
    const takt = setInterval(neu, RELOAD_MS);
    const beiSichtbar = () => { if (document.visibilityState === "visible") neu(); };
    document.addEventListener("visibilitychange", beiSichtbar);
    window.addEventListener(FRAGE_GEAENDERT, neu);
    return () => {
      clearInterval(takt);
      document.removeEventListener("visibilitychange", beiSichtbar);
      window.removeEventListener(FRAGE_GEAENDERT, neu);
    };
  }, [neu]);

  /** Alle drei Reaktionen laufen durch denselben Weg — auch "Später" und
   *  "Ist egal". Sie sind bewusst gleich teuer: eine Frage, die man nicht
   *  folgenlos wegdrücken kann, wird zur Last, und dann klickt man irgendwann
   *  alles weg, was erscheint. */
  const reagiere = useCallback(async (aktion: Reaktion, antwort?: string) => {
    if (busy) return false;
    setBusy(true);
    // Sofort verschwinden lassen: die Karte soll sich erledigt anfühlen, nicht
    // auf das Netz warten. Schlägt der Aufruf fehl, holt der nächste Takt sie
    // zurück — dann steht sie wieder da, was ehrlicher ist als ein stiller
    // Verlust der Antwort.
    setFrage(null);
    try {
      const res = await fetch("/api/question/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aktion, antwort }),
      });
      if (!res.ok) { neu(); return false; }
      return true;
    } catch {
      neu();
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, neu]);

  return { frage, busy, reagiere };
}
