// Die Empfehlungen über „Heute" und „Diese Woche" — und was Daily dafür
// gelernt hat. Die Rechnung steht in lib/empfehlung.ts und lib/prioLernen.ts.
//
// Das Gelernte ist bewusst einsehbar und löschbar: ein System, das still
// Meinungen über Paul bildet, wäre unheimlich; eines, das sagt „Uni-Aufgaben
// ziehst du durch (8× erledigt)", kann er prüfen und korrigieren.

import { useState } from "react";
import type { Empfehlung } from "../lib/empfehlung";
import { profil, type PrioModell } from "../lib/prioLernen";
import { fachNamen, vergiss } from "../lib/prioSpeicher";

const TITEL: Record<Empfehlung["art"], string> = {
  heute: "Heute rein?",
  zuerst: "Zuerst",
  woche: "Zurück in die Woche?",
  streichen: "Streichen?",
};
const JA: Record<Empfehlung["art"], string> = {
  heute: "Rein",
  zuerst: "Nach oben",
  woche: "In die Woche",
  streichen: "Löschen",
};

export function AufgabenEmpfehlungen({ empfehlungen, modell, anzahlSignale, onJa, onNein }: {
  empfehlungen: Empfehlung[];
  modell: PrioModell;
  anzahlSignale: number;
  onJa: (e: Empfehlung) => void;
  onNein: (e: Empfehlung) => void;
}) {
  const [offen, setOffen] = useState(false);
  const p = offen ? profil(modell, fachNamen()) : null;
  return (
    <div className="empf">
      {empfehlungen.length > 0 ? (
        <ul className="empf-liste" aria-label="Empfehlungen">
          {empfehlungen.map(e => (
            <li key={`${e.id}:${e.art}`} className={`empf-${e.art}`}>
              <span className="empf-art">{TITEL[e.art]}</span>
              <span className="empf-text">
                <b>{e.text}</b>
                <span className="empf-grund">{e.grund}</span>
              </span>
              <span className="empf-knoepfe">
                <button type="button" className="ja" data-sound={e.art === "streichen" ? "dismiss" : "confirm"} onClick={() => onJa(e)}>{JA[e.art]}</button>
                <button type="button" className="nein" aria-label={`Nein: ${e.text}`} onClick={() => onNein(e)}>Nein</button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empf-leer">Keine Empfehlung gerade — Heute und Woche passen zusammen.</p>
      )}
      <div className="empf-lernen">
        <button type="button" className="empf-link" aria-expanded={offen} onClick={() => setOffen(o => !o)}>
          {offen ? "▾" : "▸"} Was Daily über deine Prioritäten gelernt hat{anzahlSignale ? ` · ${anzahlSignale} Handlungen` : ""}
        </button>
        {offen && p && (
          <div className="empf-profil">
            {!p.wichtig.length && !p.unwichtig.length && (
              <p>Noch zu wenig, um etwas zu sagen. Mit jedem Abhaken, Hochstufen und Löschen lernt Daily mit — Empfehlungen werden dadurch genauer.</p>
            )}
            {p.wichtig.length > 0 && (
              <p><span className="plus">Ziehst du durch:</span> {p.wichtig.map(z => `${z.name}${z.belege ? ` (${z.belege})` : ""}`).join(" · ")}</p>
            )}
            {p.unwichtig.length > 0 && (
              <p><span className="minus">Räumst du eher weg:</span> {p.unwichtig.map(z => `${z.name}${z.belege ? ` (${z.belege})` : ""}`).join(" · ")}</p>
            )}
            {anzahlSignale > 0 && (
              <button type="button" className="empf-link" onClick={() => { if (window.confirm("Alles Gelernte vergessen? Die Aufgaben selbst bleiben.")) vergiss(); }}>
                Gelerntes vergessen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
