import type { CalendarEvent, Email, Task } from "../types";

/**
 * Mock calendar events — dates are always relative to today so the card
 * stays current without needing to re-pull from Google Calendar.
 *
 * Times are kept as-is (10:00, 13:30, 15:00) but the date portion is
 * replaced with today's ISO date at runtime.
 *
 * To wire real data: set USE_MOCKS=false in src/lib/mcp.ts and provide
 * real Google Calendar MCP credentials.
 */
function todayAt(hhmm: string): string {
  const now = new Date();
  const [h, m] = hhmm.split(":").map(Number);
  now.setHours(h, m, 0, 0);
  return now.toISOString();
}

export const MOCK_EVENTS: CalendarEvent[] = [
  {
    id: "evt-rechnernetzte",
    title: "Rechnernetzte",
    start: todayAt("10:00"),
    end: todayAt("12:00"),
    location: "Audimax",
  },
  {
    id: "evt-new",
    title: "New Event",
    start: todayAt("13:30"),
    end: todayAt("14:30"),
  },
  {
    id: "evt-ai-ethics",
    title: "Seminar — AI Ethics and Society",
    start: todayAt("15:00"),
    end: todayAt("18:15"),
    location: "0534, Kleiner Hörsaal",
  },
];

export const MOCK_EMAILS: Email[] = [
  {
    id: "m1",
    sender: "Maria Schmidt",
    subject: "Q2 roadmap draft",
    snippet:
      "Hey Paul, attached is the first cut of the Q2 roadmap. Could you sanity-check the dependencies before Friday?",
    starred: true,
  },
  {
    id: "m2",
    sender: "GitHub",
    subject: "[PR #247] Stock card refactor — review requested",
    snippet:
      "alex-dev requested your review on a pull request. 12 files changed, +384 −211 lines.",
  },
  {
    id: "m3",
    sender: "Lufthansa",
    subject: "Ihr Flug LH401 — Online-Check-in jetzt verfügbar",
    snippet:
      "Sehr geehrter Herr Muster, der Online-Check-in für Ihren Flug am 12.05. ist jetzt geöffnet.",
  },
  {
    id: "m4",
    sender: "Stripe",
    subject: "Your invoice is ready",
    snippet:
      "Your monthly invoice for April is ready to view. Total charged: €19.00.",
    starred: true,
  },
  {
    id: "m5",
    sender: "Tom Becker",
    subject: "Lunch heute?",
    snippet:
      "Lust auf 12:30 im Luitpold? Ich hab nen Tisch reserviert, falls ja.",
  },
  {
    id: "m6",
    sender: "TUM moodle",
    subject: "Neue Aufgabe: Datenbanken Übungsblatt 8",
    snippet:
      "In Ihrem Kurs Datenbanken wurde eine neue Aufgabe veröffentlicht. Abgabe: 11.05.2026 23:59.",
  },
  {
    id: "m7",
    sender: "Amazon",
    subject: "Ihre Bestellung wurde versandt",
    snippet:
      "Sendung 1Z999AA1 ist unterwegs. Voraussichtliche Lieferung: morgen.",
  },
  {
    id: "m8",
    sender: "Nina Bauer",
    subject: "Re: Wochenende?",
    snippet:
      "Ja klar, Samstag passt perfekt. Ich bring den Kuchen mit, wenn du den Kaffee machst :)",
    starred: true,
  },
];

export const MOCK_TASKS: Task[] = [
  { id: "t1", text: "Review Q2 roadmap PDF", done: false },
  { id: "t2", text: "Approve PR #247", done: false },
  { id: "t3", text: "Buy groceries on the way home", done: false },
  { id: "t4", text: "Call dentist", done: true },
  { id: "t5", text: "Book flight for Berlin trip", done: false },
];
