// „Gehst du heute hin?" — der Morgendialog über die Termine des Tages.
//
// WARUM ES IHN GIBT
// Die Serien-Entscheidung wird einmal getroffen und gilt für immer. Nach 166
// entschiedenen Serien fragt das System praktisch nichts mehr — und trägt
// deshalb beide Übungsgruppen desselben Fachs in denselben Vormittag ein,
// obwohl Paul nur in einer ist. Am 12.09. standen sechs solcher Kollisionen im
// Kalender, darunter eine ganztägige Klausur über zwei Übungsterminen.
//
// WARUM EIN DIALOG UND NICHT SECHS
// Ein Dialog pro Termin wäre ein Spiessrutenlauf. Hier steht der ganze Tag auf
// einmal da, jede Zeile hat zwei Knöpfe, und wer fertig ist, ist fertig.
// Kollisionen stehen oben und sind markiert — das ist der Grund, warum gefragt
// wird.
//
// WARUM DIE ANTWORT NUR HEUTE GILT
// Bei „Gruppe 1 oder Gruppe 2" kann es nächste Woche anders sein. Abgelehnt
// heisst deshalb: dieses eine Vorkommen ausgeblendet, Serie unberührt.

import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "../types";
import { useTracker } from "../tracker/store";
import { hideCalendarEvent, useHiddenEventIds, isEventHidden } from "../lib/hiddenEvents";
import { markProcessed } from "../lib/calendarDecisions";
import { eventToBlock } from "../lib/eventBlock";
import {
  ladeStand,
  merkeBeantwortet,
  vertageHeute,
  heuteIso,
  TAGESTERMINE_CHANGE,
} from "../lib/tagesTermine";

function uhr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function minuten(e: CalendarEvent): [number, number] {
  const s = new Date(e.start);
  const anfang = s.getHours() * 60 + s.getMinutes();
  const e2 = e.end ? new Date(e.end) : null;
  const ende = e2 && !Number.isNaN(e2.getTime()) ? e2.getHours() * 60 + e2.getMinutes() : anfang + 60;
  return [anfang, ende > anfang ? ende : anfang + 60];
}

export function TagesTermineDialog({ events }: { events: CalendarEvent[] }) {
  const { ensureEventBlock, removeEventBlock } = useTracker();
  const hidden = useHiddenEventIds();
  const [stand, setStand] = useState(ladeStand);

  useEffect(() => {
    const auf = () => setStand(ladeStand());
    window.addEventListener(TAGESTERMINE_CHANGE, auf);
    return () => window.removeEventListener(TAGESTERMINE_CHANGE, auf);
  }, []);

  const heute = heuteIso();

  /** Heutige Termine mit Uhrzeit, die weder ausgeblendet noch heute schon
   *  beantwortet sind. Ganztägige bleiben draussen — bei „Geburtstag" gibt es
   *  nichts zu entscheiden. */
  const offen = useMemo(() => {
    return events
      .filter((e) => !e.allDay)
      .filter((e) => new Date(e.start).toLocaleDateString("sv-SE") === heute)
      .filter((e) => !isEventHidden(e.id, hidden))
      .filter((e) => !stand.beantwortet.includes(e.id))
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  }, [events, hidden, stand.beantwortet, heute]);

  /** Welche der offenen Termine sich gegenseitig überschneiden — die sind der
   *  eigentliche Anlass und stehen deshalb markiert da. */
  const kollidiert = useMemo(() => {
    const raus = new Set<string>();
    for (let i = 0; i < offen.length; i++) {
      const [a1, a2] = minuten(offen[i]);
      for (let j = i + 1; j < offen.length; j++) {
        const [b1, b2] = minuten(offen[j]);
        if (Math.min(a2, b2) > Math.max(a1, b1)) {
          raus.add(offen[i].id);
          raus.add(offen[j].id);
        }
      }
    }
    return raus;
  }, [offen]);

  if (stand.vertagt || offen.length === 0) return null;

  function hingehen(e: CalendarEvent) {
    const blk = eventToBlock(e);
    if (blk) ensureEventBlock(blk);
    markProcessed([e.id]);
    merkeBeantwortet(e.id);
    setStand(ladeStand());
  }

  function nicht(e: CalendarEvent) {
    // NUR dieses Vorkommen. Die Serie bleibt unberührt — nächste Woche steht
    // der Termin wieder zur Wahl.
    removeEventBlock(e.id);
    hideCalendarEvent(e.id);
    markProcessed([e.id]);
    merkeBeantwortet(e.id);
    setStand(ladeStand());
  }

  return (
    <section className="tt" aria-labelledby="tt-titel">
      <header className="tt-kopf">
        <h2 id="tt-titel" className="tt-titel">Gehst du heute hin?</h2>
        <span className="tt-zahl">
          {offen.length === 1 ? "1 Termin" : `${offen.length} Termine`}
          {kollidiert.size > 0 && ` · ${kollidiert.size} kollidieren`}
        </span>
      </header>

      <ul className="tt-liste">
        {offen.map((e) => (
          <li key={e.id} className={"tt-row" + (kollidiert.has(e.id) ? " kollision" : "")}>
            <span className="tt-zeit">{uhr(e.start)}{e.end ? `–${uhr(e.end)}` : ""}</span>
            <span className="tt-name">
              {e.title}
              {kollidiert.has(e.id) && <span className="tt-warn"> überschneidet sich</span>}
            </span>
            <span className="tt-knoepfe">
              <button type="button" className="tt-ja" onClick={() => hingehen(e)}>Hingehen</button>
              <button type="button" className="tt-nein" onClick={() => nicht(e)}>Nicht</button>
            </span>
          </li>
        ))}
      </ul>

      <p className="tt-fuss">
        „Nicht" gilt nur für heute — nächste Woche wird derselbe Termin wieder gefragt.
        <button type="button" className="tt-spaeter" onClick={() => { vertageHeute(); setStand(ladeStand()); }}>
          Später
        </button>
      </p>
    </section>
  );
}
