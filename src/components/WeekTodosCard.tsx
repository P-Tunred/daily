import { useState } from "react";
import type { BlockCategory } from "../tracker/types";
import type { TaskPriority } from "../types";
import { CATEGORY_META, CATEGORY_ORDER } from "../lib/categories";
import { kurzesDatum, spaeterAlsDieseWoche } from "../lib/wochenplan";

export type WeekTodoItem = {
  id: string;
  text: string;
  category?: BlockCategory;
  description?: string;
  priority?: TaskPriority;
  estimatedMin?: number;
  /** ISO weekday: 1 = Montag … 7 = Sonntag. */
  plannedDay?: number;
  subjectId?: string;
  /** Konkreter Tag (JJJJ-MM-TT), meist von Hermes — siehe Task.geplantAm. */
  geplantAm?: string;
};

export type SubjectLite = { id: string; name: string; color: string };

/** Everything besides the title a weekly task can carry. Shared by add + edit. */
export type WeekTaskMeta = {
  category?: BlockCategory;
  description?: string;
  priority?: TaskPriority;
  estimatedMin?: number;
  plannedDay?: number;
  subjectId?: string;
};

type EditPatch = WeekTaskMeta & { text?: string };

export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

// Weekly effort leans toward hours (the user plans "wie viele Stunden"), unlike
// the daily list's minute-first chips.
const EFFORT_OPTIONS = [30, 60, 120, 180, 300] as const;

const PRIO_CFG: Record<TaskPriority, { dot: string; label: string }> = {
  dringend: { dot: "var(--crit)", label: "Dringend" },
  wichtig:  { dot: "var(--warn)", label: "Wichtig" },
  normal:   { dot: "var(--text-4)", label: "Normal" },
};

/** Today's ISO weekday (1 = Mo … 7 = So). */
function isoToday(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
}

/** Heute als JJJJ-MM-TT, lokal — passend zu `geplantAm`. */
function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtEffort(min: number): string {
  return min < 60 ? `${min} min` : `${min / 60} h`;
}

function groupByCategory(
  items: WeekTodoItem[],
): { key: BlockCategory | "none"; items: WeekTodoItem[] }[] {
  const map = new Map<BlockCategory | "none", WeekTodoItem[]>();
  for (const it of items) {
    const key = it.category ?? "none";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  const order: (BlockCategory | "none")[] = [...CATEGORY_ORDER, "none"];
  return order
    .filter((k) => map.has(k))
    .map((k) => ({
      key: k,
      // Planned days first (Mo→So), unplanned last — stable within.
      items: [...map.get(k)!].sort((a, b) => (a.plannedDay ?? 8) - (b.plannedDay ?? 8)),
    }));
}

// ── Small shared controls (add form + inline editor) ─────────────────────────

/** Rubrik chips — shared by the add form and the inline editor. */
function CategoryChips({
  selected,
  onSelect,
}: {
  selected: BlockCategory | undefined;
  onSelect: (c: BlockCategory | undefined) => void;
}) {
  return (
    <div className="effort-row">
      <span className="effort-label">Rubrik</span>
      {CATEGORY_ORDER.map((c) => {
        const on = selected === c;
        return (
          <button
            key={c}
            type="button"
            className={"effort-chip" + (on ? " on" : "")}
            style={on ? { background: CATEGORY_META[c].color, color: "var(--on-accent)", borderColor: CATEGORY_META[c].color } : undefined}
            onClick={() => onSelect(on ? undefined : c)}
          >
            {CATEGORY_META[c].emoji} {CATEGORY_META[c].label}
          </button>
        );
      })}
    </div>
  );
}

function DayChips({
  selected,
  onSelect,
}: {
  selected: number | undefined;
  onSelect: (d: number | undefined) => void;
}) {
  const today = isoToday();
  return (
    <div className="effort-row">
      <span className="effort-label">Tag</span>
      {WEEKDAY_SHORT.map((lbl, i) => {
        const d = i + 1;
        const on = selected === d;
        return (
          <button
            key={d}
            type="button"
            className={"effort-chip" + (on ? " on" : "")}
            onClick={() => onSelect(on ? undefined : d)}
            title={d === today ? `${lbl} — heute` : lbl}
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

function EffortChips({
  selected,
  onSelect,
}: {
  selected: number | undefined;
  onSelect: (min: number | undefined) => void;
}) {
  return (
    <div className="effort-row">
      <span className="effort-label">Aufwand</span>
      {EFFORT_OPTIONS.map((m) => {
        const on = selected === m;
        return (
          <button
            key={m}
            type="button"
            className={"effort-chip" + (on ? " on" : "")}
            onClick={() => onSelect(on ? undefined : m)}
          >
            {fmtEffort(m)}
          </button>
        );
      })}
    </div>
  );
}

/** Fach chips — only rendered for lern/uni tasks (a Sport or Privat task has
 *  no Fach), which keeps the form short for everything else. */
function SubjectChips({
  subjects,
  selected,
  onSelect,
}: {
  subjects: SubjectLite[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  if (subjects.length === 0) return null;
  return (
    <div className="effort-row">
      <span className="effort-label">Fach</span>
      {subjects.map((s) => {
        const on = selected === s.id;
        return (
          <button
            key={s.id}
            type="button"
            className={"effort-chip" + (on ? " on" : "")}
            style={on ? { background: s.color, color: "var(--on-accent)", borderColor: s.color } : undefined}
            onClick={() => onSelect(on ? undefined : s.id)}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

/** Priority cycle dot — same interaction as the daily list's prio-dot. */
function PrioCycle({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  const next: TaskPriority = value === "normal" ? "wichtig" : value === "wichtig" ? "dringend" : "normal";
  return (
    <button
      type="button"
      className="prio-dot"
      onClick={() => onChange(next)}
      title={`Priorität: ${PRIO_CFG[value].label} (klicken zum Wechseln)`}
      style={{ background: PRIO_CFG[value].dot }}
    />
  );
}

/** True when a Fach makes sense for the chosen Rubrik. */
function hasSubject(category: BlockCategory | undefined): boolean {
  return category === "lern" || category === "uni";
}

/** The compact tag line under a row's title: prio · Tag · Aufwand · Fach. */
function MetaTags({ it, subjects }: { it: WeekTodoItem; subjects: SubjectLite[] }) {
  const subj = it.subjectId ? subjects.find((s) => s.id === it.subjectId) : undefined;
  const showPrio = it.priority === "dringend" || it.priority === "wichtig";
  if (!showPrio && !it.plannedDay && !it.estimatedMin && !subj && !it.geplantAm) return null;
  const today = isoToday();
  // Erst nach dieser Woche dran → das Datum zeigen; ein Wochentag allein
  // („Do") hiesse hier „diesen Donnerstag" und wäre falsch.
  const spaeter = spaeterAlsDieseWoche(it.geplantAm, heuteIso());
  return (
    <span className="week-meta">
      {it.priority === "dringend" && <span className="tag-crit">dringend</span>}
      {it.priority === "wichtig" && <span className="tag-warn">wichtig</span>}
      {spaeter && it.geplantAm && <span className="tag-geplant">{kurzesDatum(it.geplantAm)}</span>}
      {!spaeter && it.plannedDay && (
        <span className={it.plannedDay === today ? "tag-today" : undefined}>
          {it.plannedDay === today ? "heute" : WEEKDAY_SHORT[it.plannedDay - 1]}
        </span>
      )}
      {it.estimatedMin && <span>{fmtEffort(it.estimatedMin)}</span>}
      {subj && (
        <span>
          <span className="subj-dot" style={{ background: subj.color }} aria-hidden="true" />
          {subj.name}
        </span>
      )}
    </span>
  );
}

/** "Diese Woche" — the weekly todo backlog, grouped by Rubrik. Each item can
 *  carry a free-text description ("worum geht's"), a priority, an effort
 *  estimate, a planned weekday and a Fach. Items leave here by being pushed
 *  into the daily list (drag onto "Was heute zählt", or the "→ Heute" button)
 *  — never by completing them directly. */
export function WeekTodosCard({
  items,
  subjects,
  onAdd,
  onPush,
  onDelete,
  onEdit,
  embedded = false,
  hinweise,
}: {
  items: WeekTodoItem[];
  subjects: SubjectLite[];
  /** Als Spalte in der gemeinsamen Aufgabenkarte statt als eigene Karte. */
  embedded?: boolean;
  /** Empfehlungen pro Aufgabe (lib/empfehlung.ts) — zeigt an der Zeile,
   *  was Daily rät, und hebt „→ Heute" hervor, wenn es heute rein sollte. */
  hinweise?: Map<string, { art: string; grund: string }>;
  onAdd: (text: string, meta: WeekTaskMeta) => void;
  onPush: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: EditPatch) => void;
}) {
  const [draft, setDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [category, setCategory] = useState<BlockCategory | undefined>(undefined);
  const [prio, setPrio] = useState<TaskPriority>("normal");
  const [estimate, setEstimate] = useState<number | undefined>(undefined);
  const [day, setDay] = useState<number | undefined>(undefined);
  const [subjectId, setSubjectId] = useState<string | undefined>(undefined);

  // Inline editor state — null when nothing is being edited.
  const [editingState, setEditing] = useState<
    | {
        id: string;
        text: string;
        description: string;
        category: BlockCategory | undefined;
        priority: TaskPriority;
        estimatedMin: number | undefined;
        plannedDay: number | undefined;
        subjectId: string | undefined;
      }
    | null
  >(null);

  // Was erst nach dieser Woche dran ist, steht unten für sich — „Diese Woche"
  // soll zeigen, was diese Woche zu tun ist, nicht alles, was je geplant wurde.
  const heute = heuteIso();
  const dieseWoche = items.filter((it) => !spaeterAlsDieseWoche(it.geplantAm, heute));
  const spaeter = items
    .filter((it) => spaeterAlsDieseWoche(it.geplantAm, heute))
    .sort((a, b) => (a.geplantAm ?? "").localeCompare(b.geplantAm ?? ""));
  const groups = groupByCategory(dieseWoche);
  const editing = editingState;

  const beginEdit = (it: WeekTodoItem) =>
    setEditing({
      id: it.id,
      text: it.text,
      description: it.description ?? "",
      category: it.category,
      priority: it.priority ?? "normal",
      estimatedMin: it.estimatedMin,
      plannedDay: it.plannedDay,
      subjectId: it.subjectId,
    });

  const saveEdit = () => {
    if (!editing) return;
    onEdit(editing.id, {
      text: editing.text,
      description: editing.description,
      category: editing.category,
      priority: editing.priority === "normal" ? undefined : editing.priority,
      estimatedMin: editing.estimatedMin,
      plannedDay: editing.plannedDay,
      subjectId: hasSubject(editing.category) ? editing.subjectId : undefined,
    });
    setEditing(null);
  };


  /** Der Editor — gleich für „Diese Woche" und „Später geplant". */
  const editorFuer = (editing: NonNullable<typeof editingState>) => (
    <li key={editing.id} className="week-row week-row-editing">
      <div className="week-edit">
        <div className="week-edit-head">
          <PrioCycle value={editing.priority} onChange={(p) => setEditing({ ...editing, priority: p })} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            className="week-edit-title"
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
            placeholder="Aufgabe…"
          />
        </div>
        <textarea
          className="week-edit-desc"
          value={editing.description}
          onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
          placeholder="Worum geht's? (optional)"
          rows={2}
        />
        <CategoryChips
          selected={editing.category}
          onSelect={(c) => setEditing({ ...editing, category: c })}
        />
        <DayChips
          selected={editing.plannedDay}
          onSelect={(d) => setEditing({ ...editing, plannedDay: d })}
        />
        <EffortChips
          selected={editing.estimatedMin}
          onSelect={(m) => setEditing({ ...editing, estimatedMin: m })}
        />
        {hasSubject(editing.category) && (
          <SubjectChips
            subjects={subjects}
            selected={editing.subjectId}
            onSelect={(id) => setEditing({ ...editing, subjectId: id })}
          />
        )}
        <div className="week-edit-actions">
          <button type="button" className="week-save" data-sound="confirm" onClick={saveEdit}>Speichern</button>
          <button type="button" className="week-cancel" data-sound="dismiss" onClick={() => setEditing(null)}>Abbrechen</button>
        </div>
      </div>
    </li>
  );

  /** Eine Zeile — dieselbe für „Diese Woche" und „Später geplant". */
  const zeileFuer = (it: WeekTodoItem) => {
    const h = hinweise?.get(it.id);
    return (
    <li
      key={it.id}
      className={"week-row" + (h ? ` empf-${h.art}` : "")}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/todo-id", it.id)}
    >
      <div className="week-main">
        <button type="button" className="week-text-btn" onClick={() => beginEdit(it)} title="Bearbeiten">
          <span className="text">{it.text}</span>
          {it.description?.trim() && <span className="desc">{it.description.trim()}</span>}
          <MetaTags it={it} subjects={subjects} />
          {h && (
            <span className="week-empf">
              {h.art === "heute" ? "↑ heute empfohlen" : h.art === "streichen" ? "streichen?" : h.art} · {h.grund}
            </span>
          )}
        </button>
      </div>
      <span className="row-actions">
        <button type="button" className={"push-btn" + (h?.art === "heute" ? " empfohlen" : "")} data-sound="confirm" onClick={() => onPush(it.id)}>
          → Heute
        </button>
        <button
          type="button"
          className="focus-del"
          data-sound="dismiss"
          style={{ position: "static", opacity: 1 }}
          onClick={() => onDelete(it.id)}
          title="Löschen"
          aria-label="Löschen"
        >
          ✕
        </button>
      </span>
    </li>
    );
  };

  return (
    <div className={embedded ? "aufg-spalte" : "card span-12"} id="week-todos">
      <div className="card-head">
        <span className="ttl">Diese Woche</span>
        <span className="right">{dieseWoche.length} offen{spaeter.length > 0 ? ` · ${spaeter.length} später` : ""}</span>
      </div>

      {dieseWoche.length === 0 && (
        <div className="empty-row">Die Woche ist noch unbeschrieben. Was soll rein?</div>
      )}

      {groups.length > 0 && (
        <div className="week-groups">
          {groups.map((g) => (
            <div className="week-group" key={g.key}>
              <div className="week-group-head">
                <span
                  className="dot"
                  style={{ background: g.key === "none" ? "var(--text-4)" : CATEGORY_META[g.key].color }}
                  aria-hidden="true"
                />
                <span>{g.key === "none" ? "Ohne Rubrik" : CATEGORY_META[g.key].label}</span>
                <span className="count">{g.items.length}</span>
              </div>
              <ul className="week-list">
                {g.items.map((it) =>
                  editing?.id === it.id ? (
                    editorFuer(editing)
                  ) : (
                    zeileFuer(it)
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {spaeter.length > 0 && (
        <details className="week-spaeter">
          <summary>
            Später geplant <span className="count">{spaeter.length}</span>
          </summary>
          <ul className="week-list">
            {spaeter.map((it) => (editing?.id === it.id ? editorFuer(editing) : zeileFuer(it)))}
          </ul>
        </details>
      )}

      <form
        className="focus-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(draft, {
            category,
            description: descDraft,
            priority: prio === "normal" ? undefined : prio,
            estimatedMin: estimate,
            plannedDay: day,
            subjectId: hasSubject(category) ? subjectId : undefined,
          });
          setDraft("");
          setDescDraft("");
          setCategory(undefined);
          setPrio("normal");
          setEstimate(undefined);
          setDay(undefined);
          setSubjectId(undefined);
        }}
      >
        <div className="focus-add">
          <PrioCycle value={prio} onChange={setPrio} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Für die Woche hinzufügen…" />
          <button type="submit" className="add-btn" disabled={!draft.trim()} aria-label="Zur Woche hinzufügen" data-sound="confirm">+</button>
        </div>
        <textarea
          className="week-desc-input"
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          placeholder="Worum geht's? (optional) — was genau zu tun ist"
          rows={2}
        />
        <CategoryChips selected={category} onSelect={setCategory} />
        <DayChips selected={day} onSelect={setDay} />
        <EffortChips selected={estimate} onSelect={setEstimate} />
        {hasSubject(category) && (
          <SubjectChips subjects={subjects} selected={subjectId} onSelect={setSubjectId} />
        )}
      </form>
    </div>
  );
}
