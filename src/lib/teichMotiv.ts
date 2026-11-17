// Welche Tiere im ASCII-Teich hinter dem Thema „Glas" schwimmen.
//
// Paul, 2026-11-16: „mehr Tiere … zwischen denen ich wechseln kann". Wie im
// Vorbild-Video eine Art je Motiv; „aus" schaltet den Teich ganz ab.
// Die Wahl liegt im localStorage wie der Stil (lib/stil.ts); geändert nur über
// `setTeichMotiv`, das ein Ereignis schickt, damit alles ohne Neuladen
// umschaltet.

import { useSyncExternalStore } from "react";
import type { Art } from "./asciiTiere";

export type TeichMotiv = "koi" | "libellen" | "quallen" | "schmetterlinge" | "voegel" | "aus";

export const TEICH_MOTIVE: readonly TeichMotiv[] = ["koi", "libellen", "quallen", "schmetterlinge", "voegel", "aus"];

export const MOTIV_NAMEN: Record<TeichMotiv, string> = {
  koi: "Koi",
  libellen: "Libellen",
  quallen: "Quallen",
  schmetterlinge: "Falter",
  voegel: "Vögel",
  aus: "Aus",
};

const MOTIV_ART: Record<Exclude<TeichMotiv, "aus">, Art> = {
  koi: "koi",
  libellen: "libelle",
  quallen: "qualle",
  schmetterlinge: "schmetterling",
  voegel: "vogel",
};

const KEY = "morning.teichMotiv";
const EVENT = "morning:teichMotiv";

export function artZumMotiv(motiv: TeichMotiv): Art | null {
  return motiv === "aus" ? null : MOTIV_ART[motiv];
}

export function loadTeichMotiv(): TeichMotiv {
  try {
    const v = localStorage.getItem(KEY) as TeichMotiv | null;
    return v && TEICH_MOTIVE.includes(v) ? v : "koi";
  } catch {
    return "koi";
  }
}

export function setTeichMotiv(motiv: TeichMotiv): void {
  try { localStorage.setItem(KEY, motiv); } catch { /* quota */ }
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

export function useTeichMotiv(): TeichMotiv {
  return useSyncExternalStore(subscribe, loadTeichMotiv, () => "koi");
}
