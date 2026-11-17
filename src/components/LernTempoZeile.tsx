// Eine eingeklappte Zeile in „Deine Aufgaben": wie realistisch das Lernen
// heute ist, und was Daily über Pauls Tempo gelernt hat (lib/lernTempo.ts).
// Bewusst leise — Paul: „subtil, nicht zu groß". Zahlen erst beim Aufklappen.

import { useState } from "react";
import type { LernHeute } from "../lib/lernHeute";
import { fmtMinuten as hm } from "../lib/learnHarness";

const URTEIL: Record<string, string> = {
  passt: "realistisch",
  knapp: "knapp für dein Tempo",
  "zu-viel": "mehr, als du sonst schaffst",
  unbekannt: "Tempo wird noch gemessen",
};

export function LernTempoZeile({ lern }: { lern: LernHeute }) {
  const [offen, setOffen] = useState(false);
  const ist = lern.zeilen.reduce((s, z) => s + z.ist, 0);
  const ziel = lern.zeilen.reduce((s, z) => s + z.ziel, 0);
  // Das strengste Urteil gewinnt — eine knappe Klausur macht den Tag knapp.
  const rang = ["passt", "unbekannt", "knapp", "zu-viel"];
  const urteil = lern.zeilen.map(z => z.real.urteil).sort((a, b) => rang.indexOf(b) - rang.indexOf(a))[0] ?? "unbekannt";
  const { tempo: t, kap } = lern;
  return (
    <div className="lerntempo">
      <button type="button" className="empf-link" aria-expanded={offen} onClick={() => setOffen(o => !o)}>
        {offen ? "▾" : "▸"} Lernen heute · {hm(ist)} von {hm(ziel)} · <span className={`lt-${urteil}`}>{URTEIL[urteil]}</span>
      </button>
      {offen && (
        <div className="empf-profil">
          {lern.zeilen.map(z => (
            <p key={z.id}>
              <b>{z.klausur}</b> (in {z.tageBisKlausur} {z.tageBisKlausur === 1 ? "Tag" : "Tagen"}):{" "}
              heute {hm(z.ziel)} bei deinem Tempo
              {z.planZiel !== z.ziel && <> (Plan: {hm(z.planZiel)})</>}
              {z.faktor !== null && <> · Tempo in diesem Fach {z.faktor.toLocaleString("de-DE")}×</>}
              {z.quote.von > 0 && <> · Tagesziel erreicht an {z.quote.erreicht} von {z.quote.von} Tagen</>}
              {z.real.urteil === "zu-viel" && z.real.tageNoetig !== null && (
                <span className="minus"> — so wie du sonst lernst, bräuchtest du noch {z.real.tageNoetig} Lerntage; bis zur {z.phase === "lernen" ? "Wiederholung" : "Klausur"} sind es {z.tageUebrig}.</span>
              )}
            </p>
          ))}
          <p>
            {t.faktor !== null && t.schnittMinuten !== null && t.schnittGeplant !== null
              ? <>Ein Schwerpunkt dauert bei dir im Schnitt <b>{hm(t.schnittMinuten)}</b> (geplant {hm(t.schnittGeplant)}) — {t.faktor > 1.05 ? `${t.faktor.toLocaleString("de-DE")}× so lange wie geplant` : t.faktor < 0.95 ? `schneller als geplant (${t.faktor.toLocaleString("de-DE")}×)` : "wie geplant"}.</>
              : <>Dein Tempo pro Schwerpunkt wird gemessen, sobald zwei Schwerpunkte zu einem Viertel durch sind.</>}
            {" "}Hat eine Einheit schon Fortschritt, rechnet ihr Rest mit dem Tempo, das du dort wirklich hattest.
            {kap.lerntage > 0 && <> An Lerntagen schaffst du im Schnitt <b>{hm(kap.schnittLerntage)}</b> ({kap.lerntage} von {kap.tage} Tagen gelernt).</>}
          </p>
        </div>
      )}
    </div>
  );
}
