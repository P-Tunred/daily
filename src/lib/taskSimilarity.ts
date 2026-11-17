// Duplicate detection between incoming triage items and what Paul already
// tracks (todos + "Am Horizont" events). Deliberately a QUESTION generator,
// not an auto-decider: a match only makes the morning dialog ask "dieselbe
// Sache wie …?" — Paul confirms or denies, nothing is merged silently.
//
// Two deterministic signals (no AI — this runs on every dialog render):
//   1. Shared course-code acronym (EIST, GRNVS, BWL, OR …) — the strongest
//      duplicate smell in a student's task list.
//   2. Significant-token overlap ≥ 60% of the shorter title.

export type DupCandidate = { id: string; label: string; kind: "task" | "event" };

const STOPWORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
  "und", "oder", "für", "von", "vom", "mit", "bei", "bis", "aus", "auf", "an",
  "in", "im", "am", "zu", "zum", "zur", "the", "for", "and", "noch", "neue",
  "neuer", "neues", "weiter", "machen", "erledigen", "abgeben", "bearbeiten",
]);

/** Words that carry meaning: lowercased, umlaut-normalized, no stopwords. */
function significantTokens(s: string): Set<string> {
  const cleaned = s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, " ");
  const out = new Set<string>();
  for (const w of cleaned.split(/\s+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Course-code style acronyms: 2–6 letter ALL-CAPS words (EIST, GRNVS, OR
 *  needs ≥3 to avoid matching random two-letter words). */
function acronyms(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\b[A-ZÄÖÜ]{3,6}\b/g)) out.add(m[0]);
  return out;
}

function overlapCount<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** True when the two titles plausibly describe the same piece of work. */
export function looksLikeSameTask(a: string, b: string): boolean {
  const acrA = acronyms(a);
  const acrB = acronyms(b);
  if (overlapCount(acrA, acrB) > 0) return true;

  const tokA = significantTokens(a);
  const tokB = significantTokens(b);
  if (tokA.size === 0 || tokB.size === 0) return false;
  const overlap = overlapCount(tokA, tokB);
  return overlap / Math.min(tokA.size, tokB.size) >= 0.6;
}

/** First existing task/event a new title collides with, or null. */
export function findSimilarTask(title: string, candidates: DupCandidate[]): DupCandidate | null {
  for (const c of candidates) {
    if (looksLikeSameTask(title, c.label)) return c;
  }
  return null;
}
