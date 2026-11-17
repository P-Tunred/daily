// Freie Blöcke im Kalender — anklickbar statt nur beschrieben.
//
// WARUM ES DIESE KARTE GIBT
// Hermes rechnet die Lücken für das Briefing längst aus, aber das Ergebnis
// versickert im Fließtext („vormittags hast du drei Stunden"). Ein Satz lässt
// sich nicht eintragen. Hier steht dieselbe Rechnung als Liste, aus der mit
// einem Klick ein Termin wird — über den Postausgang, den zuverlässigsten Weg
// im System.
//
// WARUM NICHTS AUTOMATISCH PASSIERT
// Ein Kalender, der sich selbst befüllt, ist in zwei Wochen unbenutzbar. Die
// Lücke wird angeboten; eintragen tut Paul.

import { useEffect, useState } from "react";
import { Card } from "./Card";

type Block = { id: string; tag: string; von: string; bis: string; minuten: number };
type Antwort = { verfuegbar: boolean; bloecke: Block[] };

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function tagLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const heute = new Date().toLocaleDateString("sv-SE");
  if (iso === heute) return "Heute";
  const morgen = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE");
  if (iso === morgen) return "Morgen";
  return `${WOCHENTAG[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

function dauer(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h},${Math.round((m / 60) * 10)} h`;
}

export function GapsCard() {
  const [bloecke, setBloecke] = useState<Block[] | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [geplant, setGeplant] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/gaps?t=" + Date.now())
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Antwort | null) => setBloecke(d && d.verfuegbar ? d.bloecke : []))
      .catch(() => setBloecke([]));
  }, []);

  async function plane(b: Block) {
    setLaeuft(b.id);
    setFehler(null);
    try {
      const res = await fetch("/api/gaps/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: b.tag, von: b.von, bis: b.bis, titel: "Lernblock" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // Ein stiller Fehlschlag wäre hier das Schlimmste: wer glaubt, der Block
        // stehe im Kalender, obwohl er es nicht tut, ist schlechter dran als vorher.
        throw new Error(d.error || `Server antwortete ${res.status}`);
      }
      setGeplant((g) => [...g, b.id]);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLaeuft(null);
    }
  }

  if (bloecke === null) return null;
  if (bloecke.length === 0) {
    return (
      <Card title="Freie Blöcke" size="small">
        <p className="lk-leer">Die nächsten sieben Tage sind durchgeplant — keine Lücke über einer Stunde.</p>
      </Card>
    );
  }

  return (
    <Card title="Freie Blöcke" size="small" meta={`${bloecke.length} über 1 h`}>
      <ul className="lk-liste">
        {bloecke.map((b) => {
          const fertig = geplant.includes(b.id);
          return (
            <li key={b.id} className={"lk-row" + (fertig ? " fertig" : "")}>
              <span className="lk-tag">{tagLabel(b.tag)}</span>
              <span className="lk-zeit">{b.von}–{b.bis}</span>
              <span className="lk-dauer">{dauer(b.minuten)}</span>
              {fertig ? (
                <span className="lk-fertig">im Postausgang</span>
              ) : (
                <button
                  type="button"
                  className="lk-btn"
                  disabled={laeuft === b.id}
                  onClick={() => void plane(b)}
                >
                  {laeuft === b.id ? "…" : "Lernblock"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {fehler && <p className="lk-fehler">Nicht eingetragen: {fehler}</p>}
      {geplant.length > 0 && (
        <p className="lk-fuss">
          Hermes trägt sie beim nächsten Durchlauf in den echten Kalender ein — er sieht alle 15 Minuten nach.
        </p>
      )}
    </Card>
  );
}
