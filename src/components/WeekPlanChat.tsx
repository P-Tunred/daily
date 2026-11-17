import { useCallback, useMemo, useState } from "react";
import { anthropicMessages, aiEnabled } from "../lib/anthropic";
import type { CalendarEvent } from "../types";
import type { BlockCategory, StudyBlock } from "../tracker/types";
import { isoDate, useTracker } from "../tracker/store";
import { hideCalendarEvent, unhideCalendarEvent, matchEventIdsByTitle } from "../lib/hiddenEvents";

// ── AI: routed through the local /api/anthropic proxy (key stays server-side) ──

// ── Action schema ─────────────────────────────────────────────────────────────

type AddBlockAction = {
  type: "addBlock";
  date: string;
  startMin: number;
  durationMin: number;
  category?: BlockCategory;
  subjectId?: string;
  note?: string;
};
type MoveBlockAction = {
  type: "moveBlock";
  blockId: string;
  date?: string;
  startMin?: number;
};
type UpdateBlockAction = {
  type: "updateBlock";
  blockId: string;
  patch: Partial<Omit<StudyBlock, "id">>;
};
type DeleteBlockAction = { type: "deleteBlock"; blockId: string };
type SetGoalAction = { type: "setGoal"; date: string; minutes: number };
/** Hide a calendar (Google/iCal) event from the calendar — "ignorieren". */
type HideEventAction = { type: "hideEvent"; title: string };
/** Bring a previously ignored calendar event back — "doch hingehen". */
type UnhideEventAction = { type: "unhideEvent"; title: string };
type SetPrefAction = {
  type: "setPreference";
  /** "blockSizeMin" | "breakSizeMin" | "note" — note = free-form Erinnerung */
  key: string;
  /** Number for sizes, string for free notes */
  value: number | string;
};

type Action = AddBlockAction | MoveBlockAction | UpdateBlockAction | DeleteBlockAction | SetGoalAction | SetPrefAction | HideEventAction | UnhideEventAction;

type ChatResponse = { actions: Action[]; reply: string };

// ── Persistent preferences (shape Jarvis can write to via setPreference) ──────

const PREFS_KEY = "morning.weekPlan.prefs";

type WeekPlanPrefs = {
  /** Length of a single auto-placed lern block in minutes. Default 60. */
  blockSizeMin?: number;
  /** Length of break inserted between auto blocks. Default 0 (no gap). */
  breakSizeMin?: number;
  /** Free-form notes Paul stated; Jarvis echoes them back in future replies. */
  notes?: string[];
};

function loadPrefs(): WeekPlanPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as WeekPlanPrefs) : {};
  } catch {
    return {};
  }
}

function savePrefs(p: WeekPlanPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const minToHHMM = (min: number): string =>
  `${Math.floor(min / 60).toString().padStart(2, "0")}:${(min % 60).toString().padStart(2, "0")}`;

function buildSystemPrompt(params: {
  today: string;
  weekIsos: string[];
  blocks: StudyBlock[];
  events: CalendarEvent[];
  subjects: { id: string; name: string }[];
  goalsByDay: { iso: string; goalMin: number }[];
  wakeTime: string;
  sleepTime: string;
  prefs: WeekPlanPrefs;
}): string {
  const { today, weekIsos, blocks, events, subjects, goalsByDay, wakeTime, sleepTime, prefs } = params;

  const subjLines = subjects.map((s) => `  ${s.id} = ${s.name}`).join("\n") || "  (keine Fächer angelegt)";

  const goalLines = goalsByDay
    .map((g) => `  ${g.iso}: ${Math.round(g.goalMin / 60 * 10) / 10}h Tagesziel`)
    .join("\n");

  const blockLines = blocks
    .filter((b) => weekIsos.includes(b.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
    .map((b) => {
      const cat = b.category ?? "lern";
      const subj = subjects.find((s) => s.id === b.subjectId)?.name ?? "—";
      const tag = b.source === "auto" ? "Vorschlag" : "fest";
      const noteStr = b.note ? ` "${b.note}"` : "";
      return `  ${b.id}  ${b.date} ${minToHHMM(b.startMin)}-${minToHHMM(b.startMin + b.durationMin)}  ${cat}/${subj}  [${tag}]${noteStr}`;
    })
    .join("\n") || "  (keine Blöcke in dieser Woche)";

  const eventLines = events
    .filter((e) => {
      const eIso = isoDate(new Date(e.start));
      return weekIsos.includes(eIso);
    })
    .sort((a, b) => +new Date(a.start) - +new Date(b.start))
    .slice(0, 20)
    .map((e) => {
      const d = new Date(e.start);
      const eIso = isoDate(d);
      const tStr = e.allDay ? "ganztägig" : minToHHMM(d.getHours() * 60 + d.getMinutes());
      return `  ${eIso} ${tStr} — ${e.title}`;
    })
    .join("\n") || "  (keine Termine)";

  const prefLines: string[] = [];
  if (prefs.blockSizeMin) prefLines.push(`  Lernblock-Länge: ${prefs.blockSizeMin} min`);
  if (prefs.breakSizeMin) prefLines.push(`  Pause zwischen Blöcken: ${prefs.breakSizeMin} min`);
  if (prefs.notes && prefs.notes.length > 0) {
    prefLines.push(`  Notizen: ${prefs.notes.map((n) => `"${n}"`).join("; ")}`);
  }
  const prefBlock = prefLines.length > 0 ? prefLines.join("\n") : "  (keine gespeichert)";

  return `Du bist Jarvis. Paul redet mit dir über seinen Wochenplan und du übersetzt seine Wünsche in strukturierte Aktionen.

Heute ist ${today}. Diese Woche umfasst ${weekIsos[0]} bis ${weekIsos[6]}.
Aufwachen: ${wakeTime}, Schlafen: ${sleepTime}.

Verfügbare Fächer (ID = Name):
${subjLines}

Tagesziele dieser Woche:
${goalLines}

Bestehende Blöcke dieser Woche (Format: id  datum start-ende  kategorie/fach  [source] "note"):
${blockLines}

Kalender-Termine dieser Woche:
${eventLines}

Pauls gespeicherte Präferenzen (gelten dauerhaft):
${prefBlock}

──────────────────────────────────────────────────────────────────────
DEINE AUFGABE:
Paul redet mit dir frei. Antworte IMMER mit EINEM einzigen JSON-Objekt — niemals nur Fließtext, niemals Markdown drumherum.

{
  "actions": [
    { "type": "addBlock", "date": "YYYY-MM-DD", "startMin": <0..1440>, "durationMin": <30..240>, "category": "lern"|"uni"|"privat"|"sport"|"sonstiges", "subjectId": "<id oder weglassen>", "note": "<optional>" },
    { "type": "moveBlock", "blockId": "<id>", "date": "YYYY-MM-DD?", "startMin": <0..1440>? },
    { "type": "updateBlock", "blockId": "<id>", "patch": { "durationMin": 90, "category": "sport", "subjectId": "...", "note": "..." } },
    { "type": "deleteBlock", "blockId": "<id>" },
    { "type": "setGoal", "date": "YYYY-MM-DD", "minutes": <0..720> },
    { "type": "setPreference", "key": "blockSizeMin"|"breakSizeMin"|"note", "value": <Zahl oder String> },
    { "type": "hideEvent", "title": "<Titel eines Kalender-Termins>" },
    { "type": "unhideEvent", "title": "<Titel eines Kalender-Termins>" }
  ],
  "reply": "<1-3 kurze Sätze auf Deutsch>"
}

REGELN:
- IMMER JSON ausgeben. Auch wenn Paul nur eine Frage stellt oder etwas erzählt: actions: [], reply trägt die Antwort.
- startMin = Minuten ab Mitternacht (z.B. 9:30 Uhr = 570, 18:00 = 1080). Snap auf 30-Min-Schritte.
- durationMin in 30-Min-Schritten, normalerweise 30/60/90/120.
- Wochentags-Wörter: heute = ${today}, sonst die nächsten 7 Tage.
- Bei moveBlock: nur die zu ändernden Felder angeben (date ODER startMin oder beide).
- Wenn unklar welcher Block gemeint ist (z.B. mehrere Lernblöcke an einem Tag), frag in reply nach — actions: [].
- subjectId IMMER aus der ID-Liste oben verwenden, nicht erfinden.
- Bei "Sport"/"Treffen"/"Privat" etc.: category passend wählen, KEIN subjectId.
- KALENDER-TERMINE IGNORIEREN: "ignorier den Termin X", "ich geh nicht zu X", "blende X aus", "lösch X aus dem Kalender", "X brauch ich nicht" → { "type": "hideEvent", "title": "X" } (Titel aus der Kalender-Terminliste oben). "ich geh doch zu X" / "hol X zurück" / "blende X wieder ein" → { "type": "unhideEvent", "title": "X" }. Das blendet den Termin nur lokal aus dem Kalender aus — der echte Google-Kalender bleibt unangetastet.

PRÄFERENZEN (DAUERHAFT):
- Wenn Paul ein VERHALTENSMUSTER nennt ("plane immer 50min mit 10min Pause", "lass freitags abends frei" usw.) → benutze setPreference:
  * "ich lerne 50 min mit 10 min Pause" → { "type": "setPreference", "key": "blockSizeMin", "value": 50 } + { "type": "setPreference", "key": "breakSizeMin", "value": 10 }
  * Sonstige Regeln/Erinnerungen → { "type": "setPreference", "key": "note", "value": "<kurzer Hinweis>" }
- Reply danach: bestätige die gespeicherte Regel in 1 Satz.

Antworte trocken-direkt, kein Blabla.`;
}

/** Always returns a usable ChatResponse — never null. If JSON parsing fails,
 *  the raw text becomes the reply with zero actions. So Paul always sees
 *  Jarvis's answer, even when he asked a question or stated a preference
 *  instead of issuing an action. */
function parseResponse(raw: string): ChatResponse {
  let s = raw.trim();
  // Strip ```json fences if present
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) s = fenced[1].trim();
  // Try to find a JSON object
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(s.slice(start, end + 1));
      if (typeof obj === "object" && obj !== null) {
        return {
          actions: Array.isArray(obj.actions) ? obj.actions : [],
          reply: typeof obj.reply === "string" && obj.reply.length > 0
            ? obj.reply
            : raw.trim(),
        };
      }
    } catch {
      /* fall through to plain-text fallback */
    }
  }
  // Fallback — treat raw text as conversational reply
  return { actions: [], reply: raw.trim() || "(leere Antwort)" };
}

// ── Component ─────────────────────────────────────────────────────────────────

type Message = { role: "user" | "assistant"; text: string };

type Props = {
  weekStart: Date;
  calendarEvents: CalendarEvent[];
  /** Per-day goal minutes (length 7, Mo..So). */
  goalsByDay: number[];
};

export function WeekPlanChat({ weekStart, calendarEvents, goalsByDay }: Props) {
  const {
    studyBlocks,
    subjects,
    wakeTime,
    sleepTime,
    addStudyBlock,
    updateStudyBlock,
    deleteStudyBlock,
    setGoalOverride,
  } = useTracker();

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekIsos = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return isoDate(d);
    });
  }, [weekStart]);

  const applyAction = useCallback(
    (a: Action): void => {
      switch (a.type) {
        case "addBlock": {
          if (!a.date || typeof a.startMin !== "number" || typeof a.durationMin !== "number") return;
          addStudyBlock({
            date: a.date,
            startMin: Math.round(a.startMin / 30) * 30,
            durationMin: Math.max(30, Math.round(a.durationMin / 30) * 30),
            source: "user",
            category: a.category ?? "lern",
            subjectId: a.subjectId,
            note: a.note,
          });
          return;
        }
        case "moveBlock": {
          if (!a.blockId) return;
          const patch: Partial<Omit<StudyBlock, "id">> = { source: "user" };
          if (a.date) patch.date = a.date;
          if (typeof a.startMin === "number") patch.startMin = Math.round(a.startMin / 30) * 30;
          updateStudyBlock(a.blockId, patch);
          return;
        }
        case "updateBlock": {
          if (!a.blockId || !a.patch) return;
          const patch = { ...a.patch, source: "user" as const };
          if (typeof patch.startMin === "number") patch.startMin = Math.round(patch.startMin / 30) * 30;
          if (typeof patch.durationMin === "number") patch.durationMin = Math.max(30, Math.round(patch.durationMin / 30) * 30);
          updateStudyBlock(a.blockId, patch);
          return;
        }
        case "deleteBlock": {
          if (!a.blockId) return;
          deleteStudyBlock(a.blockId);
          return;
        }
        case "setGoal": {
          if (!a.date || typeof a.minutes !== "number") return;
          setGoalOverride(a.date, Math.max(0, Math.round(a.minutes)));
          return;
        }
        case "setPreference": {
          if (!a.key) return;
          const prefs = loadPrefs();
          if (a.key === "blockSizeMin" && typeof a.value === "number") {
            prefs.blockSizeMin = Math.max(15, Math.min(120, Math.round(a.value / 5) * 5));
          } else if (a.key === "breakSizeMin" && typeof a.value === "number") {
            prefs.breakSizeMin = Math.max(0, Math.min(30, Math.round(a.value / 5) * 5));
          } else if (a.key === "note" && typeof a.value === "string") {
            prefs.notes = [...(prefs.notes ?? []), a.value].slice(-12);
          }
          savePrefs(prefs);
          // Notify the timeline so it re-runs the auto-planner with new prefs
          window.dispatchEvent(new Event("morning:weekplan-prefs-change"));
          return;
        }
        case "hideEvent": {
          if (!a.title) return;
          for (const id of matchEventIdsByTitle(a.title, calendarEvents)) hideCalendarEvent(id);
          return;
        }
        case "unhideEvent": {
          if (!a.title) return;
          for (const id of matchEventIdsByTitle(a.title, calendarEvents)) unhideCalendarEvent(id);
          return;
        }
      }
    },
    [addStudyBlock, updateStudyBlock, deleteStudyBlock, setGoalOverride, calendarEvents],
  );

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    if (!aiEnabled) {
      setError("KI ist deaktiviert — ANTHROPIC_API_KEY in .env setzen (und VITE_AI_ENABLED=1).");
      return;
    }

    setError(null);
    setLoading(true);

    // Add user message immediately
    const userMsg: Message = { role: "user", text: trimmed };
    setHistory((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const system = buildSystemPrompt({
        today: isoDate(),
        weekIsos,
        blocks: studyBlocks,
        events: calendarEvents,
        subjects: subjects.map(({ id, name }) => ({ id, name })),
        goalsByDay: weekIsos.map((iso, i) => ({ iso, goalMin: goalsByDay[i] ?? 0 })),
        wakeTime,
        sleepTime,
        prefs: loadPrefs(),
      });

      const res = await anthropicMessages({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        system,
        messages: [
          // Include last 3 turns for context continuity
          ...history.slice(-6).map((m) => ({ role: m.role, content: m.text })),
          { role: "user" as const, content: trimmed },
        ],
      });

      const block = res.content[0];
      const raw = (block && block.type === "text" ? block.text : "") ?? "";
      const parsed = parseResponse(raw);

      // Apply any actions Jarvis returned
      for (const a of parsed.actions) applyAction(a);
      const tagLine = parsed.actions.length > 0
        ? ` (${parsed.actions.length} Aktion${parsed.actions.length === 1 ? "" : "en"} ausgeführt)`
        : "";
      setHistory((prev) => [...prev, { role: "assistant", text: parsed.reply + tagLine }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }, [input, loading, history, weekIsos, studyBlocks, calendarEvents, subjects, goalsByDay, wakeTime, sleepTime, applyAction]);

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");

  return (
    <div className="mt-4 rounded-card-sm" style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      padding: 12,
    }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="wp-zeichen" style={{ color: "var(--color-accent)" }}>✦</span>
        <span className="font-display font-semibold text-[12px] text-fg">Mit Hermes besprechen</span>
        <span className="font-mono text-[10px] text-fg-tertiary">· er ändert direkt im Plan</span>
      </div>

      {/* Latest assistant reply, if any */}
      {lastAssistant && (
        <div
          className="text-[12px] text-fg-secondary leading-relaxed mb-2 px-3 py-2 rounded-md"
          style={{ background: "rgba(122, 162, 255, 0.06)", border: "1px solid rgba(122, 162, 255, 0.15)" }}
        >
          {lastAssistant.text}
        </div>
      )}
      {error && (
        <div className="text-[11px] mb-2" style={{ color: "var(--crit)" }}>{error}</div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='z.B. "leg Sport am Mi 18-19 Uhr" · "verschieb meinen Donnerstags-Block auf 16 Uhr" · "Mittwoch nur 1h lernen"'
          className="field flex-1"
          style={{ fontSize: 12 }}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="rounded-full px-4 py-2 text-[11px] font-display font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "var(--color-accent)",
            color: "white",
            border: "none",
          }}
        >
          {loading ? "⏳" : "↑ Senden"}
        </button>
      </form>

      {history.length > 0 && (
        <details className="mt-2">
          <summary className="font-mono text-[10px] text-fg-tertiary cursor-pointer hover:text-fg-secondary flex items-center justify-between">
            <span>Verlauf ({history.length} Nachrichten)</span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setHistory([]);
              }}
              className="text-fg-tertiary hover:text-fg-secondary"
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
              }}
              title="Lösche den Chat-Verlauf"
            >
              ✕ Verlauf löschen
            </button>
          </summary>
          <div className="flex flex-col gap-1.5 mt-2 max-h-40 overflow-y-auto">
            {history.map((m, i) => (
              <div
                key={i}
                className="text-[11px] leading-relaxed px-2 py-1.5 rounded"
                style={{
                  background: m.role === "user"
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(122, 162, 255, 0.06)",
                  color: m.role === "user" ? "var(--text-2)" : "var(--text-1)",
                }}
              >
                <span className="font-mono text-[9px] uppercase tracking-widest opacity-50 mr-2">
                  {m.role === "user" ? "Du" : "Hermes"}
                </span>
                {m.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
