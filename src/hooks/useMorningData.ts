import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent, Email, Task } from "../types";
import { fetchCalendarToday, fetchCalendarUpcoming, fetchUnreadEmails, fetchTasks } from "../lib/mcp";

type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const initial = <T>(): Resource<T> => ({
  data: null,
  loading: true,
  error: null,
});

/** Returns milliseconds until the next local midnight. */
function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export function useMorningData() {
  const [events, setEvents] = useState<Resource<CalendarEvent[]>>(initial);
  const [upcoming, setUpcoming] = useState<Resource<CalendarEvent[]>>(initial);
  const [emails, setEmails] = useState<Resource<Email[]>>(initial);
  const [tasks, setTasks] = useState<Resource<Task[]>>(initial);
  const midnightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(() => {
    let cancelled = false;

    setEvents((prev) => ({ ...prev, loading: true }));
    setUpcoming((prev) => ({ ...prev, loading: true }));
    setEmails((prev) => ({ ...prev, loading: true }));
    setTasks((prev) => ({ ...prev, loading: true }));

    fetchCalendarToday()
      .then((d) => !cancelled && setEvents({ data: d, loading: false, error: null }))
      .catch((e) =>
        !cancelled &&
        setEvents({ data: null, loading: false, error: String(e?.message ?? e) }),
      );

    fetchCalendarUpcoming()
      .then((d) => !cancelled && setUpcoming({ data: d, loading: false, error: null }))
      .catch(() =>
        !cancelled && setUpcoming({ data: [], loading: false, error: null }),
      );

    fetchUnreadEmails()
      .then((d) => !cancelled && setEmails({ data: d, loading: false, error: null }))
      .catch((e) =>
        !cancelled &&
        setEmails({ data: null, loading: false, error: String(e?.message ?? e) }),
      );

    fetchTasks()
      .then((d) => !cancelled && setTasks({ data: d, loading: false, error: null }))
      .catch((e) =>
        !cancelled &&
        setTasks({ data: null, loading: false, error: String(e?.message ?? e) }),
      );

    return () => { cancelled = true; };
  }, []);

  // Initial fetch
  useEffect(() => {
    const cancel = fetchAll();
    return cancel;
  }, [fetchAll]);

  // Auto-refresh calendar every 15 minutes so recurring events stay current
  useEffect(() => {
    const id = setInterval(() => {
      let cancelled = false;
      setEvents((prev) => ({ ...prev, loading: true }));
      setUpcoming((prev) => ({ ...prev, loading: true }));
      fetchCalendarToday()
        .then((d) => !cancelled && setEvents({ data: d, loading: false, error: null }))
        .catch((e) => !cancelled && setEvents({ data: null, loading: false, error: String(e?.message ?? e) }));
      fetchCalendarUpcoming()
        .then((d) => !cancelled && setUpcoming({ data: d, loading: false, error: null }))
        .catch(() => !cancelled && setUpcoming({ data: [], loading: false, error: null }));
      return () => { cancelled = true; };
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh at midnight so the calendar flips to the new day's events
  useEffect(() => {
    function scheduleMidnightRefresh() {
      midnightTimer.current = setTimeout(() => {
        fetchAll();
        scheduleMidnightRefresh(); // reschedule for the next midnight
      }, msUntilMidnight());
    }
    scheduleMidnightRefresh();
    return () => {
      if (midnightTimer.current) clearTimeout(midnightTimer.current);
    };
  }, [fetchAll]);

  return { events, upcoming, emails, tasks, setTasks };
}
