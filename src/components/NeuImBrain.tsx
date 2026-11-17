// „Neu im Brain" — eine leise Zeile im Intro: was Hermes seit gestern ins
// Second Brain eingearbeitet hat (electron/brainPages.cjs → neuImBrain, aus
// wiki/log.md). Pauls Wunsch: subtil, nicht gross. Deshalb eingeklappt, in der
// Sprache der Herkunftszeile, und ganz weg, wenn nichts Neues da ist.

import { useEffect, useState } from "react";

type Eintrag = { datum: string; titel: string; punkte: string[] };

export function NeuImBrain() {
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [log, setLog] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const hole = () => fetch("/api/brain/neu", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { eintraege?: Eintrag[]; log?: string } | null) => {
        if (!alive || !d || !Array.isArray(d.eintraege)) return;
        setEintraege(d.eintraege.filter(e => typeof e.titel === "string" && Array.isArray(e.punkte)));
        setLog(typeof d.log === "string" ? d.log : null);
      })
      .catch(() => { /* kein Brain — dann eben nichts */ });
    void hole();
    const t = setInterval(hole, 60 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (eintraege.length === 0) return null;
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  return (
    <details className="nib">
      <summary>Neu im Brain · {eintraege.length} seit gestern</summary>
      {/* Eine Hülle, damit das Still-Intro den Inhalt als Blatt unter die
          Zeile legen kann; im Original ändert sie nichts. */}
      <div className="nib-inhalt">
      <ul>
        {eintraege.map((e, i) => (
          <li key={i}>
            <span className="nib-titel">{e.datum === heute ? "heute" : "gestern"} · {e.titel}</span>
            {e.punkte.length > 0 && <span className="nib-punkte">{e.punkte.join(" · ")}</span>}
          </li>
        ))}
      </ul>
      {log && <a className="nib-link" href={log}>Im Log öffnen →</a>}
      </div>
    </details>
  );
}
