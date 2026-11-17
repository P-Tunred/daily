/**
 * Vite plugin: fetches your Google Calendar iCal feed server-side
 * (no CORS, no OAuth), parses it with node-ical, and exposes:
 *   GET /api/calendar/today     → CalendarEvent[]  (today only)
 *   GET /api/calendar/upcoming  → CalendarEvent[]  (today + next 90 days)
 *
 * Refresh interval: every 15 minutes.
 * Set VITE_GCAL_ICAL_URL in .env to your private iCal URL.
 *
 * Uses node-ical's expandRecurringEvent() so RRULE recurring events
 * (weekly classes, standing meetings, etc.) are fully expanded.
 */

import type { Plugin } from "vite";
import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";

// node-ical is CJS — use createRequire so ical.sync is available in ESM/Vite context
const require = createRequire(import.meta.url);
// Shared Anthropic proxy (CJS) — keeps the API key server-side in dev too.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handleAnthropic } = require("../electron/anthropicProxy.cjs") as {
  handleAnthropic: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
// Zustand der App (Todos, Lernzeit, Score) als Datei — damit /api/state auch
// im Dev-Modus antwortet und nicht nur in der gepackten App.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stateStore = require("../electron/stateStore.cjs") as {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
// Local JSON calendar source (Google Calendar via the daily Drive export).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const calSource = require("../electron/calendarSource.cjs") as {
  readEvents: () => CalendarEvent[] | null;
  split: (events: CalendarEvent[], horizonDays?: number) => { today: CalendarEvent[]; upcoming: CalendarEvent[] };
};
// Live mail triage (Drive mail report → parse → incremental Claude classify → cache).
// eslint-disable-next-line @typescript-eslint/no-require-imports
type TriageResult = {
  items: Record<string, unknown>[];
  // Grouped daily action digest; forwarded verbatim to the client (validated
  // there). null until the first daily synthesis has run.
  summary: Record<string, unknown> | null;
  reportUpdatedAt: string | null;
  newestMailAt: string | null;
  stale: boolean;
};
const mailTriage = require("../electron/mailTriage.cjs") as {
  refreshTriage: () => Promise<TriageResult>;
  servedCached: () => TriageResult;
  lastRefreshDay: () => string | null;
};
// Curated Second-Brain pages (people + working style) for Jarvis's persona.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const brainSource = require("../electron/brainSource.cjs") as {
  serveBrain: () => { ok: boolean; text: string; pages: string[]; updatedAt: string | null };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const brainPages = require("../electron/brainPages.cjs") as {
  pagesForSubject: (name: string) => unknown;
  search: (q: string) => unknown;
  freshness: () => unknown;
  neuImBrain: () => unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const learnHarness = require("../electron/learnHarness.cjs") as {
  lernstand: () => { ok: boolean; themen?: Array<Record<string, unknown>> };
  passtZuFach: (thema: Record<string, unknown>, fach: string) => boolean;
};
// Weekly Claude/GLM usage stats (edge bars).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const usageStats = require("../electron/usageStats.cjs") as {
  getClaudeUsage: () => Promise<Record<string, unknown>>;
  getWeeklyGlmUsage: () => Promise<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const subscriptions = require("../electron/subscriptions.cjs") as {
  uebersicht: () => Promise<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ical = require("node-ical") as {
  sync: { parseICS: (text: string) => Record<string, unknown> };
  expandRecurringEvent: (
    event: unknown,
    options: { from: Date; to: Date; expandOngoing?: boolean },
  ) => Array<{
    start: Date;
    end: Date | null;
    summary: string;
    isFullDay: boolean;
    event: Record<string, unknown>;
  }>;
};

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;      // ISO string
  end: string;        // ISO string
  location?: string;
  description?: string;
  allDay?: boolean;
  calendar?: string;  // source calendar tag (Uni, Privat, Klausur, …)
}

let ICAL_URL: string | undefined;
const REFRESH_MS = 15 * 60 * 1000; // 15 minutes
const USAGE_REFRESH_MS = 15 * 60 * 1000;
// Mail triage runs ONCE PER DAY at/after the morning hour (Berlin); see server.cjs.
const TRIAGE_HOUR = 7;
const TRIAGE_TICK_MS = 20 * 60 * 1000;

// today cache
let cacheToday: CalendarEvent[] = [];
// upcoming cache (next 90 days incl. today)
let cacheUpcoming: CalendarEvent[] = [];
let lastFetch = 0;
let haveSource = false; // true once a JSON or iCal source has produced events
let cacheTriage: {
  items: Record<string, unknown>[];
  summary: Record<string, unknown> | null;
  reportUpdatedAt: string | null;
  newestMailAt: string | null;
  stale: boolean;
} = {
  items: [],
  summary: null,
  reportUpdatedAt: null,
  newestMailAt: null,
  stale: true,
};
let lastTriageDay: string | null = null; // Berlin date of the last successful daily refresh
let cacheGlmUsage: Record<string, unknown> = { available: false };
let cacheClaudeUsage: Record<string, unknown> = { available: false, resetAt: null };
let lastUsageFetch = 0;

function todayBerlin(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}
function berlinHour(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })).getHours();
}

function daysBerlin(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

// ── fetchAndParse ──────────────────────────────────────────────────────────────
// Uses expandRecurringEvent so RRULE events (weekly classes, etc.) are expanded
// into individual occurrences within [from, to].

async function fetchAndParse(url: string): Promise<
  (CalendarEvent & { _startDay: string; _endDay: string })[]
> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iCal fetch failed: ${res.status}`);
  const text = await res.text();
  const data = ical.sync.parseICS(text);

  // Expand from yesterday → horizon+1 so we catch events that started
  // before midnight UTC but fall on "today" in Berlin time.
  const from = new Date(daysBerlin(-1));
  const to   = new Date(daysBerlin(92));

  const events: (CalendarEvent & { _startDay: string; _endDay: string })[] = [];

  for (const [, raw] of Object.entries(data)) {
    const entry = raw as Record<string, unknown>;
    if (!entry || entry["type"] !== "VEVENT") continue;

    let occurrences: ReturnType<typeof ical.expandRecurringEvent>;
    try {
      occurrences = ical.expandRecurringEvent(entry, { from, to, expandOngoing: true });
    } catch {
      continue; // skip malformed events
    }

    for (const occ of occurrences) {
      const startDate = new Date(occ.start);
      const endDate   = occ.end ? new Date(occ.end) : startDate;

      const startDay = startDate.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      const endDay   = endDate.toLocaleDateString("sv-SE",   { timeZone: "Europe/Berlin" });

      // Use uid from original event for stable IDs; append ISO start for recurring occurrences
      const uid = String(entry["uid"] ?? entry["summary"] ?? Math.random());

      events.push({
        id:          `${uid}|${occ.start.toISOString()}`,
        title:       String(entry["summary"] ?? "Ohne Titel"),
        start:       startDate.toISOString(),
        end:         endDate.toISOString(),
        location:    entry["location"]    ? String(entry["location"])    : undefined,
        description: entry["description"] ? String(entry["description"]) : undefined,
        allDay:      occ.isFullDay,
        _startDay:   startDay,
        _endDay:     endDay,
      });
    }
  }

  return events;
}

// ── refresh ────────────────────────────────────────────────────────────────────

async function refresh() {
  // 1) Prefer the local JSON export (Google Calendar → Drive → calendar.json).
  try {
    const local = calSource.readEvents();
    if (local && local.length) {
      const { today, upcoming } = calSource.split(local, 90);
      cacheToday = today;
      cacheUpcoming = upcoming;
      lastFetch = Date.now();
      haveSource = true;
      console.log(`[calendar] ✓ json today=${today.length} upcoming=${upcoming.length}`);
      return;
    }
  } catch (e) {
    console.warn("[calendar] json source error:", e);
  }
  // 2) Fallback: live iCal feed (only if a URL is configured).
  if (!ICAL_URL) return;
  try {
    const all = await fetchAndParse(ICAL_URL);
    const today   = todayBerlin();
    const horizon = daysBerlin(90);

    cacheToday = all
      .filter(e => {
        const s = e._startDay, en = e._endDay;
        // spans today: starts on today, OR started earlier but ends after today
        return s === today || (s < today && en > today);
      })
      .map(({ _startDay: _, _endDay: __, ...rest }) => rest)
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      });

    cacheUpcoming = all
      .filter(e => e._startDay >= today && e._startDay <= horizon)
      .map(({ _startDay: _, _endDay: __, ...rest }) => rest)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    lastFetch = Date.now();
    haveSource = true;
    console.log(`[calendar] ✓ ical today=${cacheToday.length} upcoming=${cacheUpcoming.length} events (recurring expanded)`);
  } catch (e) {
    console.warn("[calendar] fetch error:", e);
  }
}

function respond(res: ServerResponse, data: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

// Once per day, at/after the morning hour; cheap no-op otherwise. Only marks
// the day done once fresh (non-stale) data arrives (report may sync late).
async function refreshTriageCache() {
  const today = todayBerlin();
  if (lastTriageDay === today) return;
  if (berlinHour() < TRIAGE_HOUR) return;
  const result = await mailTriage.refreshTriage();
  cacheTriage = result;
  if (!result.stale) lastTriageDay = today;
}

async function refreshUsageCache() {
  const [claude, glm] = await Promise.all([
    usageStats.getClaudeUsage(),
    usageStats.getWeeklyGlmUsage(),
  ]);
  cacheClaudeUsage = claude;
  cacheGlmUsage = glm;
  lastUsageFetch = Date.now();
}

export function calendarPlugin(icalUrl?: string): Plugin {
  ICAL_URL = icalUrl;
  return {
    name: "vite-plugin-calendar",
    configureServer(server) {
      // refresh() prefers the local JSON export and only falls back to iCal, so
      // we always start it (even without VITE_GCAL_ICAL_URL).
      void refresh();
      setInterval(() => void refresh(), REFRESH_MS);
      // Serve the last classified inbox instantly; real read+classify is gated
      // to once per day at TRIAGE_HOUR. Seed the day-marker from the cache so a
      // restart doesn't re-refresh if today was already done.
      cacheTriage = mailTriage.servedCached();
      lastTriageDay = mailTriage.lastRefreshDay();
      void refreshTriageCache();
      setInterval(() => void refreshTriageCache(), TRIAGE_TICK_MS);
      void refreshUsageCache();
      setInterval(() => void refreshUsageCache(), USAGE_REFRESH_MS);

      // /api/state — Zustand der App lesen und schreiben
      server.middlewares.use("/api/state", (req: IncomingMessage, res: ServerResponse) => {
        void stateStore.handle(req, res);
      });

      // /api/anthropic — server-side AI proxy (key never reaches the browser)
      server.middlewares.use("/api/anthropic", (req: IncomingMessage, res: ServerResponse) => {
        void handleAnthropic(req, res);
      });

      // /api/calendar/today — events happening today
      server.middlewares.use("/api/calendar/today", async (_req: IncomingMessage, res: ServerResponse) => {
        if (Date.now() - lastFetch > REFRESH_MS) await refresh();
        respond(res, haveSource ? cacheToday : null);
      });

      // /api/calendar/upcoming — events in the next 90 days
      server.middlewares.use("/api/calendar/upcoming", async (_req: IncomingMessage, res: ServerResponse) => {
        if (Date.now() - lastFetch > REFRESH_MS) await refresh();
        respond(res, haveSource ? cacheUpcoming : null);
      });

      // /api/triage — live-classified mail report (Drive → parse → Claude → cache)
      server.middlewares.use("/api/triage", async (_req: IncomingMessage, res: ServerResponse) => {
        await refreshTriageCache(); // no-op unless the daily window just opened
        respond(res, cacheTriage);
      });

      // /api/brain/fach|suche|stand — MUESSEN vor /api/brain stehen: connect
      // matcht Praefixe, "/api/brain" wuerde sie sonst alle verschlucken und
      // still die Persona ausliefern.
      const brainQuery = (req: IncomingMessage, key: string): string => {
        const orig = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "";
        try { return new URL(orig, "http://x").searchParams.get(key) ?? ""; } catch { return ""; }
      };
      server.middlewares.use("/api/brain/fach", (req: IncomingMessage, res: ServerResponse) => {
        respond(res, brainPages.pagesForSubject(brainQuery(req, "name").slice(0, 80)));
      });
      server.middlewares.use("/api/brain/suche", (req: IncomingMessage, res: ServerResponse) => {
        respond(res, brainPages.search(brainQuery(req, "q").slice(0, 400)));
      });
      server.middlewares.use("/api/brain/neu", (_req: IncomingMessage, res: ServerResponse) => {
        respond(res, brainPages.neuImBrain());
      });
      server.middlewares.use("/api/brain/stand", (_req: IncomingMessage, res: ServerResponse) => {
        respond(res, brainPages.freshness());
      });

      // /api/learnharness — woran Paul in LearnHarness lernt (wie im Server).
      server.middlewares.use("/api/learnharness", (req: IncomingMessage, res: ServerResponse) => {
        const fach = brainQuery(req, "fach").slice(0, 80);
        const stand = learnHarness.lernstand();
        if (!stand.ok || !fach || !stand.themen) return respond(res, stand);
        respond(res, { ...stand, themen: stand.themen.map((t) => ({ ...t, passtZumFach: learnHarness.passtZuFach(t, fach) })) });
      });

      // /api/brain — curated Second-Brain pages for Jarvis's persona block
      server.middlewares.use("/api/brain", (_req: IncomingMessage, res: ServerResponse) => {
        respond(res, brainSource.serveBrain());
      });

      // /api/usage — weekly Claude (Pro plan or local log) + GLM (z.ai) usage for the edge bars
      server.middlewares.use("/api/usage", async (_req: IncomingMessage, res: ServerResponse) => {
        if (Date.now() - lastUsageFetch > USAGE_REFRESH_MS) await refreshUsageCache();
        respond(res, { claude: cacheClaudeUsage, glm: cacheGlmUsage });
      });

      // /api/subscriptions — Abo-Uebersicht (Claude, z.ai, Codex).
      // Muss hier genauso stehen wie im gepackten Server: fehlt eine Route im
      // Entwicklungsmodus, ist die zugehoerige Karte dort tot und der
      // Unterschied faellt erst in der Produktion auf.
      server.middlewares.use("/api/subscriptions", async (_req: IncomingMessage, res: ServerResponse) => {
        respond(res, await subscriptions.uebersicht());
      });
    },
  };
}
