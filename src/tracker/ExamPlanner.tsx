import { useEffect, useMemo, useState } from "react";
import { isoDate, useTracker } from "./store";
import { ladeLearnHarness, type Klausur } from "../lib/learnHarness";
import { planeAlle, type PlanerErgebnis } from "../lib/klausurPlaner";

// Exam planner — how much is due today and this week for an exam that
// LearnHarness has a plan for. English on purpose (Paul, 2026-10-31): the
// exams and the lessons are in English, so is their planner.
//
// WHERE THE NUMBERS COME FROM
// Effort, progress and understanding per focus come from LearnHarness (via
// the brain mirror, electron/learnHarness.cjs). Time spent today and this
// week comes from two clocks: Daily's timer for the matching subject and the
// minutes LearnHarness measured in the exam sessions — per day the larger of
// the two (lernminuten). The arithmetic lives in src/lib/klausurPlaner.ts.

const LAGE: Record<"im-plan" | "knapp" | "zu-knapp", { label: string; color: string }> = {
  "im-plan": { label: "On track", color: "var(--color-positive)" },
  knapp: { label: "Tight", color: "var(--color-orange)" },
  "zu-knapp": { label: "Behind", color: "var(--color-negative, #f87171)" },
};

function hm(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function Bar({ value, color = "var(--color-blue)" }: { value: number; color?: string }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
      <span
        className="block h-full rounded-full origin-left transition-transform duration-300"
        style={{ background: color, transform: `scaleX(${Math.min(1, Math.max(0, value))})` }}
      />
    </span>
  );
}

function PlannerCard({ k, plan, fachGefunden }: { k: Klausur; plan: Exclude<PlanerErgebnis, { phase: "ohne-datum" | "vorbei" }>; fachGefunden: boolean }) {
  const [open, setOpen] = useState(false);
  const lage = LAGE[plan.lage];
  const doneToday = plan.tagesziel - plan.heuteNoch;
  return (
    <section
      aria-label={`Exam planner ${k.name}`}
      className="px-4 py-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] text-[12px] flex flex-col gap-3"
    >
      <header className="flex items-center gap-2 flex-wrap">
        <span aria-hidden="true">🎯</span>
        <span className="font-display font-semibold text-[14px] text-fg">{k.name}</span>
        <span className="text-fg-secondary">
          exam in {plan.tageBisKlausur} {plan.tageBisKlausur === 1 ? "day" : "days"}
          {k.datum ? ` · ${dateLabel(k.datum)}` : ""}
        </span>
        <span
          className="ml-auto px-2 py-0.5 rounded-full text-[11px] font-semibold"
          style={{ color: lage.color, border: `1px solid ${lage.color}`, background: "color-mix(in srgb, currentColor 10%, transparent)" }}
        >
          {plan.phase === "wiederholung" ? `Revision · ${lage.label}` : lage.label}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">Today</span>
            <span className="metric text-[18px] tabular-nums text-fg">{hm(doneToday)}</span>
            <span className="text-fg-tertiary tabular-nums">of {hm(plan.tagesziel)}</span>
            <span className="ml-auto text-fg-secondary tabular-nums">
              {plan.heuteNoch > 0 ? `${hm(plan.heuteNoch)} to go` : "done for today ✓"}
            </span>
          </div>
          <Bar value={plan.tagesziel ? doneToday / plan.tagesziel : 1} color={lage.color} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">This week</span>
            <span className="metric text-[18px] tabular-nums text-fg">{hm(plan.wocheIst)}</span>
            <span className="text-fg-tertiary tabular-nums">of {hm(plan.wochenziel)}</span>
          </div>
          <Bar value={plan.wochenziel ? plan.wocheIst / plan.wochenziel : 0} />
        </div>
      </div>

      {plan.heuteDran.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
            {plan.phase === "wiederholung" ? "Revise today" : "Up next today"}
          </span>
          <ol className="flex flex-col gap-1">
            {plan.heuteDran.map((h) => (
              <li key={h.titel} className="flex items-center gap-2">
                <span className="font-display font-semibold text-fg truncate min-w-0">{h.titel}</span>
                {h.wiederholen && (
                  <span className="shrink-0 px-1.5 rounded text-[10px] text-[var(--color-orange)] border border-[var(--color-orange)]/40">
                    review
                  </span>
                )}
                <span className="ml-auto shrink-0 text-fg-secondary tabular-nums whitespace-nowrap">{hm(h.minuten)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-fg-tertiary">
        {Math.round(plan.gesamtErledigt * 100)} % of the plan done · {plan.restStunden} h left ·{" "}
        {plan.phase === "lernen"
          ? `${plan.tageUebrig} study ${plan.tageUebrig === 1 ? "day" : "days"} before revision (planned ${hm(plan.planProTag)}/day)`
          : `${plan.tageUebrig} ${plan.tageUebrig === 1 ? "day" : "days"} of revision left`}
        {!fachGefunden && " · no Daily subject matches this exam, so only LearnHarness time counts"}
      </p>

      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-[11px] text-fg-secondary hover:text-fg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded"
        >
          {open ? "Hide topics" : `All ${k.fokusse.length} topics`} ›
        </button>
        {open && (
          <ul className="mt-2 flex flex-col gap-2">
            {k.fokusse.map((f) => (
              <li key={f.titel} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
                <span className="truncate min-w-0 text-fg">{f.titel}</span>
                <span className="text-fg-tertiary tabular-nums whitespace-nowrap">
                  {f.verstaendnis !== null ? `${Math.round(f.verstaendnis * 100)} % right` : f.angefangen ? "started" : "not started"}
                  {f.offeneFragen > 0 && <span className="text-[var(--color-orange)]"> · ?{f.offeneFragen}</span>}
                  {f.aufwandStunden ? ` · ${f.aufwandStunden} h` : ""}
                </span>
                <span className="col-span-2"><Bar value={f.erledigt} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ExamPlanner() {
  const { subjects, sessions } = useTracker();
  const [klausuren, setKlausuren] = useState<Klausur[]>([]);

  useEffect(() => {
    let alive = true;
    ladeLearnHarness().then((d) => { if (alive && d.ok) setKlausuren(d.klausuren.filter((k) => k.fokusse.length > 0)); });
    return () => { alive = false; };
  }, []);

  const heute = isoDate();
  // Dieselbe Rechnung wie auf der Morgens-Seite (lib/lernHeute.ts).
  const plaene = useMemo(() => planeAlle(klausuren, subjects, sessions, heute), [klausuren, subjects, sessions, heute]);

  const sichtbar = plaene.filter((p) => p.plan.phase === "lernen" || p.plan.phase === "wiederholung");
  if (sichtbar.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {sichtbar.map(({ k, plan, fachGefunden }) => (
        <PlannerCard
          key={`${k.name}|${k.datum ?? ""}`}
          k={k}
          plan={plan as Exclude<PlanerErgebnis, { phase: "ohne-datum" | "vorbei" }>}
          fachGefunden={fachGefunden}
        />
      ))}
    </div>
  );
}
