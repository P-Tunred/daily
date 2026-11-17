// „Wann soll das zur Aufgabe werden?" — die eine Frage, die Hermes stellt,
// wenn er es nicht aus den bisherigen Entscheidungen ableiten kann.
//
// WARUM ES DIESE FRAGE GIBT
// „Beurlaubung: nachfassen, falls bis 17.09. nichts kommt" gehört AN den Tag.
// „Frist: SU-Einmalcode läuft am 04.09. ab" gehört DAVOR — am Tag selbst ist
// es zu spät. Beides sind Termine mit Datum; der Unterschied liegt in der
// Bedeutung. Wo Hermes einen klaren Präzedenzfall findet, entscheidet er
// selbst. Wo nicht, steht hier eine Frage.
//
// WARUM DIE ANTWORT ETWAS BEWIRKT
// Sie setzt nicht nur diesen einen Stichtag, sie wird zur Regel für das
// nächste Mal. Eine Frage, die man jedes Mal neu gestellt bekommt, beantwortet
// man dreimal und klickt sie danach weg.

import { useEffect, useState } from "react";
import { Card } from "./Card";
import { fetchVorlauf, antworteVorlauf, verwirfVorlauf, type VorlaufFrage } from "../lib/vorlauf";

const NACHLADEN_MS = 5 * 60 * 1000;

/** Die angebotenen Abstände. Bewusst wenige und in Sprache, nicht in Zahlen —
 *  „3" beantwortet man anders als „drei Tage vorher". */
const WAHL: { tage: number; label: string }[] = [
  { tage: 0, label: "am Tag selbst" },
  { tage: 1, label: "einen Tag vorher" },
  { tage: 3, label: "drei Tage vorher" },
  { tage: 7, label: "eine Woche vorher" },
];

function datumLang(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}

function stichtag(iso: string, tage: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - tage);
  return datumLang(d.toISOString().slice(0, 10));
}

export function VorlaufCard() {
  const [frage, setFrage] = useState<VorlaufFrage | null>(null);
  const [gelernt, setGelernt] = useState(0);
  const [wahl, setWahl] = useState<number | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let lebt = true;
    const laden = () => {
      void fetchVorlauf().then((z) => {
        if (!lebt || !z) return;
        setFrage(z.offen);
        setGelernt(z.gelernt);
        setWahl(z.offen ? z.offen.vorschlag : null);
      });
    };
    laden();
    const t = setInterval(laden, NACHLADEN_MS);
    return () => { lebt = false; clearInterval(t); };
  }, []);

  if (!frage) return null;

  async function senden(tage: number) {
    setLaeuft(true);
    setFehler(null);
    const err = await antworteVorlauf(tage);
    setLaeuft(false);
    if (err) { setFehler(err); return; }
    setFrage(null);
  }

  const gewaehlt = wahl ?? frage.vorschlag;

  return (
    <Card title="Wann soll das auf die Liste?" size="small" meta={gelernt > 0 ? `${gelernt} gelernt` : undefined}>
      <p className="vl-titel">{frage.titel}</p>
      <p className="vl-datum">Termin: {datumLang(frage.datum)}</p>
      {frage.warum && <p className="vl-warum">{frage.warum}</p>}

      <div className="vl-wahl" role="radiogroup" aria-label="Vorlauf">
        {WAHL.map((w) => (
          <button
            key={w.tage}
            type="button"
            role="radio"
            aria-checked={gewaehlt === w.tage}
            className={"vl-btn" + (gewaehlt === w.tage ? " sel" : "")}
            onClick={() => setWahl(w.tage)}
            disabled={laeuft}
          >
            {w.label}
          </button>
        ))}
      </div>

      <p className="vl-folge">
        Landet am <b>{stichtag(frage.datum, gewaehlt)}</b> in „Was heute zählt" — und gilt ab
        jetzt als Regel für Ähnliches.
      </p>

      {fehler && <p className="vl-fehler">Nicht gespeichert: {fehler}</p>}

      <div className="vl-aktionen">
        <button type="button" className="vl-ok" onClick={() => void senden(gewaehlt)} disabled={laeuft}>
          {laeuft ? "…" : "Merken"}
        </button>
        <button
          type="button"
          className="vl-weg"
          disabled={laeuft}
          onClick={() => { void verwirfVorlauf(); setFrage(null); }}
        >
          Nicht jetzt
        </button>
      </div>
    </Card>
  );
}
