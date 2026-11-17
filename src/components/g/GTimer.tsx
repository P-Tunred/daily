// Stil „G" — Lernzeit › Timer im Aufbau von Seite G (Artboard „Glas-Timer").
// Paul (2026-11-03): „den Timer … fand ich schöner, wie du es designt hast."
//
// Nur Ansicht: Laufen, Pausieren, Speichern und Verwerfen bleiben im
// TimerContext, Fächer und Sessions im Tracker-Store. Fokus, Pausen und
// Stoppuhr teilen sich einen Ring; die Reiter darüber wählen, was er zeigt.
// Läuft schon eine Stoppuhr, zeigt er die — nie zwei Uhren auf einmal.

import { useEffect, useState } from "react";
import { FOCUS_PRESETS, useTimerContext, type FocusMode } from "../../tracker/TimerContext";
import { isoDate, useTracker } from "../../tracker/store";
import type { BlockCategory } from "../../tracker/types";
import { CATEGORY_META, CATEGORY_ORDER } from "../../lib/categories";
import "./g.css";

type Ansicht = FocusMode | "uhr";
type SubjectLite = { id: string; name: string; color: string; archiviert?: boolean };

const REITER: { id: Ansicht; label: string }[] = [
  { id: "focus", label: `Fokus · ${FOCUS_PRESETS.focus / 60}` },
  { id: "shortBreak", label: `Kurze Pause · ${FOCUS_PRESETS.shortBreak / 60}` },
  { id: "longBreak", label: `Lange Pause · ${FOCUS_PRESETS.longBreak / 60}` },
  { id: "uhr", label: "Stoppuhr" },
];
const R = 170;
const UMFANG = 2 * Math.PI * R;

function teile(sec: number): { haupt: string; rest: string } {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? { haupt: `${h}:${String(m).padStart(2, "0")}`, rest: `:${String(r).padStart(2, "0")}` }
    : { haupt: String(m), rest: `:${String(r).padStart(2, "0")}` };
}
/** HH:MM → Minuten seit Mitternacht, sonst null. */
function minutenAus(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}
const uhrzeit = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

function Play() { return <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4.5 2.8v8.4c0 .4.4.7.8.4l6.4-4.2a.5.5 0 0 0 0-.8L5.3 2.4c-.4-.3-.8 0-.8.4z" fill="currentColor" /></svg>; }
function Pause() { return <svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3.5" y="3" width="2.2" height="8" rx="1" fill="currentColor" /><rect x="8.3" y="3" width="2.2" height="8" rx="1" fill="currentColor" /></svg>; }
function Neu() { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3" /><path d="M2.5 2.2v2.6h2.6" /></svg>; }
function Weg() { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M4 4l6 6M10 4l-6 6" /></svg>; }

export function GTimer({ subjects, selectedSubject, onSelectSubject }: {
  subjects: SubjectLite[];
  selectedSubject: string;
  onSelectSubject: (id: string) => void;
}) {
  const ctx = useTimerContext();
  const { sessions } = useTracker();
  const ft = ctx.focusTimer;
  const sw = ctx.stopwatch;
  const [ansicht, setAnsicht] = useState<Ansicht>(() => (sw && !ft ? "uhr" : ft?.mode ?? "focus"));
  const [eigene, setEigene] = useState("");
  const [notiz, setNotiz] = useState(sw?.note ?? "");
  useEffect(() => { if (sw) setNotiz(sw.note); }, [sw?.note]); // eslint-disable-line react-hooks/exhaustive-deps

  const uhr = ansicht === "uhr";
  const aktiv = subjects.filter(s => !s.archiviert);
  const fach = (uhr ? sw?.subjectId : ft?.subjectId) || selectedSubject;
  const fachName = subjects.find(s => s.id === fach)?.name ?? "kein Fach";

  // Was der Ring zeigt
  const modus: FocusMode = uhr ? "focus" : (ft?.mode ?? ansicht);
  const dauer = ft?.duration ?? FOCUS_PRESETS[modus];
  const bleibt = ft ? ctx.remainingSec : FOCUS_PRESETS[modus];
  const vergangen = ctx.elapsedMs / 1000;
  const laeuft = uhr ? ctx.isStopwatchRunning : ctx.isFocusRunning;
  const anteil = uhr ? (vergangen % 3600) / 3600 : dauer > 0 ? 1 - bleibt / dauer : 0;
  const zeit = teile(uhr ? vergangen : bleibt);
  const runde = ((ft?.pomodoroCount ?? 0) % 4) + 1;
  const unter = uhr
    ? `${fachName} · ${sw ? "läuft offen" : "zählt hoch"}`
    : modus === "focus" ? `${fachName} · Runde ${runde} von 4` : `Pause · danach Runde ${runde}`;
  const winkel = anteil * 2 * Math.PI - Math.PI / 2;
  const kopf = { x: 180 + R * Math.cos(winkel), y: 180 + R * Math.sin(winkel) };

  const waehle = (a: Ansicht) => {
    setAnsicht(a);
    // Zurück vom Stoppuhr-Reiter auf denselben Modus: der Fokus-Timer bleibt.
    if (a === "uhr" || a === ft?.mode) return;
    if (ft) ctx.resetFocus(a); else ctx.setFocusMode(a, FOCUS_PRESETS[a]);
  };
  const umschalten = () => {
    if (uhr) {
      if (!sw) { if (fach) ctx.startStopwatch(fach, notiz); return; }
      if (sw.startedAt !== null) ctx.pauseStopwatch(); else ctx.resumeStopwatch();
      return;
    }
    if (!ft) { if (fach) ctx.startFocus(fach, modus, dauer); return; }
    if (ft.startedAt !== null) ctx.pauseFocus(); else ctx.resumeFocus();
  };
  const neuStarten = () => (uhr ? ctx.resetStopwatch() : ctx.resetFocus());
  const verwerfen = () => (uhr ? ctx.resetStopwatch() : ctx.discardFocus());
  const kannSpeichern = uhr ? !!sw && ctx.elapsedMs >= 1000 : !!ft && ft.mode === "focus";
  const speichern = () => (uhr ? ctx.saveStopwatch() : ctx.stopFocus());
  const setzeEigene = () => {
    const m = parseInt(eigene, 10);
    if (Number.isFinite(m) && m > 0 && m <= 240) {
      setAnsicht("focus");
      if (ft) ctx.resetFocus("focus", m * 60); else ctx.setFocusMode("focus", m * 60);
      setEigene("");
    }
  };
  const fachWahl = (id: string) => {
    onSelectSubject(id);
    if (uhr && sw) ctx.setStopwatchSubject(id);
    if (!uhr && ft) ctx.setFocusSubject(id);
  };

  const heute = isoDate();
  const heuteListe = sessions
    .filter(s => s.date === heute)
    .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
  const heuteMin = heuteListe.reduce((s, x) => s + x.durationMin, 0);

  return (
    <div className="g-raster g-timer">
      <section className="g-span-7 g-uhr" aria-label="Timer">
        <div className="g-tabs" role="radiogroup" aria-label="Art">
          {REITER.map(r => (
            <button key={r.id} type="button" role="radio" aria-checked={ansicht === r.id} className={ansicht === r.id ? "an" : ""} onClick={() => waehle(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="g-ring">
          <svg viewBox="0 0 360 360" aria-hidden="true">
            <g transform="rotate(-90 180 180)">
              <circle className="striche" cx="180" cy="180" r="158" />
              <circle className="spur" cx="180" cy="180" r={R} />
              <circle className="fuell" cx="180" cy="180" r={R} strokeDasharray={UMFANG.toFixed(1)} style={{ strokeDashoffset: (UMFANG * (1 - anteil)).toFixed(1) }} />
            </g>
            {anteil > 0 && <>
              <circle cx={kopf.x.toFixed(1)} cy={kopf.y.toFixed(1)} r="10" className="kopf-schein" />
              <circle cx={kopf.x.toFixed(1)} cy={kopf.y.toFixed(1)} r="4" className="kopf" />
            </>}
          </svg>
          <div className="g-ring-innen">
            <p className="g-zahl riesig" role="timer" aria-label={`${uhr ? "" : "noch "}${zeit.haupt} Minuten ${zeit.rest.slice(1)} Sekunden`}>
              <span>{zeit.haupt}</span><span className="leise">{zeit.rest}</span>
            </p>
            <p className="g-notiz">{unter}</p>
          </div>
        </div>
        <div className="g-uhr-knoepfe">
          <button type="button" className="g-rundknopf geist" aria-label="Runde neu starten" title="Runde neu starten" onClick={neuStarten}><Neu /></button>
          <button type="button" className="g-rundknopf gross" aria-label={laeuft ? "Pausieren" : (uhr ? sw : ft) ? "Weiter" : "Starten"} disabled={!fach} onClick={umschalten} data-sound={laeuft ? undefined : "confirm"}>
            {laeuft ? <Pause /> : <Play />}
          </button>
          <button type="button" className="g-rundknopf geist" aria-label="Timer verwerfen, ohne zu speichern" title="Verwerfen ohne zu speichern" disabled={uhr ? !sw : !ft} onClick={verwerfen} data-sound="dismiss"><Weg /></button>
        </div>
        <button type="button" className="g-pille-frei" disabled={!kannSpeichern} onClick={speichern} data-sound="confirm">
          Zeit jetzt speichern, keine Pause nötig
        </button>
        {!fach && aktiv.length > 0 && <p className="g-notiz">Wähle rechts ein Fach, dann läuft die Zeit.</p>}
        {!uhr && (
          <form className="g-eigene" onSubmit={(e) => { e.preventDefault(); setzeEigene(); }}>
            <label htmlFor="g-eigene-dauer" className="g-leise">Eigene Dauer</label>
            <input id="g-eigene-dauer" type="number" min={1} max={240} inputMode="numeric" placeholder="min" value={eigene} onChange={(e) => setEigene(e.target.value)} />
            <button type="submit" className="g-tabs-knopf">Setzen</button>
          </form>
        )}
      </section>

      <div className="g-spalte g-span-5 g-timer-rechts">
        <section className="g-blatt g-vorn" aria-labelledby="g-fach-h">
          <div className="g-kopf"><div><h2 id="g-fach-h">Wofür läuft die Zeit?</h2><p>zählt auf das Fach{laeuft ? " · beim Laufen gesperrt" : ""}</p></div></div>
          {aktiv.length === 0 ? (
            <p className="g-notiz">Lege erst ein Fach unter „Einstellungen“ an.</p>
          ) : (
            <div className="g-pillen" role="radiogroup" aria-label="Fach" style={{ marginTop: 14 }}>
              {aktiv.map(s => (
                <button key={s.id} type="button" role="radio" aria-checked={s.id === fach} disabled={laeuft}
                  className={"g-pille klein" + (s.id === fach ? " an" : "")} style={{ ["--kat" as string]: s.color }} onClick={() => fachWahl(s.id)}>
                  <span className="g-kat-punkt" aria-hidden="true" />{s.name}
                </button>
              ))}
            </div>
          )}
          {uhr && (
            <>
              <label className="sr-only" htmlFor="g-uhr-notiz">Notiz zur Stoppuhr</label>
              <input id="g-uhr-notiz" className="g-feld-text leise" style={{ marginTop: 14 }} placeholder="Notiz (optional), z. B. Folien 12–20" value={notiz}
                onChange={(e) => { setNotiz(e.target.value); if (sw) ctx.setStopwatchNote(e.target.value); }} />
            </>
          )}
        </section>

        <GManuell subjects={aktiv} vorgabe={fach} onSave={ctx.requestManualSave} />

        <section className="g-blatt" aria-labelledby="g-heute-h">
          <div className="g-kopf"><div><h2 id="g-heute-h">Heute</h2><p>{heuteListe.length ? `${heuteMin} min in ${heuteListe.length} ${heuteListe.length === 1 ? "Session" : "Sessions"}` : "noch nichts gelernt"}</p></div></div>
          {heuteListe.length > 0 && (
            <ul className="g-liste">
              {heuteListe.map(s => (
                <li key={s.id} className="g-zeile">
                  <span className="g-wann">{s.startedAtMs ? `${uhrzeit(s.startedAtMs)}–${uhrzeit(s.startedAtMs + s.durationMin * 60_000)}` : "—"}</span>
                  <span className="g-text"><span>{[subjects.find(x => x.id === s.subjectId)?.name ?? (s.subjectId ? "Fach" : "ohne Fach"), s.note?.trim()].filter(Boolean).join(" · ")}</span></span>
                  <span className="g-leise">{s.durationMin} min</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Manuell eintragen — dieselben Regeln wie ManualEntryCard in TrackerTimer. */
function GManuell({ subjects, vorgabe, onSave }: {
  subjects: SubjectLite[];
  vorgabe: string;
  onSave: (subjectId: string, date: string, durationMin: number, note?: string, extras?: { startedAtMs?: number; category?: BlockCategory }) => void;
}) {
  const [kategorie, setKategorie] = useState<BlockCategory>("lern");
  const [fach, setFach] = useState(vorgabe);
  const [datum, setDatum] = useState(isoDate());
  const [von, setVon] = useState("09:00");
  const [bis, setBis] = useState("10:00");
  const [notiz, setNotiz] = useState("");
  useEffect(() => { if (!fach && vorgabe) setFach(vorgabe); }, [vorgabe, fach]);

  const a = minutenAus(von), b = minutenAus(bis);
  const dauer = a !== null && b !== null && b > a ? b - a : 0;
  const lernen = kategorie === "lern";
  const geht = dauer > 0 && (!lernen || !!fach);

  const eintragen = () => {
    if (!geht) return;
    const [y, mo, d] = datum.split("-").map(Number);
    const start = new Date(y, (mo || 1) - 1, d || 1, Math.floor((a ?? 0) / 60), (a ?? 0) % 60);
    onSave(lernen ? fach : "", datum, dauer, notiz, { startedAtMs: start.getTime(), category: kategorie });
    setNotiz("");
  };

  return (
    <section className="g-blatt" aria-labelledby="g-man-h">
      <div className="g-kopf"><div><h2 id="g-man-h">Manuell eintragen</h2><p>wenn der Timer nicht lief</p></div></div>
      <form onSubmit={(e) => { e.preventDefault(); eintragen(); }}>
        <div className="g-pillen" role="radiogroup" aria-label="Kategorie" style={{ marginTop: 14 }}>
          {CATEGORY_ORDER.map(c => (
            <button key={c} type="button" role="radio" aria-checked={kategorie === c} className={"g-pille klein" + (kategorie === c ? " an" : "")}
              style={{ ["--kat" as string]: CATEGORY_META[c].color }} onClick={() => setKategorie(c)}>
              <span className="g-kat-punkt" aria-hidden="true" />{CATEGORY_META[c].label}
            </button>
          ))}
        </div>
        <div className="g-felder">
          {lernen ? (
            <label className="g-feld-mit"><span>Fach</span>
              <select value={fach} onChange={(e) => setFach(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="g-feld-mit"><span>Titel</span>
              <input value={notiz} placeholder={CATEGORY_META[kategorie].label} onChange={(e) => setNotiz(e.target.value)} />
            </label>
          )}
          <label className="g-feld-mit"><span>Datum</span><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
          <label className="g-feld-mit"><span>Start</span><input type="time" value={von} onChange={(e) => setVon(e.target.value)} /></label>
          <label className="g-feld-mit"><span>Ende</span><input type="time" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
        </div>
        {lernen && (
          <>
            <label className="sr-only" htmlFor="g-man-notiz">Notiz</label>
            <input id="g-man-notiz" className="g-feld-text leise" style={{ marginTop: 10 }} placeholder="Notiz (optional)" value={notiz} onChange={(e) => setNotiz(e.target.value)} />
          </>
        )}
        <div className="g-man-fuss">
          {dauer > 0
            ? <p className="g-notiz">{dauer >= 60 ? `${Math.floor(dauer / 60)} h${dauer % 60 ? ` ${dauer % 60} min` : ""}` : `${dauer} min`} · erscheint im Wochenplan</p>
            : <p className="g-urteil"><span className="g-warn" />Endzeit muss nach Startzeit liegen</p>}
          <button type="submit" className="g-pille hell" disabled={!geht} data-sound="confirm">Eintragen</button>
        </div>
      </form>
    </section>
  );
}
