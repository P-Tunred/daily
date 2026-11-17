import { useEffect, useRef, useState } from 'react';
import { Card } from './Card';
import { useBewusst } from '../lib/useBewusst';
import { CATALOG, closePeriod, configure, dayInZone, monthlySummary, periodFor, recordSuggestion, shiftDay, updateGoal, type Entry, type GoalPatch } from '../lib/bewusst';
import { hinweise, restTage, verlauf, vorschlag, wochenSachen, type Block, type Punkt, type WochenPunkt } from '../lib/zeitFuerDich';
import { SCHLUESSEL, aendere, lies } from '../lib/store';
import original from '../data/zielraster-original.txt?raw';
import './bewusst.css';
import { useStil } from '../lib/stil';
import { GBewusst } from './g/GBewusst';

const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
const PUNKT: Record<Punkt, string> = { ja: 'gemacht', nein: 'nicht gemacht', offen: 'heute noch offen', pause: 'pausiert', unbekannt: 'nicht erfasst' };
const WPUNKT: Record<WochenPunkt, string> = { ja: 'geschafft', teil: 'angefangen', nein: 'nicht gemacht', offen: 'diese Woche noch offen', pause: 'pausiert', unbekannt: 'nichts erfasst' };
const Haken = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const wtag = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short' }).slice(0, 2);

/** Freie Blöcke aus dem Kalender — für „heute ist von … bis … frei". */
function useFreieBloecke(): Block[] {
  const [b, setB] = useState<Block[]>([]);
  useEffect(() => {
    let alive = true;
    const hole = () => fetch('/api/gaps', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
      .then((d: { bloecke?: Block[] } | null) => { if (alive && Array.isArray(d?.bloecke)) setB(d!.bloecke); }).catch(() => { /* kein Kalender */ });
    void hole();
    const t = setInterval(hole, 30 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return b;
}
export function BewusstCard() {
  const { state, save, busy, error } = useBewusst();
  const stil = useStil();
  const [today, setToday] = useState(dayInZone);
  // Die Woche hat seit 2026-10-31 ihren eigenen Abschnitt oben (wie die
  // Tagesroutinen); unter „Ideen" bleiben Monat und Rückblick.
  const [tab, setTab] = useState<'month' | 'history' | null>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const bloecke = useFreieBloecke();
  const [behalten, setBehalten] = useState(() => lies(SCHLUESSEL.bewusstHinweiseOk));
  const attempted = useRef('');
  const editorButton = useRef<HTMLButtonElement>(null);
  const ideasButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { const timer = setInterval(() => setToday(dayInZone()), 15000); return () => clearInterval(timer); }, []);
  // Journal only the current visited day, with zero confirmations. No backfill.
  useEffect(() => {
    if (!state || busy) return;
    const p = periodFor(state, 'day', today);
    if (state.periods[p.id] || !p.goals.length || attempted.current === p.id) return;
    attempted.current = p.id;
    void save(s => {
      const current = periodFor(s, 'day', today);
      return s.periods[current.id] || !current.goals.length ? s : { ...s, periods: { ...s.periods, [current.id]: current } };
    });
  }, [state, today, busy, save]);
  const sum = state ? monthlySummary(state, today) : null;
  const plans = state?.plans.filter(p => p.cadence === 'day') ?? [];
  const daily = state ? periodFor(state, 'day', today) : null;
  const tabs = [['month', 'Monat'], ['history', 'Rückblick']] as const;
  const evening = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false })) >= 17;
  const returnToEditor = useRef(false);
  const journalReady = !!state && (!daily?.goals.length || !!state.periods[daily.id]);
  useEffect(() => {
    if (busy || editing || !journalReady || !returnToEditor.current) return;
    editorButton.current?.focus();
    returnToEditor.current = false;
  }, [busy, editing, journalReady]);
  const closeEditor = () => { returnToEditor.current = true; setEditing(false); };
  // „Heute für dich": Verlauf der Routinen, ein freier Block, und Routinen,
  // die seit Wochen liegen bleiben (lib/zeitFuerDich.ts).
  const tage = state ? verlauf(state, today) : [];
  const erledigtHeute = tage.filter(v => v.punkte.at(-1)?.stand === 'ja').length;
  const frei = state ? vorschlag(state, today, bloecke) : null;
  const anpassen = state ? hinweise(state, today, behalten) : [];
  const hake = (id: string, an: boolean) => void save(s => updateGoal(s, periodFor(s, 'day', today), id, { value: an ? 1 : 0 }, today));
  const behalte = (id: string) => setBehalten(aendere(SCHLUESSEL.bewusstHinweiseOk, b => ({ ...b, [id]: today })));
  const lasseWeg = (id: string) => {
    const aktuell = (plans.at(-1)?.goals ?? []).map(g => g.id).filter(g => g !== id);
    void save(s => configure(s, 'day', aktuell, today));
  };
  // „Diese Woche für dich": dieselbe Form wie die Tagesroutinen, für die
  // sechs Wochenideen (lib/zeitFuerDich.ts → wochenSachen).
  const woche = state ? wochenSachen(state, today) : [];
  const wocheFertig = woche.filter(w => w.punkte.at(-1)?.stand === 'ja').length;
  const wocheZu = state ? !!periodFor(state, 'week', today).closed : false;
  const rest = restTage(today);
  const trage = (id: string, patch: GoalPatch) => void save(s => recordSuggestion(s, 'week', id, patch, today));
  // Teile, die Original und Stil G gleich zeigen (Auswahl, Ideen, Rückblick, Status).
  const routinenTeil = <>
      <div className="bewusst-routines">
        <div><h3>Deine täglichen Routinen</h3><p>{daily?.goals.length ? `${daily.goals.filter(g => !g.paused).length} für heute · Abhaken oben in dieser Karte. Jeder Haken zählt zum Tagesscore.` : 'Was möchtest du dir täglich gönnen? Such dir ein paar Routinen aus.'}</p>
          {plans.at(-1) && plans.at(-1)!.effective > today && <p className="bewusst-meta">Deine neue Auswahl gilt ab {dateLabel(plans.at(-1)!.effective)}.</p>}
        </div>
        <div className="bewusst-actions">
          <button className="bewusst-link" ref={editorButton} aria-expanded={editing} aria-controls="bewusst-routine-editor" onClick={() => { setSelected((plans.at(-1)?.goals ?? []).map(g => g.id)); setEditing(!editing); }}>{plans.length ? 'Routinen anpassen' : 'Routinen auswählen'}</button>
        </div>
      </div>
      {editing && <form id="bewusst-routine-editor" className="bewusst-editor" onSubmit={async e => { e.preventDefault(); if (await save(s => configure(s, 'day', selected, today))) closeEditor(); }}>
        <p>{plans.length ? `Deine Änderungen gelten ab ${dateLabel(shiftDay(today, 1))}. Heute bleibt, wie es ist.` : 'Diese Routinen erscheinen ab heute oben in dieser Karte. Abgehakt wird erst, wenn du sie gemacht hast.'}</p>
        <fieldset className="bewusst-selection"><legend>Was passt zu deinem Alltag?</legend>{CATALOG.day.map(g => <label key={g.id}><input type="checkbox" aria-label={g.title} checked={selected.includes(g.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, g.id] : ids.filter(id => id !== g.id))} /><span>{g.title}</span></label>)}</fieldset>
        <div className="bewusst-actions"><button type="submit">Auswahl übernehmen</button><button type="button" className="bewusst-link" onClick={closeEditor}>Abbrechen</button></div>
      </form>}
  </>;
  const ideenTeil = state ? <>
      <div className="bewusst-entry"><p>Ideen für den Monat. Kein Muss.</p><button ref={ideasButton} className="bewusst-link" aria-expanded={tab !== null} aria-controls="bewusst-explore" onClick={() => setTab(tab ? null : 'month')}>{evening ? 'Abend-Rückblick' : 'Ideen ansehen'} <span aria-hidden="true">{tab ? '−' : '→'}</span></button></div>
      {tab && <div id="bewusst-explore">
        <div className="bewusst-navigation"><div role="tablist" aria-label="Ideen und Rückblick" className="bewusst-nav">{tabs.map(([id, title], i) => <button key={id} id={`bewusst-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="bewusst-panel" tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={e => {
          const direction = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
          if (!direction && !['Home', 'End'].includes(e.key)) return;
          e.preventDefault(); const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + direction + tabs.length) % tabs.length;
          setTab(tabs[n][0]); document.getElementById(`bewusst-tab-${tabs[n][0]}`)?.focus();
        }}>{title}</button>)}</div><button className="bewusst-link" aria-label="Ideen und Rückblick schließen" onClick={() => { setTab(null); ideasButton.current?.focus(); }}>Schließen</button></div>
        <div id="bewusst-panel" role="tabpanel" aria-labelledby={`bewusst-tab-${tab}`} tabIndex={0}>
          {tab === 'month' && (() => {
            const p = periodFor(state, tab, today);
            return <><p className="bewusst-caption">Trag ein, was du gemacht hast. Die Mengen sind eine Anregung, kein Soll.</p>
              {p.closed && <p>Dieser Zeitraum ist abgeschlossen. <button onClick={() => void save(s => closePeriod(s, periodFor(s, tab, today), today, true))}>Zur Korrektur wieder öffnen</button></p>}
              {CATALOG[tab].map(g => <Suggestion key={`${p.id}:${g.id}`} goal={p.goals.find(e => e.id === g.id) ?? { ...g, value: 0, note: '', paused: '' }} locked={!!p.closed} onChange={patch => void save(s => recordSuggestion(s, tab, g.id, patch, today))} />)}
            </>;
          })()}
          {tab === 'history' && sum && <>
            <h3 className="bewusst-month">{new Date(`${today}T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h3>
            <div className="bewusst-progress"><strong>{sum.routineDue ? `${Math.round(100 * sum.routineDone / sum.routineDue)} % deiner Routinen` : 'Dein Rückblick wächst mit deinen Tagen.'}</strong><span>{sum.routineDone} / {sum.routineDue} bestätigt</span></div>
            <p>Dazu {sum.suggestions} aufgegriffene Vorschläge · {sum.suggestionUnits} bestätigte Aktivitäten{sum.minutes ? ` · ${sum.minutes} Minuten Vertiefung` : ''}.</p>
            <details><summary>Was zählt hier mit?</summary><p className="bewusst-meta">Bestätigte Haken geteilt durch ausgewählte Routinen an erfassten Tagen dieses Monats. Unbesuchte Tage werden nicht von selbst nachgetragen; gestern lässt sich oben über „Gestern nachtragen“ ergänzen. Pausen sind ausgeschlossen. Vorschläge zählen zusätzlich als Aktivitäten, nie als unerfüllte Pflichten. Eine Woche zählt zum Monat ihres Montags. Im Tagesscore bringt jede Routine und ein Tag mit Gym +2 Punkte; die Lernzeit bleibt unverändert.</p></details>
            <details><summary>Vergangene Einträge</summary><div className="bewusst-history">{Object.values(state.periods).sort((a,b) => b.start.localeCompare(a.start)).slice(0, 60).map(p => <div key={p.id}><h4>{dateLabel(p.start)} · {p.cadence === 'day' ? 'Routinen' : p.cadence === 'week' ? 'Woche' : 'Monat'}</h4>{p.goals.filter(g => p.cadence === 'day' || g.value > 0).map(g => <p key={g.id}>{g.title} · {g.value} / {g.target}{g.paused ? ' · pausiert' : ''}</p>)}</div>)}</div></details>
          </>}
        </div>
      </div>}
  </> : null;
  const statusTeil = <>
    <p role="status" className="bewusst-status">{busy ? 'Wird gespeichert …' : ''}</p>
    {error && <p role="alert">{error} <button onClick={() => { attempted.current = ''; void save(s => s); }}>Erneut versuchen</button></p>}
    <div className="bewusst-footer"><details><summary>Dein ursprüngliches Blatt</summary><p>Vom 19. September 2026. Haltungen und Projekte brauchen keinen Score.</p><pre>{original}</pre></details></div>
  </>;

  if (stil === 'g') return <GBewusst
    geladen={!!state} busy={busy} tage={tage} erledigtHeute={erledigtHeute} frei={frei} anpassen={anpassen}
    morgenLabel={plans.length ? dateLabel(shiftDay(today, 1)) : 'morgen'} woche={woche} wocheFertig={wocheFertig} wocheZu={wocheZu} rest={rest}
    onHaken={hake} onWeglassen={lasseWeg} onBehalten={behalte} onTrage={trage}
    weiteres={<>{routinenTeil}{ideenTeil}</>} status={statusTeil}
  />;
  return <div id="bewusst-leben"><Card className="bewusst" title="Bewusst leben">
    <div className="bewusst-intro"><h2>{evening ? 'Was hast du heute für dich gemacht?' : 'Ein bisschen Zeit für dich.'}</h2><p>{evening ? 'Ein kurzer Blick zurück reicht. Was hat heute gutgetan?' : 'Deine Routinen begleiten den Tag. Für alles andere ist Platz, wenn es passt.'}</p></div>
    {!state ? <p role="status">Routinen werden geladen …</p> : <fieldset disabled={busy} aria-busy={busy} className="bewusst-layout">
      {tage.length > 0 && <section className="bewusst-heute" aria-label="Heute für dich">
        <div className="bewusst-heute-kopf">
          <span className="bewusst-ring" style={{ ['--anteil' as string]: `${Math.round(100 * erledigtHeute / tage.length)}%` }} aria-hidden="true"><b>{erledigtHeute}</b></span>
          <p><strong>{erledigtHeute === tage.length ? 'Alles für heute erledigt.' : `${erledigtHeute} von ${tage.length} Routinen heute`}</strong>
            <span className="bewusst-meta">Die Punkte zeigen die letzten sieben Tage. Leer heisst: nicht erfasst — nicht verpasst.</span></p>
        </div>
        <ul className="bewusst-tage">
          {tage.map(v => {
            const an = v.punkte.at(-1)?.stand === 'ja';
            return <li key={v.id}>
              <button type="button" className={'bewusst-haken' + (an ? ' an' : '')} aria-pressed={an} aria-label={`Heute abhaken: ${v.titel}`} onClick={() => hake(v.id, !an)} data-sound={an ? undefined : 'confirm'}>
                <Haken />
              </button>
              <span className="bewusst-tage-titel">{v.titel}</span>
              <span className="bewusst-punkte" role="img" aria-label={`Letzte sieben Tage: ${v.erledigt} von ${v.erfasst} erfassten gemacht`}>
                {v.punkte.map(p => <i key={p.tag} className={p.stand} title={`${wtag(p.tag)}, ${dateLabel(p.tag)}: ${PUNKT[p.stand]}`} />)}
              </span>
            </li>;
          })}
        </ul>
        {frei && <p className="bewusst-frei">Heute von <b>{frei.block.von}</b> bis <b>{frei.block.bis}</b> ist frei{frei.idee ? <> — Platz für <b>{frei.idee}</b>?</> : '.'}</p>}
        {anpassen.map(h => <div key={h.id} className="bewusst-anpassen" role="note">
          <p>„{h.titel.replace(/\.$/, '')}" hat in den letzten zwei Wochen an {h.erledigt} von {h.erfasst} erfassten Tagen geklappt. Vielleicht passt sie gerade nicht — anpassen?</p>
          <div className="bewusst-actions">
            <button type="button" onClick={() => lasseWeg(h.id)}>Ab {plans.length ? dateLabel(shiftDay(today, 1)) : 'morgen'} weglassen</button>
            <button type="button" className="bewusst-link" onClick={() => behalte(h.id)}>Behalten</button>
          </div>
        </div>)}
      </section>}
      {routinenTeil}
      <section className="bewusst-heute bewusst-woche" aria-label="Diese Woche für dich">
        <div className="bewusst-heute-kopf">
          <span className="bewusst-ring" style={{ ['--anteil' as string]: `${Math.round(100 * wocheFertig / Math.max(1, woche.length))}%` }} aria-hidden="true"><b>{wocheFertig}</b></span>
          <p><strong>{wocheFertig === woche.length ? 'Alles für diese Woche geschafft.' : `${wocheFertig} von ${woche.length} diese Woche`}</strong>
            <span className="bewusst-meta">{rest === 1 ? 'Heute ist der letzte Tag der Woche.' : `Noch ${rest} Tage bis Sonntag.`} Die Punkte zeigen die letzten sechs Wochen. Gym zählt zum Tagesscore.</span></p>
        </div>
        <ul className="bewusst-tage">
          {woche.map(w => {
            const an = w.wert >= w.ziel;
            const aus = wocheZu || w.pausiert;
            return <li key={w.id}>
              {w.ziel === 1
                ? <button type="button" className={'bewusst-haken' + (an ? ' an' : '')} aria-pressed={an} aria-label={`Diese Woche abhaken: ${w.titel}`} disabled={aus} onClick={() => trage(w.id, { value: an ? 0 : 1 })} data-sound={an ? undefined : 'confirm'}><Haken /></button>
                : <button type="button" className={'bewusst-haken bewusst-zaehler' + (an ? ' an' : '')} aria-label={`${w.titel} erhöhen`} disabled={aus || an} onClick={() => trage(w.id, { delta: w.einheit === 'Minuten' ? 15 : 1 })} data-sound="confirm">{an ? <Haken /> : <span aria-hidden="true">+1</span>}</button>}
              <span className="bewusst-tage-titel">
                {w.titel}
                {w.ziel > 1 && <> <span className="bewusst-stand">{w.wert} / {w.ziel} {w.einheit}</span>
                  {w.wert > 0 && <button type="button" className="bewusst-minus" aria-label={`${w.titel} verringern`} disabled={aus} onClick={() => trage(w.id, { delta: w.einheit === 'Minuten' ? -15 : -1 })}>−</button>}</>}
                {w.pausiert && <span className="bewusst-meta"> · pausiert</span>}
              </span>
              <span className="bewusst-punkte" role="img" aria-label={`Letzte sechs Wochen: ${w.punkte.filter(p => p.stand === 'ja').length} geschafft`}>
                {w.punkte.map(p => <i key={p.start} className={p.stand} title={`Woche ab ${dateLabel(p.start)}: ${WPUNKT[p.stand]}`} />)}
              </span>
            </li>;
          })}
        </ul>
        {wocheZu && <p className="bewusst-meta">Diese Woche ist abgeschlossen.</p>}
      </section>
      {ideenTeil}
    </fieldset>}
    {statusTeil}
  </Card></div>;
}
function Suggestion({ goal: g, locked, onChange }: { goal: Entry; locked: boolean; onChange: (patch: GoalPatch) => void }) {
  const disabled = locked || !!g.paused;
  return <article className="bewusst-row"><div className="bewusst-row-main">
    <div className="bewusst-row-copy">{g.target === 1 ? <label className="bewusst-check"><input type="checkbox" aria-label={g.title} checked={g.value > 0} disabled={disabled} onChange={e => onChange({ value: e.target.checked ? 1 : 0 })} /><span>{g.title}</span></label> : <span className="bewusst-row-title">{g.title}</span>}
      <p className="bewusst-meta">{g.topic}{g.paused ? ` · Pause: ${g.paused}` : ''}</p>
    </div>
    {g.target > 1 && <div className="bewusst-counter"><button disabled={disabled || !g.value} aria-label={`${g.title} verringern`} onClick={() => onChange({ delta: g.unit === 'Minuten' ? -15 : -1 })}>−</button><span>{g.value} / {g.target} {g.unit}</span><button disabled={disabled || g.value >= g.target} aria-label={`${g.title} erhöhen`} onClick={() => onChange({ delta: g.unit === 'Minuten' ? 15 : 1 })}>+</button></div>}
    </div>
    <details><summary>Notiz & Pause{g.note ? ' · Notiz vorhanden' : ''}</summary>{g.hint && <p className="bewusst-meta">{g.hint}</p>}<form key={g.note} onSubmit={e => { e.preventDefault(); onChange({ note: String(new FormData(e.currentTarget).get('note') ?? '').slice(0, 500) }); }}><label>Optionale Notiz zu „{g.title}“<input name="note" defaultValue={g.note} maxLength={500} disabled={locked} /></label><button disabled={locked}>Notiz speichern</button></form>
      <label>Pause für {g.title}<select aria-label={`Pause für ${g.title}`} value={g.paused} disabled={locked} onChange={e => onChange({ paused: e.target.value })}><option value="">Nicht pausiert</option><option>Krankheit</option><option>Bewusste Pause</option><option>Nicht passend in dieser Saison</option></select></label>
      <a href="#/lernzeit/kalender">Termin planen →</a><p>Planen setzt keinen Haken.</p>
    </details>
  </article>;
}
