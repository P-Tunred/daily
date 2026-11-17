/**
 * Subject color palette — referenced as CSS var() strings, not literal hex, so
 * every subject re-colors automatically when the theme (Setzling ↔ Abendrot)
 * changes. Actual values live in index.css (:root + [data-theme="abendrot"]).
 * Muted, distinguishable on dark — twelve slots, cycled per new subject.
 */
export const SUBJECT_COLORS: string[] = [
  "var(--subject-1)",
  "var(--subject-2)",
  "var(--subject-3)",
  "var(--subject-4)",
  "var(--subject-5)",
  "var(--subject-6)",
  "var(--subject-7)",
  "var(--subject-8)",
  "var(--subject-9)",
  "var(--subject-10)",
  "var(--subject-11)",
  "var(--subject-12)",
];

/** Pre-theming literal hex values, in the same order as SUBJECT_COLORS. Used
 *  only to migrate subjects created before the var()-based palette existed —
 *  see tracker/store.tsx's one-time subject-color migration. */
export const LEGACY_SUBJECT_HEX: string[] = [
  "#7AA2FF",
  "#73C9A8",
  "#E8B948",
  "#F07A6A",
  "#9B8FE0",
  "#C47DB5",
  "#5BB8D4",
  "#D4A052",
  "#89B49A",
  "#B89A75",
  "#5B8DD4",
  "#E07A96",
];

export function pickNextColor(used: string[]): string {
  const free = SUBJECT_COLORS.find((c) => !used.includes(c));
  return free ?? SUBJECT_COLORS[used.length % SUBJECT_COLORS.length];
}
