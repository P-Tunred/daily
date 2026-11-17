/**
 * Scans upcoming Google Calendar events for exams and birthdays and syncs
 * them into the ImportantEvents store automatically.
 *
 * IDs are prefixed with "gcal-" so they can be identified and updated without
 * creating duplicates. The user can delete them manually — they re-appear on
 * next reload only if the calendar event still exists in the future.
 */

import { useEffect } from "react";
import { useImportantEvents } from "./store";
import type { EventKind } from "./types";

interface RawCalEvent {
  id: string;
  title: string;
  start: string;
  allDay?: boolean;
}

// Keywords that identify each kind (case-insensitive)
const EXAM_RE = /klausur|prüfung|prüf|exam|abitur|abi\b|hausarbeit|abgabe|referat/i;
const BDAY_RE = /geburtstag|birthday|bday|geb\./i;

function detectKind(title: string): EventKind | null {
  if (BDAY_RE.test(title)) return "birthday";
  if (EXAM_RE.test(title)) return "exam";
  return null;
}

function toDateString(isoStart: string): string {
  return new Date(isoStart).toLocaleDateString("sv-SE", {
    timeZone: "Europe/Berlin",
  });
}

export function useCalendarSync() {
  const { events, addEvent, deleteEvent } = useImportantEvents();

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const res = await fetch("/api/calendar/upcoming");
        if (!res.ok || cancelled) return;
        const raw = (await res.json()) as RawCalEvent[] | null;
        if (!raw || cancelled) return;

        // Detect relevant events
        const detected = raw.flatMap((ev) => {
          const kind = detectKind(ev.title);
          if (!kind) return [];
          return [{
            id: `gcal-${ev.id}`,
            kind,
            title: ev.title,
            date: toDateString(ev.start),
            recurringYearly: kind === "birthday" ? true : undefined,
          }];
        });

        const existingGcal = events.filter((e) => e.id.startsWith("gcal-"));
        const existingIds = new Set(existingGcal.map((e) => e.id));
        const detectedIds = new Set(detected.map((d) => d.id));

        // Load tombstones — gcal- IDs the user explicitly deleted; never re-add these
        const tombstones = new Set<string>(
          JSON.parse(localStorage.getItem("morning.important.gcal-tombstones") ?? "[]") as string[]
        );

        // Add new (skip tombstoned IDs)
        for (const d of detected) {
          if (!existingIds.has(d.id) && !tombstones.has(d.id)) {
            addEvent(
              { kind: d.kind, title: d.title, date: d.date, recurringYearly: d.recurringYearly },
              d.id,
            );
          }
        }

        // Remove ones no longer in calendar (past / deleted from Google Calendar)
        for (const ex of existingGcal) {
          if (!detectedIds.has(ex.id)) {
            deleteEvent(ex.id);
          }
        }

        // NOTE: We intentionally do NOT revert user edits (date/title changes) back
        // to calendar values — the user owns their data once it's in the store.
      } catch {
        // No live calendar — skip silently
      }
    }

    sync();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
