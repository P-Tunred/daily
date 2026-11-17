// "Schon gefragt" — the missing third state next to seen (handled) and
// deferred (parked). Until now "Später" only closed the window in memory, so
// the very same mails reappeared every morning and after every restart.
//
// Recording WHEN an item was last put in front of Paul lets the morning dialog
// hold back for a while. Nothing is lost: those mails stay visible in the
// Posteingang card and its manage view — only the daily interruption is
// throttled.

import { SCHLUESSEL, lies, schreib, entferne } from "./store";

/** Days before the morning dialog may bring the same item up again. */
export const ASK_COOLDOWN_DAYS = 7;

type AskedMap = Record<string, string>; // mail id → ISO date (YYYY-MM-DD)

export function loadAsked(): AskedMap {
  return lies(SCHLUESSEL.triageGefragt);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Records that these items were shown today. Prunes entries older than four
 *  cooldowns so the map can't grow forever. */
export function markAsked(ids: string[]): void {
  if (ids.length === 0) return;
  const today = todayIso();
  const cutoff = new Date(Date.now() - ASK_COOLDOWN_DAYS * 4 * 86_400_000).toISOString().slice(0, 10);
  const next: AskedMap = {};
  for (const [id, date] of Object.entries(loadAsked())) {
    if (date >= cutoff) next[id] = date;
  }
  for (const id of ids) next[id] = today;
  schreib(SCHLUESSEL.triageGefragt, next);
}

/** True while an item is still inside its cooldown — don't ask again yet. */
export function isInCooldown(id: string, asked: AskedMap, today = todayIso()): boolean {
  const last = asked[id];
  if (!last) return false;
  const days = Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000);
  return Number.isFinite(days) && days < ASK_COOLDOWN_DAYS;
}

/** Lets the user pull everything back into the next morning dialog. */
export function clearAsked(): void {
  entferne(SCHLUESSEL.triageGefragt);
}
