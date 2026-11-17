// Stil „G" — Lernzeit › Score im Aufbau von Seite G (Artboard „Glas-Score").
// Paul (2026-11-03): „Score … muss nochmal überarbeitet werden", dann:
// „mach es etwas schöner und mehr Daten, die man sehen kann."
//
// Nur Ansicht: ScorePanel rechnet den Tag und lädt den Verlauf, die Auswertungen
// kommen aus lib/scoreStats — so zeigen beide Stile dieselben Zahlen.
// Aufbau: oben die Zahl und was bremst, darunter eine Kennzahlen-Leiste, dann
// Verlauf und Herkunft der Punkte, unten Kalender und Wochentage.

import type { ScoreParts } from "../../lib/dayScore";
import type { ScoreDay } from "../../lib/scoreHistory";
import { serie, punkteHerkunft, zielQuote, STARK } from "../../lib/scoreStats";
import { navigate } from "../../lib/router";
import { klausurHebel, type KlausurStand } from "../../lib/klausurStand";
import { GKlausurStand } from "./GKlausurStand";
import { Entwicklung, Kalender, Wochentage, ausIso, isoVon, tagKurz, fmtMin, MONAT } from "./GScoreVerlauf";
import "./g.css";
import "./g-score.css";

type Grenzen = { tasksMax: number; timeMax: number; timeBase: number; dragMax: number; routineBonus: number };
type Hebel = { titel: string; warum: string; krit?: boolean; knopf: string; ziel: string };

export type GScoreProps = {
  parts: ScoreParts;
  dayGoal: number;
  routinenOffen: number;
  todayIso: string;
  weekStart: Date;
  /** Gespeicherter Verlauf mit dem Live-Stand von heute. */
  verlauf: ScoreDay[];
  weekAvg: number | null;
  monthAvg: number | null;
  avg7: number | null;
  avg30: number | null;
  trend: number | null;
  best: ScoreDay | null;
  grenzen: Grenzen;
  /** Je laufende Klausur: Zeit übrig, wie weit, was schieben (lib/klausurStand). */
  klausuren: KlausurStand[];
};

function stufe(score: number): string {
  if (score >= 85) return "sehr stark";
  if (score >= STARK) return "starker Tag";
  if (score >= 40) return "auf dem Weg";
  return score > 0 ? "noch viel Luft" : "noch nichts passiert";
}

const mitVorzeichen = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
const ton = (n: number | null) => (n == null || n === 0 ? "" : n > 0 ? " g-gut" : " g-schlecht");

/** Die größten Hebel für heute — Antwort statt Armaturenbrett. */
function hebelFuer(p: GScoreProps): Hebel[] {
  const { parts, dayGoal, routinenOffen, grenzen } = p;
  const liste: Hebel[] = [];
  if (dayGoal > 0 && parts.studyMin < dayGoal) {
    liste.push({
      titel: `Noch ${fmtMin(dayGoal - parts.studyMin)} bis zum Tagesziel`,
      warum: `bringt bis zu +${Math.max(0, grenzen.timeBase - parts.time)} Punkte, Überzeit zählt halb weiter`,
      knopf: "Timer starten", ziel: "#/lernzeit/timer",
    });
  }
  const eng = klausurHebel(p.klausuren);
  if (eng) liste.push({ ...eng, krit: true, knopf: "Timer starten", ziel: "#/lernzeit/timer" });
  if (parts.weightedTotal === 0) {
    liste.push({ titel: "Keine Aufgaben für heute", warum: `der Aufgabenteil bringt bis zu ${grenzen.tasksMax} Punkte`, knopf: "Aufgabe anlegen", ziel: "#/" });
  } else if (parts.weightedDone < parts.weightedTotal) {
    liste.push({
      titel: parts.weightedDone === 0 ? "Noch nichts abgehakt" : "Aufgaben offen",
      warum: `noch +${grenzen.tasksMax - parts.tasks} Punkte, dringende zählen dreifach`,
      knopf: "Zu den Aufgaben", ziel: "#/",
    });
  }
  if (routinenOffen > 0) {
    liste.push({
      titel: `${routinenOffen} ${routinenOffen === 1 ? "Routine" : "Routinen"} noch offen`,
      warum: `je +${grenzen.routineBonus} Punkte`, knopf: "Abhaken", ziel: "#/",
    });
  }
  return liste.slice(0, 3);
}

function satzFuer(parts: ScoreParts, dayGoal: number, timeMax: number): string {
  if (parts.score >= STARK) return "Starker Tag — so darf es bleiben.";
  if (parts.studyMin === 0) return `Die Lernzeit trägt ${timeMax} der 100 Punkte.`;
  if (dayGoal > 0 && parts.studyMin < dayGoal) return "Der größte Hebel liegt bei der Lernzeit.";
  if (parts.stale.length > 0) return "Altlasten ziehen den Tag nach unten.";
  return "Lernziel steht, jetzt noch abhaken.";
}

function Held(p: GScoreProps & { gestern: ScoreDay | undefined; serieTage: number }) {
  const { parts, dayGoal, grenzen, gestern, serieTage } = p;
  const routineAnteil = parts.routineHaken + p.routinenOffen > 0 ? parts.routineHaken / (parts.routineHaken + p.routinenOffen) : 0;
  const teile = [
    { label: "Lernzeit", sub: dayGoal > 0 ? `${fmtMin(parts.studyMin)} von ${fmtMin(dayGoal)}` : fmtMin(parts.studyMin), wert: String(parts.time), anteil: parts.time / grenzen.timeMax, max: `von ${grenzen.timeMax}`, art: "t-zeit" },
    { label: "Aufgaben", sub: "dringend ×3, wichtig ×2", wert: String(parts.tasks), anteil: parts.tasks / grenzen.tasksMax, max: `von ${grenzen.tasksMax}`, art: "t-auf" },
    { label: "Routinen", sub: `${parts.routineHaken} Haken · +${grenzen.routineBonus} je Haken`, wert: parts.routineBonus > 0 ? `+${parts.routineBonus}` : "0", anteil: routineAnteil, max: "Bonus", art: "t-rout" },
    { label: "Altlasten", sub: parts.stale.length ? `${parts.stale.length} ${parts.stale.length === 1 ? "liegt" : "liegen"} zu lange` : "nichts liegt zu lange", wert: parts.drag < 0 ? `−${Math.abs(parts.drag)}` : "0", anteil: Math.abs(parts.drag) / grenzen.dragMax, max: `bis −${grenzen.dragMax}`, art: "t-alt" },
  ];
  const vsGestern = gestern ? parts.score - gestern.score : null;
  const vsSchnitt = p.avg7 != null ? parts.score - p.avg7 : null;

  return (
    <section className="g-held g-span-7" aria-labelledby="g-sc-h">
      <div className="g-kopf"><h1 className="g-label" id="g-sc-h">Score heute</h1><span className="g-label leise">{stufe(parts.score)}</span></div>
      <div className="g-score-kern">
        <p className="g-zahl riesig"><span>{parts.score}</span><span className="leise">/100</span></p>
        <ul className="g-vergleich" aria-label="Vergleich">
          <li><span>gestern</span><b>{gestern ? gestern.score : "—"}</b>{vsGestern != null && <small className={ton(vsGestern)}>{mitVorzeichen(vsGestern)}</small>}</li>
          <li><span>Ø 7 Tage</span><b>{p.avg7 ?? "—"}</b>{vsSchnitt != null && <small className={ton(vsSchnitt)}>{mitVorzeichen(vsSchnitt)}</small>}</li>
          <li><span>Serie über {STARK}</span><b>{serieTage}</b><small>{serieTage === 1 ? "Tag" : "Tage"}</small></li>
        </ul>
      </div>
      <div className="g-mix" aria-hidden="true">
        <i className="t-zeit" style={{ flexGrow: parts.time }} />
        <i className="t-auf" style={{ flexGrow: parts.tasks }} />
        <i className="t-rout" style={{ flexGrow: parts.routineBonus }} />
        <i className="t-rest" style={{ flexGrow: Math.max(0, 100 - parts.time - parts.tasks - parts.routineBonus) }} />
      </div>
      <ul className="g-teile" aria-label="Woraus der Score besteht">
        {teile.map((t) => (
          <li key={t.label}>
            <span className="g-teil-name"><i className={"g-punkt " + t.art} aria-hidden="true" />{t.label}<small>{t.sub}</small></span>
            <span className={"g-linie" + (t.art === "t-alt" ? " krit" : "")} aria-hidden="true">
              <i style={{ width: `${Math.min(100, Math.max(0, t.anteil * 100))}%` }} />
              {t.anteil > 0 && <b style={{ left: `${Math.min(100, t.anteil * 100)}%` }} />}
            </span>
            <span className="g-teil-wert" aria-label={`${t.label} ${t.wert} Punkte ${t.max}`}><b>{t.wert}</b><small>{t.max}</small></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Bremst(p: GScoreProps) {
  const { parts, dayGoal, grenzen } = p;
  const hebel = hebelFuer(p);
  return (
    <section className="g-blatt g-vorn g-span-5" aria-labelledby="g-brems-h">
      <div className="g-kopf"><div><h2 id="g-brems-h">Was gerade bremst</h2><p>die größten Hebel für heute</p></div></div>
      <p className="g-satz">{satzFuer(parts, dayGoal, grenzen.timeMax)}</p>
      {hebel.length === 0 && parts.stale.length === 0 ? (
        <p className="g-notiz">Nichts Auffälliges. Ziel erreicht, nichts liegt zu lange.</p>
      ) : (
        <ul className="g-liste">
          {hebel.map((h) => (
            <li key={h.titel} className="g-zeile g-hebel">
              <span className="g-text"><span>{h.titel}</span><small>{h.warum}</small></span>
              <button type="button" className={"g-pille klein" + (h.ziel.startsWith("#/lernzeit") ? " hell" : "")} onClick={() => navigate(h.ziel)}>{h.knopf}</button>
            </li>
          ))}
        </ul>
      )}
      {parts.stale.length > 0 && <>
        <p className="g-unterkopf">Liegt zu lange · kostet zusammen {Math.abs(parts.drag)} {Math.abs(parts.drag) === 1 ? "Punkt" : "Punkte"}</p>
        <ul className="g-altlasten">
          {parts.stale.slice(0, 4).map((s) => (
            <li key={s.id}>
              <span className="g-krit" aria-hidden="true" />
              <span className="g-alt-text">{s.text}</span>
              <small>{s.days} Tage · −{s.cost.toLocaleString("de-DE")}</small>
            </li>
          ))}
        </ul>
        {parts.stale.length > 4 && <p className="g-notiz">und {parts.stale.length - 4} weitere</p>}
      </>}
    </section>
  );
}

function Kennzahlen(p: GScoreProps & { serieTage: number; wocheMin: number; ziel: ReturnType<typeof zielQuote> }) {
  const trendText = p.trend == null ? "—" : mitVorzeichen(p.trend);
  const kacheln = [
    { label: "Serie über 70", wert: String(p.serieTage), klein: p.serieTage === 1 ? "Tag" : "Tage" },
    { label: "Schnitt 7 Tage", wert: p.avg7 != null ? String(p.avg7) : "—", klein: "" },
    { label: "Schnitt 30 Tage", wert: p.avg30 != null ? String(p.avg30) : "—", klein: "" },
    { label: "vs. Vorwoche", wert: trendText, klein: "", klasse: ton(p.trend) },
    { label: `Bester Tag · ${MONAT[ausIso(p.todayIso).getMonth()]}`, wert: p.best ? String(p.best.score) : "—", klein: p.best ? tagKurz(p.best.date) : "" },
    { label: "Lernziel · 30 Tage", wert: p.ziel.tage ? `${p.ziel.erreicht}/${p.ziel.tage}` : "—", klein: "Tage" },
    { label: "Gelernt diese Woche", wert: fmtMin(p.wocheMin), klein: "" },
  ];
  return (
    <section className="g-blatt g-span-12 g-kennzahlen" aria-label="Kennzahlen">
      <dl>
        {kacheln.map((k) => (
          <div key={k.label}><dt>{k.label}</dt><dd className={k.klasse ?? ""}>{k.wert}{k.klein && <small>{k.klein}</small>}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function Herkunft({ verlauf30, grenzen, ziel }: { verlauf30: ScoreDay[]; grenzen: Grenzen; ziel: ReturnType<typeof zielQuote> }) {
  const h = punkteHerkunft(verlauf30);
  if (!h) {
    return (
      <section className="g-blatt g-span-4" aria-labelledby="g-her-h">
        <div className="g-kopf"><div><h2 id="g-her-h">Woher die Punkte kommen</h2><p>noch keine Tage erfasst</p></div></div>
      </section>
    );
  }
  const zeilen = [
    { label: "Lernzeit", wert: h.time, max: grenzen.timeMax, art: "t-zeit" },
    { label: "Aufgaben", wert: h.tasks, max: grenzen.tasksMax, art: "t-auf" },
    { label: "Routinen", wert: h.routine, max: null, art: "t-rout" },
    { label: "Altlasten", wert: h.drag, max: null, art: "t-alt" },
  ];
  return (
    <section className="g-blatt g-span-4 g-herkunft" aria-labelledby="g-her-h">
      <div className="g-kopf"><div><h2 id="g-her-h">Woher die Punkte kommen</h2><p>Schnitt pro Tag · letzte 30 Tage</p></div></div>
      <div className="g-mix gross" aria-hidden="true">
        <i className="t-zeit" style={{ flexGrow: h.time }} /><i className="t-auf" style={{ flexGrow: h.tasks }} />
        <i className="t-rout" style={{ flexGrow: h.routine }} /><i className="t-rest" style={{ flexGrow: Math.max(0, 100 - h.time - h.tasks - h.routine) }} />
      </div>
      <dl className="g-her-liste">
        {zeilen.map((z) => (
          <div key={z.label}>
            <dt><i className={"g-punkt " + z.art} aria-hidden="true" />{z.label}</dt>
            <dd>{z.art === "t-rout" && z.wert > 0 ? `+${z.wert}` : z.art === "t-alt" && z.wert < 0 ? `−${Math.abs(z.wert)}` : z.wert}{z.max != null && <small>von {z.max}</small>}</dd>
          </div>
        ))}
      </dl>
      <p className="g-notiz">
        Ø {fmtMin(ziel.schnittMin)} gelernt am Tag · {fmtMin(ziel.minuten)} in {verlauf30.length} erfassten Tagen
      </p>
    </section>
  );
}

export function GScore(p: GScoreProps) {
  const heute = ausIso(p.todayIso);
  const gesternD = new Date(heute); gesternD.setDate(gesternD.getDate() - 1);
  const gestern = p.verlauf.find((d) => d.date === isoVon(gesternD));
  const serieTage = serie(p.verlauf, p.todayIso);
  const ab30 = new Date(heute); ab30.setDate(ab30.getDate() - 29);
  const verlauf30 = p.verlauf.filter((d) => d.date >= isoVon(ab30));
  const ziel = zielQuote(verlauf30);
  const wocheMin = p.verlauf.filter((d) => d.date >= isoVon(p.weekStart)).reduce((a, d) => a + d.studyMin, 0);

  return (
    <div className="g-raster g-score">
      <Held {...p} gestern={gestern} serieTage={serieTage} />
      <Bremst {...p} />
      <GKlausurStand staende={p.klausuren} />
      <Kennzahlen {...p} serieTage={serieTage} wocheMin={wocheMin} ziel={ziel} />
      <Entwicklung verlauf={p.verlauf} todayIso={p.todayIso} weekStart={p.weekStart} schnittWoche={p.weekAvg} schnittMonat={p.monthAvg} />
      <Herkunft verlauf30={verlauf30} grenzen={p.grenzen} ziel={ziel} />
      <Kalender verlauf={p.verlauf} todayIso={p.todayIso} />
      <Wochentage verlauf={p.verlauf} />
    </div>
  );
}
