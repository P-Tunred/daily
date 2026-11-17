// „Still" — der zweite Entwurf für den ersten Bildschirm (Paul, 2026-11-01:
// „noch etwas schöner und schlichter, etwas mehr tacit").
//
// Kein Gruss mehr: oben steht der Satz des Tages — Hermes' Heute-Zeile, sonst
// der lokale Rückfall —, die erste Hälfte hell, der Nachsatz leiser. Darunter
// die Herkunftszeile, der Hörbriefing-Ring und zwei leise Wege (Gestern, Brain).
// Score und Lernzeit stehen als zwei Zahlen ohne Rahmen; die einzige Fläche
// ist „Heute". Das Original-Intro bleibt in HeuteJarvis und ist per
// Einstellung wieder da (lib/introLayout.ts).

import type { BlockCategory } from "../tracker/types";
import { CATEGORY_META } from "../lib/categories";
import { useBriefingSicht, useMeldeGerendert } from "../lib/briefingContext";
import { lokalerSatz, teileSatz, urteil } from "../lib/stillIntro";
import { HoerbriefingPlayer } from "./HoerbriefingPlayer";
import { HermesStimme } from "./HermesStimme";
import { NeuImBrain } from "./NeuImBrain";
import "./still-intro.css";

export type StillItem = {
  id: string;
  text: string;
  done: boolean;
  category?: BlockCategory;
  /** Wie oft schon in den nächsten Tag geschoben — ab 2 steht es dabei. */
  verschoben?: number;
};

type Props = {
  dateStr: string;
  timeStr: string;
  score: number;
  totalMin: number;
  dayGoal: number;
  streak: number;
  /** Erklärt ein berechnetes Tagesziel; null, wenn das Budget gilt. */
  zielHinweis: string | null;
  items: StillItem[];
  doneCount: number;
  taskTotal: number;
  weekCount: number;
  onToggle: (id: string) => void;
  onJumpToWeek: () => void;
  onGestern: () => void;
  onMehr: () => void;
};

const anteil = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function StillIntro({
  dateStr, timeStr, score, totalMin, dayGoal, streak, zielHinweis,
  items, doneCount, taskTotal, weekCount, onToggle, onJumpToWeek, onGestern, onMehr,
}: Props) {
  const { zeilen, herkunft } = useBriefingSicht();
  const lead = zeilen?.todayLead;
  // Hier steht Hermes' Heute-Zeile oben — also meldet diese Fläche sie.
  useMeldeGerendert("todayLead", !!lead);

  const offen = items.filter((i) => !i.done).length;
  const { satz, nachsatz } = teileSatz(lead ?? lokalerSatz(offen, weekCount));
  const vonHermes = herkunft.quelle === "hermes";

  return (
    <section className="still-intro" aria-label="Dein Tag">
      <p className="still-datum">{dateStr}<b className="num">{timeStr}</b></p>

      <header className="still-held">
        <h1 className="still-satz">
          {satz}{nachsatz && <> <span className="leise">{nachsatz}</span></>}
        </h1>
        <div className="still-meta">
          {/* Die Herkunft steht IMMER da: ein lokaler Satz darf nie aussehen
              wie einer von Hermes (der Fehler vom 15.08.). */}
          <p className={"still-herkunft" + (vonHermes ? "" : " lokal")}>
            <span className="still-punkt" aria-hidden="true" />{herkunft.text}
          </p>
          <HoerbriefingPlayer variante="ring" />
          {/* Gleich daneben: wer beim Briefing dazwischenredet, redet mit Hermes. */}
          <HermesStimme />
          <button type="button" className="still-weg" onClick={onGestern} aria-haspopup="dialog">
            Gestern nachtragen
          </button>
          <NeuImBrain />
        </div>
      </header>

      <div className="still-zahlen">
        <section className="still-zahl" aria-labelledby="still-tag">
          <h2 id="still-tag">Der Tag</h2>
          <p className="still-wert num" aria-label={`Tages-Score ${score} von 100`}>
            {score}<span className="leise">/100</span>
          </p>
          <div className="still-linie" aria-hidden="true"><span style={{ transform: `scaleX(${anteil(score / 100)})` }} /></div>
          <p className="still-unter">{urteil(score, totalMin)}</p>
        </section>
        <section className="still-zahl" aria-labelledby="still-lernzeit">
          <h2 id="still-lernzeit">Lernzeit</h2>
          <p className="still-wert num">
            {totalMin}<span className="leise">/{dayGoal}</span><small>min</small>
          </p>
          <div className="still-linie" aria-hidden="true"><span style={{ transform: `scaleX(${anteil(dayGoal > 0 ? totalMin / dayGoal : 0)})` }} /></div>
          <div className="still-unter">
            <span>{streak} {streak === 1 ? "Tag" : "Tage"} Serie</span>
            {zielHinweis && (
              <span className="still-ziel">
                <button type="button" aria-describedby="still-ziel-tip">Ziel ⓘ</button>
                <span className="still-tip" role="tooltip" id="still-ziel-tip">{zielHinweis}</span>
              </span>
            )}
          </div>
        </section>
      </div>

      <section className="still-heute" aria-labelledby="still-heute-h">
        <div className="still-heute-kopf">
          <h2 id="still-heute-h">Heute</h2>
          {taskTotal > 0 && <span className="num">{doneCount} von {taskTotal}</span>}
        </div>
        {items.length > 0 ? (
          <ul>
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className={"still-aufgabe" + (it.done ? " erledigt" : "")}
                  aria-pressed={it.done}
                  onClick={() => onToggle(it.id)}
                  data-sound={it.done ? undefined : "confirm"}
                >
                  <span
                    className="still-haken"
                    style={{ ["--kat" as string]: it.category ? CATEGORY_META[it.category].color : "var(--text-3)" }}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className="still-aufgabe-text">{it.text}</span>
                  {!it.done && (it.verschoben ?? 0) >= 2 && (
                    <span className="still-alt"><span aria-hidden="true">◆</span> {it.verschoben} Tage</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : weekCount > 0 ? (
          <>
            <p className="still-frei">Heute ist frei.</p>
            <button type="button" className="still-weg" onClick={onJumpToWeek}>
              {weekCount} {weekCount === 1 ? "Punkt wartet" : "Punkte warten"} diese Woche ↓
            </button>
          </>
        ) : (
          <p className="still-frei">Heute ist frei. <span className="leise">Diese Woche auch.</span></p>
        )}
      </section>

      <button type="button" className="still-mehr" onClick={onMehr}>
        Mehr
        <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 5.5 7 9.5 11 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </section>
  );
}
