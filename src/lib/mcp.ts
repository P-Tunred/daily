import type { CalendarEvent, Email, Task } from "../types";
import { MOCK_EVENTS, MOCK_EMAILS, MOCK_TASKS } from "../data/mocks";

export const USE_MOCKS = true;

const MCP_SERVERS = [
  {
    type: "url" as const,
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    name: "google-calendar",
  },
  {
    type: "url" as const,
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    name: "gmail",
  },
  {
    type: "url" as const,
    url: "https://tasks.googleapis.com/mcp/v1",
    name: "google-tasks",
  },
];

async function callRealMcp<T>(_server: string, _intent: string): Promise<T> {
  throw new Error(
    "Real MCP path not yet wired: provide real MCP server URLs and a bearer token, then implement Anthropic messages.create with mcp_servers + the 'mcp-client-2025-04-04' beta header.",
  );
}

export async function fetchCalendarToday(): Promise<CalendarEvent[]> {
  // Try the live Vite-plugin endpoint first (works when VITE_GCAL_ICAL_URL is set)
  try {
    const res = await fetch("/api/calendar/today");
    if (res.ok) {
      const data = await res.json() as CalendarEvent[] | null;
      if (Array.isArray(data)) return data;
    }
  } catch {
    // dev server not running or endpoint missing → fall through
  }
  if (USE_MOCKS) return MOCK_EVENTS;
  return callRealMcp<CalendarEvent[]>("google-calendar", "list-today");
}

export async function fetchCalendarUpcoming(): Promise<CalendarEvent[]> {
  try {
    const res = await fetch("/api/calendar/upcoming");
    if (res.ok) {
      const data = await res.json() as CalendarEvent[] | null;
      if (Array.isArray(data)) return data;
    }
  } catch {
    // endpoint missing → return empty
  }
  return [];
}

export async function fetchUnreadEmails(limit = 50): Promise<Email[]> {
  if (USE_MOCKS) return MOCK_EMAILS.slice(0, limit);
  return callRealMcp<Email[]>("gmail", `unread-top-${limit}`);
}

export async function fetchTasks(): Promise<Task[]> {
  if (USE_MOCKS) return MOCK_TASKS;
  return callRealMcp<Task[]>("google-tasks", "list");
}

export async function completeTask(_id: string, _done: boolean): Promise<void> {
  if (USE_MOCKS) return;
  await callRealMcp<void>("google-tasks", "patch");
}

export const __mcpServers = MCP_SERVERS;
