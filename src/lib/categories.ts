import type { BlockCategory } from "../tracker/types";

// Single source of truth for the 5 Rubriken — shared by the Stundenplan
// (WeeklyTimeline), the weekly/daily todo lists, and anything else that needs
// to color or label a category. Colors reuse the same earthy --cal-* tokens
// as the calendar tags (index.css) so the whole app speaks one color language.

export type CategoryMeta = { label: string; color: string; emoji: string };

export const CATEGORY_META: Record<BlockCategory, CategoryMeta> = {
  lern:      { label: "Lernen",    color: "var(--accent)",      emoji: "📚" },
  uni:       { label: "Uni",       color: "var(--cal-familie)", emoji: "🎓" },
  privat:    { label: "Privat",    color: "var(--cal-privat)",  emoji: "🌿" },
  sport:     { label: "Sport",     color: "var(--cal-klausur)", emoji: "💪" },
  sonstiges: { label: "Sonstiges", color: "var(--cal-arbeit)",  emoji: "✨" },
};

export const CATEGORY_ORDER: BlockCategory[] = ["lern", "uni", "privat", "sport", "sonstiges"];
