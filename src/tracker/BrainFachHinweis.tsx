import { useEffect, useState } from "react";
import { ladeBrainFach, type BrainFach } from "../lib/brainFach";

// Was das Second Brain zum Fach weiss, das gerade im Timer läuft.
//
// WARUM UNTER DEM TIMER UND NICHT ALS EIGENE KARTE
// Die Stichpunkte sind nur in dem Moment nützlich, in dem Paul sich an das
// Fach setzt — als Erinnerung, was dran ist. Eine Karte, die immer da ist,
// wird zur Tapete. Deshalb: eine Zeile, eingeklappt, nur solange ein Timer
// läuft, und nur wenn es überhaupt eine passende Seite gibt.

// Beim Fachwechsel baut TimerWidget die Komponente über `key` neu auf — so
// startet sie eingeklappt und ohne die Seiten des vorigen Fachs.
export function BrainFachHinweis({ fach }: { fach: string }) {
  const [data, setData] = useState<BrainFach | null>(null);
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    let alive = true;
    ladeBrainFach(fach).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [fach]);

  const seite = data?.seiten[0];
  if (!seite) return null;
  const weitere = data.seiten.slice(1);

  return (
    <div className="px-4 py-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] text-[12px]">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        aria-expanded={offen}
        className="w-full flex items-center gap-2 text-left text-fg-secondary hover:text-fg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-lg"
      >
        <span aria-hidden="true">📓</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary shrink-0">
          {seite.eigeneSeite ? "Aus dem Brain" : "Im Brain erwähnt"}
        </span>
        <span className="truncate font-display font-semibold">{seite.titel}</span>
        <span
          aria-hidden="true"
          className="ml-auto text-fg-tertiary transition-transform duration-150"
          style={{ transform: offen ? "rotate(90deg)" : "none" }}
        >
          ›
        </span>
      </button>

      {offen && (
        <div className="mt-2 flex flex-col gap-2">
          <ul className="flex flex-col gap-1 pl-5 list-disc marker:text-fg-tertiary text-fg-secondary">
            {seite.punkte.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <a
              href={seite.obsidian}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-blue)] hover:underline"
            >
              In Obsidian öffnen
            </a>
            {seite.offeneFragen > 0 && (
              <span className="text-fg-tertiary">
                {seite.offeneFragen} offene {seite.offeneFragen === 1 ? "Frage" : "Fragen"} auf der Seite
              </span>
            )}
            <span className="text-fg-tertiary">
              Stand {new Date(seite.stand).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
            </span>
          </div>
          {weitere.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-fg-tertiary">
              <span>Auch:</span>
              {weitere.map((w) => (
                <a key={w.datei} href={w.obsidian} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
                  {w.titel}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
