// Stil „G" — Diese Woche: die Wochenliste mit Tagesleiste.
//
// Paul (2026-11-03): „in der Woche, dass ich da noch sagen kann, wann, wo,
// was — wie beim Original: welches Fach ist das". Beim Eintragen und beim
// Bearbeiten gibt es deshalb dieselben Angaben wie in WeekTodosCard: Tag,
// Rubrik, Fach (nur bei Lernen/Uni), Aufwand, Priorität und eine Notiz. Die
// Regeln (was gespeichert wird, was ein leerer Chip heißt) bleiben in
// HeuteJarvis.addWeekTask / editWeekTask — hier ist nur die Ansicht.

import { useState } from "react";
import type { TaskPriority } from "../../types";
import type { BlockCategory } from "../../tracker/types";
import type { WeekTaskMeta, WeekTodoItem, SubjectLite } from "../WeekTodosCard";
import { CATEGORY_META, CATEGORY_ORDER } from "../../lib/categories";
import { kurzesDatum, spaeterAlsDieseWoche } from "../../lib/wochenplan";

const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const WOTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
// Die Woche plant eher in Stunden („wie viele Stunden"), wie im Original.
const AUFWAND = [30, 60, 120, 180, 300] as const;
const PRIOS: TaskPriority[] = ["normal", "wichtig", "dringend"];

type Entwurf = Required<Pick<WeekTaskMeta, "priority">> & Omit<WeekTaskMeta, "priority"> & { text: string };
const LEER: Entwurf = { text: "", priority: "normal" };

const fmtAufwand = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`);
const hatFach = (c?: BlockCategory) => c === "lern" || c === "uni";
const isoHeute = () => ((new Date().getDay() + 6) % 7) + 1;
function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const prioKlasse = (p?: TaskPriority) => (p === "dringend" ? " p-dringend" : p === "wichtig" ? " p-wichtig" : "");

function Kreuz() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function Plus() {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Eine Reihe Chips mit Beschriftung; ein zweiter Klick auf den gewählten leert. */
function Wahl<T extends string | number>({ label, werte, wert, text, farbe, onWahl }: {
  label: string;
  werte: readonly T[];
  wert: T | undefined;
  text: (w: T) => string;
  farbe?: (w: T) => string | undefined;
  onWahl: (w: T | undefined) => void;
}) {
  return (
    <div className="g-wahl" role="group" aria-label={label}>
      <span className="g-leise">{label}</span>
      {werte.map(w => {
        const an = wert === w;
        const f = farbe?.(w);
        return (
          <button
            key={String(w)}
            type="button"
            aria-pressed={an}
            className={"g-pille klein" + (an ? " an" : "")}
            style={f ? { ["--kat" as string]: f } : undefined}
            onClick={() => onWahl(an ? undefined : w)}
          >
            {f && <span className="g-kat-punkt" aria-hidden="true" />}
            {text(w)}
          </button>
        );
      })}
    </div>
  );
}

/** Die Angaben unter dem Titel — für Eintragen und Bearbeiten gleich. */
function Angaben({ e, subjects, onChange }: { e: Entwurf; subjects: SubjectLite[]; onChange: (e: Entwurf) => void }) {
  const heute = isoHeute();
  return (
    <div className="g-angaben">
      <Wahl label="Tag" werte={[1, 2, 3, 4, 5, 6, 7] as const} wert={e.plannedDay}
        text={d => (d === heute ? "heute" : TAGE[d - 1])} onWahl={d => onChange({ ...e, plannedDay: d })} />
      <Wahl label="Rubrik" werte={CATEGORY_ORDER} wert={e.category}
        text={c => CATEGORY_META[c].label} farbe={c => CATEGORY_META[c].color}
        onWahl={c => onChange({ ...e, category: c, subjectId: hatFach(c) ? e.subjectId : undefined })} />
      {hatFach(e.category) && subjects.length > 0 && (
        <Wahl label="Fach" werte={subjects.map(s => s.id)} wert={e.subjectId}
          text={id => subjects.find(s => s.id === id)?.name ?? id}
          farbe={id => subjects.find(s => s.id === id)?.color}
          onWahl={id => onChange({ ...e, subjectId: id })} />
      )}
      <Wahl label="Aufwand" werte={AUFWAND} wert={e.estimatedMin} text={fmtAufwand} onWahl={m => onChange({ ...e, estimatedMin: m })} />
      <Wahl label="Priorität" werte={PRIOS} wert={e.priority}
        text={p => p} onWahl={p => onChange({ ...e, priority: p ?? "normal" })} />
    </div>
  );
}

function metaVon(it: WeekTodoItem, subjects: SubjectLite[], heute: string): string {
  const fach = it.subjectId ? subjects.find(s => s.id === it.subjectId)?.name : undefined;
  const spaeter = spaeterAlsDieseWoche(it.geplantAm, heute);
  const tag = spaeter && it.geplantAm
    ? kurzesDatum(it.geplantAm)
    : it.plannedDay ? (it.plannedDay === isoHeute() ? "heute" : TAGE[it.plannedDay - 1]) : null;
  return [
    tag,
    fach ?? (it.category ? CATEGORY_META[it.category].label : null),
    it.estimatedMin ? fmtAufwand(it.estimatedMin) : null,
    it.description?.trim() || null,
  ].filter(Boolean).join(" · ") || "diese Woche";
}

export function GWoche({ items, subjects, onAdd, onEdit, onPush, onDelete }: {
  items: WeekTodoItem[];
  subjects: SubjectLite[];
  onAdd: (text: string, meta: WeekTaskMeta) => void;
  onEdit: (id: string, patch: WeekTaskMeta & { text?: string }) => void;
  onPush: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [neu, setNeu] = useState<Entwurf>(LEER);
  const [offen, setOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<(Entwurf & { id: string }) | null>(null);

  const heute = heuteIso();
  const dieseWoche = items
    .filter(it => !spaeterAlsDieseWoche(it.geplantAm, heute))
    .sort((a, b) => (a.plannedDay ?? 8) - (b.plannedDay ?? 8));
  const spaeter = items
    .filter(it => spaeterAlsDieseWoche(it.geplantAm, heute))
    .sort((a, b) => (a.geplantAm ?? "").localeCompare(b.geplantAm ?? ""));

  const hinzu = () => {
    const text = neu.text.trim();
    if (!text) return;
    onAdd(text, {
      description: neu.description, category: neu.category, priority: neu.priority, estimatedMin: neu.estimatedMin,
      plannedDay: neu.plannedDay, subjectId: hatFach(neu.category) ? neu.subjectId : undefined,
    });
    setNeu(LEER);
    setOffen(false);
  };
  const speichern = () => {
    if (!bearbeite) return;
    const { id, ...rest } = bearbeite;
    onEdit(id, {
      text: rest.text,
      description: rest.description ?? "",
      category: rest.category,
      priority: rest.priority,
      estimatedMin: rest.estimatedMin,
      plannedDay: rest.plannedDay,
      subjectId: hatFach(rest.category) ? rest.subjectId : undefined,
    });
    setBearbeite(null);
  };
  const beginne = (it: WeekTodoItem) => setBearbeite({
    id: it.id, text: it.text, description: it.description, category: it.category,
    priority: it.priority ?? "normal", estimatedMin: it.estimatedMin, plannedDay: it.plannedDay, subjectId: it.subjectId,
  });

  // Die Woche als sieben Tage, Montag zuerst — Punkte für geplante Sachen.
  const jetzt = new Date();
  const wochentag = (jetzt.getDay() + 6) % 7; // 0 = Montag
  const montag = new Date(jetzt); montag.setDate(jetzt.getDate() - wochentag);
  const tage = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(montag); d.setDate(montag.getDate() + i);
    return { kurz: WOTAG[d.getDay()], n: d.getDate(), heute: i === wochentag, vorbei: i < wochentag, geplant: dieseWoche.filter(w => w.plannedDay === i + 1) };
  });

  const zeile = (w: WeekTodoItem) => {
    if (bearbeite?.id === w.id) {
      return (
        <li key={w.id} className="g-bearbeiten">
          <label className="sr-only" htmlFor={`g-wt-${w.id}`}>Titel</label>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input id={`g-wt-${w.id}`} autoFocus className="g-feld-text" value={bearbeite.text}
            onChange={e => setBearbeite({ ...bearbeite, text: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") speichern(); if (e.key === "Escape") setBearbeite(null); }} />
          <label className="sr-only" htmlFor={`g-wn-${w.id}`}>Notiz</label>
          <input id={`g-wn-${w.id}`} className="g-feld-text leise" value={bearbeite.description ?? ""} placeholder="Worum geht's? (optional)"
            onChange={e => setBearbeite({ ...bearbeite, description: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") speichern(); if (e.key === "Escape") setBearbeite(null); }} />
          <Angaben e={bearbeite} subjects={subjects} onChange={e => setBearbeite({ ...bearbeite, ...e })} />
          <div className="g-knoepfe">
            <button type="button" className="g-pille hell klein" data-sound="confirm" onClick={speichern}>Speichern</button>
            <button type="button" className="g-pille klein" data-sound="dismiss" onClick={() => setBearbeite(null)}>Abbrechen</button>
          </div>
        </li>
      );
    }
    const fach = w.subjectId ? subjects.find(s => s.id === w.subjectId) : undefined;
    const farbe = fach?.color ?? (w.category ? CATEGORY_META[w.category].color : "var(--text-3)");
    return (
      <li key={w.id} className={"g-zeile" + prioKlasse(w.priority)}>
        <button type="button" className="g-aufgabe" onClick={() => beginne(w)} aria-label={`Bearbeiten: ${w.text}`} title="Bearbeiten">
          <span className="g-haken" style={{ ["--kat" as string]: farbe }} aria-hidden="true" />
          <span className="g-text"><span>{w.text}</span><small>{metaVon(w, subjects, heute)}</small></span>
          {(w.priority === "dringend" || w.priority === "wichtig") && <span className={"g-marke " + w.priority}>{w.priority}</span>}
        </button>
        <button type="button" className="g-pille klein" onClick={() => onPush(w.id)} aria-label={`Auf heute: ${w.text}`}>→ Heute</button>
        <button type="button" className="g-icon" aria-label={`${w.text} löschen`} title="Löschen" onClick={() => onDelete(w.id)}><Kreuz /></button>
      </li>
    );
  };

  return (
    <section className="g-blatt" id="week-todos" aria-labelledby="g-woche-h">
      <div className="g-kopf">
        <div><h2 id="g-woche-h">Diese Woche</h2><p>{items.length ? `${items.length} offen` : "noch nichts geplant"}</p></div>
      </div>
      <div className="g-woche" role="img" aria-label="Die Woche, Montag bis Sonntag, mit den geplanten Sachen als Punkte">
        {tage.map(d => (
          <div key={d.n} className={"g-tag" + (d.heute ? " heute" : "") + (d.vorbei ? " vorbei" : "")}>
            {d.kurz}<b>{d.n}</b>
            <span className="g-punkte">{d.geplant.slice(0, 3).map(w => <i key={w.id} className="ja" />)}</span>
          </div>
        ))}
      </div>
      {dieseWoche.length > 0 ? (
        <ul className="g-liste">{dieseWoche.map(zeile)}</ul>
      ) : (
        <p className="g-frei klein">Die Woche ist noch frei.</p>
      )}
      {spaeter.length > 0 && (
        <>
          <p className="g-unterkopf">Später geplant</p>
          <ul className="g-liste">{spaeter.map(zeile)}</ul>
        </>
      )}
      <div className="g-eingabe klein">
        <label className="sr-only" htmlFor="g-neue-woche">Zur Woche hinzufügen</label>
        <input
          id="g-neue-woche"
          value={neu.text}
          onChange={e => { setNeu({ ...neu, text: e.target.value }); if (e.target.value) setOffen(true); }}
          onFocus={() => setOffen(true)}
          onKeyDown={e => { if (e.key === "Enter") hinzu(); if (e.key === "Escape") setOffen(false); }}
          placeholder="Zur Woche hinzufügen"
        />
        <button type="button" className="g-rund geist" aria-label="Zur Woche hinzufügen" onClick={hinzu}><Plus /></button>
      </div>
      {offen && (
        <div className="g-neu-angaben">
          <label className="sr-only" htmlFor="g-neue-woche-notiz">Notiz</label>
          <input id="g-neue-woche-notiz" className="g-feld-text leise" value={neu.description ?? ""} placeholder="Worum geht's? (optional)"
            onChange={e => setNeu({ ...neu, description: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") hinzu(); }} />
          <Angaben e={neu} subjects={subjects} onChange={setNeu} />
        </div>
      )}
    </section>
  );
}
