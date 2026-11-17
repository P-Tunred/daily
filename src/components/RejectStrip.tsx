// Ein schmaler Streifen, der nur erscheint, wenn Daily etwas von Hermes
// zurückgewiesen hat.
//
// WARUM ES IHN GIBT
// Am 1.9. um 06:06 lehnte Daily zweimal einen Vorschlag ab (Kennung mit
// falschem Präfix). Um 06:07 meldete Hermes' Auftrag „ok". Die Karte zeigte
// danach einen Vorschlag statt zwei, und niemand erfuhr davon — die einzige
// Spur war eine Zeile in einem Journal, das keiner liest.
//
// WARUM ER NICHTS ZEIGT, WENN NICHTS IST
// Ein Streifen, der jeden Tag „alles in Ordnung" sagt, trainiert einen darauf,
// ihn zu übersehen. Dann fehlt er genau an dem Tag, an dem er zählt. Er ist
// entweder unsichtbar oder er bedeutet etwas.

import { useEffect, useState } from "react";

const NACHLADEN_MS = 5 * 60 * 1000;

type Eintrag = { route: string; status: number; nachricht: string; um: string };
type Lage = { abgelehnt24h: number; zuletzt: Eintrag | null; proRoute: Record<string, number> };

function vorWieLange(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "gerade eben";
  const min = Math.round(ms / 60000);
  if (min < 60) return `vor ${min} min`;
  const std = Math.round(min / 60);
  return std < 24 ? `vor ${std} h` : `vor ${Math.round(std / 24)} Tagen`;
}

export function RejectStrip() {
  const [lage, setLage] = useState<Lage | null>(null);
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    let lebt = true;
    const laden = () => {
      fetch("/api/rejections?t=" + Date.now())
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Lage | null) => {
          if (lebt && d && typeof d.abgelehnt24h === "number") setLage(d);
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

  if (!lage || lage.abgelehnt24h === 0) return null;

  const n = lage.abgelehnt24h;
  const wege = Object.keys(lage.proRoute).join(", ");

  return (
    <div className="rj" role="status">
      <button
        type="button"
        className="rj-kopf"
        onClick={() => setOffen((o) => !o)}
        aria-expanded={offen}
      >
        <span className="rj-punkt" aria-hidden="true" />
        <span className="rj-text">
          {n === 1 ? "Ein Beitrag von Hermes wurde abgewiesen" : `${n} Beiträge von Hermes wurden abgewiesen`}
          {lage.zuletzt && <span className="rj-wann"> · {vorWieLange(lage.zuletzt.um)}</span>}
        </span>
        <span className="rj-mehr">{offen ? "weniger" : "warum"}</span>
      </button>

      {offen && lage.zuletzt && (
        <div className="rj-details">
          <p className="rj-grund">{lage.zuletzt.nachricht}</p>
          <p className="rj-wo">
            {wege}
            {" · "}
            Hermes' Auftrag meldet trotzdem Erfolg — die Daten sind verloren, nicht verschoben.
          </p>
        </div>
      )}
    </div>
  );
}
