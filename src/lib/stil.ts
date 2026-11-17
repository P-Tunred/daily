// Der Stil der ganzen App: „Original" oder „G".
//
// Paul, 2026-11-01: „ich will, dass es so aussieht wie in G — einfach nur als
// Setting für G … als Stil". G ist Seite G im Design-Canvas („Glas-Vexto"):
// die Startseite wie „Still", alles darunter und die Lernzeit im Aufbau von G
// (Glasblätter, Pillen, Lineal, Punkte, gespaltene Zahlen, Akzent als Funke).
// Unabhängig von der Startseiten-Wahl (lib/introLayout.ts): wer „Original"
// wählt, sieht die App genau wie vorher.
//
// Die Wahl liegt im localStorage wie das Thema; geändert nur über `setStil`,
// das ein Ereignis schickt, damit alles ohne Neuladen umschaltet.

import { useSyncExternalStore } from "react";

export type Stil = "original" | "g";

export const STILE: readonly Stil[] = ["original", "g"];
const KEY = "morning.stil";
const EVENT = "morning:stil";

export function loadStil(): Stil {
  try {
    return localStorage.getItem(KEY) === "g" ? "g" : "original";
  } catch {
    return "original";
  }
}

export function setStil(stil: Stil): void {
  try { localStorage.setItem(KEY, stil); } catch { /* quota */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStil(): Stil {
  return useSyncExternalStore(subscribe, loadStil, () => "original");
}
