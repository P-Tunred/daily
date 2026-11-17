// Shared "handled" state for mail-triage items — set once (committed or
// explicitly discarded in MorningTriage's morning dialog, or dismissed
// directly from the Posteingang card), consumed everywhere a triage item is
// shown so a handled item doesn't keep occupying a slot and blocking newer
// mail from surfacing.
import { SCHLUESSEL, lies, aendere } from "./store";

const SEEN_CHANGE_EVENT = "morning:triage-seen-change";

export function loadSeenTriageIds(): string[] {
  // Vorher stand hier `JSON.parse(getItem(k) ?? "[]")` — das liefert `any`.
  // Lag im Speicher ein Objekt statt einer Liste, kam es als `string[]` zurück
  // und der Spread in markTriageSeen() warf. Jetzt prüft das Register.
  return lies(SCHLUESSEL.triageGesehen);
}

/** Marks ids handled and notifies other mounted components (e.g. the
 *  Posteingang card doesn't re-fetch on every triage-dialog interaction, so
 *  it listens for this instead). */
export function markTriageSeen(ids: string[]): void {
  if (ids.length === 0) return;
  aendere(SCHLUESSEL.triageGesehen, (bisher) => [...new Set([...bisher, ...ids])]);
  window.dispatchEvent(new Event(SEEN_CHANGE_EVENT));
}

/** Un-hides the given ids (the "Erledigte wieder anzeigen" path) — a manual
 *  undo, so a mis-click or an over-eager "Fertig" isn't permanent. */
export function unmarkTriageSeen(ids: string[]): void {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  aendere(SCHLUESSEL.triageGesehen, (bisher) => bisher.filter((id) => !drop.has(id)));
  window.dispatchEvent(new Event(SEEN_CHANGE_EVENT));
}

export const TRIAGE_SEEN_CHANGE_EVENT = SEEN_CHANGE_EVENT;
