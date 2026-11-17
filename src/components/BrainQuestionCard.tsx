// Die eine Frage aus dem Second Brain.
//
// BEWUSST EINE KARTE UND KEIN POP-UP
// Das Pop-up-Kontingent gehört den Fristen — Dingen, die morgen nicht mehr
// möglich sind. Eine Wissenslücke ist nie so dringend. Käme sie trotzdem als
// Pop-up, würde beides zusammen abgestumpft weggeklickt, und dann geht auch
// die Frist unter, die gezählt hätte.
//
// WARUM "SPÄTER" GENAUSO GROSS IST WIE "ANTWORTEN"
// Eine Frage, die man nicht folgenlos wegdrücken kann, wird zur Last. Wer sie
// dreimal umständlich schliessen musste, klickt beim vierten Mal alles weg,
// was erscheint — auch das Nächste. Deshalb sind alle drei Wege gleich leicht;
// "Später" kostet nur einen Klick und bringt sieben Tage Ruhe.

import { useState } from "react";
import { Card } from "./Card";
import { useBrainQuestion } from "../lib/brainQuestion";

/** Die Herkunft ist der Unterschied zwischen "das habe ich mir selbst notiert"
 *  und "das hat sich ein Agent ausgedacht". Beide Fragen sind gleich viel wert,
 *  aber wie ernst Paul sie nimmt, ist seine Entscheidung — und dafür muss er
 *  sehen, woher sie kommt. Deshalb steht es dran, klein, aber lesbar. */
const HERKUNFT: Record<"brain" | "hermes", string> = {
  brain: "aus deinen offenen Fragen",
  hermes: "Hermes ist das aufgefallen",
};

export function BrainQuestionCard() {
  const { frage, busy, reagiere } = useBrainQuestion();
  const [text, setText] = useState("");

  // Keine leere Karte und kein Ladebalken: gibt es nichts zu fragen, ist hier
  // nichts. Ein stiller Tag ist besser als eine belanglose Frage.
  if (!frage) return null;

  const senden = async () => {
    if (!text.trim()) return;
    await reagiere("antworten", text.trim());
    setText("");
  };

  return (
    // Anker „brain-frage": die letzte Frage im Hörbriefing ist diese. Der
    // Hörbriefing-Knopf verlinkt seit 2026-11-01 nicht mehr selbst hierher.
    <div id="brain-frage">
    <Card
      title="Kurze Frage"
      meta={<span style={{ color: "var(--text-4)" }}>{HERKUNFT[frage.quelle]}</span>}
    >
      <p className="text-[14px] mb-2" style={{ color: "var(--text-1)", lineHeight: 1.5 }}>
        {frage.frage}
      </p>
      {frage.warum && (
        <p className="text-[12.5px] mb-3.5" style={{ color: "var(--text-3)", lineHeight: 1.55 }}>
          {frage.warum}
        </p>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sendet, Shift+Enter macht eine neue Zeile — die Antwort ist
          // meist ein Satz, da wäre ein Griff zur Maus unnötig.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void senden(); }
        }}
        id="brain-frage-antwort"
        aria-label="Antwort auf die Frage"
        rows={2}
        placeholder="Antwort — oder leer lassen und später"
        disabled={busy}
        className="w-full rounded-[10px] px-3 py-2 text-[13px] resize-none"
        style={{
          background: "color-mix(in srgb, var(--ink-3) 40%, transparent)",
          border: "1px solid var(--line-1)",
          color: "var(--text-1)",
          outline: "none",
        }}
      />

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => void senden()}
          disabled={busy || !text.trim()}
          className="rounded-full px-3.5 py-1.5 text-[12.5px] font-display font-medium transition-colors disabled:opacity-40"
          style={{
            background: "color-mix(in srgb, var(--accent) 18%, transparent)",
            color: "var(--accent)",
            border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
          }}
        >
          Antworten
        </button>
        <button
          type="button"
          onClick={() => void reagiere("spaeter")}
          disabled={busy}
          className="rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors"
          style={{ color: "var(--text-2)", border: "1px solid var(--line-1)" }}
        >
          Später
        </button>
        <button
          type="button"
          onClick={() => void reagiere("egal")}
          disabled={busy}
          className="rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors"
          style={{ color: "var(--text-3)", border: "1px solid transparent" }}
        >
          Ist egal
        </button>
        <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--text-4)" }}>
          {frage.seite}
        </span>
      </div>
    </Card>
    </div>
  );
}
