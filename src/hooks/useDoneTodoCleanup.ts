import { useEffect, useRef } from "react";
import { msUntilNextTwoAm, sweepDoneTodos } from "../lib/todoCleanup";

/**
 * Keeps the todo lists clean: everything ticked off before the last 2 AM is
 * removed, automatically.
 *
 * Three triggers, because a single timer is not trustworthy here:
 *   1. On mount — catches every night the app simply wasn't running.
 *   2. A timer that fires at 2 AM and reschedules itself — catches the app
 *      being left open overnight.
 *   3. Waking up (tab visible again / window focused) — a Mac that slept
 *      through 2 AM suspends the timer, and Chromium throttles background
 *      timers hard. The sweep is a no-op outside the boundary, so re-running
 *      it on wake costs nothing and closes the gap.
 *
 * Mount this once, at app level — not inside a page component, or it stops
 * running the moment that page is not on screen.
 */
export function useDoneTodoCleanup(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void sweepDoneTodos();

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void sweepDoneTodos();
        schedule();
      }, msUntilNextTwoAm());
    };
    schedule();

    // Re-arm on wake: the pending timeout may have been suspended or delayed,
    // and its deadline is stale after a long sleep. Deliberately NOT gated on
    // document.visibilityState — a backgrounded or minimized window reports
    // "hidden", which is exactly the case whose timer we don't trust. The sweep
    // is idempotent and a no-op outside the boundary, so running it too often
    // costs nothing; skipping it once can leave done todos sitting for a day.
    const onWake = () => {
      void sweepDoneTodos();
      schedule();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);
}
