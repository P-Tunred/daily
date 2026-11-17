// Aus einem Kalendertermin einen Stundenplan-Block machen.
//
// Stand vorher in CalendarPlanner.tsx. Seit der Morgendialog dieselbe Umwandlung
// braucht, liegt sie hier: zwei Kopien derselben Regel laufen auseinander, und
// zwar genau dann, wenn jemand eine davon anpasst und die andere vergisst.

import type { CalendarEvent } from "../types";
import type { StudyBlock } from "../tracker/types";
import { isoDate } from "../tracker/store";
import { calToBlockCategory } from "./calendarTags";

/** Ganztägige Termine bekommen keinen Block — sie haben keinen Platz im Raster.
 *  Die Entscheidung darüber wird trotzdem gemerkt. */
export function eventToBlock(
  e: CalendarEvent,
): (Omit<StudyBlock, "id"> & { fromEventId: string }) | null {
  if (e.allDay) return null;
  const start = new Date(e.start);
  if (Number.isNaN(start.getTime())) return null;
  const end = e.end ? new Date(e.end) : null;
  let dur = end && !Number.isNaN(end.getTime()) ? Math.round((+end - +start) / 60000) : 60;
  if (!(dur > 0)) dur = 60;
  dur = Math.min(dur, 12 * 60);
  const snap = (m: number) => Math.round(m / 30) * 30;
  return {
    date: isoDate(start),
    startMin: snap(start.getHours() * 60 + start.getMinutes()),
    durationMin: Math.max(30, snap(dur)),
    source: "user",
    category: calToBlockCategory(e.calendar),
    note: e.title,
    fromEventId: e.id,
    calendar: e.calendar,
  };
}
