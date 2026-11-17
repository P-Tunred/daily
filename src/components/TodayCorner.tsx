import { useEffect } from "react";
import type { BlockCategory } from "../tracker/types";
import { CATEGORY_META } from "../lib/categories";
import { useBriefingSicht } from "../lib/briefingContext";

export type TodayCornerItem = { id: string; text: string; category?: BlockCategory };

/** The quiet top-right teaser in the Setzling intro — mirrors Jarvis' greeting
 *  (bottom-left) with a minimal, card-less readout of today's must-dos. Click
 *  an item to check it off right here; the full editor lives in "Was heute
 *  zählt" further down. Purely a glance, not a second todo app. */
export function TodayCorner({
  items,
  weekCount,
  onToggle,
  onJumpToWeek,
}: {
  items: TodayCornerItem[];
  weekCount: number;
  onToggle: (id: string) => void;
  onJumpToWeek: () => void;
}) {
  // Die Zeile von Hermes gilt in ALLEN drei Zweigen.
  //
  // Vorher stand sie nur im Zweig "es gibt Aufgaben". An einem leeren Tag —
  // genau dem Tag, für den ein Satz wie "Heute steht nichts an, geniess es"
  // geschrieben wurde — wurde sie stillschweigend verworfen, obwohl sie
  // korrekt gespeichert war. Der Server hatte recht, die Anzeige nicht.
  const { zeilen, meldeGerendert } = useBriefingSicht();
  const lead = zeilen?.todayLead;

  // Nur melden, wenn wirklich SEINE Zeile dasteht. Beim lokalen Rückfall
  // hiesse "rendered" sonst nur noch "irgendein Text war zu sehen".
  useEffect(() => { if (lead) meldeGerendert("todayLead"); }, [lead, meldeGerendert]);

  return (
    <div className="szl-today">
      <div className="kicker">Heute</div>

      {items.length > 0 ? (
        <>
          {lead
            ? <p className="lead">{lead}</p>
            : <p className="lead">Okay — <em>nur das hier</em> musst du heute machen.</p>}
          <ul>
            {items.map((it) => (
              <li
                key={it.id}
                role="button"
                tabIndex={0}
                onClick={() => onToggle(it.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(it.id); }
                }}
              >
                <span>{it.text}</span>
                <span
                  className="dot"
                  style={{ background: it.category ? CATEGORY_META[it.category].color : "var(--text-4)" }}
                  aria-hidden="true"
                />
              </li>
            ))}
          </ul>
        </>
      ) : weekCount > 0 ? (
        <>
          {/* Auch hier Hermes' Zeile, falls vorhanden. Der Wochen-Link bleibt. */}
          <p className="lead">{lead ?? "Heute ist frei."}</p>
          <button type="button" className="nudge" onClick={onJumpToWeek}>
            {weekCount} {weekCount === 1 ? "Punkt wartet" : "Punkte warten"} diese Woche ↓
          </button>
        </>
      ) : (
        /* Der leere Tag — genau der Fall, für den Hermes' Satz gedacht ist und
           in dem er vorher verworfen wurde. */
        <p className={lead ? "lead" : "empty"}>
          {lead ?? "Nichts Festes heute — mach draus, was du willst."}
        </p>
      )}
    </div>
  );
}
