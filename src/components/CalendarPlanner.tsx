import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "../types";
import { Card } from "./Card";
import { useTracker } from "../tracker/store";
import { calColor, calLabel } from "../lib/calendarTags";
import {
  useCalendarDecisions,
  setSeriesDecision,
  markProcessed,
  unmarkProcessed,
  seriesUid,
  type Decision,
} from "../lib/calendarDecisions";
// Die Umwandlung Termin -> Block liegt gemeinsam in lib/eventBlock.ts:
// zwei Kopien derselben Regel laufen auseinander, sobald jemand eine anpasst.
import { eventToBlock } from "../lib/eventBlock";

type SeriesRow = {
  uid: string;
  title: string;
  calendar?: string;
  next: CalendarEvent;
  count: number;
  decision?: Decision;
};

const DAY = 86_400_000;

function fmtNext(e: CalendarEvent): string {
  const d = new Date(e.start.length === 10 ? e.start + "T12:00:00" : e.start);
  const day = d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  if (e.allDay) return `${day} · ganztägig`;
  return `${day} · ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

export function CalendarPlanner({ events }: { events: CalendarEvent[] }) {
  const { ensureEventBlock, removeEventBlock } = useTracker();
  const { decisions, processed } = useCalendarDecisions();
  const [dismissed, setDismissed] = useState(false);

  // ── 1) Auto-materialize occurrences of already-decided series ──────────────────
  useEffect(() => {
    const toProcess: string[] = [];
    for (const e of events) {
      if (processed.has(e.id)) continue;
      const d = decisions[seriesUid(e.id)];
      if (!d) continue; // undecided → handled by the prompt below
      if (d === "attend") {
        const blk = eventToBlock(e);
        if (blk) ensureEventBlock(blk); // idempotent (dedupes on fromEventId)
      }
      toProcess.push(e.id); // attended (block ensured) or skipped → done
    }
    if (toProcess.length) markProcessed(toProcess);
  }, [events, decisions, processed, ensureEventBlock]);

  // ── 2) Build series rows ──────────────────────────────────────────────────────
  const bySeries = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const uid = seriesUid(e.id);
      if (!map.has(uid)) map.set(uid, []);
      map.get(uid)!.push(e);
    }
    const rows: SeriesRow[] = [];
    for (const [uid, list] of map) {
      list.sort((a, b) => +new Date(a.start) - +new Date(b.start));
      const next = list.find((e) => +new Date(e.start) >= now - DAY) ?? list[0];
      rows.push({ uid, title: next.title, calendar: next.calendar, next, count: list.length, decision: decisions[uid] });
    }
    return rows.sort((a, b) => +new Date(a.next.start) - +new Date(b.next.start));
  }, [events, decisions]);

  // Only series without a decision ever show up here — once you've said
  // "Hingehen" or "Überspringen", that series is done, permanently. New
  // occurrences of an already-decided series are auto-materialized/skipped
  // silently by the effect above, never re-asked (was previously broken: a
  // "weekly review" mode re-surfaced already-decided series for no reason).
  const pending = bySeries.filter((r) => !r.decision);
  // Chunk a large first-run backlog: decide a handful, the next batch appears next.
  const MAX_ROWS = 8;
  const rows = pending.slice(0, MAX_ROWS);
  const moreRows = pending.length - rows.length;

  if (dismissed || rows.length === 0) return null;

  // ── 3) Decision handlers ──────────────────────────────────────────────────────
  function occIdsOf(uid: string): string[] {
    return events.filter((e) => seriesUid(e.id) === uid).map((e) => e.id);
  }
  function decide(uid: string, decision: Decision) {
    const ids = occIdsOf(uid);
    if (decision === "attend") {
      unmarkProcessed(ids); // let the effect (re)create the blocks
      setSeriesDecision(uid, "attend");
    } else {
      for (const id of ids) removeEventBlock(id); // pull any existing blocks
      setSeriesDecision(uid, "skip");
      markProcessed(ids);
    }
  }

  const subtitle = `${pending.length} neue${pending.length === 1 ? "r Termin" : " Termine"} — in deinen Stundenplan?`;

  return (
    <Card title="Stundenplan-Check" icon="🧭" meta="neu">
      <p className="text-[12px] mb-3" style={{ color: "var(--text-3)" }}>{subtitle}</p>

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const tag = calLabel(r.calendar);
          const tagColor = calColor(r.calendar);
          return (
            <li
              key={r.uid}
              className="flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5"
              style={{ background: "var(--ink-3)" }}
            >
              <span className="inline-block rounded-full shrink-0" style={{ width: 8, height: 8, background: tagColor }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-medium truncate" style={{ fontSize: "13px", color: "var(--text-1)" }}>
                  {r.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2" style={{ fontSize: "11px", color: "var(--text-4)" }}>
                  {tag && <span style={{ color: "var(--text-3)" }}>{tag}</span>}
                  <span>{fmtNext(r.next)}</span>
                  {r.count > 1 && <span>· {r.count}×</span>}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => decide(r.uid, "attend")}
                  aria-pressed={r.decision === "attend"}
                  data-sound="confirm"
                  className="rounded-full px-2.5 py-1 transition-colors"
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase",
                    border: `1px solid ${r.decision === "attend" ? "var(--accent)" : "var(--line-2)"}`,
                    color: r.decision === "attend" ? "var(--on-accent)" : "var(--text-2)",
                    background: r.decision === "attend" ? "var(--accent)" : "transparent",
                  }}
                >
                  Hingehen
                </button>
                <button
                  type="button"
                  onClick={() => decide(r.uid, "skip")}
                  aria-pressed={r.decision === "skip"}
                  data-sound="dismiss"
                  className="rounded-full px-2.5 py-1 transition-colors"
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase",
                    border: `1px solid ${r.decision === "skip" ? "var(--text-3)" : "var(--line-2)"}`,
                    color: r.decision === "skip" ? "var(--text-1)" : "var(--text-3)",
                    background: r.decision === "skip" ? "var(--line-2)" : "transparent",
                  }}
                >
                  Überspringen
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {moreRows > 0 && (
        <p className="mt-2 text-center" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-4)" }}>
          +{moreRows} weitere — erscheinen nach deiner Wahl
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full px-3 py-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", border: "1px solid var(--line-1)" }}
        >
          Später
        </button>
      </div>
    </Card>
  );
}
