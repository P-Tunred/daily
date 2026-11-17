// Wann eine Aufnahme von selbst endet — für „Mit Hermes sprechen".
//
// Paul redet und hört dann einfach auf; kein zweiter Klick. Gemessen wird der
// Pegel (RMS, 0..1) in kurzen Schritten. Erst wer eine Viertelsekunde am Stück
// laut ist, „spricht" — ein Knacken oder Husten startet nichts. Danach endet
// die Aufnahme nach gut einer Sekunde Stille; kurzes Luftholen setzt die Uhr
// zurück. Sagt Paul gar nichts, hört sie nach einigen Sekunden auf, und wer
// eine Minute durchredet, wird abgeschickt.
//
// Rein und unveränderlich, damit es ohne Mikrofon testbar ist
// (tests/stimme-stille.test.mjs).

export const SCHWELLE = 0.02;
export const SPRACHE_AB_MS = 250;
export const STILLE_MS = 1400;
export const NICHTS_MS = 7000;
export const HOECHSTENS_MS = 60_000;

export type Phase = "wartet" | "spricht" | "fertig";
export type Grund = "stille" | "nichts" | "zulang";

export interface StilleZustand {
  readonly phase: Phase;
  readonly sprachMs: number;
  readonly stilleMs: number;
  readonly gesamtMs: number;
  readonly grund?: Grund;
  /** Wie lange auf den ersten Laut gewartet wird (Vorgabe NICHTS_MS). */
  readonly nichtsMs?: number;
}

export const START: StilleZustand = Object.freeze({ phase: "wartet", sprachMs: 0, stilleMs: 0, gesamtMs: 0 });

const fertig = (z: StilleZustand, grund: Grund, gesamtMs: number): StilleZustand =>
  ({ ...z, phase: "fertig", grund, gesamtMs });

/** Ein Messschritt: Pegel über `dtMs` Millisekunden. */
export function schritt(z: StilleZustand, pegel: number, dtMs: number): StilleZustand {
  if (z.phase === "fertig") return z;
  const gesamtMs = z.gesamtMs + dtMs;
  const laut = pegel >= SCHWELLE;
  if (gesamtMs >= HOECHSTENS_MS) return fertig(z, "zulang", gesamtMs);

  if (z.phase === "wartet") {
    const sprachMs = laut ? z.sprachMs + dtMs : 0;
    if (sprachMs >= SPRACHE_AB_MS) return { ...z, phase: "spricht", sprachMs, stilleMs: 0, gesamtMs };
    if (gesamtMs >= (z.nichtsMs ?? NICHTS_MS)) return fertig(z, "nichts", gesamtMs);
    return { ...z, sprachMs, gesamtMs };
  }

  const stilleMs = laut ? 0 : z.stilleMs + dtMs;
  if (stilleMs >= STILLE_MS) return fertig(z, "stille", gesamtMs);
  return { ...z, stilleMs, gesamtMs, sprachMs: laut ? z.sprachMs + dtMs : z.sprachMs };
}

/** Pegel eines Messfensters (Float-Samples, -1..1). */
export function rms(samples: Float32Array): number {
  let summe = 0;
  for (let i = 0; i < samples.length; i++) summe += samples[i] * samples[i];
  return samples.length ? Math.sqrt(summe / samples.length) : 0;
}
