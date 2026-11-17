// Welcher erste Bildschirm: das bisherige Intro („Original") oder „Still".
//
// Paul, 2026-11-01: „setze es um, aber lasse auch das Original-Design, ich
// würde gerne switchen können". Deshalb ein Schalter in den Einstellungen,
// kein Ersatz. Gilt nur für das Intro oben; alles darunter bleibt gleich.
//
// Die Wahl liegt im localStorage wie das Thema — eine Vorliebe dieses
// Fensters, kein Tagesstand. Geändert wird sie nur über `setIntroLayout`,
// das ein Ereignis schickt, damit das Intro ohne Neuladen umschaltet.

import { useSyncExternalStore } from "react";

export type IntroLayout = "original" | "still";

export const INTRO_LAYOUTS: readonly IntroLayout[] = ["original", "still"];
const KEY = "morning.introLayout";
const EVENT = "morning:intro-layout";

export function loadIntroLayout(): IntroLayout {
  try {
    const v = localStorage.getItem(KEY);
    return v === "still" ? "still" : "original";
  } catch {
    return "original";
  }
}

export function setIntroLayout(layout: IntroLayout): void {
  try { localStorage.setItem(KEY, layout); } catch { /* quota — gilt dann nur bis zum Neuladen nicht */ }
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

export function useIntroLayout(): IntroLayout {
  return useSyncExternalStore(subscribe, loadIntroLayout, () => "original");
}
