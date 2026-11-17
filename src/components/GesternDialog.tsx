// „Gestern nachtragen" — was gestern passiert ist, aber nicht eingetragen wurde.
//
// Vier Dinge, in der Reihenfolge, in der man sie vergisst: Routinen, das Gym
// und andere Wochenvorhaben, eine erledigte Aufgabe, Lernzeit. Alles gilt nur
// für GESTERN — siehe lib/gestern.ts für das Warum.
//
// WO WAS ZÄHLT
// Seit 2026-10-22 zählt alles hier in den Tagesscore von gestern: Aufgaben
// und Lernzeit wie bisher, jede Routine und ein Tag mit Gym als Bonus von +2
// (dayScore.ts, ROUTINE_BONUS). Vorher zählten Routinen und Gym nur in
// „Bewusst leben" — und ein nachgetragener Haken liess die Zahl stehen.

import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { useTracker, goalMinForDate } from "../tracker/store";
import {
  CATALOG, dayInZone, periodFor, recordSuggestion, routineHakenAm, routineTodos, updateGoal,
  type BewusstState, type Cadence,
} from "../lib/bewusst";
import { gesternVon, nachtragbareAufgaben } from "../lib/gestern";
import { aufgabeGesternErledigt, gleicheGesternAb, studyMinAm } from "../lib/gesternNachtrag";
import { loadScoreDay } from "../lib/scoreHistory";
import { SCHLUESSEL } from "../lib/store";
import "./gestern.css";

type Bewusst = {
  state: BewusstState | null;
  save: (change: (s: BewusstState) => BewusstState) => Promise<boolean | undefined>;
  busy: boolean;
  error: string;
};

type Props = { todos: Task[]; bewusst: Bewusst; onSchliessen: () => void };

const MINUTEN_VORSCHLAG = [30, 60, 90, 120];

/** Das Tagesziel für `day` — dieselbe Rechnung wie der Morgendialog für heute. */
function useZielFuer(day: string): number {
  const { goalsByWeekday, goalMin, goalMinWeekend } = useTracker();
  return goalMinForDate(new Date(day + "T12:00:00"), goalsByWeekday, goalMin, goalMinWeekend);
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function tagLang(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

export function GesternDialog({ todos, bewusst, onSchliessen }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { subjects, sessions, addSession, deleteSession } = useTracker();
  const heute = dayInZone();
  const gestern = gesternVon(heute);
  const ziel = useZielFuer(gestern);
  const lernGestern = studyMinAm(sessions, gestern);

  // Der Stand von gestern wird bei jedem Rendern frisch gelesen; `rev` stösst
  // nach einem Schreiben das Rendern an.
  const [, setRev] = useState(0);
  const stand = loadScoreDay(gestern);
  const [fehler, setFehler] = useState("");
  const [neueSitzungen, setNeueSitzungen] = useState<{ id: string; min: number; fach: string }[]>([]);
  const aktiveFaecher = subjects.filter((s) => !s.archiviert);
  const [fach, setFach] = useState(aktiveFaecher[0]?.id ?? "");
  const [minuten, setMinuten] = useState(60);
  const [verbucht, setVerbucht] = useState<{ id: string; text: string }[]>([]);

  // Native <dialog>: Fokusfalle, Escape und Rückkehr des Fokus gibt es dann
  // vom Browser, statt sie nachzubauen.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  /** Routine-Haken von gestern aus dem BESTÄTIGTEN Stand. useBewusst schreibt
   *  ihn nach dem Rücklesen in den Speicher — der Hook-Zustand in diesem
   *  Durchlauf ist dann noch der alte. undefined = noch nicht geladen. */
  function hakenGestern(): number | undefined {
    const roh = localStorage.getItem(SCHLUESSEL.bewusst.name);
    const gespeichert = roh ? SCHLUESSEL.bewusst.lese(roh) : undefined;
    const st = gespeichert ?? bewusst.state;
    return st ? routineHakenAm(st, gestern) : undefined;
  }

  function nachrechnen(studyMin: number, anlegen: boolean) {
    const r = gleicheGesternAb(gestern, { studyMin, goalMin: ziel, routineHaken: hakenGestern() }, anlegen);
    if (!r.ok) setFehler(r.fehler);
    setRev((v) => v + 1);
  }

  /** Bewusst speichern — und erst nach der Bestätigung den Score von gestern
   *  nachziehen. Vorher zählten Routinen und Gym nicht in den Tagesscore; seit
   *  2026-10-22 bringt jeder Haken +2 (dayScore.ts, ROUTINE_BONUS). */
  async function bewusstSpeichern(change: (s: BewusstState) => BewusstState) {
    const ok = await bewusst.save(change);
    if (ok) nachrechnen(lernGestern, true);
  }

  function lernzeitEintragen() {
    if (!fach || !(minuten > 0)) return;
    const s = addSession(fach, gestern, Math.round(minuten), "nachgetragen");
    if (!s) return;
    const name = aktiveFaecher.find((f) => f.id === fach)?.name ?? "Fach";
    setNeueSitzungen((alt) => [...alt, { id: s.id, min: s.durationMin, fach: name }]);
    // Die neue Sitzung ist im Zustand noch nicht angekommen — also selbst addieren.
    nachrechnen(lernGestern + s.durationMin, true);
  }

  function lernzeitZurueck(id: string, min: number) {
    deleteSession(id);
    setNeueSitzungen((alt) => alt.filter((x) => x.id !== id));
    nachrechnen(Math.max(0, lernGestern - min), false);
  }

  async function aufgabeErledigt(t: Task) {
    setFehler("");
    const r = await aufgabeGesternErledigt(t, gestern, { studyMin: lernGestern, goalMin: ziel, routineHaken: hakenGestern() });
    if (!r.ok) { setFehler(r.fehler); return; }
    setVerbucht((alt) => [...alt, { id: t.id, text: t.text }]);
    setRev((v) => v + 1);
  }

  const routinen = bewusst.state ? routineTodos(bewusst.state, gestern) : [];
  const aufgaben = nachtragbareAufgaben(todos, heute);
  // Montags ist gestern Sonntag — dann landet das Gym in der Vorwoche. Das soll
  // dastehen, sonst wundert man sich, warum der Zähler bei 0 anfängt.
  const vorwoche = bewusst.state
    ? periodFor(bewusst.state, "week", gestern).start !== periodFor(bewusst.state, "week", heute).start
    : false;

  function wertVon(cadence: Exclude<Cadence, "day">, id: string): number {
    if (!bewusst.state) return 0;
    return periodFor(bewusst.state, cadence, gestern).goals.find((g) => g.id === id)?.value ?? 0;
  }
  function aktivitaet(cadence: Exclude<Cadence, "day">, id: string, delta: number) {
    void bewusstSpeichern((s) => recordSuggestion(s, cadence, id, { delta }, heute, gestern));
  }

  return (
    <dialog ref={ref} className="gestern" aria-labelledby="gestern-titel" onClose={onSchliessen}>
      <header className="gestern-kopf">
        <div>
          <h2 id="gestern-titel">Gestern nachtragen</h2>
          <p className="gestern-datum">{tagLang(gestern)}</p>
        </div>
        <button type="button" className="gestern-zu" onClick={() => ref.current?.close()}>Fertig</button>
      </header>

      <p className="gestern-stand" aria-live="polite">
        {stand
          ? <><span className="n num">{stand.score}</span> Score gestern · {fmtMin(stand.studyMin)} gelernt · {stand.tasksDone}/{stand.tasksTotal} Aufgaben{stand.routineBonus ? ` · +${stand.routineBonus} Routinen` : ""}{stand.nachgetragen ? " · nachgetragen" : ""}</>
          : <>Für gestern ist kein Score festgehalten. Trägst du Lernzeit oder eine Aufgabe ein, entsteht er.</>}
      </p>
      {(fehler || bewusst.error) && <p className="gestern-fehler" role="alert">{fehler || bewusst.error}</p>}

      <section aria-labelledby="g-routinen">
        <h3 id="g-routinen">Routinen</h3>
        {routinen.length === 0
          ? <p className="gestern-leer">Für gestern waren keine Routinen ausgewählt.</p>
          : <ul className="gestern-liste">{routinen.map((r) => (
              <li key={r.id}>
                <label className="gestern-zeile">
                  <input type="checkbox" checked={r.done} disabled={bewusst.busy}
                    onChange={() => void bewusstSpeichern((s) => updateGoal(s, periodFor(s, "day", gestern), r.routineId, { value: r.done ? 0 : 1 }, heute, gestern))} />
                  <span>{r.text}</span>
                </label>
              </li>))}
            </ul>}
      </section>

      <section aria-labelledby="g-woche">
        <h3 id="g-woche">Gym und andere Vorhaben{vorwoche ? " · zählt zur Vorwoche" : ""}</h3>
        <ul className="gestern-liste">{CATALOG.week.map((g) => (
          <li key={g.id} className="gestern-zeile">
            <span>{g.title}</span>
            <span className="gestern-zaehler">
              <button type="button" disabled={bewusst.busy || wertVon("week", g.id) === 0} onClick={() => aktivitaet("week", g.id, -1)} aria-label={`${g.title} eins weniger`}>−</button>
              <span className="num">{wertVon("week", g.id)}/{g.target}</span>
              <button type="button" disabled={bewusst.busy || wertVon("week", g.id) >= g.target} onClick={() => aktivitaet("week", g.id, 1)} aria-label={`${g.title} gestern gemacht`}>+</button>
            </span>
          </li>))}
        </ul>
        <details className="gestern-mehr">
          <summary>Monatsvorhaben</summary>
          <ul className="gestern-liste">{CATALOG.month.map((g) => {
            const schritt = g.unit === "Minuten" ? 30 : 1;
            return (
              <li key={g.id} className="gestern-zeile">
                <span>{g.title}</span>
                <span className="gestern-zaehler">
                  <button type="button" disabled={bewusst.busy || wertVon("month", g.id) === 0} onClick={() => aktivitaet("month", g.id, -schritt)} aria-label={`${g.title} weniger`}>−</button>
                  <span className="num">{wertVon("month", g.id)}/{g.target}</span>
                  <button type="button" disabled={bewusst.busy || wertVon("month", g.id) >= g.target} onClick={() => aktivitaet("month", g.id, schritt)} aria-label={`${g.title} gestern gemacht`}>+</button>
                </span>
              </li>);
          })}</ul>
        </details>
      </section>

      <section aria-labelledby="g-aufgaben">
        <h3 id="g-aufgaben">Aufgaben, die du gestern erledigt hast</h3>
        {aufgaben.length === 0 && verbucht.length === 0 && <p className="gestern-leer">Keine offenen Aufgaben von gestern.</p>}
        <ul className="gestern-liste">
          {aufgaben.map((t) => (
            <li key={t.id} className="gestern-zeile">
              <span>{t.text}</span>
              <button type="button" className="gestern-ja" onClick={() => void aufgabeErledigt(t)}>Gestern erledigt</button>
            </li>))}
          {verbucht.map((v) => <li key={v.id} className="gestern-zeile erledigt"><span>{v.text}</span><span className="gestern-ok">für gestern verbucht</span></li>)}
        </ul>
      </section>

      <section aria-labelledby="g-lernzeit">
        <h3 id="g-lernzeit">Lernzeit gestern · {fmtMin(lernGestern)}</h3>
        {aktiveFaecher.length === 0
          ? <p className="gestern-leer">Lege zuerst ein Fach in der Lernzeit an.</p>
          : <form className="gestern-lernzeit" onSubmit={(e) => { e.preventDefault(); lernzeitEintragen(); }}>
              <label>Fach
                <select value={fach} onChange={(e) => setFach(e.target.value)}>
                  {aktiveFaecher.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <span className="gestern-chips" role="group" aria-label="Dauer">
                {MINUTEN_VORSCHLAG.map((m) => (
                  <button key={m} type="button" aria-pressed={minuten === m} className={minuten === m ? "an" : ""} onClick={() => setMinuten(m)}>{fmtMin(m)}</button>))}
              </span>
              <label>Minuten
                <input type="number" min={1} max={960} inputMode="numeric" value={minuten}
                  onChange={(e) => setMinuten(Number(e.target.value))} />
              </label>
              <button type="submit" className="gestern-ja">Eintragen</button>
            </form>}
        {neueSitzungen.length > 0 && <ul className="gestern-liste">{neueSitzungen.map((s) => (
          <li key={s.id} className="gestern-zeile">
            <span>{s.fach} · {fmtMin(s.min)}</span>
            <button type="button" className="gestern-link" onClick={() => lernzeitZurueck(s.id, s.min)}>Rückgängig</button>
          </li>))}
        </ul>}
      </section>

      <p className="gestern-fuss">
        Nur für gestern. Alles hier ändert den Score von gestern: Aufgaben und
        Lernzeit wie gewohnt, jede Routine und ein Tag mit Gym je +2.
      </p>
    </dialog>
  );
}
