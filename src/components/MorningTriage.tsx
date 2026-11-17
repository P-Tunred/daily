// MorningTriage — morning pop-up driven by /api/triage (electron/mailTriage.cjs:
// live-classified daily Drive mail report).
//
// Handling rules (defined, not asked every time):
//   • Klausur (exam) with a date  → added AUTOMATICALLY to "Am Horizont".
//   • Abgabe (deadline)           → calendar item ("Am Horizont").
//   • Aufgabe (task)              → To-Do ("Was heute zählt").
// Only items that aren't clear (no date / uncertain) are asked about.
// On "Übernehmen", anything left unchecked goes to a persistent
// "Nicht zugeordnet" list you can sort later — nothing is lost.
import { useEffect, useRef, useState } from "react";
import { useImportantEvents } from "../important/store";
import { todosDB, notifyTodosChanged } from "../lib/db";
import { hideCalendarEvent } from "../lib/hiddenEvents";
import { loadSeenTriageIds, markTriageSeen } from "../lib/triageSeen";
import { loadAsked, markAsked, isInCooldown } from "../lib/triageAsked";
import { findSimilarTask, type DupCandidate } from "../lib/taskSimilarity";
import type { Task, TaskPriority, CalendarEvent } from "../types";

type TriageItem = {
  id: string;
  classification: "exam" | "deadline" | "task" | "uncertain";
  title: string;
  date: string | null;
  source?: string;
  context?: string;
};
type Kind = "task" | "deadline" | "exam";
type Decision = { add: boolean; kind: Kind; priority: TaskPriority; date: string; title: string };

const DEFERRED_KEY = "morning.triage.deferred";
const CALSEEN_KEY = "morning.triage.calseen";
// Item ids where Paul answered "Nein, neu" to the duplicate question — the
// question must never come back for those (decisions are remembered).
const DUPOK_KEY = "morning.triage.dupok";
const loadDupOk = (): string[] => { try { return JSON.parse(localStorage.getItem(DUPOK_KEY) ?? "[]"); } catch { return []; } };
const saveDupOk = (ids: string[]) => { try { localStorage.setItem(DUPOK_KEY, JSON.stringify([...new Set(ids)])); } catch { /* quota */ } };
const loadCalSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(CALSEEN_KEY) ?? "[]"); } catch { return []; } };
const saveCalSeen = (ids: string[]) => { try { localStorage.setItem(CALSEEN_KEY, JSON.stringify([...new Set(ids)])); } catch { /* quota */ } };
const loadDeferred = (): TriageItem[] => { try { return JSON.parse(localStorage.getItem(DEFERRED_KEY) ?? "[]"); } catch { return []; } };
const saveDeferred = (items: TriageItem[]) => { try { localStorage.setItem(DEFERRED_KEY, JSON.stringify(items)); } catch { /* quota */ } };
const loadTodos = (): Task[] => { try { return JSON.parse(localStorage.getItem("morning.todos") ?? "[]"); } catch { return []; } };
const todayIso = () => new Date().toISOString().slice(0, 10);

const KIND_LABELS: [Kind, string][] = [["task", "Aufgabe"], ["deadline", "Abgabe"], ["exam", "Klausur"]];
const PRIOS: [TaskPriority, string][] = [["normal", "Normal"], ["wichtig", "Wichtig"], ["dringend", "Dringend"]];

function decisionsFor(items: TriageItem[]): Record<string, Decision> {
  const d: Record<string, Decision> = {};
  for (const it of items) {
    const sure = (it.classification === "exam" || it.classification === "deadline") && !!it.date;
    d[it.id] = {
      add: sure,
      kind: it.classification === "exam" ? "exam" : it.classification === "deadline" ? "deadline" : "task",
      priority: "normal",
      date: it.date ?? "",
      title: it.title,
    };
  }
  return d;
}

const VALID_CLASSIFICATIONS = new Set(["exam", "deadline", "task", "uncertain"]);

// Runtime guard: the triage feed is built from incoming mail (attacker-
// influenced), so its shape can't be trusted just because TypeScript says so.
// Validate every field, cap lengths, and drop anything malformed instead of
// processing it.
function sanitizeTriageItems(raw: unknown): TriageItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TriageItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length === 0 || o.id.length > 120) continue;
    if (typeof o.title !== "string" || o.title.trim().length === 0) continue;
    if (typeof o.classification !== "string" || !VALID_CLASSIFICATIONS.has(o.classification)) continue;
    const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
    out.push({
      id: o.id,
      classification: o.classification as TriageItem["classification"],
      title: o.title.slice(0, 200),
      date,
      source: typeof o.source === "string" ? o.source.slice(0, 200) : undefined,
      context: typeof o.context === "string" ? o.context.slice(0, 500) : undefined,
    });
  }
  return out;
}

type DayEvent = { id: string; time: string; title: string };

export function MorningTriage({ calendarEvents = [] }: { calendarEvents?: CalendarEvent[] }) {
  const { addEvent, events: horizonEvents } = useImportantEvents();
  const [modalItems, setModalItems] = useState<TriageItem[]>([]);
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [view, setView] = useState<"closed" | "fresh" | "deferred">("closed");
  /** Neues aus Mail, das auf eine Entscheidung wartet — angeboten, nicht aufgedraengt. */
  const [pending, setPending] = useState<TriageItem[]>([]);
  const [deferred, setDeferred] = useState<TriageItem[]>(() => loadDeferred());
  const [autoCount, setAutoCount] = useState(0);
  const [dayEvents, setDayEvents] = useState<DayEvent[]>([]);
  const [dupOk, setDupOk] = useState<string[]>(() => loadDupOk());
  const closedByUser = useRef(false);

  // Everything Paul already tracks — the pool new items are checked against.
  // Recomputed per render: cheap (string sets), and the dialog is rarely open.
  const dupPool: DupCandidate[] = [
    ...loadTodos().filter(t => !t.done).map(t => ({ id: t.id, label: t.text, kind: "task" as const })),
    ...horizonEvents.filter(e => !e.dismissed).map(e => ({ id: e.id, label: e.title, kind: "event" as const })),
  ];
  /** The duplicate question for one item — null once answered "Nein, neu". */
  function dupFor(it: TriageItem): DupCandidate | null {
    if (dupOk.includes(it.id)) return null;
    return findSimilarTask(it.title, dupPool);
  }
  function confirmDuplicate(id: string) {
    // "Ja, gleiche Sache" → the mail is already covered; drop it for good.
    discardItem(id);
  }
  function denyDuplicate(id: string) {
    // "Nein, neu" → remember the answer, never ask again for this item.
    const next = [...dupOk, id];
    setDupOk(next);
    saveDupOk(next);
  }

  // Polled, not fetch-once: the app stays open for days, so new mails have to
  // surface without a restart. "Später" silences the dialog for the current
  // day only — a fresh day (or genuinely new items on the same day, if the
  // dialog was never dismissed) may open it again.
  const dismissedDay = useRef<string | null>(null);
  // Ref mirror — the poll effect runs with empty deps, a direct read of
  // horizonEvents would be a stale closure.
  const horizonRef = useRef(horizonEvents);
  useEffect(() => { horizonRef.current = horizonEvents; }, [horizonEvents]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/triage?t=" + Date.now())
        .then(r => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          if (!alive) return;
          const items = sanitizeTriageItems((data as { items?: unknown } | null)?.items);
          if (items.length === 0) return;
          if (dismissedDay.current && dismissedDay.current !== todayIso()) {
            closedByUser.current = false; // new day — the morning dialog may come back
            dismissedDay.current = null;
          }
          const seen = new Set(loadSeenTriageIds());
          const defIds = new Set(loadDeferred().map(d => d.id));
          // Third filter besides handled/parked: anything already put in front
          // of Paul recently. Without it "Später" was purely visual and the
          // identical mails returned every single morning (and after every
          // restart) — they stay visible in the Posteingang card meanwhile.
          const asked = loadAsked();
          const fresh = items.filter(
            it => !seen.has(it.id) && !defIds.has(it.id) && !isInCooldown(it.id, asked));

          // Rule 1: clear exams (type + date) are taken over automatically —
          // but only when nothing similar is tracked yet. A suspected
          // duplicate goes to the dialog instead, which ASKS rather than
          // silently creating a second horizon entry.
          const pool: DupCandidate[] = [
            ...loadTodos().filter(t => !t.done).map(t => ({ id: t.id, label: t.text, kind: "task" as const })),
            ...horizonRef.current.filter(e => !e.dismissed).map(e => ({ id: e.id, label: e.title, kind: "event" as const })),
          ];
          const autoExams = fresh.filter(it =>
            it.classification === "exam" && it.date && !findSimilarTask(it.title, pool));
          if (autoExams.length) {
            autoExams.forEach(it => addEvent({ kind: "exam", title: it.title, date: it.date as string }));
            markTriageSeen(autoExams.map(i => i.id));
            setAutoCount(autoExams.length);
          }

          const autoIds = new Set(autoExams.map(i => i.id));
          const remaining = fresh.filter(it => !autoIds.has(it.id));
          if (remaining.length && !closedByUser.current) {
            // Count them as asked the moment they're shown — whatever Paul
            // does next (sort them, hit "Später", or just close the app), the
            // dialog won't lead with the same mails again for a week.
            // NICHT MEHR AUTOMATISCH AUFREISSEN.
            // Vorher legte sich hier beim Laden ein Sortier-Overlay ueber das
            // persoenliche Intro — man las zuerst eine Aufgabenliste, nicht
            // seinen Tag. Die Sachen werden vorgehalten und unter dem Intro
            // als ruhige Leiste angeboten; echte harte Fristen laufen weiter
            // ueber den seltenen Alarmweg (BriefingAlertDialog).
            markAsked(remaining.map(it => it.id));
            setPending(remaining);
          }
        })
        .catch(() => { /* no triage file → nothing to do */ });
    };
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addEvent is stable
  }, []);

  // Today's timed calendar events the user hasn't decided on yet → ask
  // "Behalten / Ausblenden" in the same pop-up. (calendarEvents already
  // excludes locally-hidden ones.)
  useEffect(() => {
    const calseen = new Set(loadCalSeen());
    const fresh = calendarEvents
      .filter(e => e && e.id && !e.allDay && !calseen.has(e.id))
      .sort((a, b) => +new Date(a.start) - +new Date(b.start))
      .map(e => ({ id: e.id, time: new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), title: e.title }));
    setDayEvents(fresh);
    // Auch neue Kalendertermine oeffnen nichts von selbst — siehe oben.
  }, [calendarEvents]);

  const patch = (id: string, p: Partial<Decision>) => setDec(prev => ({ ...prev, [id]: { ...prev[id], ...p } }));

  function commit() {
    let todos = loadTodos();
    let todosTouched = false;
    const addedIds: string[] = [];
    const skipped: TriageItem[] = [];
    for (const it of modalItems) {
      const d = dec[it.id];
      if (d && d.add) {
        const title = d.title.trim() || it.title;
        if (d.kind === "exam" || d.kind === "deadline") {
          addEvent({ kind: d.kind, title, date: d.date || todayIso() });
        } else {
          const task: Task = {
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            text: title, done: false, priority: d.priority, createdAt: Date.now(),
          };
          todos = [task, ...todos];
          void todosDB.put(task);
          todosTouched = true;
        }
        addedIds.push(it.id);
      } else {
        skipped.push(it);
      }
    }
    if (todosTouched) {
      try { localStorage.setItem("morning.todos", JSON.stringify(todos)); } catch { /* quota */ }
      notifyTodosChanged();
    }
    markTriageSeen(addedIds);

    if (view === "fresh") {
      // Skipped fresh items go to the "Nicht zugeordnet" list (deduped).
      const existing = loadDeferred();
      const ids = new Set(existing.map(d => d.id));
      const next = [...existing, ...skipped.filter(s => !ids.has(s.id))];
      saveDeferred(next);
      setDeferred(next);
      // Calendar events still shown count as "kept" once you confirm.
      if (dayEvents.length) {
        saveCalSeen([...loadCalSeen(), ...dayEvents.map(e => e.id)]);
        setDayEvents([]);
      }
    } else {
      // Deferred view: added items leave the list; skipped stay.
      const next = loadDeferred().filter(d => !addedIds.includes(d.id));
      saveDeferred(next);
      setDeferred(next);
    }
    closedByUser.current = true;
    dismissedDay.current = todayIso();
    setView("closed");
  }

  function dismiss() {
    closedByUser.current = true;
    dismissedDay.current = todayIso();
    setView("closed");
  }

  function keepEvent(id: string) {
    saveCalSeen([...loadCalSeen(), id]);
    setDayEvents(prev => prev.filter(e => e.id !== id));
  }
  function hideEvent(id: string) {
    hideCalendarEvent(id);
    saveCalSeen([...loadCalSeen(), id]);
    setDayEvents(prev => prev.filter(e => e.id !== id));
  }
  // Verwerten: turn a picked-up appointment into a To-Do or an Abgabe.
  function convertEvent(ev: DayEvent, kind: "task" | "deadline") {
    if (kind === "task") {
      const task: Task = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        text: ev.title, done: false, priority: "normal", createdAt: Date.now(),
      };
      const todos = [task, ...loadTodos()];
      try { localStorage.setItem("morning.todos", JSON.stringify(todos)); } catch { /* quota */ }
      void todosDB.put(task);
      notifyTodosChanged();
    } else {
      addEvent({ kind: "deadline", title: ev.title, date: todayIso() });
    }
    saveCalSeen([...loadCalSeen(), ev.id]);
    setDayEvents(prev => prev.filter(e => e.id !== ev.id));
  }

  // Verwerfen: drop an item for good — not added, not deferred, never asked again.
  function discardItem(id: string) {
    markTriageSeen([id]);
    if (view === "deferred") {
      const next = loadDeferred().filter(d => d.id !== id);
      saveDeferred(next);
      setDeferred(next);
    }
    setModalItems(prev => prev.filter(it => it.id !== id));
    setDec(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  function openPending() {
    setModalItems(pending);
    setDec(decisionsFor(pending));
    setPending([]);
    setView("fresh");
  }

  function openDeferred() {
    setModalItems(deferred);
    setDec(decisionsFor(deferred));
    setView("deferred");
  }

  // Geschlossen: ruhige Leiste statt Overlay. Neues aus Mail zuerst, danach
  // das schon einmal Zurueckgestellte. Beides oeffnet erst auf Klick.
  if (view === "closed") {
    if (pending.length > 0) {
      return (
        <button className="triage-deferred-bar" onClick={openPending}>
          <span className="triage-deferred-dot" />
          {pending.length} {pending.length === 1 ? "neues Ding" : "neue Dinge"} aus Mail — einsortieren
          <span className="triage-deferred-arrow">›</span>
        </button>
      );
    }
    if (deferred.length === 0) return null;
    return (
      <button className="triage-deferred-bar" onClick={openDeferred}>
        <span className="triage-deferred-dot" />
        Nicht zugeordnet · {deferred.length} — später sortieren
        <span className="triage-deferred-arrow">›</span>
      </button>
    );
  }

  const isDeferred = view === "deferred";
  return (
    <div className="triage-overlay" role="dialog" aria-modal="true" aria-label="Morgen-Triage">
      <div className="triage-modal">
        <div className="triage-head">
          <span className="triage-kicker">{isDeferred ? "Noch offen" : "Guten Morgen · aus deinen Mails"}</span>
          <h2 className="triage-title">
            {isDeferred
              ? `Nicht zugeordnet · ${modalItems.length}`
              : `${modalItems.length + dayEvents.length} ${(modalItems.length + dayEvents.length) === 1 ? "Sache" : "Sachen"} zum Sortieren`}
          </h2>
          {!isDeferred && autoCount > 0 && (
            <p className="triage-auto-note">✓ {autoCount} {autoCount === 1 ? "Klausur" : "Klausuren"} automatisch in „Am Horizont" eingetragen.</p>
          )}
        </div>

        <div className="triage-list">
          {modalItems.map(it => {
            const d = dec[it.id];
            const isEvent = d.kind === "exam" || d.kind === "deadline";
            return (
              <div key={it.id} className={"triage-item" + (d.add ? " on" : "")}>
                <div className="triage-item-head">
                  <input type="checkbox" className="triage-cb" checked={d.add}
                    onChange={e => patch(it.id, { add: e.target.checked })}
                    aria-label={"Hinzufügen: " + it.title} />
                  {d.add
                    ? <input className="triage-title-edit" value={d.title}
                        onChange={e => patch(it.id, { title: e.target.value })} aria-label="Titel bearbeiten" />
                    : <span className="triage-item-title" onClick={() => patch(it.id, { add: true })}>{it.title}</span>}
                  {it.source && <span className="triage-src">{it.source}</span>}
                  <button className="triage-discard" onClick={() => discardItem(it.id)} title="Verwerfen" aria-label="Verwerfen">✕</button>
                </div>
                {it.context && <p className="triage-ctx">{it.context}</p>}

                {(() => {
                  const dup = dupFor(it);
                  if (!dup) return null;
                  return (
                    <div className="triage-dup">
                      <span className="triage-dup-q">
                        Klingt wie {dup.kind === "task" ? "deine Aufgabe" : "dein Termin"} „{dup.label}" — dieselbe Sache?
                      </span>
                      <button type="button" className="triage-dup-yes" onClick={() => confirmDuplicate(it.id)}>
                        Ja, gleiche — weg damit
                      </button>
                      <button type="button" className="triage-dup-no" onClick={() => denyDuplicate(it.id)}>
                        Nein, neu
                      </button>
                    </div>
                  );
                })()}

                {d.add && (
                  <div className="triage-controls">
                    <div className="triage-seg">
                      {KIND_LABELS.map(([k, lbl]) => (
                        <button key={k} type="button" className={d.kind === k ? "on" : ""} onClick={() => patch(it.id, { kind: k })}>{lbl}</button>
                      ))}
                    </div>
                    {isEvent ? (
                      <input type="date" className="triage-date" value={d.date} onChange={e => patch(it.id, { date: e.target.value })} />
                    ) : (
                      <div className="triage-seg">
                        {PRIOS.map(([p, lbl]) => (
                          <button key={p} type="button" className={d.priority === p ? "on" : ""} onClick={() => patch(it.id, { priority: p })}>{lbl}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!isDeferred && dayEvents.length > 0 && (
          <div className="triage-cal">
            <p className="triage-subhead">Termine heute · behalten?</p>
            {dayEvents.map(e => (
              <div key={e.id} className="triage-cal-row">
                <div className="triage-cal-main">
                  <span className="triage-cal-time num">{e.time}</span>
                  <span className="triage-cal-title">{e.title}</span>
                </div>
                <div className="triage-cal-actions">
                  <button className="cal-act" onClick={() => convertEvent(e, "task")}>→ Aufgabe</button>
                  <button className="cal-act" onClick={() => convertEvent(e, "deadline")}>→ Abgabe</button>
                  <button className="cal-act" onClick={() => keepEvent(e.id)}>Behalten</button>
                  <button className="cal-x" onClick={() => hideEvent(e.id)} title="Verwerfen / ausblenden" aria-label="Verwerfen">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="triage-foot">
          <button
            className="triage-later"
            onClick={dismiss}
            title="Bleibt im Posteingang — hier wird erst in einer Woche wieder danach gefragt"
          >
            Später
          </button>
          <button className="triage-apply" onClick={commit}>Fertig</button>
        </div>
      </div>
    </div>
  );
}
