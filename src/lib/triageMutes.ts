// Muted senders — "von dem will ich künftig nichts mehr sehen". Unlike the
// seen-store (which hides ONE mail you've handled), a mute is forward-looking:
// every future mail from that sender is filtered out before it can reach the
// inbox card or the morning dialog.
//
// Client-side by design, like the seen-store: the mailbox knows nothing about
// dashboard decisions, and a mute must never delete anything upstream.

import { SCHLUESSEL, lies, aendere } from "./store";

const CHANGE_EVENT = "morning:triage-mutes-change";

/** Senders arrive as "Lorenz Lehle (über TUM) · 29.06." or bare addresses —
 *  strip the trailing date and normalise so the same person matches. */
export function normalizeSender(raw: string): string {
  return raw
    .split("·")[0]
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

export function loadMutedSenders(): string[] {
  return lies(SCHLUESSEL.stummeAbsender);
}

export function muteSender(sender: string): void {
  const key = normalizeSender(sender);
  if (!key) return;
  aendere(SCHLUESSEL.stummeAbsender, (bisher) => [...new Set([...bisher, key])]);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function unmuteSender(sender: string): void {
  const key = normalizeSender(sender);
  aendere(SCHLUESSEL.stummeAbsender, (bisher) => bisher.filter((s) => s !== key));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function isSenderMuted(sender: string, muted: Set<string>): boolean {
  return muted.has(normalizeSender(sender));
}

export const TRIAGE_MUTES_CHANGE_EVENT = CHANGE_EVENT;
