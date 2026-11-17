// Map a raw source-calendar name (from the Drive export: "Uni", "Privat",
// "Familie shared", "Klausur", …) to a stable key, a short display label, and
// a CSS color variable (defined in index.css under "Calendar tags").
//
// Matching is fuzzy/substring so small naming drifts ("Familie", "Familie
// shared") collapse to one tag.

export type CalKey =
  | "uni"
  | "klausur"
  | "privat"
  | "familie"
  | "freunde"
  | "arbeit"
  | "default";

const META: Record<CalKey, { label: string; varName: string }> = {
  uni: { label: "Uni", varName: "--cal-uni" },
  klausur: { label: "Klausur", varName: "--cal-klausur" },
  privat: { label: "Privat", varName: "--cal-privat" },
  familie: { label: "Familie", varName: "--cal-familie" },
  freunde: { label: "Freunde", varName: "--cal-freunde" },
  arbeit: { label: "Arbeit", varName: "--cal-arbeit" },
  default: { label: "", varName: "--cal-default" },
};

/** Classify a raw calendar name into a tag key. Order matters: check the most
 *  specific names first (Klausur before Uni). */
export function calKey(raw?: string): CalKey {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "default";
  if (s.includes("klausur") || s.includes("exam")) return "klausur";
  if (s.includes("uni") || s.includes("übung") || s.includes("uebung")) return "uni";
  if (s.includes("privat")) return "privat";
  if (s.includes("familie") || s.includes("family")) return "familie";
  if (s.includes("freunde") || s.includes("friend")) return "freunde";
  if (s.includes("arbeit") || s.includes("work")) return "arbeit";
  return "default";
}

/** Short label for the tag chip. Falls back to the trimmed raw name when the
 *  calendar isn't one we have an explicit label for. */
export function calLabel(raw?: string): string {
  const key = calKey(raw);
  return META[key].label || (raw ?? "").trim();
}

/** CSS color value (a `var(--cal-…)`) for the calendar's tag. */
export function calColor(raw?: string): string {
  return `var(${META[calKey(raw)].varName})`;
}

// ── mapping to Stundenplan block categories ─────────────────────────────────────
// BlockCategory is "lern" | "uni" | "privat" | "sport" | "sonstiges". Calendar
// commitments are never "lern" (that's reserved for actual study time) — they
// block time on the plan but don't count as studied.
export type BlockCategory = "lern" | "uni" | "privat" | "sport" | "sonstiges";

export function calToBlockCategory(raw?: string): BlockCategory {
  switch (calKey(raw)) {
    case "uni":
    case "klausur":
      return "uni";
    case "privat":
    case "familie":
    case "freunde":
      return "privat";
    case "arbeit":
      return "sonstiges";
    default:
      return "sonstiges";
  }
}
