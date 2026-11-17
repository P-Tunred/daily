// Weekly "KI-Nutzung" data for the footer dropdown. Served by GET /api/usage
// (electron/usageStats.cjs) — see that module for why neither number is a
// literal subscription-quota reading. Validated at the boundary since the
// GLM half passes through a third-party API response before reaching here.
export type ClaudeUsage =
  | {
      available: false;
      resetAt: string | null;
      /** Klartext, warum die Quote fehlt — und seit wann sie zuletzt stimmte.
       *  Ohne diese beiden sah ein acht Tage alter Defekt genauso aus wie ein
       *  frisch aufgesetzter Rechner. */
      grundText?: string;
      zuletztGesehenAm?: string | null;
    }
  | {
      // Real Pro-plan quota via the Claude Code OAuth login (Keychain).
      available: true;
      source: "plan";
      usedPct: number;
      remainingPct: number;
      resetAt: string | null;
      fiveHourUsedPct: number | null;
    }
  | {
      // Fallback: local Claude Code session log, measured against a budget.
      available: true;
      source: "local";
      sessions: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      resetAt: string | null;
    };

export type GlmUsage =
  | { available: false; reason?: string }
  | {
      available: true;
      usedPct: number;
      remainingPct: number | null;
      resetAt: string | null;
      fiveHourUsedPct: number | null;
    };

export type WeeklyUsage = { claude: ClaudeUsage; glm: GlmUsage };

const FALLBACK: WeeklyUsage = {
  claude: { available: false, resetAt: null },
  glm: { available: false },
};

function clampPct(v: unknown): number {
  return typeof v === "number" ? Math.max(0, Math.min(100, v)) : 0;
}

function toClaudeUsage(v: unknown): ClaudeUsage {
  if (!v || typeof v !== "object") return { available: false, resetAt: null };
  const o = v as Record<string, unknown>;
  const resetAt = typeof o.resetAt === "string" ? o.resetAt : null;
  if (o.available !== true) {
    return {
      available: false,
      resetAt,
      grundText: typeof o.grundText === "string" ? o.grundText : undefined,
      zuletztGesehenAm: typeof o.zuletztGesehenAm === "string" ? o.zuletztGesehenAm : null,
    };
  }
  // "pushed" ist dieselbe echte Abo-Quote wie "plan", nur den Umweg über den
  // Mac gegangen (siehe electron/usageStats.cjs: die Linux-VM kommt an den
  // OAuth-Login im macOS-Schlüsselbund nicht heran). Sie muss deshalb auch
  // gleich gelesen werden — fiel sie in den "local"-Zweig, würde eine echte
  // Prozentzahl als Budget-Schätzung mit lauter Nullen dargestellt.
  if (o.source === "plan" || o.source === "pushed") {
    const usedPct = clampPct(o.usedPct);
    return {
      available: true,
      source: "plan",
      usedPct,
      remainingPct: typeof o.remainingPct === "number" ? clampPct(o.remainingPct) : 100 - usedPct,
      resetAt,
      fiveHourUsedPct: typeof o.fiveHourUsedPct === "number" ? clampPct(o.fiveHourUsedPct) : null,
    };
  }
  return {
    available: true,
    source: "local",
    sessions: typeof o.sessions === "number" ? o.sessions : 0,
    costUsd: typeof o.costUsd === "number" ? o.costUsd : 0,
    inputTokens: typeof o.inputTokens === "number" ? o.inputTokens : 0,
    outputTokens: typeof o.outputTokens === "number" ? o.outputTokens : 0,
    resetAt,
  };
}

function toGlmUsage(v: unknown): GlmUsage {
  if (!v || typeof v !== "object") return { available: false };
  const o = v as Record<string, unknown>;
  if (o.available !== true) {
    return { available: false, reason: typeof o.reason === "string" ? o.reason : undefined };
  }
  return {
    available: true,
    usedPct: clampPct(o.usedPct),
    remainingPct: typeof o.remainingPct === "number" ? clampPct(o.remainingPct) : null,
    resetAt: typeof o.resetAt === "string" ? o.resetAt : null,
    fiveHourUsedPct: typeof o.fiveHourUsedPct === "number" ? clampPct(o.fiveHourUsedPct) : null,
  };
}

export async function fetchWeeklyUsage(): Promise<WeeklyUsage> {
  try {
    const res = await fetch("/api/usage?t=" + Date.now());
    if (!res.ok) return FALLBACK;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return FALLBACK;
    const o = data as Record<string, unknown>;
    return { claude: toClaudeUsage(o.claude), glm: toGlmUsage(o.glm) };
  } catch {
    return FALLBACK;
  }
}
