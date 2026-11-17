// Ein schmaler Streifen, der nur erscheint, wenn ein Kanal zum Second Brain
// klemmt — der Tagesbericht kam nicht an, die Fristen wurden tagelang nicht
// abgeglichen, das Hörbriefing fehlt.
//
// WARUM ES IHN GIBT
// Am 2026-10-27 lagen zwölf Entscheidungen seit Wochen in Daily und keine im
// Brain. Kein Fehler, keine Meldung — es passierte einfach nichts. Was nur
// ausbleibt, sieht man nirgends; deshalb steht es hier, wo Paul morgens
// hinsieht. Die Prüfung selbst: electron/kanaele.cjs.
//
// Wie RejectStrip: nichts zu sagen → nichts zu sehen. Gelb statt Rot, denn
// verloren ist nichts — es wartet nur.

import { useEffect, useState } from "react";

const NACHLADEN_MS = 10 * 60 * 1000;

type Kanal = { name: string; ok: boolean; text: string };
type Stand = { kanaele: Kanal[]; probleme: string[] };

export function KanalHinweis() {
  const [stand, setStand] = useState<Stand | null>(null);
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    let lebt = true;
    const laden = () => {
      fetch("/api/kanaele?t=" + Date.now())
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Stand | null) => {
          if (lebt && d && Array.isArray(d.probleme)) setStand(d);
        })
        .catch(() => {});
    };
    laden();
    const t = setInterval(laden, NACHLADEN_MS);
    return () => {
      lebt = false;
      clearInterval(t);
    };
  }, []);

  if (!stand || stand.probleme.length === 0) return null;

  const [erstes, ...weitere] = stand.probleme;

  return (
    <div className="rj rj-kanal" role="status">
      <button
        type="button"
        className="rj-kopf"
        onClick={() => setOffen((o) => !o)}
        aria-expanded={offen}
      >
        <span className="rj-punkt" aria-hidden="true" />
        <span className="rj-text">
          {erstes}
          {weitere.length > 0 && <span className="rj-wann"> · und {weitere.length} weitere(s)</span>}
        </span>
        <span className="rj-mehr">{offen ? "weniger" : "alle Kanäle"}</span>
      </button>

      {offen && (
        <div className="rj-details">
          {stand.kanaele.map((k) => (
            <p key={k.name} className={k.ok ? "rj-grund rj-ok" : "rj-grund"}>
              {k.ok ? "✓ " : "• "}{k.text}
            </p>
          ))}
          <p className="rj-wo">Hermes holt das abends mit dem Tagesbericht nach — klemmt es weiter, frag ihn, was hakt.</p>
        </div>
      )}
    </div>
  );
}
