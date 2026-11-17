// Stil „G" — Deine Aufgaben, Diese Woche und Dein Horizont im Aufbau von
// Seite G (Design-Canvas „Glas-Vexto", Artboard „Glas-Aufgaben").
//
// Nur Ansicht: Zustand und Regeln bleiben in HeuteJarvis (Aufgaben, Lernen,
// Empfehlungen) und lib/horizon.ts (Termine und Fristen). Dieselben Handlungen
// wie im Original, nur anders gezeigt — damit G und Original nie auseinander-
// laufen, was eine Aufgabe ist oder was ein Klick bewirkt.

import { useMemo, useState, type ReactNode } from "react";
import type { Task, TaskPriority, CalendarEvent } from "../../types";
import type { LernZeile } from "../../lib/lernHeute";
import { LAGE_TEXT, pufferText, type KlausurStand } from "../../lib/klausurStand";

/** „Klausur in 26 Tagen · 3 h Puffer" — und wenn es eng wird, was zu schieben ist. */
function standZeile(s: KlausurStand): string {
  const wann = s.tageBisKlausur === 0 ? "Klausur heute" : s.tageBisKlausur === 1 ? "Klausur morgen" : `Klausur in ${s.tageBisKlausur} Tagen`;
  const eng = s.lage === "knapp" || s.lage === "hinten";
  const mehr = eng && s.schieben.length ? ` · mehr: ${s.schieben.slice(0, 2).map((x) => x.titel).join(", ")}` : "";
  return `${wann} · ${pufferText(s.pufferMin)}${mehr}`;
}
import type { Empfehlung } from "../../lib/empfehlung";
import { profil, type PrioModell } from "../../lib/prioLernen";
import { fachNamen } from "../../lib/prioSpeicher";
import { CATEGORY_META } from "../../lib/categories";
import type { WeekTaskMeta, WeekTodoItem, SubjectLite } from "../WeekTodosCard";
import { GWoche } from "./GWoche";
import { useImportantEvents } from "../../important/store";
import { baueHorizont, tageBis, type HorizonItem } from "../../lib/horizon";
import { useHiddenEventIds, hideCalendarEvent } from "../../lib/hiddenEvents";
import "./g.css";

const PRIOS: { id: TaskPriority; label: string; stufe: number }[] = [
  { id: "dringend", label: "dringend", stufe: 3 },
  { id: "wichtig", label: "wichtig", stufe: 2 },
  { id: "normal", label: "normal", stufe: 1 },
];
const stufe = (p?: TaskPriority) => (p === "dringend" ? 3 : p === "wichtig" ? 2 : 1);
const AUFWAND = [15, 30, 60, 120] as const;
const JA: Record<string, string> = { zuerst: "Nach oben", heute: "Rein", woche: "In die Woche", streichen: "Löschen" };
const ART: Record<string, string> = { zuerst: "Zuerst", heute: "Heute rein?", woche: "Zurück in die Woche?", streichen: "Streichen?" };
const WOTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fmtMin(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m}` : ""}` : `${m} min`;
}
const anteil = (v: number) => `${(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 100).toFixed(1)}%`;
const katFarbe = (t: { category?: Task["category"] }) => (t.category ? CATEGORY_META[t.category].color : "var(--text-3)");
/** Dringend und wichtig bekommen einen Hauch Farbe (Paul 2026-11-03: „leicht
 *  farblich markiert, nur ganz wenig"); normal bleibt ohne. */
const prioKlasse = (p?: TaskPriority) => (p === "dringend" ? " p-dringend" : p === "wichtig" ? " p-wichtig" : "");

function PrioMarke({ p }: { p?: TaskPriority }) {
  if (p !== "dringend" && p !== "wichtig") return null;
  return <span className={"g-marke " + p}>{p}</span>;
}

function Haken() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
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

function AufgabeZeile({ t, onToggle, onDelete, onPrio }: {
  t: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onPrio: (id: string) => void;
}) {
  const s = stufe(t.priority);
  const alt = !t.done && (t.verschoben ?? 0) >= 2 ? t.verschoben : 0;
  const meta = [
    t.category ? CATEGORY_META[t.category].label : null,
    t.estimatedMin ? fmtMin(t.estimatedMin) : null,
    t.description?.trim() || null,
  ].filter(Boolean).join(" · ") || (t.done ? "erledigt" : "offen");
  return (
    <li className={"g-zeile" + (t.done ? "" : prioKlasse(t.priority))}>
      <button
        type="button"
        className={"g-aufgabe" + (t.done ? " erledigt" : "")}
        aria-pressed={t.done}
        onClick={() => onToggle(t.id)}
        data-sound={t.done ? undefined : "confirm"}
      >
        <span className="g-haken" style={{ ["--kat" as string]: katFarbe(t) }} aria-hidden="true"><Haken /></span>
        <span className="g-text"><span>{t.text}</span><small>{meta}</small></span>
        {alt ? <span className="g-alt"><span aria-hidden="true">◆</span> {alt} Tage</span> : null}
        {!t.done && <PrioMarke p={t.priority} />}
      </button>
      <button
        type="button"
        className="g-prio"
        onClick={() => onPrio(t.id)}
        aria-label={`Priorität ${t.priority ?? "normal"} — ändern: ${t.text}`}
        title="Priorität ändern"
      >
        <i className="an" /><i className={s >= 2 ? "an" : ""} /><i className={s >= 3 ? "an" : ""} />
      </button>
      <button type="button" className="g-icon" aria-label={`${t.text} löschen`} title="Löschen" onClick={() => onDelete(t.id)}>
        <Kreuz />
      </button>
    </li>
  );
}

export function GAufgaben({
  tasks, lern, weekItems, empfehlungen, modell, anzahlSignale,
  onToggle, onDelete, onAdd, onPrio, onEmpfJa, onEmpfNein, onPush, onAddWeek, onEditWeek, subjects, horizont,
}: {
  tasks: Task[];
  lern: LernZeile[];
  weekItems: WeekTodoItem[];
  subjects: SubjectLite[];
  empfehlungen: Empfehlung[];
  modell: PrioModell;
  anzahlSignale: number;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string, prio: TaskPriority, aufwand: number | null) => void;
  onPrio: (id: string) => void;
  onEmpfJa: (e: Empfehlung) => void;
  onEmpfNein: (e: Empfehlung) => void;
  onPush: (id: string) => void;
  onAddWeek: (text: string, meta: WeekTaskMeta) => void;
  onEditWeek: (id: string, patch: WeekTaskMeta & { text?: string }) => void;
  /** Steht rechts unter „Diese Woche", damit neben den Aufgaben kein Loch bleibt. */
  horizont?: ReactNode;
}) {
  const [entwurf, setEntwurf] = useState("");
  const [prio, setPrio] = useState<TaskPriority>("normal");
  const [aufwand, setAufwand] = useState<number | null>(null);

  const sortiert = useMemo(() => {
    const offen = tasks.filter(t => !t.done).sort((a, b) => stufe(b.priority) - stufe(a.priority));
    return [...offen, ...tasks.filter(t => t.done)];
  }, [tasks]);
  const oben = sortiert.slice(0, 3);
  const rest = sortiert.slice(3);
  const offenMin = tasks.filter(t => !t.done).reduce((s, t) => s + (t.estimatedMin ?? 0), 0)
    + lern.reduce((s, z) => s + Math.max(0, z.ziel - z.ist), 0);
  const offenZahl = tasks.filter(t => !t.done).length + lern.filter(z => z.ist < z.ziel).length;
  const p = useMemo(() => profil(modell, fachNamen()), [modell]);

  const hinzu = () => {
    const text = entwurf.trim();
    if (!text) return;
    onAdd(text, prio, aufwand);
    setEntwurf("");
    setAufwand(null);
  };

  return (
    <div className="g-raster" id="aufgaben">
      <section className="g-blatt g-vorn g-span-7" aria-labelledby="g-aufg-h">
        <div className="g-kopf">
          <div><h2 id="g-aufg-h">Deine Aufgaben</h2><p>{offenZahl} offen{offenMin ? ` · zusammen ${fmtMin(offenMin)}` : ""}</p></div>
          <span className="g-leise">sortiert nach dem, was du durchziehst</span>
        </div>

        <div className="g-eingabe">
          <label className="sr-only" htmlFor="g-neue-aufgabe">Neue Aufgabe</label>
          <input
            id="g-neue-aufgabe"
            value={entwurf}
            onChange={(e) => setEntwurf(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") hinzu(); }}
            placeholder="Was kommt dazu?"
          />
          <div className="g-tabs" role="radiogroup" aria-label="Priorität">
            {PRIOS.map(pr => (
              <button key={pr.id} type="button" role="radio" aria-checked={prio === pr.id} data-p={pr.id} className={prio === pr.id ? "an" : ""} onClick={() => setPrio(pr.id)}>
                {pr.label}
              </button>
            ))}
          </div>
          <button type="button" className="g-rund" aria-label="Aufgabe hinzufügen" onClick={hinzu}><Plus /></button>
        </div>
        <div className="g-pillen g-aufwand" role="radiogroup" aria-label="Aufwand">
          <span className="g-leise">Aufwand</span>
          {AUFWAND.map(a => (
            <button key={a} type="button" role="radio" aria-checked={aufwand === a} className={"g-pille klein" + (aufwand === a ? " an" : "")} onClick={() => setAufwand(aufwand === a ? null : a)}>
              {fmtMin(a)}
            </button>
          ))}
        </div>

        {empfehlungen.length > 0 && (
          <ul className="g-vorschlaege" aria-label="Empfehlungen">
            {empfehlungen.map(e => (
              <li key={`${e.id}:${e.art}`}>
                <span className="g-art">{ART[e.art] ?? e.art}</span>
                <span className="g-text"><span>{e.text}</span><small>{e.grund}</small></span>
                <span className="g-knoepfe">
                  <button type="button" className="g-pille an" data-sound={e.art === "streichen" ? "dismiss" : "confirm"} onClick={() => onEmpfJa(e)}>{JA[e.art] ?? "Ja"}</button>
                  <button type="button" className="g-pille" aria-label={`Nein: ${e.text}`} onClick={() => onEmpfNein(e)}>Nein</button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {lern.length > 0 && (
          <>
            <p className="g-unterkopf">Heute dran</p>
            <ul className="g-liste">
              {lern.map(z => (
                <li key={z.id} className="g-zeile">
                  <div className={"g-aufgabe g-jetzt" + (z.ist >= z.ziel ? " erledigt" : "")}>
                    <span className="g-haken" style={{ ["--kat" as string]: CATEGORY_META.lern.color }} aria-hidden="true"><Haken /></span>
                    <span className="g-text">
                      <span>{z.klausur} lernen</span>
                      <small>{fmtMin(z.ist)} von {fmtMin(z.ziel)}{z.dran.length ? ` · ${z.dran.join(", ")}` : ""}</small>
                      <small className="g-kl-zeile">{standZeile(z.stand)}</small>
                      <span className="g-linie" aria-hidden="true"><i style={{ width: anteil(z.ist / z.ziel) }} /><b style={{ left: anteil(z.ist / z.ziel) }} /></span>
                    </span>
                    {(z.stand.lage === "knapp" || z.stand.lage === "hinten") && (
                      <span className="g-urteil"><span className={z.stand.lage === "hinten" ? "g-krit" : "g-warn"} />{LAGE_TEXT[z.stand.lage]}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="g-unterkopf">Was heute zählt</p>
        {oben.length ? (
          <ul className="g-liste">
            {oben.map(t => <AufgabeZeile key={t.id} t={t} onToggle={onToggle} onDelete={onDelete} onPrio={onPrio} />)}
          </ul>
        ) : (
          <p className="g-frei">Heute ist nichts offen. <span>Oben eintragen, was zählt.</span></p>
        )}
        {rest.length > 0 && (
          <>
            <p className="g-unterkopf">Zählt auch.</p>
            <ul className="g-liste">
              {rest.map(t => <AufgabeZeile key={t.id} t={t} onToggle={onToggle} onDelete={onDelete} onPrio={onPrio} />)}
            </ul>
          </>
        )}

        {(p.wichtig.length > 0 || p.unwichtig.length > 0) && (
          <dl className="g-reko">
            {p.wichtig.length > 0 && (<><dt>Ziehst du durch:</dt><dd>{p.wichtig.slice(0, 4).map(z => <span key={z.name} className="g-pille still">{z.name}</span>)}</dd></>)}
            {p.unwichtig.length > 0 && (<><dt>Räumst du eher weg:</dt><dd>{p.unwichtig.slice(0, 4).map(z => <span key={z.name} className="g-pille still">{z.name}</span>)}</dd></>)}
          </dl>
        )}
        <p className="g-notiz">{anzahlSignale ? `Gelernt aus ${anzahlSignale} Handlungen: Abhaken, Hochstufen, Löschen.` : "Mit jedem Abhaken, Hochstufen und Löschen lernt Daily, was dir wichtig ist."}</p>
      </section>

      <div className="g-spalte g-span-5">
      <GWoche items={weekItems} subjects={subjects} onAdd={onAddWeek} onEdit={onEditWeek} onPush={onPush} onDelete={onDelete} />
      {horizont}
      </div>
    </div>
  );
}

const TYP: Record<HorizonItem["kind"], string> = { appointment: "Termin", exam: "Klausur", deadline: "Frist", birthday: "Geburtstag", note: "Notiz" };

/** Dein Horizont: die nächsten 14 Tage als Leiste, darunter die Einträge. */
export function GHorizont({ events, upcoming }: { events: CalendarEvent[]; upcoming: CalendarEvent[] }) {
  const { events: wichtige, deleteEvent } = useImportantEvents();
  useHiddenEventIds(); // neu rendern, wenn etwas ausgeblendet wird
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const items = useMemo(() => baueHorizont(upcoming.length ? upcoming : events, wichtige, { heute }), [upcoming, events, wichtige, heute]);

  const wegDamit = (item: HorizonItem) => {
    if (item.source === "important" || item.source === "beide") for (const id of item.quellIds?.important ?? [item.id]) deleteEvent(id);
    if (item.source === "calendar" || item.source === "beide") for (const id of item.quellIds?.calendar ?? [item.id]) hideCalendarEvent(id);
  };

  const tage = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + 1);
    const iso = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const an = items.filter(x => x.date === iso);
    return { iso, kurz: WOTAG[d.getDay()], n: d.getDate(), termin: an.some(x => x.kind !== "exam"), klausur: an.some(x => x.kind === "exam") };
  });
  const MONAT = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const tagText = (iso: string) => { const d = new Date(iso + "T12:00:00"); return `${WOTAG[d.getDay()]}, ${d.getDate()}. ${MONAT[d.getMonth()]}`; };

  return (
    <section className="g-blatt g-hz" aria-labelledby="g-hz-h">
      <div className="g-kopf">
        <div><h2 id="g-hz-h">Dein Horizont</h2><p>die nächsten 14 Tage</p></div>
        <span className="g-leise">{items.length} Einträge</span>
      </div>
      <div className="g-leiste" role="img" aria-label={`Die nächsten 14 Tage: ${items.length} Einträge`}>
        {tage.map(d => (
          <div key={d.iso} className="g-tag">
            {d.kurz}<b>{d.n}</b>
            <span className="g-punkte">{d.klausur ? <i className="krit" /> : d.termin ? <i className="ja" /> : null}</span>
          </div>
        ))}
      </div>
      {items.length > 0 ? (
        <ul className="g-liste g-hz-liste">
          {items.slice(0, 40).map(it => {
            const n = tageBis(heute, it.date);
            const eigen = it.source === "important";
            return (
              <li key={it.id} className="g-zeile">
                <span className="g-wann">{n === 0 ? "heute" : n === 1 ? "morgen" : tagText(it.date)}</span>
                <span className="g-text"><span>{it.title}</span><small>{[TYP[it.kind], it.time, n > 1 ? `in ${n} Tagen` : null].filter(Boolean).join(" · ")}</small></span>
                {it.kind === "exam" && n <= 14 && <span className="g-urteil"><span className="g-krit" />Klausur</span>}
                <button type="button" className="g-icon" aria-label={`${eigen ? "Löschen" : "Ausblenden"}: ${it.title}`} title={eigen ? "Löschen" : "Ausblenden"} onClick={() => wegDamit(it)}><Kreuz /></button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="g-frei">Nichts in Sicht.</p>
      )}
    </section>
  );
}
