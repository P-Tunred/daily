import { useEffect } from "react";
import { isSoundEnabled, playClick, playConfirm, playDismiss } from "../lib/sound";

const CLICKABLE_SELECTOR =
  'button, [role="button"], a[href], input[type="checkbox"], input[type="radio"], input[type="submit"]';

/** Components opt into a distinct sound via `data-sound="confirm" | "dismiss"`
 *  on the clickable element itself (or an ancestor). Anything unmarked falls
 *  back to the neutral click — most buttons (nav, toggles, pause) should stay
 *  on this default rather than every element declaring itself explicitly. */
const SOUND_BY_KIND = {
  confirm: playConfirm,
  dismiss: playDismiss,
} as const;

/** App-wide click-sound delegate — one listener instead of wiring a sound
 *  call into every individual button across the dashboard. Fires on any
 *  clickable element (buttons, links, checkboxes/radios), skips disabled
 *  ones, and checks the mute flag live on every click so toggling it off
 *  takes effect immediately. */
export function useClickSounds() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!isSoundEnabled()) return;
      const target = e.target as HTMLElement | null;
      const el = target?.closest(CLICKABLE_SELECTOR) as
        | (HTMLElement & { disabled?: boolean })
        | null;
      if (!el) return;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return;
      const kind = target?.closest<HTMLElement>("[data-sound]")?.dataset.sound;
      const play = SOUND_BY_KIND[kind as keyof typeof SOUND_BY_KIND] ?? playClick;
      play();
    };
    document.addEventListener("click", handler, { passive: true });
    return () => document.removeEventListener("click", handler);
  }, []);
}
