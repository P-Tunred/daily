// Absprache zwischen dem Hörbriefing-Knopf und „Mit Hermes sprechen".
//
// Der Player meldet, ob und wo er spielt; die Stimme hört dann mit. Redet Paul
// dazwischen, bittet die Stimme um Pause — der Player hält an und meldet die
// genaue Stelle sofort (synchron, im selben Aufruf), damit Hermes weiss, bis
// wohin Paul gehört hat. Nach dem Gespräch bittet sie um „weiter", und das
// Briefing läuft zwei Sekunden vor der Stelle wieder an.
// Fensterereignisse wie im Rest der App (lib/db.ts, lib/sync.ts): die beiden
// Komponenten kennen einander nicht.

export const BRIEFING_STAND = "morning:hoerbriefing-stand";
const BRIEFING_PAUSE = "morning:hoerbriefing-pause";
const BRIEFING_WEITER = "morning:hoerbriefing-weiter";
const ZURUECK_SEK = 2;

export interface BriefingStand {
  readonly spielt: boolean;
  readonly sek: number;
  readonly gesamt: number;
}

export function meldeBriefing(stand: BriefingStand): void {
  window.dispatchEvent(new CustomEvent<BriefingStand>(BRIEFING_STAND, { detail: stand }));
}

export function hoereBriefing(beiStand: (s: BriefingStand) => void): () => void {
  const f = (e: Event) => beiStand((e as CustomEvent<BriefingStand>).detail);
  window.addEventListener(BRIEFING_STAND, f);
  return () => window.removeEventListener(BRIEFING_STAND, f);
}

export function bittePause(): void {
  window.dispatchEvent(new Event(BRIEFING_PAUSE));
}

export function bitteWeiter(): void {
  window.dispatchEvent(new CustomEvent<number>(BRIEFING_WEITER, { detail: ZURUECK_SEK }));
}

/** Für den Player: auf die beiden Bitten hören. */
export function hoereBitten(pause: () => void, weiter: (zurueckSek: number) => void): () => void {
  const p = () => pause();
  const w = (e: Event) => weiter(Number((e as CustomEvent<number>).detail) || 0);
  window.addEventListener(BRIEFING_PAUSE, p);
  window.addEventListener(BRIEFING_WEITER, w);
  return () => {
    window.removeEventListener(BRIEFING_PAUSE, p);
    window.removeEventListener(BRIEFING_WEITER, w);
  };
}
