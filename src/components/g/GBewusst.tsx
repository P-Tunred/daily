// Stil „G" — Zeit für dich (Bewusst leben) im Aufbau von Seite G (Artboard
// „Glas-ZeitFuerDich"). Nur Ansicht: Zustand und Regeln bleiben in
// BewusstCard und lib/zeitFuerDich.ts; Auswahl, Ideen und Rückblick reicht
// BewusstCard als `weiteres` durch, damit dort nichts doppelt lebt.
//
// Oben steht kein Satz („Ein bisschen Zeit für dich." fällt weg).

import type { ReactNode } from "react";
import type { Anpassung, Block, Punkt, RoutinenVerlauf, WochenPunkt, WochenSache } from "../../lib/zeitFuerDich";
import type { GoalPatch } from "../../lib/bewusst";
import "./g.css";

const PUNKT: Record<Punkt, string> = { ja: "ja", nein: "", offen: "jetzt", pause: "weiss", unbekannt: "weiss" };
const WPUNKT: Record<WochenPunkt, string> = { ja: "ja", teil: "teil", nein: "", offen: "jetzt", pause: "weiss", unbekannt: "weiss" };
const minuten = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
const aufLineal = (min: number) => Math.max(0, Math.min(100, ((min - 7 * 60) / (16 * 60)) * 100));

function Haken() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GBewusst({
  geladen, busy, tage, erledigtHeute, frei, anpassen, morgenLabel, woche, wocheFertig, wocheZu, rest,
  onHaken, onWeglassen, onBehalten, onTrage, weiteres, status,
}: {
  geladen: boolean;
  busy: boolean;
  tage: RoutinenVerlauf[];
  erledigtHeute: number;
  frei: { block: Block; idee: string | null } | null;
  anpassen: Anpassung[];
  morgenLabel: string;
  woche: WochenSache[];
  wocheFertig: number;
  wocheZu: boolean;
  rest: number;
  onHaken: (id: string, an: boolean) => void;
  onWeglassen: (id: string) => void;
  onBehalten: (id: string) => void;
  onTrage: (id: string, patch: GoalPatch) => void;
  weiteres: ReactNode;
  status: ReactNode;
}) {
  const jetzt = new Date();
  const jetztPos = aufLineal(jetzt.getHours() * 60 + jetzt.getMinutes());

  return (
    <div id="bewusst-leben" className="g-raster g-bewusst">
      {!geladen ? (
        <section className="g-blatt g-span-12"><p role="status" className="g-notiz">Routinen werden geladen …</p></section>
      ) : (
        <>
          <div className="g-spalte g-span-5">
          <section className="g-blatt g-vorn" aria-labelledby="g-bw-heute">
            <fieldset disabled={busy} aria-busy={busy} className="g-feld">
              <div className="g-kopf">
                <div>
                  <h2 id="g-bw-heute">Heute für dich</h2>
                  <p>{tage.length ? `${erledigtHeute} von ${tage.length} · jeder Haken +2 für den Tag` : "noch keine Routinen ausgewählt"}</p>
                </div>
                {tage.length > 0 && <span className="g-leise" aria-hidden="true">letzte 7 Tage</span>}
              </div>
              {tage.length > 0 ? (
                <ul className="g-liste">
                  {tage.map(v => {
                    const an = v.punkte.at(-1)?.stand === "ja";
                    return (
                      <li key={v.id} className="g-zeile">
                        <button
                          type="button"
                          className={"g-aufgabe" + (an ? " erledigt" : "")}
                          aria-pressed={an}
                          aria-label={`Heute abhaken: ${v.titel}`}
                          onClick={() => onHaken(v.id, !an)}
                          data-sound={an ? undefined : "confirm"}
                        >
                          <span className="g-haken" aria-hidden="true"><Haken /></span>
                          <span className="g-text"><span>{v.titel}</span></span>
                          <span className="g-punkte" role="img" aria-label={`Letzte sieben Tage: ${v.erledigt} von ${v.erfasst} erfassten gemacht`}>
                            {v.punkte.map(p => <i key={p.tag} className={PUNKT[p.stand]} />)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="g-frei">Was möchtest du dir täglich gönnen? <span>Unten Routinen auswählen.</span></p>
              )}
              {anpassen.map(h => (
                <div key={h.id} className="g-hinweis" role="note">
                  <p>„{h.titel.replace(/\.$/, "")}“ hat in den letzten zwei Wochen an <b>{h.erledigt} von {h.erfasst}</b> erfassten Tagen geklappt. Vielleicht passt sie gerade nicht. Anpassen?</p>
                  <div className="g-pillen">
                    <button type="button" className="g-pille klein" onClick={() => onWeglassen(h.id)}>Ab {morgenLabel} weglassen</button>
                    <button type="button" className="g-pille klein" onClick={() => onBehalten(h.id)}>Behalten</button>
                  </div>
                </div>
              ))}
            </fieldset>
          </section>

          </div>

          <div className="g-spalte g-span-7">
            {frei && (
              <section className="g-blatt g-vorn" aria-labelledby="g-bw-frei">
                <div className="g-kopf">
                  <div><h2 id="g-bw-frei">Heute frei</h2><p>ein freier Block im Kalender</p></div>
                  <p className="g-zahl klein"><span>{frei.block.von}</span><span className="leise" style={{ marginLeft: 10 }}>bis {frei.block.bis}</span></p>
                </div>
                <div className="g-lineal" role="img" aria-label={`Der Tag von 7 bis 23 Uhr, frei von ${frei.block.von} bis ${frei.block.bis}`}>
                  <span className="g-lineal-striche" />
                  <span className="g-lineal-frei" style={{ left: `${aufLineal(minuten(frei.block.von))}%`, width: `${aufLineal(minuten(frei.block.bis)) - aufLineal(minuten(frei.block.von))}%` }} />
                  <span className="g-lineal-jetzt" style={{ left: `${jetztPos}%` }} />
                  <span className="g-lineal-enden"><span>07</span><span>23</span></span>
                </div>
                <p className="g-notiz g-gross">
                  {frei.idee ? <>Platz für <b>{frei.idee}</b>?</> : "Zeit für dich, wenn du magst."}
                </p>
                <div className="g-pillen" style={{ marginTop: 12 }}>
                  <a className="g-pille hell" href="#/lernzeit/kalender">Termin planen →</a>
                  <span className="g-leise">Planen setzt keinen Haken.</span>
                </div>
              </section>
            )}

            <section className="g-blatt" aria-labelledby="g-bw-woche">
              <fieldset disabled={busy || wocheZu} className="g-feld">
                <div className="g-kopf">
                  <div>
                    <h2 id="g-bw-woche">Diese Woche für dich</h2>
                    <p>{wocheFertig} von {woche.length} · {rest === 1 ? "heute letzter Tag" : `noch ${rest} Tage`} · Ideen, kein Muss</p>
                  </div>
                  <span className="g-leise" aria-hidden="true">letzte 6 Wochen</span>
                </div>
                <ul className="g-liste">
                  {woche.map(w => {
                    const an = w.wert >= w.ziel;
                    const schritt = w.einheit === "Minuten" ? 15 : 1;
                    return (
                      <li key={w.id} className="g-zeile">
                        <div className={"g-aufgabe" + (an ? " erledigt" : "")}>
                          <span className="g-haken" aria-hidden="true"><Haken /></span>
                          <span className="g-text">
                            <span>{w.titel}</span>
                            <small>{w.wert} von {w.ziel} {w.einheit}{w.pausiert ? " · pausiert" : ""}{an ? " · geschafft" : ""}</small>
                          </span>
                          <span className="g-punkte" role="img" aria-label={`Letzte sechs Wochen: ${w.punkte.filter(p => p.stand === "ja").length} geschafft`}>
                            {w.punkte.map(p => <i key={p.start} className={WPUNKT[p.stand]} />)}
                          </span>
                        </div>
                        {w.wert > 0 && w.ziel > 1 && (
                          <button type="button" className="g-rund geist klein" aria-label={`${w.titel} verringern`} disabled={w.pausiert} onClick={() => onTrage(w.id, { delta: -schritt })}>−</button>
                        )}
                        {w.ziel === 1 ? (
                          <button type="button" className={"g-rund klein" + (an ? "" : " geist")} aria-pressed={an} aria-label={`Diese Woche abhaken: ${w.titel}`} disabled={w.pausiert} onClick={() => onTrage(w.id, { value: an ? 0 : 1 })} data-sound={an ? undefined : "confirm"}><Haken /></button>
                        ) : (
                          <button type="button" className="g-rund geist klein" aria-label={`${w.titel} erhöhen`} disabled={w.pausiert || an} onClick={() => onTrage(w.id, { delta: schritt })} data-sound="confirm">+</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {wocheZu && <p className="g-notiz">Diese Woche ist abgeschlossen.</p>}
              </fieldset>
            </section>
          </div>

          {/* Auswahl, Ideen und Rückblick als schmale Leiste über die ganze
              Breite — vorher stand das als eigene Karte unter „Heute für
              dich" und liess rechts ein Loch (Paul 2026-11-03). */}
          <section className="g-blatt g-bw-mehr g-span-12" aria-label="Routinen, Ideen und Rückblick">
            {weiteres}
            {status}
          </section>
        </>
      )}
      {!geladen && status}
    </div>
  );
}
