import type { Email } from "../types";

// Shared loader for the daily mail triage — served live by the server at
// /api/triage (electron/mailTriage.cjs: reads the synced Drive mail report,
// classifies it with Claude, caches the result). Validated at the boundary —
// the report is built from incoming mail, so its shape can't be trusted.
export type TriageItem = {
  id: string;
  classification: "exam" | "deadline" | "task" | "uncertain";
  /** Claude's content-based importance judgment — drives both server-side
   *  sort order and the ★ marker here, since date proximity alone can't
   *  tell an overdue thesis submission from a moot, already-passed poll. */
  priority: "dringend" | "wichtig" | "normal";
  title: string;
  date: string | null;
  source?: string;
  context?: string;
  /** Backend ranking (0–110): stakes + time pressure, recomputed against
   *  today on every serve — so nothing stays frozen at yesterday's urgency. */
  score?: number;
  /** The quiet marker for things that actually burn right now. */
  signal?: "überfällig" | "heute" | "morgen" | null;
};

const VALID = new Set(["exam", "deadline", "task", "uncertain"]);
const VALID_PRIORITY = new Set(["dringend", "wichtig", "normal"]);
const VALID_SIGNAL = new Set(["überfällig", "heute", "morgen"]);
const VALID_BUCKET = new Set(["jetzt", "woche", "altlast"]);

/** One grouped action in the daily digest — several mails about the same matter
 *  (e.g. five "Allihoop-Vertrag" mails) collapse into one card. Built server-
 *  side by Claude once a day; validated here since the model output derives
 *  from untrusted mail content. */
export type SummaryCard = {
  id: string;
  bucket: "jetzt" | "woche" | "altlast";
  /** What it's about — short. */
  title: string;
  /** The one concrete next step, imperative. May be empty. */
  action: string;
  deadline: string | null;
  /** Where the mails are — sender + short receive date. */
  sources: { sender: string; when: string }[];
  /** Ids of the mails behind this card — lets one click mark the whole
   *  matter handled (the seen-store works per mail id). */
  sourceIds: string[];
  /** How many mails collapsed into this card. */
  mailCount: number;
};

export type TriageSummary = {
  generatedAt: string;
  cards: SummaryCard[];
};

export type TriageFeed = {
  items: TriageItem[];
  /** Grouped daily digest, or null before the first synthesis / on AI failure —
   *  callers then fall back to `items` so a populated report never shows blank. */
  summary: TriageSummary | null;
  /** When the upstream mail report was generated — lets the UI show how
   *  fresh the data actually is (the report, not our fetch of it). */
  reportUpdatedAt: string | null;
  /** Newest mail contained IN the report — the report timestamp alone can
   *  lie when the generator re-runs on frozen mailbox data. */
  newestMailAt: string | null;
};

/** Validate the server's digest — every field is checked because it ultimately
 *  derives from untrusted mail content. Returns null on any structural problem
 *  so the caller cleanly falls back to the raw item list. */
function parseSummary(raw: unknown): TriageSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { generatedAt?: unknown; cards?: unknown };
  if (!Array.isArray(s.cards)) return null;
  const cards: SummaryCard[] = [];
  for (const c of s.cards) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.bucket !== "string" || !VALID_BUCKET.has(o.bucket)) continue;
    if (typeof o.title !== "string" || o.title.trim().length === 0) continue;
    const rawSources = Array.isArray(o.sources) ? o.sources : [];
    const sources = rawSources
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .slice(0, 4)
      .map((x) => ({
        sender: typeof x.sender === "string" ? x.sender.slice(0, 80) : "",
        when: typeof x.when === "string" ? x.when.slice(0, 12) : "",
      }));
    cards.push({
      id: typeof o.id === "string" && o.id.length > 0 ? o.id.slice(0, 64) : `${cards.length}`,
      bucket: o.bucket as SummaryCard["bucket"],
      title: o.title.slice(0, 120),
      action: typeof o.action === "string" ? o.action.slice(0, 160) : "",
      deadline: typeof o.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.deadline) ? o.deadline : null,
      sources,
      sourceIds: (Array.isArray(o.sourceIds) ? o.sourceIds : [])
        .filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120)
        .slice(0, 40),
      mailCount: typeof o.mailCount === "number" && o.mailCount > 0 ? Math.floor(o.mailCount) : sources.length,
    });
  }
  return { generatedAt: typeof s.generatedAt === "string" ? s.generatedAt : "", cards };
}

export async function fetchTriage(): Promise<TriageFeed> {
  try {
    const res = await fetch("/api/triage?t=" + Date.now());
    if (!res.ok) return { items: [], summary: null, reportUpdatedAt: null, newestMailAt: null };
    const data: unknown = await res.json();
    const doc = (data ?? {}) as { items?: unknown; summary?: unknown; reportUpdatedAt?: unknown; newestMailAt?: unknown };
    const raw = doc.items;
    const summary = parseSummary(doc.summary);
    const reportUpdatedAt = typeof doc.reportUpdatedAt === "string" ? doc.reportUpdatedAt : null;
    const newestMailAt = typeof doc.newestMailAt === "string" ? doc.newestMailAt : null;
    if (!Array.isArray(raw)) return { items: [], summary, reportUpdatedAt, newestMailAt };
    const out: TriageItem[] = [];
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      if (typeof o.id !== "string" || o.id.length === 0 || o.id.length > 120) continue;
      if (typeof o.title !== "string" || o.title.trim().length === 0) continue;
      const classification = (typeof o.classification === "string" && VALID.has(o.classification)
        ? o.classification
        : "uncertain") as TriageItem["classification"];
      const priority = (typeof o.priority === "string" && VALID_PRIORITY.has(o.priority)
        ? o.priority
        : "normal") as TriageItem["priority"];
      out.push({
        id: o.id,
        classification,
        priority,
        title: o.title.slice(0, 200),
        date: typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null,
        source: typeof o.source === "string" ? o.source.slice(0, 80) : undefined,
        context: typeof o.context === "string" ? o.context.slice(0, 300) : undefined,
        score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : undefined,
        signal: VALID_SIGNAL.has(o.signal as string) ? (o.signal as TriageItem["signal"]) : null,
      });
    }
    return { items: out, summary, reportUpdatedAt, newestMailAt };
  } catch {
    return { items: [], summary: null, reportUpdatedAt: null, newestMailAt: null };
  }
}

export async function fetchTriageItems(): Promise<TriageItem[]> {
  return (await fetchTriage()).items;
}

const CLASS_LABEL: Record<TriageItem["classification"], string> = {
  exam: "Klausur",
  deadline: "Abgabe",
  task: "Aufgabe",
  uncertain: "Hinweis",
};

/** Map a triage item to the inbox Email shape so the "wichtigsten" mails from the
 *  daily report show up in the Posteingang card, ranked by real importance
 *  (server already sorts by priority) with a ★ on the genuinely urgent ones. */
export function triageToEmail(it: TriageItem): Email {
  return {
    id: it.id,
    sender: it.source || CLASS_LABEL[it.classification],
    subject: it.title,
    snippet: it.context ?? "",
    starred: it.priority === "dringend",
    flag: it.signal ?? null,
  };
}
