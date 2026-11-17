// Stil „G" — das Lernzeit-Dashboard im Aufbau von Seite G (Artboard
// „Glas-Lernzeit"). Nur Ansicht über die vorhandenen Daten: Lernzeit aus dem
// Tracker, Tagesziel aus Budget und Bedarf (lib/tagesziel.ts), Heute dran aus
// dem Klausur-Planer (lib/lernHeute.ts), Klausuren aus den wichtigen Terminen.
// Oben kein Titel und kein Satz — die Zahl sagt es.

import { useMemo } from "react";
import { isoDate, useTracker } from "../../tracker/store";
import { useTimerContext } from "../../tracker/TimerContext";
import { useTagesziel } from "../../lib/tagesziel";
import { fachZurKlausur } from "../../lib/klausurPlaner";
import { useImportantEvents } from "../../important/store";
import { tageBis } from "../../lib/horizon";
import "./g.css";
import { stundenZahl } from "../../lib/stunden";

const WOTAG = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const anteil = (v: number) => `${(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 100).toFixed(1)}%`;
function fmtMin(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m}` : ""}` : `${m} min`;
}
const stunden = stundenZahl;

function Play() {
  return <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4.5 2.8v8.4c0 .4.4.7.8.4l6.4-4.2a.5.5 0 0 0 0-.8L5.3 2.4c-.4-.3-.8 0-.8.4z" fill="currentColor" /></svg>;
}

export function GLernzeit() {
  const { sessions, subjects, goalForDate } = useTracker();
  const { startStopwatch, isFocusRunning, isStopwatchRunning } = useTimerContext();
  const { events } = useImportantEvents();
  const jetzt = new Date();
  const heute = isoDate(jetzt);
  const tz = useTagesziel(jetzt);

  const proTag = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(s.date, (m.get(s.date) ?? 0) + s.durationMin);
    return m;
  }, [sessions]);
  const heuteMin = proTag.get(heute) ?? 0;

  // Serie: Tage in Folge mit Lernzeit, heute zählt mit, sobald gelernt wurde.
  const serie = useMemo(() => {
    let n = 0;
    const d = new Date(jetzt);
    if (!(proTag.get(isoDate(d)) ?? 0)) d.setDate(d.getDate() - 1);
    while ((proTag.get(isoDate(d)) ?? 0) > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }, [proTag, heute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Woche Montag bis Sonntag.
  const woche = useMemo(() => {
    const wt = (jetzt.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(jetzt); d.setDate(jetzt.getDate() - wt + i);
      const iso = isoDate(d);
      const min = proTag.get(iso) ?? 0;
      return { kurz: WOTAG[i], min, ziel: goalForDate(d), heute: iso === heute, zukunft: i > wt };
    });
  }, [proTag, heute, goalForDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const wocheMin = woche.reduce((s, t) => s + t.min, 0);
  const wocheZiel = woche.reduce((s, t) => s + t.ziel, 0);
  const zielTage = woche.filter(t => !t.zukunft && t.ziel > 0 && t.min >= t.ziel * 0.9).length;
  const maxBalken = Math.max(60, ...woche.map(t => Math.max(t.min, t.ziel)));

  // Ein Jahr in Punkten, heute zuletzt (52 Wochen, Montag oben).
  const jahr = useMemo(() => {
    const ende = new Date(jetzt);
    const wt = (ende.getDay() + 6) % 7;
    const start = new Date(ende); start.setDate(ende.getDate() - wt - 51 * 7);
    const zellen: { cls: string; titel: string }[] = [];
    for (let i = 0; i < 52 * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = isoDate(d);
      if (iso > heute) { zellen.push({ cls: "leer", titel: "" }); continue; }
      const m = proTag.get(iso) ?? 0;
      const cls = iso === heute ? "jetzt" : m === 0 ? "" : m < 30 ? "l1" : m < 60 ? "l2" : m < 120 ? "l3" : "l4";
      zellen.push({ cls, titel: `${iso}: ${m} min` });
    }
    return zellen;
  }, [proTag, heute]); // eslint-disable-line react-hooks/exhaustive-deps
  const tageGelernt = [...proTag.values()].filter(m => m > 0).length;

  // Produktivste Stunden: Lernminuten je Zwei-Stunden-Block (nur mit Startzeit).
  const stundenBloecke = useMemo(() => {
    const b = [6, 8, 10, 12, 14, 16, 18, 20].map(h => ({ h, min: 0 }));
    for (const s of sessions) {
      if (!s.startedAtMs) continue;
      const h = new Date(s.startedAtMs).getHours();
      const i = b.findIndex(x => h >= x.h && h < x.h + 2);
      if (i >= 0) b[i].min += s.durationMin;
    }
    return b;
  }, [sessions]);
  const peak = stundenBloecke.reduce((a, x) => (x.min > a.min ? x : a), stundenBloecke[0]);
  const maxStunde = Math.max(1, ...stundenBloecke.map(x => x.min));

  // Heute dran: Klausur-Planer und feste Fachzeiten.
  const zeilen = tz.lern?.zeilen.filter(z => z.ziel > 0) ?? [];
  const lernIst = (name: string) => {
    const fach = subjects.find(s => s.name === name);
    return fach ? sessions.filter(s => s.subjectId === fach.id && s.date === heute).reduce((a, s) => a + s.durationMin, 0) : 0;
  };
  const dran = [
    ...zeilen.map(z => ({ id: z.id, titel: z.klausur, meta: z.dran.length ? z.dran.join(", ") : "aus dem Klausur-Planer", ist: z.ist, ziel: z.ziel, fach: fachZurKlausur(subjects, z.klausur)?.id, lage: z.lage })),
    ...tz.feste.map(f => ({ id: `fest:${f.name}`, titel: f.name, meta: "feste Zeit pro Woche", ist: lernIst(f.name), ziel: f.minuten, fach: subjects.find(s => s.name === f.name)?.id, lage: "im-plan" as const })),
  ];
  const timerLaeuft = isFocusRunning || isStopwatchRunning;

  // Klausuren: aus den wichtigen Terminen, mit dem Urteil des Planers, wenn es eins gibt.
  const klausuren = events
    .filter(e => e.kind === "exam" && e.date >= heute)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)
    .map(e => {
      const z = zeilen.find(x => e.title.toLowerCase().includes(x.klausur.toLowerCase()) || x.klausur.toLowerCase().includes(e.title.replace(/^klausur\s+/i, "").toLowerCase()));
      return { id: e.id, titel: e.title.replace(/^Klausur\s+/i, ""), tage: tageBis(heute, e.date), datum: new Date(e.date + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" }), lage: z?.lage ?? null };
    });

  const quelleText = tz.quelle === "eigenes" ? "dein eigenes Ziel für heute" : tz.quelle === "bedarf" ? "so viel ist heute nötig" : "das Budget gilt";

  return (
    <div className="g-raster g-lernzeit">
      <div className="g-spalte g-span-7">
      <section className="g-held" aria-labelledby="g-lz-heute">
        <div className="g-kopf">
          <h1 id="g-lz-heute" className="g-label">Heute gelernt</h1>
          <span className="g-label">{serie} {serie === 1 ? "Tag" : "Tage"} in Folge</span>
        </div>
        <p className="g-zahl riesig"><span>{heuteMin}</span><span className="leise">/{tz.ziel}</span><small>min</small></p>
        <span className="g-linie dick" aria-hidden="true"><i style={{ width: anteil(heuteMin / Math.max(1, tz.ziel)) }} /><b style={{ left: anteil(heuteMin / Math.max(1, tz.ziel)) }} /></span>
        <dl className="g-werte">
          <div><dt>Budget</dt><dd className="g-zahl klein"><span className="leise">{fmtMin(tz.budget)}</span></dd><dd className="g-notiz">so viel Zeit hast du heute</dd></div>
          <div><dt>Bedarf heute</dt><dd className="g-zahl klein"><span>{tz.bedarf === null ? "–" : fmtMin(tz.bedarf)}</span></dd><dd className="g-notiz">{[...zeilen.map(z => `${z.klausur} ${fmtMin(z.ziel)}`), ...tz.feste.map(f => `${f.name} ${fmtMin(f.minuten)}`)].join(" · ") || "kein Plan für heute"}</dd></div>
          <div><dt>Ziel <span className="g-funke" aria-hidden="true" /></dt><dd className="g-zahl klein"><span>{fmtMin(tz.ziel)}</span></dd><dd className="g-notiz">{quelleText}</dd></div>
        </dl>
      </section>
      <section className="g-blatt" aria-labelledby="g-lz-dran">
        <div className="g-kopf">
          <div><h2 id="g-lz-dran">Heute dran</h2><p>aus dem Klausur-Planer und deinen festen Zeiten</p></div>
          <span className="g-leise">{dran.reduce((s, d) => s + Math.min(d.ist, d.ziel), 0)} von {dran.reduce((s, d) => s + d.ziel, 0)} min</span>
        </div>
        {dran.length ? (
          <ul className="g-liste">
            {dran.map(d => (
              <li key={d.id} className="g-zeile">
                <div className={"g-aufgabe" + (d.ist >= d.ziel ? " erledigt" : "")}>
                  <span className="g-text">
                    <span>{d.titel}</span>
                    <small>{fmtMin(d.ist)} von {fmtMin(d.ziel)} · {d.meta}</small>
                    <span className="g-linie" aria-hidden="true"><i style={{ width: anteil(d.ist / d.ziel) }} /><b style={{ left: anteil(d.ist / d.ziel) }} /></span>
                  </span>
                  {d.lage !== "im-plan" && <span className="g-urteil"><span className={d.lage === "knapp" ? "g-warn" : "g-krit"} />{d.lage === "knapp" ? "knapp" : "zu knapp"}</span>}
                </div>
                {d.fach && (
                  <button type="button" className="g-rund geist" disabled={timerLaeuft} aria-label={`Timer starten: ${d.titel}`} title={timerLaeuft ? "Es läuft schon ein Timer" : "Timer starten"} onClick={() => startStopwatch(d.fach!, "")}>
                    <Play />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="g-frei">Heute steht nichts Festes an. <span>Lernen zählt trotzdem.</span></p>
        )}
        {tz.lern?.tempo.faktor && tz.lern.tempo.schnittMinuten ? (
          <p className="g-notiz g-trenner">Ein Schwerpunkt dauert bei dir im Schnitt <b>{fmtMin(tz.lern.tempo.schnittMinuten)}</b>{tz.lern.tempo.schnittGeplant ? <> statt {fmtMin(tz.lern.tempo.schnittGeplant)}</> : null}.{tz.lern.kap.schnittLerntage ? <> An Lerntagen schaffst du im Schnitt <b>{fmtMin(tz.lern.kap.schnittLerntage)}</b>.</> : null}</p>
        ) : null}
      </section>
      <section className="g-blatt" aria-labelledby="g-lz-jahr">
        <div className="g-kopf">
          <div><h2 id="g-lz-jahr">365-Tage Streak</h2><p>{tageGelernt} Tage gelernt</p></div>
          <span className="g-legende" aria-hidden="true">weniger<i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" />mehr</span>
        </div>
        <div className="g-jahr" role="img" aria-label={`Lernzeit der letzten 52 Wochen, ${tageGelernt} Tage gelernt`}>
          {jahr.map((z, i) => <i key={i} className={z.cls} title={z.titel || undefined} />)}
        </div>
      </section>
      </div>
      <div className="g-spalte g-span-5">
      <section className="g-blatt g-vorn" aria-labelledby="g-lz-klausuren">
        <div className="g-kopf"><div><h2 id="g-lz-klausuren">Klausur-Countdown</h2><p>dein Tempo eingerechnet</p></div></div>
        {klausuren.length ? (
          <ul className="g-liste">
            {klausuren.map(k => (
              <li key={k.id} className="g-zeile g-klausur">
                <span className="g-text">
                  <span>{k.titel}</span>
                  <small>{k.datum}</small>
                  {k.lage && (
                    <span className="g-urteil">
                      <span className={k.lage === "im-plan" ? "g-ok" : k.lage === "knapp" ? "g-warn" : "g-krit"} />
                      {k.lage === "im-plan" ? "passt" : k.lage === "knapp" ? "knapp" : "zu knapp"}
                    </span>
                  )}
                </span>
                <p className="g-zahl mittel"><span className={k.tage > 30 ? "leise" : ""}>{k.tage}</span><small>{k.tage === 1 ? "Tag" : "Tage"}</small></p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="g-frei">Keine Klausur in Sicht.</p>
        )}
      </section>
      <section className="g-blatt" aria-labelledby="g-lz-woche">
        <div className="g-kopf"><div><h2 id="g-lz-woche">Diese Woche</h2><p>Ziel an {zielTage} {zielTage === 1 ? "Tag" : "Tagen"} erreicht</p></div></div>
        <p className="g-zahl mittel" style={{ marginTop: 14 }}><span>{stunden(wocheMin)}</span><span className="leise">/{stunden(wocheZiel)}</span><small>h</small></p>
        <div className="g-balken" role="img" aria-label={`Lernzeit je Tag dieser Woche, zusammen ${fmtMin(wocheMin)}`}>
          {woche.map(t => (
            <div key={t.kurz} className={"g-balken-tag" + (t.heute ? " heute" : t.ziel > 0 && t.min >= t.ziel * 0.9 ? " ziel" : "") + (t.min === 0 ? " leer" : "")}>
              <span className="g-balken-rahmen" style={{ height: `${Math.round((t.ziel / maxBalken) * 120)}px` }} />
              <i style={{ height: `${Math.max(6, Math.round((t.min / maxBalken) * 120))}px` }} />
              <span>{t.kurz}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="g-blatt" aria-labelledby="g-lz-peak">
        <div className="g-kopf"><div><h2 id="g-lz-peak">Produktivste Stunden</h2><p>{peak.min ? `Peak-Slot ${peak.h} bis ${peak.h + 2} Uhr` : "füllt sich mit neuen Sessions"}</p></div></div>
        <div className="g-balken acht" role="img" aria-label="Lernminuten je Zwei-Stunden-Block">
          {stundenBloecke.map(b => (
            <div key={b.h} className={"g-balken-tag" + (b === peak && b.min ? " ziel" : "") + (b.min === 0 ? " leer" : "")}>
              <i style={{ height: `${Math.max(6, Math.round((b.min / maxStunde) * 100))}px` }} />
              <span>{b.h}</span>
            </div>
          ))}
        </div>
      </section>
      </div>





    </div>
  );
}
