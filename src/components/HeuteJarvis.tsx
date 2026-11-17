// HeuteJarvis.tsx — Aurora "Heute"-Panel: Intro und Aufgaben.
//
// Seit 2026-10-31 gibt es hier kein Gespräch mehr — weder die Chat-Karte
// „Gespräch mit Hermes" noch die kurzlebige Stimme „Sprich mit deinem Tag".
// Pauls Entscheidung: „Wenn ich mit Hermes rede, dann rede ich mit Hermes"
// (Telegram). Das Dashboard zeigt und ordnet; reden ist Hermes' Sache.
// Der Server-Endpunkt /api/hermes-chat bleibt bestehen, ungenutzt.
//
// Alle Änderungen an Aufgaben laufen durch die Funktionen hier — ob geklickt
// oder aus einer Empfehlung. An genau diesen Stellen lernt Daily mit
// (lib/prioSpeicher.ts), und nur dort: Aufräum-Läufe zählen nicht.
//
// Die Tagesroutinen stehen NICHT mehr in „Was heute zählt" (Pauls Wunsch,
// 2026-10-31): sie haben ihren eigenen Platz in „Bewusst leben". Für den
// Score zählen sie unverändert — der liest die Haken aus dem Routinenbuch
// (routineHakenAm), nicht aus der Todo-Liste.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTracker, isoDate, goalMinForDate } from "../tracker/store";
import { useImportantEvents } from "../important/store";
import type { Task, TaskPriority, CalendarEvent, Email } from "../types";
import type { BlockCategory } from "../tracker/types";
import { todosDB, notifyTodosChanged } from "../lib/db";
import { useBewusst } from '../lib/useBewusst';
import { GesternDialog } from "./GesternDialog";
import { HoerbriefingPlayer } from "./HoerbriefingPlayer";
import { HermesStimme } from "./HermesStimme";
import { NeuImBrain } from "./NeuImBrain";
import { gesternVon } from "../lib/gestern";
import { gleicheGesternAb, studyMinAm } from "../lib/gesternNachtrag";
import { dayInZone, routineHakenAm } from '../lib/bewusst';
import { useProactiveNudges } from "../hooks/useProactiveNudges";
import { CATEGORY_META } from "../lib/categories";
import { computeDayScore } from "../lib/dayScore";
import { backfillDoneStamps, pruneStaleDone } from "../lib/todoCleanup";
import { TodayCorner } from "./TodayCorner";
import { StillIntro, type StillItem } from "./StillIntro";
import { zielHinweisText } from "../lib/stillIntro";
import { useIntroLayout } from "../lib/introLayout";
import { useStil } from "../lib/stil";
import { GAufgaben, GHorizont } from "./g/GAufgaben";
import { HorizonCard } from "./HorizonCard";
import { WeekTodosCard, type WeekTaskMeta } from "./WeekTodosCard";
import { useBriefingSicht, useMeldeGerendert } from "../lib/briefingContext";
import { AufgabenEmpfehlungen } from "./AufgabenEmpfehlungen";
import { LernTempoZeile } from "./LernTempoZeile";
import { useTagesziel } from "../lib/tagesziel";
import { fmtMinuten } from "../lib/learnHarness";
import { lerne, beantworteEmpfehlung, usePrioModell, fachNamen } from "../lib/prioSpeicher";
import { prioRang } from "../lib/prioLernen";
import { empfehle, type Empfehlung } from "../lib/empfehlung";
import "../aurora.css";
import "../setzling.css";



const NAME = "Paul";

// ── Todo persistence (shared key with the rest of the app) ───────────────────
function loadTodos(): Task[] {
  try { return JSON.parse(localStorage.getItem("morning.todos") ?? "[]") as Task[]; }
  catch { return []; }
}

// The 2 AM done-todo cleanup lives in lib/todoCleanup.ts and is scheduled
// app-wide by useDoneTodoCleanup() — it used to be scheduled here, which meant
// it only ran while this dashboard was on screen. What stays here is the prune
// on hydrate, so freshly loaded DB data is filtered before it hits the UI.
function saveTodos(todos: Task[]) {
  try { localStorage.setItem("morning.todos", JSON.stringify(todos)); } catch { /* quota */ }
  notifyTodosChanged(); // canonical app-wide event so every consumer (DB-backed) stays in sync
}

// Safe replacement for dangerouslySetInnerHTML. Interprets ONLY the two tags we
// author ourselves — <em> and <span class="accent"> — and renders everything
// else (including any untrusted data) as plain, escaped text. A malicious title
// like `<img onerror=…>` can therefore never execute.
function RichText({ html, className }: { html: string; className?: string }) {
  const nodes = useMemo<ReactNode[]>(() => {
    const out: ReactNode[] = [];
    let mode: null | "em" | "accent" = null;
    let key = 0;
    for (const part of html.split(/(<em>|<\/em>|<span class="accent">|<\/span>)/g)) {
      if (part === "<em>") { mode = "em"; continue; }
      if (part === "</em>") { mode = null; continue; }
      if (part === '<span class="accent">') { mode = "accent"; continue; }
      if (part === "</span>") { mode = null; continue; }
      if (!part) continue;
      if (mode === "em") out.push(<em key={key++}>{part}</em>);
      else if (mode === "accent") out.push(<span key={key++} className="accent">{part}</span>);
      else out.push(part);
    }
    return out;
  }, [html]);
  return <div className={className}>{nodes}</div>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Check({ prio, done }: { prio: string; done: boolean }) {
  return (
    <span className={"check " + (done ? "" : prio)}>
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 12.5l4.2 4.2L19 7" style={{ stroke: "var(--ink-1)" }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type FocusItem = { id: string; name: string; sub: string; prio: "crit" | "warn" | "norm"; when: string; done: boolean; disabled?: boolean; category?: BlockCategory; priority?: TaskPriority; empfehlung?: string };

const PRIO_CFG: Record<TaskPriority, { dot: string; label: string }> = {
  normal: { dot: "var(--text-4)", label: "Normal" },
  wichtig: { dot: "var(--warn)", label: "Wichtig" },
  dringend: { dot: "var(--crit)", label: "Kritisch" },
};

const EFFORT_OPTIONS = [5, 15, 30, 60, 120, 300] as const;

/** Zeilen, die nicht gespeichert sind, sondern jeden Tag neu entstehen:
 *  Lernen aus dem Klausur-Planer (`lern:`) — früher auch die Routinen. Sie
 *  lassen sich weder löschen noch verschieben noch hochstufen. */
const projiziert = (id: string) => id.startsWith("routine:") || id.startsWith("lern:");

/** Kurzform einer Empfehlung an der Tageszeile — die ausführliche mit Grund
 *  und Knöpfen steht oben in der Aufgabenkarte. */
const EMPF_KURZ: Record<string, string | undefined> = {
  zuerst: "damit anfangen",
  woche: "zurück in die Woche?",
  streichen: "streichen?",
};

function FocusCard({ items, onToggle, onAdd, onDelete, onDropTodoId, onPrio, embedded = false }: {
  items: FocusItem[];
  onToggle: (id: string) => void;
  onAdd: (text: string, prio: TaskPriority, estimateMin: number | null) => void;
  onDelete: (id: string) => void;
  /** Accepts a drag from the weekly list ("Diese Woche") — pushes that task
   *  into today. Optional so FocusCard stays usable without the weekly system. */
  onDropTodoId?: (id: string) => void;
  /** Priorität eine Stufe weiter (normal → wichtig → dringend → normal).
   *  Jede Änderung ist ein Signal fürs Lernen — siehe lib/prioSpeicher.ts. */
  onPrio?: (id: string) => void;
  /** Als Spalte in der gemeinsamen Aufgabenkarte statt als eigene Karte. */
  embedded?: boolean;
}) {
  const done = items.filter(t => t.done).length;
  const [draft, setDraft] = useState("");
  const [prio, setPrio] = useState<TaskPriority>("normal");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const cyclePrio = () => setPrio(p => (p === "normal" ? "wichtig" : p === "wichtig" ? "dringend" : "normal"));
  return (
    <div
      id="heute-todos" className={(embedded ? "aufg-spalte card-heute" : "card span-6 card-heute") + (dragOver ? " drag-over" : "")}
      onDragOver={onDropTodoId ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={onDropTodoId ? () => setDragOver(false) : undefined}
      onDrop={onDropTodoId ? (e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData("text/todo-id");
        if (id) onDropTodoId(id);
      } : undefined}
    >
      <div className="card-head">
        <span className="ttl">Was heute zählt</span>
        <span className="right">{done} / {items.length} erledigt</span>
      </div>
      <div className="focus-list">
        {items.length === 0 && <div className="empty-row">Leer. Eine echte Aufgabe unten eintragen — mehr braucht der Anfang nicht.</div>}
        {items.map(t => (
          <div key={t.id} className="focus-row-wrap">
            <button className={"focus-row " + (t.done ? "done" : t.prio)} disabled={t.disabled} onClick={() => onToggle(t.id)} data-sound={t.done ? undefined : "confirm"}>
              <Check prio={t.prio} done={t.done} />
              <span>
                <span className="name">
                  {t.category && <span className="cat-dot" style={{ background: CATEGORY_META[t.category].color }} aria-hidden="true" />}
                  {t.name}
                </span>
                <span className="sub">
                  {t.done ? "Erledigt. Sauber." : t.sub}
                  {!t.done && t.empfehlung && <span className="focus-empf"> · {t.empfehlung}</span>}
                </span>
              </span>
              <span className="when">{t.done ? "erledigt" : t.when}</span>
            </button>
            {!projiziert(t.id) && !t.done && onPrio && (
              <button
                type="button"
                className={"focus-prio " + t.prio}
                onClick={() => onPrio(t.id)}
                title={`Priorität: ${PRIO_CFG[t.priority ?? "normal"].label} — klicken zum Ändern`}
                aria-label={`Priorität ändern: ${t.name} (jetzt ${PRIO_CFG[t.priority ?? "normal"].label})`}
              >
                <span aria-hidden="true" />
              </button>
            )}
            {!projiziert(t.id) && <button className="focus-del" onClick={() => onDelete(t.id)} title="Löschen" aria-label="Aufgabe löschen" data-sound="dismiss">✕</button>}
          </div>
        ))}
      </div>
      <form className="focus-add-form" onSubmit={(e) => { e.preventDefault(); onAdd(draft, prio, estimate); setDraft(""); setPrio("normal"); setEstimate(null); }}>
        <div className="focus-add">
          <button type="button" className="prio-dot" onClick={cyclePrio} title={`Priorität: ${PRIO_CFG[prio].label} (klicken zum Wechseln)`} style={{ background: PRIO_CFG[prio].dot }} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Aufgabe hinzufügen…" />
          <button type="submit" className="add-btn" disabled={!draft.trim()} aria-label="Aufgabe hinzufügen" data-sound="confirm">+</button>
        </div>
        <div className="effort-row">
          <span className="effort-label">Aufwand</span>
          {EFFORT_OPTIONS.map(m => (
            <button key={m} type="button" className={"effort-chip" + (estimate === m ? " on" : "")}
              onClick={() => setEstimate(estimate === m ? null : m)}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}


// Ring + DayStatusCard removed — the day score now lives in the Setzling intro.

// ── Main panel ────────────────────────────────────────────────────────────────

export function HeuteJarvis({ calendarEvents = [], upcomingEvents = [], emails = [] }: {
  calendarEvents?: CalendarEvent[];
  /** Heute + Horizont. „Dein Horizont" braucht mehr als den heutigen Tag. */
  upcomingEvents?: CalendarEvent[];
  emails?: Email[];
}) {
  const { sessions, goalMin, goalMinWeekend, goalsByWeekday, subjects } = useTracker();
  const { events: importantEvents } = useImportantEvents();

  const [todos, setTodos] = useState<Task[]>(() => loadTodos());
  const routines = useBewusst();
  const [gesternOffen, setGesternOffen] = useState(false);
  // Beim Öffnen zuerst den Score von gestern an die Lernzeit von gestern
  // angleichen — falls sie zwischendurch woanders nachgetragen wurde (Timer →
  // Eintrag mit Datum). Hier, im Klick, und nicht in einem Effekt beim Laden:
  // dann ist sicher alles geladen (siehe lib/gesternNachtrag.ts).
  function oeffneGestern() {
    const gestern = gesternVon(dayInZone());
    const ziel = goalMinForDate(new Date(gestern + "T12:00:00"), goalsByWeekday, goalMin, goalMinWeekend);
    gleicheGesternAb(gestern, {
      studyMin: studyMinAm(sessions, gestern),
      goalMin: ziel,
      // Noch nicht geladen → undefined: der festgehaltene Bonus bleibt stehen.
      routineHaken: routines.state ? routineHakenAm(routines.state, gestern) : undefined,
    }, false);
    setGesternOffen(true);
  }
  const [now, setNow] = useState(() => new Date());
  // Original-Intro oder „Still" — Einstellung in der Seitenleiste.
  const stil = useStil();
  // Im Stil G ist die Startseite immer „Still" (Seite G übernimmt sie 1:1).
  const gewaehltesIntro = useIntroLayout();
  const introLayout = stil === "g" ? "still" : gewaehltesIntro;

  /** Das Gelernte über Pauls Prioritäten — wird bei jeder Handlung neu gerechnet. */
  const prio = usePrioModell();

  // Tageszeit bestimmt den Modus — Jarvis wechselt selbst (kein manueller Tab).
  // Morgen-Briefing von 5–18 Uhr, danach Abend-Rückblick. Aktualisiert sich mit der Uhr.
  const mode: "morgen" | "abend" = now.getHours() >= 5 && now.getHours() < 18 ? "morgen" : "abend";

  // Clock tick — 30s is enough for the HH:MM header and the morgen/abend mode.
  // (No live timer renders here anymore, so a 1s tick would re-render the whole
  //  panel — and every now-dependent useMemo — 30x more often for nothing.)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const sync = () => setTodos(loadTodos());
    const id = setInterval(sync, 60_000);
    window.addEventListener("morning:todos-changed", sync);
    window.addEventListener("storage", sync);
    return () => { clearInterval(id); window.removeEventListener("morning:todos-changed", sync); window.removeEventListener("storage", sync); };
  }, []);

  // Hydrate from the canonical IndexedDB store on mount. localStorage is only a
  // mirror, and the old Todo card that kept it fresh was removed — so the DB is
  // the source of truth. DB wins when it has data; otherwise keep the
  // localStorage-seeded state (never overwrite real todos with an empty DB).
  useEffect(() => {
    let alive = true;
    const settle = (source: Task[]) => {
      if (!alive) return;
      // Stamp anything done-but-unstamped first, otherwise it can never expire.
      const { list, stamped } = backfillDoneStamps(source);
      stamped.forEach(t => void todosDB.put(t));
      const { kept, removedIds } = pruneStaleDone(list);
      removedIds.forEach(id => void todosDB.remove(id));
      setTodos(kept);
      try { localStorage.setItem("morning.todos", JSON.stringify(kept)); } catch { /* quota */ }
    };
    void todosDB.getAll()
      .then(items => settle(Array.isArray(items) && items.length > 0 ? items : loadTodos()))
      .catch(() => settle(loadTodos()));
    return () => { alive = false; };
  }, []);

  // The live 2 AM sweep runs app-wide (useDoneTodoCleanup in App.tsx) so it also
  // fires while the Lernzeit page is open. It persists + emits
  // "morning:todos-changed", which the sync effect above already listens to —
  // so this view updates itself when the sweep removes something.

  const todayIso = isoDate(now);

  // ── derived: lernzeit, goal, score, streak ──
  const totalMin = useMemo(
    () => sessions.filter(s => s.date === todayIso).reduce((a, s) => a + s.durationMin, 0),
    [sessions, todayIso],
  );
  // Das Tagesziel: Budget aus der Wochenzeile als Obergrenze, Bedarf aus
  // Klausurplänen und festen Fachzeiten als Ziel (lib/tagesziel.ts).
  const tz = useTagesziel(now);
  const dayGoal = tz.ziel;
  // Today's todos only (scope "day"). The weekly backlog ("Diese Woche") is a
  // staging area — it must NOT drag the daily score or the "X/Y Aufgaben" count.
  const dayTodos = useMemo(() => todos.filter(t => (t.scope ?? "day") === "day"), [todos]);
  const tasksDone = dayTodos.filter(t => t.done).length;
  const tasksTotal = dayTodos.length;
  // Weighted tasks + study time (incl. overtime) − the drag of tasks left
  // lying around. See lib/dayScore.ts for the reasoning behind each part.
  // Routinen und Gym von heute — seit 2026-10-22 je +2 im Score (ROUTINE_BONUS).
  const routineHakenHeute = useMemo(
    () => (routines.state ? routineHakenAm(routines.state, dayInZone(now)) : 0),
    [routines.state, now],
  );
  const scoreParts = useMemo(
    () => computeDayScore(dayTodos, totalMin, dayGoal, now.getTime(), routineHakenHeute),
    [dayTodos, totalMin, dayGoal, now, routineHakenHeute],
  );
  const score = scoreParts.score;
  // Festgehalten wird der Score app-weit in hooks/useScoreSnapshot.ts — hier
  // nur noch angezeigt. Bis 2026-10-27 schrieb dieses Dashboard ihn selbst und
  // nur, solange es offen war; Lernzeit danach fehlte im Verlauf.
  const streak = useMemo(() => {
    const dates = new Set(sessions.map(s => s.date));
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (dates.has(isoDate(d))) n += 1;
      else if (i > 0) break;
    }
    return n;
  }, [sessions, now]);

  // Proactive native notifications (exam soon, no study by midday). Throttled +
  // mutable inside the hook; reads fresh data via a ref so it doesn't re-arm.
  useProactiveNudges({ importantEvents, totalMin, dayGoal, todayIso });

  // ── Empfehlungen: reinnehmen oder nicht? (lib/empfehlung.ts) ──
  const empfehlungen = useMemo<Empfehlung[]>(
    () => empfehle(todos, prio.modell, { heute: todayIso, abgelehnt: prio.abgelehnt, faecher: fachNamen() }),
    [todos, prio, todayIso],
  );
  const empfehlungFuer = useMemo(() => new Map(empfehlungen.map(e => [e.id, e])), [empfehlungen]);
  // ── Lernen heute: Klausur-Planer + Lerntempo (lib/lernHeute.ts) ──
  const lern = tz.lern;
  const lernItems = useMemo<FocusItem[]>(() => (lern?.zeilen ?? []).filter(z => z.ziel > 0).map(z => {
    const fertig = z.ist >= z.ziel;
    // Das Ziel IST schon das bei Pauls Tempo; die Planzahl steht zum Vergleich.
    const tempoHinweis = z.planZiel !== z.ziel ? ` · Plan sagte ${fmtMinuten(z.planZiel)}` : "";
    return {
      id: z.id,
      name: `${z.klausur} lernen`,
      sub: `${fmtMinuten(z.ist)} von ${fmtMinuten(z.ziel)}${z.dran.length ? ` · dran: ${z.dran.join(", ")}` : ""}${tempoHinweis}`,
      prio: z.lage === "zu-knapp" ? "warn" as const : "norm" as const,
      when: fertig ? "erledigt" : `noch ${fmtMinuten(z.ziel - z.ist)}`,
      done: fertig,
      category: "lern" as const,
    };
  }), [lern]);

  // ── derived: "Was heute zählt" (real todos, daily scope only) ──
  // Weekly backlog items (scope "week") live exclusively in WeekTodosCard until
  // pushed — they never show here. Missing scope = "day" (every todo created
  // before this field existed keeps behaving exactly as before).
  const focusItems = useMemo<FocusItem[]>(() => {
    const prioOf = (t: Task): "crit" | "warn" | "norm" =>
      t.priority === "dringend" ? "crit" : t.priority === "wichtig" ? "warn" : "norm";
    const rank = { crit: 0, warn: 1, norm: 2 };
    const open = dayTodos.filter(t => !t.done).sort((a, b) => rank[prioOf(a)] - rank[prioOf(b)]);
    const done = dayTodos.filter(t => t.done);
    // Show ALL open tasks (scrollable list) + done after them — nothing hidden.
    // A description (carried over from the weekly list) becomes the sub-line, so
    // the "what" you wrote out follows the task into today.
    // Ab zwei Verschiebungen wird der Zähler zur Nachricht: die Aufgabe hat
    // zwei Abende überlebt. Darunter wäre es Rauschen — alles, was heute
    // angelegt wurde, hätte sonst schon einen Vermerk.
    const alter = (t: Task): string | null =>
      (t.verschoben ?? 0) >= 2 ? `seit ${t.verschoben} Tagen offen` : null;
    return [...open, ...done].map(t => ({
      id: t.id,
      name: t.text,
      sub: [t.description?.trim() || null, alter(t)].filter(Boolean).join(" · ")
        || (t.priority === "dringend" ? "dringend" : "offen"),
      prio: prioOf(t),
      when: t.priority === "dringend" ? "dringend" : t.priority === "wichtig" ? "wichtig" : "offen",
      done: t.done,
      category: t.category,
      priority: t.priority,
      empfehlung: EMPF_KURZ[empfehlungFuer.get(t.id)?.art ?? ""],
    }));
  }, [dayTodos, empfehlungFuer]);

  // ── derived: weekly backlog ("Diese Woche") ──
  const weekItems = useMemo(
    () => todos.filter(t => t.scope === "week" && !t.done)
      .map(t => ({
        id: t.id, text: t.text, category: t.category, description: t.description,
        priority: t.priority, estimatedMin: t.estimatedMin,
        plannedDay: t.plannedDay, subjectId: t.subjectId, geplantAm: t.geplantAm,
      })),
    [todos],
  );

  // ── derived: the quiet top-right teaser — today's open must-dos, capped ──
  const todayCornerItems = useMemo(() => {
    const prioOf = (t: Task): "crit" | "warn" | "norm" =>
      t.priority === "dringend" ? "crit" : t.priority === "wichtig" ? "warn" : "norm";
    const rank = { crit: 0, warn: 1, norm: 2 };
    return dayTodos
      .filter(t => !t.done)
      .sort((a, b) => rank[prioOf(a)] - rank[prioOf(b)])
      .slice(0, 6)
      .map(t => ({ id: t.id, text: t.text, category: t.category }));
  }, [dayTodos]);

  // ── derived: „Heute" im Still-Intro — wie die Ecke oben, aber mit den
  // erledigten dahinter, damit ein Haken nicht spurlos verschwindet. ──
  const stillItems = useMemo<StillItem[]>(() => {
    const rank = (t: Task) => (t.priority === "dringend" ? 0 : t.priority === "wichtig" ? 1 : 2);
    const offen = dayTodos.filter(t => !t.done).sort((a, b) => rank(a) - rank(b));
    const erledigt = dayTodos.filter(t => t.done);
    return [...offen, ...erledigt].slice(0, 6).map(t => ({
      id: t.id, text: t.text, done: t.done, category: t.category, verschoben: t.verschoben,
    }));
  }, [dayTodos]);


  // ── derived: today's calendar appointments + inbox count ──
  const todayAppts = useMemo(() => {
    return calendarEvents
      .filter(e => !e.allDay && isoDate(new Date(e.start)) === todayIso)
      .sort((a, b) => +new Date(a.start) - +new Date(b.start))
      .slice(0, 4)
      .map(e => ({
        id: e.id,
        time: new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        title: e.title,
      }));
  }, [calendarEvents, todayIso]);
  const mailCount = emails.length;

  // ── Begrüssung ──
  // Seit 2026-10-31 steht unter dem Gruss kein Text mehr — weder die lokale
  // Tagline noch die Einordnung („Samstag ohne festen Block …", „Heute 0 von 7
  // Aufgaben …"). Pauls Wunsch: oben nur noch Gruss, Herkunft und das
  // Hörbriefing. Was der Tag bringt, erzählt das Hörbriefing; was zu tun ist,
  // steht in „Deine Aufgaben".
  const greetingLokal = `${now.getHours() < 11 ? "Guten Morgen" : now.getHours() < 18 || mode === "morgen" ? "Hallo" : "Guten Abend"}, ${NAME}.`;

  // Muss VOR jedem vorzeitigen Return stehen — Hooks dürfen nicht bedingt
  // laufen. Verwendet wird es weiter unten, wo `b` zusammengesetzt wird.
  // Die Datumsprüfung passiert im Provider, nicht hier: drei Flächen mit drei
  // eigenen Prüfungen waren genau der Grund, warum eine davon falsch lag.
  const { zeilen, herkunft, meldeGerendert } = useBriefingSicht();

  // Jarvis kommentiert den Stand — trocken, mit Kante, nie Motivationsposter.
  // Beschreibt den Stand, bewertet ihn nicht.
  //
  // Vorher standen hier Sätze wie „Wir wissen es beide" und „Ich würde es
  // ungern als Stilmittel deuten müssen" — an einem Tag, an dem ohnehin nichts
  // lief, liest sich das wie ein Vorwurf von der eigenen App. Das dauernde
  // „Sir" ist ebenfalls raus: einmal augenzwinkernd, dreimal täglich eine
  // Marotte. Kein Motivationsposter als Gegenrichtung — nur die Feststellung.
  const dayMessage = useMemo(() => {
    if (score >= 80) return "Starker Tag. <em>Da ist nichts offen, was drängt.</em>";
    if (score >= 55) return "Gut unterwegs — <em>der Rest des Tages gehört noch dir.</em>";
    if (score >= 30) return "In Bewegung. <em>Noch nicht rund, aber angefangen.</em>";
    if (totalMin > 0 || score > 0) return "Ein Anfang steht. <em>Zählt auch.</em>";
    return "Noch nichts eingetragen heute.";
  }, [score, totalMin]);

  // ── interactions ──
  // Side effects stay OUT of the setTodos updater (StrictMode double-invokes
  // updaters in dev — keep them pure and persist exactly once here).
  //
  // IMMER AUF DEM NEUESTEN STAND RECHNEN. Mehrere Änderungen kurz
  // hintereinander (Empfehlung + Klick) dürfen sich nicht überschreiben. Rechnete jede davon mit dem
  // `todos` des letzten Renders, überschriebe die zweite still die erste.
  // Deshalb gehen alle Handler über `todosRef`, und `commit` setzt den Stand
  // sofort, nicht erst beim nächsten Render.
  const todosRef = useRef(todos);
  useEffect(() => { todosRef.current = todos; }, [todos]);
  function commit(next: Task[]) {
    todosRef.current = next;
    setTodos(next);
    saveTodos(next);
  }
  const finde = (id: string) => todosRef.current.find(t => t.id === id);
  const neueId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  function toggleTask(id: string) {
    // Eine Lernzeile hakt sich selbst ab (Timer/LearnHarness messen). Ein
    // Klick führt dorthin, wo gelernt wird.
    if (id.startsWith("lern:")) { window.location.hash = "#/lernzeit"; return; }
    const next = todosRef.current.map(t => {
      if (t.id !== id) return t;
      // Stamp when completed (drives next-day auto-cleanup); clear it on un-done.
      if (!t.done) return { ...t, done: true, doneAt: Date.now() };
      const reopened = { ...t, done: false };
      delete reopened.doneAt;
      return reopened;
    });
    const toggled = next.find(t => t.id === id);
    if (toggled) void todosDB.put(toggled);
    commit(next);
    if (toggled?.done) lerne(toggled, "erledigt");
    // Dem Server melden, dass das Todo durch ist: er bewegt einen Vorgang, an
    // dem es als „nächster Schritt" hängt, und vermerkt im Vorlaufbuch, wie
    // knapp eine Frist war. Die Fokus-Karte gibt es nicht mehr, der Vermerk
    // bleibt wichtig. Ein Fehlschlag ist folgenlos — abgehakt ist gespeichert.
    if (toggled?.done) {
      void fetch("/api/focus/todo-done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoId: id }),
      }).catch(() => { /* folgenlos */ });
    }
  }
  // Manual delete — remove a todo entirely (done or open). Persists everywhere.
  // Nur ein OFFEN gelöschtes Todo ist eine Aussage („unwichtig"); ein
  // erledigtes wegzuräumen ist Aufräumen.
  function deleteTodo(id: string, lernen = true) {
    const weg = finde(id);
    void todosDB.remove(id);
    commit(todosRef.current.filter(t => t.id !== id));
    if (lernen && weg && !weg.done) lerne(weg, "geloescht");
  }
  function addTask(text: string, priority: TaskPriority, estimateMin: number | null) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task: Task = {
      id: neueId(), text: trimmed, done: false, priority, createdAt: Date.now(),
      ...(estimateMin ? { estimatedMin: estimateMin } : {}),
    };
    void todosDB.put(task);
    commit([task, ...todosRef.current]);
  }
  // "Reinschieben" — moves a weekly backlog item into today's list (drag or the
  // "→ Heute" button). A pure move: the same task flips scope, nothing is
  // duplicated, and it keeps its category/priority/text as-is.
  function pushToToday(id: string, lernen = true) {
    const vorher = finde(id);
    const next = todosRef.current.map(t => (t.id === id ? { ...t, scope: "day" as const, date: todayIso } : t));
    const updated = next.find(t => t.id === id);
    if (updated) void todosDB.put(updated);
    commit(next);
    if (lernen && vorher && vorher.scope === "week") lerne(vorher, "nachHeute");
  }
  /** Der Rückweg: aus dem Tag zurück in die Woche. Der Verschiebe-Zähler
   *  bleibt — er erzählt, wie lange die Aufgabe schon mitläuft. */
  function moveToWeek(id: string, lernen = true) {
    const vorher = finde(id);
    const next = todosRef.current.map(t => {
      if (t.id !== id) return t;
      const w: Task = { ...t, scope: "week" };
      delete w.date;
      return w;
    });
    const updated = next.find(t => t.id === id);
    if (updated) void todosDB.put(updated);
    commit(next);
    if (lernen && vorher && (vorher.scope ?? "day") === "day") lerne(vorher, "zurueckWoche");
  }
  function addWeekTask(text: string, meta: WeekTaskMeta = {}) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const desc = meta.description?.trim();
    const task: Task = {
      id: neueId(), text: trimmed, done: false, scope: "week", createdAt: Date.now(),
      ...(meta.category ? { category: meta.category } : {}),
      ...(desc ? { description: desc } : {}),
      ...(meta.priority && meta.priority !== "normal" ? { priority: meta.priority } : {}),
      ...(meta.estimatedMin ? { estimatedMin: meta.estimatedMin } : {}),
      ...(meta.plannedDay ? { plannedDay: meta.plannedDay } : {}),
      ...(meta.subjectId ? { subjectId: meta.subjectId } : {}),
    };
    void todosDB.put(task);
    commit([task, ...todosRef.current]);
  }
  // Edit a task in place (weekly editor, priority dot, the voice). Presence of
  // a key in the patch means "set or clear this field" — an undefined/empty
  // value drops it. (`in`-checks, not !== undefined, so deselecting a chip
  // actually clears the field.)
  function editWeekTask(id: string, patch: WeekTaskMeta & { text?: string }, lernen = true) {
    const vorher = finde(id);
    const next = todosRef.current.map(t => {
      if (t.id !== id) return t;
      const updated: Task = { ...t };
      if (patch.text !== undefined) updated.text = patch.text.trim() || t.text;
      if ("description" in patch) {
        const d = patch.description?.trim();
        if (d) updated.description = d; else delete updated.description;
      }
      if ("category" in patch) {
        if (patch.category) updated.category = patch.category; else delete updated.category;
      }
      if ("priority" in patch) {
        if (patch.priority && patch.priority !== "normal") updated.priority = patch.priority;
        else delete updated.priority;
      }
      if ("estimatedMin" in patch) {
        if (patch.estimatedMin) updated.estimatedMin = patch.estimatedMin; else delete updated.estimatedMin;
      }
      if ("plannedDay" in patch) {
        // Paul legt den Tag selbst neu fest → das Datum, das Hermes gesetzt
        // hatte, gilt nicht mehr. Sonst schöbe der Tagesbeginn die Aufgabe am
        // alten Datum in den Tag, egal was hier gewählt wurde.
        if (patch.plannedDay !== t.plannedDay) delete updated.geplantAm;
        if (patch.plannedDay) updated.plannedDay = patch.plannedDay; else delete updated.plannedDay;
      }
      if ("subjectId" in patch) {
        if (patch.subjectId) updated.subjectId = patch.subjectId; else delete updated.subjectId;
      }
      return updated;
    });
    const updated = next.find(t => t.id === id);
    if (updated) void todosDB.put(updated);
    commit(next);
    // Priorität hoch oder runter ist die deutlichste Aussage über Wichtigkeit.
    if (lernen && vorher && updated && "priority" in patch) {
      const d = prioRang(updated.priority) - prioRang(vorher.priority);
      if (d > 0) lerne(updated, "hochgestuft");
      else if (d < 0) lerne(updated, "runtergestuft");
    }
  }
  /** Der Punkt an der Tageszeile: normal → wichtig → dringend → normal. */
  function cyclePrio(id: string) {
    const t = finde(id);
    if (!t) return;
    const p = t.priority ?? "normal";
    editWeekTask(id, { priority: p === "normal" ? "wichtig" : p === "wichtig" ? "dringend" : "normal" });
  }

  // ── Empfehlungen beantworten (berechnet weiter oben, vor „Was heute zählt") ──
  function empfehlungJa(e: Empfehlung) {
    const t = finde(e.id);
    if (!t) return;
    // Das Ja selbst ist das Signal — die Handlung darunter lernt nicht noch
    // einmal mit, sonst zählte ein Klick doppelt.
    if (e.art === "heute") pushToToday(e.id, false);
    else if (e.art === "woche") moveToWeek(e.id, false);
    else if (e.art === "streichen") deleteTodo(e.id, false);
    else if (e.art === "zuerst") {
      const andere = dayTodos.filter(x => !x.done && x.id !== e.id).map(x => prioRang(x.priority));
      const ziel = Math.max(1, ...andere);
      if (ziel > prioRang(t.priority)) editWeekTask(e.id, { priority: ziel >= 2 ? "dringend" : "wichtig" }, false);
    }
    beantworteEmpfehlung(t, e.art, true, todayIso);
  }
  function empfehlungNein(e: Empfehlung) {
    const t = finde(e.id);
    if (t) beantworteEmpfehlung(t, e.art, false, todayIso);
  }

  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const timeStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  // Hat Hermes heute Zeilen geschrieben, gewinnen sie — aber FELDWEISE. Fehlt
  // nur die tagline, bleibt der Gruß trotzdem seiner; "alles oder nichts" wäre
  // hier die schlechtere Regel, weil eine fehlende Kleinigkeit die ganze Zeile
  // zurück auf die Formel würfe.
  // `brief` und `essential` bleiben bewusst IMMER lokal: die tragen Zahlen
  // (offene Aufgaben, Minuten) und müssen zum Stand JETZT passen — nicht zu
  // dem von heute früh um fünf, als Hermes geschrieben hat.
  const greeting = zeilen?.headerGreeting ?? greetingLokal;

  // Gemeldet wird nur, was wirklich auf dem Schirm steht: der Gruss. Die
  // Tagline zeigt Daily seit 2026-10-31 nicht mehr, also meldet es sie auch
  // nicht — sonst behauptete die Quittung mehr, als sie belegen kann.
  // Im Still-Intro steht kein Gruss — dann meldet er auch nichts.
  useMeldeGerendert("greeting", introLayout === "original" && !!zeilen?.headerGreeting);
  void meldeGerendert;   // die Flächen melden über den Hook, nicht direkt

  return (
    <div className="szl">
      {introLayout === "still" ? (
        <StillIntro
          dateStr={dateStr}
          timeStr={timeStr}
          score={score}
          totalMin={totalMin}
          dayGoal={dayGoal}
          streak={streak}
          zielHinweis={tz.angepasst ? zielHinweisText(fmtMinuten(tz.ziel), fmtMinuten(tz.budget), [
            ...(tz.lern?.zeilen ?? []).map(z => `${z.klausur}: ${fmtMinuten(z.ziel)}`),
            ...tz.feste.map(f => `${f.name}: ${fmtMinuten(f.minuten)} (feste Wochenzeit)`),
          ]) : null}
          items={stillItems}
          doneCount={tasksDone}
          taskTotal={tasksTotal}
          weekCount={weekItems.length}
          onToggle={toggleTask}
          onJumpToWeek={() => document.getElementById("week-todos")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onGestern={oeffneGestern}
          onMehr={() => document.getElementById("aufgaben")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      ) : (
      /* INTRO — first screen, minimal; the sapling sits centred behind */
      <section className="szl-intro">
        {/* LINKS — die persönliche Stimme. Aufbau bewusst knapp:
            Datum · Begrüßung · höchstens zwei Sätze · optional EINE
            Akzentzeile · eine sehr kleine Herkunftszeile.

            Die Herkunftszeile ist der Teil, der leicht wegfällt und am
            meisten trägt: Ein lokal errechneter Satz darf nie aussehen wie
            einer von Hermes. Genau diese Verwechslung hat den Fehler vom
            15.08. tagelang verdeckt. */}
        <div className="szl-greet">
          <div className="kicker">
            <span className="pip" />{dateStr} · {timeStr}
            {/* Oben, weil man es morgens braucht: beim ersten Blick auf den Tag
                fällt einem ein, was man gestern nicht mehr eingetragen hat. */}
            <button type="button" className="gestern-knopf" onClick={oeffneGestern} aria-haspopup="dialog">
              ← Gestern nachtragen
            </button>
          </div>
          {gesternOffen && (
            <GesternDialog todos={todos} bewusst={routines} onSchliessen={() => setGesternOffen(false)} />
          )}
          {/* Begrüßung und Tagline getrennt. Zusammen in EINER Überschrift
              liefen sie über vier Zeilen und erschlugen die ganze Spalte —
              die Anrede ist kurz, der charakterisierende Halbsatz gehört
              eine Stufe leiser darunter. */}
          <h1>{greeting}</h1>
          <div className="szl-quelle">
            <span>{herkunft.text}</span>
          </div>
          {/* Der Tag zum Anhören — bis zu fünf Minuten, von Hermes geschrieben,
              hier aufgenommen. Startet nur auf Klick. */}
          <HoerbriefingPlayer />
          {/* Danach reden: Hermes kennt das Briefing und die Frage, mit der
              es endete — Antwort und „schreib auf …" landen in der App. */}
          <HermesStimme />
          {/* Was seit gestern ins Brain kam — eine leise, aufklappbare Zeile. */}
          <NeuImBrain />
        </div>

        <div className="szl-daystatus">
          <span className="lbl">Wie der Tag steht</span>
          <div className="score"><span className="n num">{score}</span><span className="tot">/ 100</span></div>
          <RichText className="msg" html={dayMessage} />
          <div className="stats num">{totalMin}/{dayGoal} min · {tasksDone}/{tasksTotal} Aufgaben · {streak} d</div>
          {/* Leise: nur wenn das Ziel unter dem Budget liegt — dann soll man
              sehen, dass es berechnet ist und woher. */}
          {tz.angepasst && (
            <div
              className="stats num szl-ziel"
              title={[
                ...(tz.lern?.zeilen ?? []).map(z => `${z.klausur}: ${fmtMinuten(z.ziel)}`),
                ...tz.feste.map(f => `${f.name}: ${fmtMinuten(f.minuten)} (feste Wochenzeit)`),
              ].join(" · ")}
            >
              Ziel heute {fmtMinuten(tz.ziel)} · von {fmtMinuten(tz.budget)} verfügbar
            </div>
          )}
          <div className="stem" />
        </div>

        <TodayCorner
          items={todayCornerItems}
          weekCount={weekItems.length}
          onToggle={toggleTask}
          onJumpToWeek={() => document.getElementById("week-todos")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />

        <div className="szl-scrollcue">
          <span>Mehr</span>
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </section>
      )}
      {/* Der Dialog hängt am Intro-Wechsel nicht mit: beide Intros öffnen ihn. */}
      {introLayout === "still" && gesternOffen && (
        <GesternDialog todos={todos} bewusst={routines} onSchliessen={() => setGesternOffen(false)} />
      )}

      {/* WORK — revealed on scroll: the rich content */}
      <div className="aurora szl-work">
        <div className="hero">
          {(todayAppts.length > 0 || mailCount > 0) && (
            <div className="agenda">
              {todayAppts.map(a => (
                <span className="appt" key={a.id}><b className="num">{a.time}</b> {a.title}</span>
              ))}
              {mailCount > 0 && <span className="appt mail">📬 {mailCount} {mailCount === 1 ? "Mail" : "Mails"} im Posteingang</span>}
            </div>
          )}
        </div>

        {stil === "g" ? (
          /* Stil G: dieselben Daten und Handlungen, Aufbau aus Seite G. */
          <div className="g-spalte">
            <GAufgaben
              tasks={dayTodos}
              lern={lern?.zeilen.filter(z => z.ziel > 0) ?? []}
              weekItems={weekItems}
              empfehlungen={empfehlungen}
              modell={prio.modell}
              anzahlSignale={prio.anzahl}
              onToggle={toggleTask}
              onDelete={(id) => deleteTodo(id)}
              onAdd={addTask}
              onPrio={cyclePrio}
              onEmpfJa={empfehlungJa}
              onEmpfNein={empfehlungNein}
              onPush={(id) => pushToToday(id)}
              onAddWeek={addWeekTask}
              onEditWeek={(id, patch) => editWeekTask(id, patch)}
              subjects={subjects}
              horizont={<GHorizont events={calendarEvents} upcoming={upcomingEvents} />}
            />
          </div>
        ) : (
        <div className="grid">
          {/* Heute und Diese Woche in EINER Karte (Pauls Wunsch 2026-10-31):
              zwei Spalten derselben Frage „was muss ich tun?", darüber die
              Empfehlungen, die beide verbinden — rein, zuerst, zurück, weg. */}
          <div className="card span-12 aufgaben" id="aufgaben">
            <div className="card-head">
              <span className="ttl">Deine Aufgaben</span>
              <span className="right">heute {tasksDone}/{tasksTotal} · Woche {weekItems.length} offen</span>
            </div>
            <AufgabenEmpfehlungen
              empfehlungen={empfehlungen}
              modell={prio.modell}
              anzahlSignale={prio.anzahl}
              onJa={empfehlungJa}
              onNein={empfehlungNein}
            />
            {lern && <LernTempoZeile lern={lern} />}
            <div className="aufgaben-spalten">
              <FocusCard
                embedded
                items={[...lernItems.filter(i => !i.done), ...focusItems, ...lernItems.filter(i => i.done)]}
                onToggle={toggleTask}
                onAdd={addTask}
                onDelete={(id) => deleteTodo(id)}
                onDropTodoId={(id) => pushToToday(id)}
                onPrio={cyclePrio}
              />
              <WeekTodosCard
                embedded
                items={weekItems}
                subjects={subjects}
                hinweise={empfehlungFuer}
                onAdd={addWeekTask}
                onPush={(id) => pushToToday(id)}
                onDelete={(id) => deleteTodo(id)}
                onEdit={(id, patch) => editWeekTask(id, patch)}
              />
            </div>
          </div>
          {/* Ersetzt „Am Horizont": zeigt Kalendertermine UND Fristen in einer
              Ordnung, entdoppelt (src/lib/horizon.ts). Direkt nach den
              Aufgaben — erst was zu tun ist, dann was kommt. */}
          <HorizonCard
            className="card span-12"
            events={calendarEvents}
            upcoming={upcomingEvents}
            onOpenCalendar={() => document.getElementById("kalender-voll")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
        </div>
        )}
      </div>
    </div>
  );
}
