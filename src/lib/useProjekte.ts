// Projekte laden und mit Versionsprüfung speichern — derselbe Weg wie
// useBewusst: frisch vom Server lesen, Änderung darauf anwenden, mit dem
// gelesenen Stand als `base` schreiben; bei 409 (Hermes oder ein zweites
// Gerät war schneller) das Ganze noch einmal. Nichts wird blind überschrieben.

import { useCallback, useEffect, useRef, useState } from "react";
import { SCHLUESSEL } from "./store";
import { ProjektFehler, leer, type Herkunft, type Kontext, type ProjekteState } from "./projekte";
import { STAND_WEITER } from "./syncBasis";

const KEY = SCHLUESSEL.projekte;
const ROUTE = "/api/projekte";
export const PROJEKTE_GEAENDERT = "morning:projekte-changed";
const TAKT_MS = 30_000;
const VERSUCHE = 4;
const zeit = () => AbortSignal.timeout(8000);

async function holen(): Promise<{ roh: string | null; stand: ProjekteState }> {
  const r = await fetch(ROUTE, { cache: "no-store", signal: zeit() });
  if (!r.ok) throw new Error("Projekte sind gerade nicht erreichbar.");
  const { value } = (await r.json()) as { value: string | null };
  const stand = value === null ? leer() : KEY.lese(value);
  if (!stand) throw new Error("Projekte sind gespeichert, aber nicht lesbar. Nichts wurde überschrieben.");
  return { roh: value, stand };
}

export type Aenderung = (s: ProjekteState, k: Kontext) => ProjekteState;

export function useProjekte() {
  const [stand, setStand] = useState<ProjekteState | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const speichert = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let lebt = true;
    const auffrischen = async () => {
      if (speichert.current) return;
      const gen = ++generation.current;
      try {
        const { stand: neu } = await holen();
        if (lebt && gen === generation.current) { setStand(neu); setFehler(""); }
      } catch (e) {
        if (lebt) setFehler(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
      }
    };
    void auffrischen();
    const takt = setInterval(auffrischen, TAKT_MS);
    window.addEventListener(PROJEKTE_GEAENDERT, auffrischen);
    return () => { lebt = false; clearInterval(takt); window.removeEventListener(PROJEKTE_GEAENDERT, auffrischen); };
  }, []);

  const aendere = useCallback(async (aenderung: Aenderung, von: Herkunft = "paul"): Promise<boolean> => {
    if (speichert.current) return false;
    speichert.current = true; generation.current++; setBusy(true);
    try {
      for (let versuch = 0; versuch < VERSUCHE; versuch++) {
        const { roh, stand: neuester } = await holen();
        const k: Kontext = { am: new Date().toISOString(), von, neueId: () => crypto.randomUUID() };
        const wert = KEY.schreibe(aenderung(neuester, k));
        if (wert === roh) { setStand(neuester); setFehler(""); return true; }
        const put = await fetch(ROUTE, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base: roh, value: wert }),
          signal: zeit(),
        });
        if (put.status === 409) continue;
        if (!put.ok) throw new Error("Speichern nicht bestätigt.");
        // Der Server hat seine Versionsmarke weitergesetzt — ohne diese Meldung
        // verlöre der nächste Gesamt-Upload still, was seither im Browser
        // geändert wurde (siehe syncBasis.ts).
        const sprung = (await put.json().catch(() => null)) as { vorher?: unknown; updatedAt?: unknown } | null;
        window.dispatchEvent(new CustomEvent(STAND_WEITER, { detail: { vorher: sprung?.vorher, nachher: sprung?.updatedAt } }));
        const zurueck = await holen();
        if (zurueck.roh !== wert) throw new Error("Rückleseprüfung fehlgeschlagen.");
        setStand(zurueck.stand); setFehler("");
        try { localStorage.setItem(KEY.name, wert); } catch { /* Speicher voll oder gesperrt: Server hat es */ }
        return true;
      }
      throw new Error("Gleichzeitige Änderungen.");
    } catch (e) {
      // Ein Regelverstoß (leerer Name, doppelt) ist kein Netzfehler — dann
      // genau den Grund zeigen, ohne „erneut versuchen".
      if (e instanceof ProjektFehler) setFehler(e.message);
      else setFehler(`Nicht gespeichert. ${e instanceof Error ? e.message : ""} Bitte erneut versuchen.`.replace(/\s+/g, " "));
      return false;
    } finally {
      speichert.current = false; setBusy(false);
    }
  }, []);

  return { stand, aendere, busy, fehler };
}
