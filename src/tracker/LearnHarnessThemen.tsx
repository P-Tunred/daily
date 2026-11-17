import { useEffect, useState } from "react";
import { useTimerContext } from "./TimerContext";
import { useTracker } from "./store";
import { fmtMinuten, ladeLearnHarness, type Klausur, type LearnHarnessStand } from "../lib/learnHarness";

/** „in 12 Tagen“, „morgen“, „heute“. */
function bis(k: Klausur): string {
  if (k.tage === null) return "ohne Datum";
  if (k.tage === 0) return "heute";
  if (k.tage === 1) return "morgen";
  return `in ${k.tage} Tagen`;
}

// Eine Klausur, für die LearnHarness einen Auftrag hat: wie nah, wie weit.
// Nah (≤ 7 Tage) und kaum angefangen wird orange — das ist der Moment, in
// dem die Zeile etwas sagen soll.
function KlausurZeile({ k }: { k: Klausur }) {
  const anteil = k.schwerpunkte ? k.angefangen / k.schwerpunkte : 0;
  const knapp = k.tage !== null && k.tage <= 7 && anteil < 0.5;
  return (
    <li className="flex items-center gap-2 flex-wrap">
      <span aria-hidden="true">🎯</span>
      <span className="font-display font-semibold text-fg">{k.name}</span>
      <span className={knapp ? "text-[var(--color-orange)]" : "text-fg-secondary"}>{bis(k)}</span>
      <span className="text-fg-tertiary tabular-nums whitespace-nowrap">
        {k.angefangen} von {k.schwerpunkte} Schwerpunkten angefangen
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-16 rounded-full bg-white/[0.08] overflow-hidden"
      >
        <span
          className="block h-full rounded-full bg-[var(--color-blue)] origin-left"
          style={{ transform: `scaleX(${anteil})` }}
        />
      </span>
      {k.minuten > 0 && <span className="text-fg-tertiary tabular-nums whitespace-nowrap">{fmtMinuten(k.minuten)}</span>}
      {k.offeneFragen > 0 && (
        <span className="text-[var(--color-orange)] tabular-nums whitespace-nowrap">?{k.offeneFragen}</span>
      )}
    </li>
  );
}

// Woran Paul gerade in LearnHarness lernt — eine ruhige Zeile unter dem Timer.
//
// WARUM HIER
// Auf der Lernzeit-Seite fällt die Entscheidung, woran Paul sich als Nächstes
// setzt. Die Themen aus LearnHarness sind die zweite Hälfte dieses Bildes:
// Dailys Timer misst die Zeit, LearnHarness weiss, WELCHES Thema dran war.
// Die Minuten bleiben getrennt — sie zählen nicht in Dailys Lernzeit.
//
// Läuft ein Timer, rücken die Themen nach vorn, die zu seinem Fach passen.
// Gibt es keinen Stand (LearnHarness nicht verbunden), bleibt die Zeile weg.
export function LearnHarnessThemen() {
  const { focusTimer, stopwatch } = useTimerContext();
  const { subjects } = useTracker();
  const laufendId = (focusTimer?.mode === "focus" ? focusTimer.subjectId : null) ?? stopwatch?.subjectId ?? null;
  const fach = laufendId ? subjects.find((s) => s.id === laufendId)?.name : undefined;
  const [stand, setStand] = useState<LearnHarnessStand | null>(null);

  useEffect(() => {
    let alive = true;
    ladeLearnHarness(fach).then((d) => { if (alive) setStand(d); });
    return () => { alive = false; };
  }, [fach]);

  if (!stand?.ok || (stand.themen.length === 0 && stand.ohneFach.length === 0 && !stand.klausuren.some((k) => k.fokusse.length === 0))) return null;
  const themen = [...stand.themen].sort((a, b) => Number(!!b.passtZumFach) - Number(!!a.passtZumFach));
  const datum = new Date(stand.stand).toLocaleDateString("de-DE", { day: "numeric", month: "short" });

  return (
    <section
      aria-label="Themen aus LearnHarness"
      className="px-4 py-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] text-[12px] flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span aria-hidden="true">🧠</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
          In LearnHarness · letzte {stand.tage} Tage
        </span>
        <span className="text-fg-secondary tabular-nums whitespace-nowrap">{fmtMinuten(stand.minuten)}</span>
        <span className={`ml-auto text-[11px] ${stand.veraltet ? "text-[var(--color-orange)]" : "text-fg-tertiary"}`}>
          {stand.veraltet ? `Stand ${datum} — veraltet` : `Stand ${datum}`}
        </span>
      </div>
      {stand.ohneFach.length > 0 && (
        <p className="text-[11px] text-[var(--color-orange)]">
          Gespeichert in LearnHarness, aber ohne passendes Fach hier: {stand.ohneFach.join(", ")} — Fach anlegen
          oder den Chat in LearnHarness einem Fach zuordnen, dann kommt die Zeit an.
        </p>
      )}
      {stand.klausuren.some((k) => k.fokusse.length === 0) && (
        <ul aria-label="Klausuren" className="flex flex-col gap-1">
          {/* Klausuren mit Schwerpunkten zeigt der Planer darüber ausführlich. */}
          {stand.klausuren.filter((k) => k.fokusse.length === 0).map((k) => <KlausurZeile key={`${k.name}|${k.datum ?? ""}`} k={k} />)}
        </ul>
      )}
      {themen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {themen.map((t) => (
            <li
              key={`${t.titel}|${t.rahmen ?? ""}`}
              title={`Zuletzt ${t.zuletzt}${t.offeneFragen ? ` · ${t.offeneFragen} offene Fragen` : ""}${t.ueben ? " · auch geübt" : ""}`}
              className={
                "flex items-center gap-1.5 min-w-0 max-w-full px-2.5 py-1 rounded-full border " +
                (t.passtZumFach
                  ? "border-[var(--color-blue)]/40 bg-[var(--color-blue)]/10 text-fg"
                  : "border-white/[0.08] bg-white/[0.03] text-fg-secondary")
              }
            >
              <span className="font-display font-semibold truncate min-w-0 max-w-[220px]">{t.titel}</span>
              {t.rahmen && <span className="text-fg-tertiary truncate min-w-0 max-w-[120px]">{t.rahmen}</span>}
              <span className="text-fg-tertiary tabular-nums whitespace-nowrap shrink-0">{fmtMinuten(t.minuten)}</span>
              {t.offeneFragen > 0 && (
                <span className="text-[var(--color-orange)] tabular-nums shrink-0" aria-label={`${t.offeneFragen} offene Fragen`}>
                  ?{t.offeneFragen}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
