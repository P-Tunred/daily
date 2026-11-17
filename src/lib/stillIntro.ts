// Die Sätze des Still-Intros (components/StillIntro.tsx) — reine Regeln ohne
// React, damit sie sich testen lassen (tests/still-intro.test.mjs).

/** Teilt den Satz des Tages: der erste Satz trägt, der Rest ist Nachsatz. */
export function teileSatz(text: string): { satz: string; nachsatz: string } {
  const m = /^(.+?[.!?…])\s+(.+)$/s.exec(text.trim());
  return m ? { satz: m[1], nachsatz: m[2] } : { satz: text.trim(), nachsatz: "" };
}

/** Lokaler Satz, wenn Hermes heute keine Heute-Zeile geschrieben hat. */
export function lokalerSatz(offen: number, weekCount: number): string {
  if (offen > 0) return "Nur das hier musst du heute machen. Mehr nicht.";
  if (weekCount > 0) return "Heute steht nichts Festes an. Die Woche wartet trotzdem.";
  return "Nichts Festes heute. Mach draus, was du willst.";
}

export function urteil(score: number, totalMin: number): string {
  if (score >= 85) return "Reicht für heute.";
  if (score >= 55) return "Gut unterwegs.";
  if (score >= 30) return "Halb drin.";
  if (score > 0 || totalMin > 0) return "Ein Anfang.";
  return "Noch nichts eingetragen.";
}

/** Der Ziel-Hinweis — dieselben Teile wie der Tooltip im Original-Intro.
 *  Bekommt fertig formatierte Zeiten, damit hier nichts aus dem Browser hängt. */
export function zielHinweisText(ziel: string, budget: string, teile: string[]): string {
  const woher = teile.length ? ` Aus: ${teile.join(" · ")}.` : "";
  return `Ziel heute ${ziel}, von ${budget} verfügbar.${woher}`;
}
