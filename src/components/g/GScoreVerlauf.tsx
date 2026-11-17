// Stil „G" — die Verlaufskarten der Score-Seite: Entwicklung als gestapelte
// Säulen, Kalender der letzten Wochen und der Schnitt je Wochentag.
// Paul (2026-11-03): „mach es etwas schöner und mehr Daten, die man sehen kann."
//
// Jede Säule zeigt, woraus der Tag bestand (Lernzeit, Aufgaben, Routinen oben,
// Altlasten unter der Null). Ein Klick auf einen Tag schreibt ihn unten aus —
// so lässt sich jeder Tag nachlesen, ohne dass die Karte voller Zahlen steht.

import { useState, type CSSProperties } from "react";
import type { ScoreDay } from "../../lib/scoreHistory";
import { kalenderWochen, wochentagSchnitt, STARK } from "../../lib/scoreStats";
import "./g.css";
import "./g-score.css";

type Zeitraum = "woche" | "monat";

export const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WOCHENTAG_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const MONAT = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const ausIso = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const isoVon = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const tagKurz = (iso: string) => { const d = ausIso(iso); return `${WOCHENTAG[d.getDay()]} ${d.getDate()}. ${MONAT[d.getMonth()]}`; };

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Altlasten reichen höchstens bis −DRAG_MAX; so tief geht die Säule unter die Null. */
const MINUS_MAX = 8;

function tageVon(von: Date, anzahl: number): string[] {
  return Array.from({ length: anzahl }, (_, i) => { const d = new Date(von); d.setDate(d.getDate() + i); return isoVon(d); });
}

function tagSatz(d: ScoreDay): string {
  const teile = [`Lernzeit ${d.time}`, `Aufgaben ${d.tasks}`];
  if (d.routineBonus) teile.push(`Routinen +${d.routineBonus}`);
  if (d.drag) teile.push(`Altlasten ${d.drag}`);
  return teile.join(" · ");
}

function tagFakten(d: ScoreDay): string {
  const lern = d.goalMin > 0 ? `${fmtMin(d.studyMin)} von ${fmtMin(d.goalMin)} gelernt` : `${fmtMin(d.studyMin)} gelernt`;
  const auf = d.tasksTotal > 0 ? `${d.tasksDone} von ${d.tasksTotal} Aufgaben` : "keine Aufgaben";
  return `${lern} · ${auf}`;
}

function Saeule({ iso, tag, an, zukunft, beschriftung, zahl, onWahl }: {
  iso: string; tag: ScoreDay | undefined; an: boolean; zukunft: boolean; beschriftung: string; zahl: boolean; onWahl: (iso: string) => void;
}) {
  const plus = tag ? tag.time + tag.tasks + (tag.routineBonus ?? 0) : 0;
  // Über 100 wird gedeckelt — die Teile behalten ihr Verhältnis.
  const faktor = plus > 100 ? 100 / plus : 1;
  const hoehe = (n: number) => `${n * faktor}%`;
  const label = tag ? `${tagKurz(iso)}: ${tag.score} Punkte, ${tagSatz(tag)}` : `${tagKurz(iso)}: ${zukunft ? "kommt noch" : "kein Eintrag"}`;
  return (
    <li className={"g-saeule" + (an ? " an" : "") + (zukunft ? " zukunft" : "") + (tag && tag.score >= STARK ? " stark" : "")}>
      <button type="button" aria-pressed={an} aria-label={label} disabled={!tag} onClick={() => onWahl(iso)}>
        <span className="plus">
          {zahl && tag && <em>{tag.score}</em>}
          {tag ? <>
            <i className="t-zeit" style={{ height: hoehe(tag.time) }} />
            <i className="t-auf" style={{ height: hoehe(tag.tasks) }} />
            {(tag.routineBonus ?? 0) > 0 && <i className="t-rout" style={{ height: hoehe(tag.routineBonus ?? 0) }} />}
          </> : <i className="t-leer" />}
        </span>
        <span className="minus">{tag && tag.drag < 0 && <i style={{ height: `${Math.min(100, (-tag.drag / MINUS_MAX) * 100)}%` }} />}</span>
        <small>{beschriftung}</small>
      </button>
    </li>
  );
}

export function Entwicklung({ verlauf, todayIso, weekStart, schnittWoche, schnittMonat }: {
  verlauf: ScoreDay[]; todayIso: string; weekStart: Date; schnittWoche: number | null; schnittMonat: number | null;
}) {
  const [zeitraum, setZeitraum] = useState<Zeitraum>("woche");
  const [gewaehlt, setGewaehlt] = useState(todayIso);
  const woche = zeitraum === "woche";
  const heute = ausIso(todayIso);
  const tage = woche
    ? tageVon(weekStart, 7)
    : tageVon(new Date(heute.getFullYear(), heute.getMonth(), 1), new Date(heute.getFullYear(), heute.getMonth() + 1, 0).getDate());
  const nachDatum = new Map(verlauf.map((d) => [d.date, d]));
  const schnitt = woche ? schnittWoche : schnittMonat;
  const auswahl = nachDatum.get(gewaehlt) ?? nachDatum.get(todayIso);
  const erfasst = tage.filter((t) => nachDatum.has(t)).length;

  return (
    <section className="g-blatt g-span-8 g-entwicklung" aria-labelledby="g-dev-h">
      <div className="g-kopf">
        <div>
          <h2 id="g-dev-h">Entwicklung</h2>
          <p>{woche ? "diese Woche" : MONAT[heute.getMonth()]} · {erfasst} {erfasst === 1 ? "Tag" : "Tage"} erfasst{schnitt != null ? ` · Schnitt ${schnitt}` : ""}</p>
        </div>
        <div className="g-tabs" role="radiogroup" aria-label="Zeitraum">
          {(["woche", "monat"] as const).map((z) => (
            <button key={z} type="button" role="radio" aria-checked={zeitraum === z} className={zeitraum === z ? "an" : ""} onClick={() => setZeitraum(z)}>
              {z === "woche" ? "Diese Woche" : "Diesen Monat"}
            </button>
          ))}
        </div>
      </div>

      <div className={"g-saeulen-rahmen" + (woche ? " woche" : " monat")}>
        <span className="g-sc-linie stark" aria-hidden="true"><b>{STARK}</b></span>
        {schnitt != null && <span className="g-sc-linie schnitt" style={{ "--h": String(schnitt / 100) } as CSSProperties} aria-hidden="true"><b>Ø {schnitt}</b></span>}
        <ol className="g-saeulen" aria-label="Score je Tag — Tag wählen für Einzelheiten">
          {tage.map((iso) => {
            const d = ausIso(iso);
            const beschriftung = woche ? `${WOCHENTAG[d.getDay()]} ${d.getDate()}.` : d.getDate() === 1 || d.getDate() % 5 === 0 ? String(d.getDate()) : "";
            return (
              <Saeule key={iso} iso={iso} tag={nachDatum.get(iso)} an={auswahl?.date === iso} zukunft={iso > todayIso}
                beschriftung={beschriftung} zahl={woche} onWahl={setGewaehlt} />
            );
          })}
        </ol>
      </div>

      <div className="g-legende" aria-hidden="true">
        <span><i className="t-zeit" />Lernzeit</span><span><i className="t-auf" />Aufgaben</span>
        <span><i className="t-rout" />Routinen</span><span><i className="t-alt" />Altlasten</span>
      </div>

      <p className="g-tagdetail" aria-live="polite">
        {auswahl ? <>
          <b>{auswahl.date === todayIso ? "Heute" : tagKurz(auswahl.date)} · {auswahl.score}</b>
          <span>{tagSatz(auswahl)}</span>
          <span className="leise">{tagFakten(auswahl)}</span>
        </> : <span className="leise">Noch kein Tag erfasst.</span>}
      </p>
    </section>
  );
}

const stufeKlasse = (s: number | null) => (s == null ? "" : s >= 85 ? " s4" : s >= STARK ? " s3" : s >= 40 ? " s2" : s > 0 ? " s1" : " s0");

/** Die letzten Wochen als Raster: eine Spalte je Woche, Montag oben. */
export function Kalender({ verlauf, todayIso }: { verlauf: ScoreDay[]; todayIso: string }) {
  const wochen = kalenderWochen(verlauf, todayIso, 17);
  const erfasst = wochen.flat().filter((t) => t.score != null);
  const stark = erfasst.filter((t) => (t.score ?? 0) >= STARK).length;
  return (
    <section className="g-blatt g-span-8 g-kalender" aria-labelledby="g-kal-h">
      <div className="g-kopf">
        <div><h2 id="g-kal-h">Die letzten Wochen</h2><p>{erfasst.length} Tage erfasst · {stark} davon über {STARK}</p></div>
      </div>
      <div className="g-kal">
        <div className="g-kal-tage" aria-hidden="true"><span>Mo</span><span /><span>Mi</span><span /><span>Fr</span><span /><span>So</span></div>
        <div className="g-kal-raster" role="img" aria-label={`Score der letzten ${wochen.length} Wochen, ${erfasst.length} Tage erfasst, ${stark} über ${STARK}`}>
          {wochen.map((w) => (
            <div key={w[0].iso} className="g-kal-woche">
              {ausIso(w[0].iso).getDate() <= 7 && <span className="g-kal-monat">{MONAT[ausIso(w[0].iso).getMonth()]}</span>}
              {w.map((t) => (
                <i key={t.iso} className={"g-kal-tag" + stufeKlasse(t.score) + (t.zukunft ? " zukunft" : "") + (t.iso === todayIso ? " heute" : "")}
                  title={t.score != null ? `${tagKurz(t.iso)}: ${t.score}` : tagKurz(t.iso)} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="g-kal-skala" aria-hidden="true">
        <span>weniger</span><i className="g-kal-tag" /><i className="g-kal-tag s1" /><i className="g-kal-tag s2" /><i className="g-kal-tag s3" /><i className="g-kal-tag s4" /><span>mehr</span>
      </div>
    </section>
  );
}

/** Schnitt je Wochentag — wo die Woche trägt und wo sie hängt. */
export function Wochentage({ verlauf }: { verlauf: ScoreDay[] }) {
  const werte = wochentagSchnitt(verlauf);
  const mit = werte.map((w, i) => ({ ...w, i })).filter((w) => w.schnitt != null);
  const bester = mit.reduce<typeof mit[number] | null>((a, w) => (!a || (w.schnitt ?? 0) > (a.schnitt ?? 0) ? w : a), null);
  const schwaechster = mit.reduce<typeof mit[number] | null>((a, w) => (!a || (w.schnitt ?? 0) < (a.schnitt ?? 0) ? w : a), null);
  return (
    <section className="g-blatt g-span-4 g-wochentage" aria-labelledby="g-wt-h">
      <div className="g-kopf"><div><h2 id="g-wt-h">Nach Wochentag</h2><p>Schnitt über alle erfassten Tage</p></div></div>
      {bester && schwaechster && bester.i !== schwaechster.i
        ? <p className="g-satz klein">{WOCHENTAG_LANG[bester.i]} trägt, {WOCHENTAG_LANG[schwaechster.i]} hängt.</p>
        : <p className="g-notiz">Noch zu wenige Tage für ein Muster.</p>}
      <ul className="g-wt-liste">
        {werte.map((w, i) => (
          <li key={WOCHENTAG_LANG[i]} className={bester?.i === i ? "bester" : ""}>
            <span>{WOCHENTAG_LANG[i].slice(0, 2)}</span>
            <span className="g-wt-spur" aria-hidden="true"><i style={{ width: `${w.schnitt ?? 0}%` }} /></span>
            <b aria-label={w.schnitt != null ? `${WOCHENTAG_LANG[i]}: Schnitt ${w.schnitt} aus ${w.n} Tagen` : `${WOCHENTAG_LANG[i]}: noch keine Tage`}>{w.schnitt ?? "—"}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
