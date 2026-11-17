import { useEffect, useState } from "react";
import { fetchWeeklyUsage, type WeeklyUsage } from "../lib/usage";

// Two hairline usage bars hugging the screen edges — top is Claude, bottom is
// GLM. The bar FILLS left-to-right as the weekly quota is consumed and the
// tiny right-aligned label reads "X% verbraucht · bis <reset>" — the same
// framing as the official claude.ai / z.ai usage dashboards, so the numbers
// match what Paul sees there. Deliberately ambient, not a card.
//
// Colors follow the active theme (position + label already identify the two):
// Claude takes the theme accent (Setzling green / Abendrot sun), GLM the
// theme's warm secondary tone.
const CLAUDE_COLOR = "var(--accent)";
const GLM_COLOR = "var(--warn)";

const EMPTY: WeeklyUsage = {
  claude: { available: false, resetAt: null },
  glm: { available: false },
};

function fmtReset(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("de-DE", { weekday: "short" });
  return `${day} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

function EdgeBar({
  edge,
  color,
  usedPct,
  label,
  title,
}: {
  edge: "top" | "bottom";
  color: string;
  usedPct: number | null; // null → track only (no data)
  label: string | null;
  title?: string;
}) {
  const barAt = edge === "top" ? { top: 0 } : { bottom: 0 };
  const labelAt = edge === "top" ? { top: 6 } : { bottom: 6 };
  const fill = usedPct === null ? 0 : Math.max(0, Math.min(100, usedPct)) / 100;
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          ...barAt,
          height: 3,
          zIndex: 60,
          pointerEvents: "none",
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
        }}
      >
        {usedPct !== null && (
          <div
            style={{
              height: "100%",
              width: "100%",
              transformOrigin: "left",
              transform: `scaleX(${fill})`,
              background: `color-mix(in srgb, ${color} 55%, transparent)`,
            }}
          />
        )}
      </div>
      {label && (
        <span
          title={title}
          style={{
            position: "fixed",
            right: 12,
            ...labelAt,
            zIndex: 60,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: `color-mix(in srgb, ${color} 45%, var(--text-4))`,
          }}
        >
          {label}
        </span>
      )}
    </>
  );
}

// Re-poll periodically — otherwise a fresh Claude Code login (or a GLM key
// added later) only takes effect after a full app restart, since the app
// tends to stay open for hours at a stretch.
const POLL_MS = 5 * 60 * 1000;

export function UsageEdges() {
  const [usage, setUsage] = useState<WeeklyUsage>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchWeeklyUsage().then((u) => {
        if (!cancelled) setUsage(u);
      });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const { claude, glm } = usage;

  // Claude: ONLY the real Pro-plan quota is worth showing as a number — the
  // local session-log estimate (cache tokens ×  API list prices) is wildly off
  // for a subscription, so without the OAuth login we show a login hint instead.
  const claudePlan = claude.available && claude.source === "plan" ? claude : null;
  const claudeLabel = claudePlan
    ? `Claude · ${Math.round(claudePlan.usedPct)}% verbraucht${
        fmtReset(claudePlan.resetAt) ? ` · bis ${fmtReset(claudePlan.resetAt)}` : ""
      }`
    : "Claude · Login nötig";
  const claudeTitle = claudePlan
    ? `Pro-Plan · Woche: ${Math.round(claudePlan.usedPct)}% verbraucht${
        claudePlan.fiveHourUsedPct !== null ? ` · 5h-Fenster: ${Math.round(claudePlan.fiveHourUsedPct)}%` : ""
      }`
    // Der konkrete Grund schlaegt den allgemeinen Rat: "Login noetig" stand
    // auch dann da, als die Anmeldung nur abgelaufen war — und weil derselbe
    // Satz beim allerersten Start erscheint, fiel acht Tage lang niemandem auf,
    // dass etwas kaputtgegangen war.
    : !claude.available && claude.grundText
      ? claude.grundText +
        (claude.zuletztGesehenAm
          ? ` (zuletzt gültig am ${new Date(claude.zuletztGesehenAm).toLocaleDateString("de-DE")})`
          : "")
      : "Einmalig im Terminal: claude → /login — danach zeigt die Leiste dein echtes Pro-Kontingent.";

  const glmLabel = glm.available
    ? `GLM · ${Math.round(glm.usedPct)}% verbraucht${
        fmtReset(glm.resetAt) ? ` · bis ${fmtReset(glm.resetAt)}` : ""
      }`
    : null;
  const glmTitle = glm.available
    ? `GLM Coding Plan · Woche: ${Math.round(glm.usedPct)}% verbraucht${
        glm.fiveHourUsedPct !== null ? ` · 5h-Fenster: ${Math.round(glm.fiveHourUsedPct)}%` : ""
      }`
    : undefined;

  return (
    <>
      <EdgeBar
        edge="top"
        color={CLAUDE_COLOR}
        usedPct={claudePlan ? claudePlan.usedPct : null}
        label={claudeLabel}
        title={claudeTitle}
      />
      <EdgeBar
        edge="bottom"
        color={GLM_COLOR}
        usedPct={glm.available ? glm.usedPct : null}
        label={glmLabel}
        title={glmTitle}
      />
    </>
  );
}
