// Der Provider — die Komponente. Kontext, Typen und Hooks liegen in
// briefingContext.ts, damit diese Datei ausschliesslich Komponenten
// exportiert (Fast Refresh bricht sonst bei jeder Aenderung den Zustand ab).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadBriefing, heuteIso, type Briefing, type BriefingLines } from "./briefing";
import { BriefingCtx, herkunftText, type BriefingSicht, type BriefingStatus, type Surface } from "./briefingContext";

const STATUS_URL = "/api/briefing/status";
const RENDERED_URL = "/api/briefing/rendered";
const STATUS_POLL_MS = 60_000;

export function BriefingProvider({ children }: { children: ReactNode }) {
  const [briefing, setBriefing] = useState<Briefing | null>(() => loadBriefing());
  const [status, setStatus] = useState<BriefingStatus | null>(null);

  // Welche Flächen für welche Revision schon gemeldet wurden — damit dieselbe
  // Meldung nicht bei jedem Render erneut über die Leitung geht.
  const gemeldet = useRef<{ rev: string | null; surfaces: Set<Surface>; offen: Set<Surface> }>({
    rev: null, surfaces: new Set(), offen: new Set(),
  });

  const lesen = useCallback(() => setBriefing(loadBriefing()), []);

  // Nur noch das FACHLICH richtige Ereignis plus die allgemeinen Signale.
  // `morning:todos-changed` war eine Zufallsabhängigkeit: das Briefing wurde
  // aktualisiert, weil zufällig ein Todo kam — und blieb stehen, wenn keins kam.
  useEffect(() => {
    const beiSichtbar = () => { if (document.visibilityState === "visible") lesen(); };
    window.addEventListener("morning:briefing-changed", lesen);
    window.addEventListener("storage", lesen);
    document.addEventListener("visibilitychange", beiSichtbar);
    return () => {
      window.removeEventListener("morning:briefing-changed", lesen);
      window.removeEventListener("storage", lesen);
      document.removeEventListener("visibilitychange", beiSichtbar);
    };
  }, [lesen]);

  // Serverzustand holen. Schlägt das fehl, bleibt `status` null — die Anzeige
  // sagt dann ehrlich "Sync offline" statt "kein Briefing".
  useEffect(() => {
    let lebt = true;
    const holen = async () => {
      try {
        const res = await fetch(STATUS_URL, { cache: "no-store" });
        if (!res.ok && res.status !== 503) throw new Error("HTTP " + res.status);
        const s = (await res.json()) as BriefingStatus;
        if (lebt) setStatus(s);
      } catch {
        if (lebt) setStatus(null);
      }
    };
    void holen();
    const takt = setInterval(() => void holen(), STATUS_POLL_MS);
    const beiSichtbar = () => { if (document.visibilityState === "visible") void holen(); };
    document.addEventListener("visibilitychange", beiSichtbar);
    return () => { lebt = false; clearInterval(takt); document.removeEventListener("visibilitychange", beiSichtbar); };
  }, [briefing]);

  const zeilen = useMemo<BriefingLines | null>(() => {
    if (!briefing?.lines) return null;
    if (briefing.date !== heuteIso()) return null;   // DIE Datumsprüfung, genau einmal
    return briefing.lines;
  }, [briefing]);

  // Meldet gerenderte Flächen gebündelt. Gebündelt, weil vier Flächen im
  // selben Frame committen und vier einzelne POSTs Unsinn wären.
  const meldeGerendert = useCallback((surface: Surface) => {
    const rev = status?.revision ?? null;
    if (!rev) return;
    const z = gemeldet.current;
    if (z.rev !== rev) { z.rev = rev; z.surfaces = new Set(); z.offen = new Set(); }
    if (z.surfaces.has(surface)) return;
    z.surfaces.add(surface);
    z.offen.add(surface);
    queueMicrotask(() => {
      if (!z.offen.size) return;
      const surfaces = Array.from(z.offen);
      z.offen.clear();
      void fetch(RENDERED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha256: rev, surfaces }),
      }).catch(() => {
        // Kein Drama: die Revision bleibt "persisted, Anzeige nicht bestätigt".
        // Lieber ehrlich unbestätigt als fälschlich bestätigt.
        surfaces.forEach((s) => z.surfaces.delete(s));
      });
    });
  }, [status?.revision]);

  const wert = useMemo<BriefingSicht>(() => ({
    briefing,
    zeilen,
    status,
    herkunft: herkunftText(briefing, zeilen, status),
    meldeGerendert,
  }), [briefing, zeilen, status, meldeGerendert]);

  return <BriefingCtx.Provider value={wert}>{children}</BriefingCtx.Provider>;
}

