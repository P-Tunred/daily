// Das Mikrofon für „Mit Hermes sprechen" — offen, solange das Gespräch läuft
// oder das Hörbriefing mithört.
//
// DREI ZUSTÄNDE
//   ruhe       offen, aber nichts passiert (nur der Vorlauf läuft mit)
//   lauschen   wartet darauf, dass Paul dazwischenredet (src/lib/dazwischen.ts)
//   aufnahme   nimmt auf, bis Paul aufhört (src/lib/stille.ts)
// Rohe Samples statt MediaRecorder: so liegt beim Auslösen immer die letzte
// gute Sekunde im Vorlauf, und die Aufnahme beginnt mit Pauls erstem Wort,
// nicht mit dem dritten. Abgeschickt wird WAV (src/lib/wav.ts).
//
// ScriptProcessorNode ist veraltet, läuft aber überall (Chromium, Electron,
// Safari) ohne eigene Worklet-Datei — und ein Fenster von 2048 Samples
// (~43 ms) ist genau der Takt, den Stille- und Dazwischen-Erkennung brauchen.

import { START, schritt as stilleSchritt, rms, type Grund, type StilleZustand } from "./stille";
import { LAUSCHEN, lauschSchritt, type LauschZustand } from "./dazwischen";
import { alsWav } from "./wav";

const FENSTER = 2048;
const VORLAUF_MS = 1200;

export interface Aufnahme {
  blob: Blob | null;   // null: es wurde nichts gesagt (oder abgebrochen)
  grund: Grund | "abgebrochen";
}

export interface Mikrofon {
  /** Auf Dazwischenreden warten; `beiSprache` kommt höchstens einmal.
   *  Lauscht es schon, bleibt die gelernte Echo-Hülle erhalten (Hermes'
   *  Antwort kommt Satz für Satz — kein neues Einschwingen je Satz). */
  lausche: (beiSprache: () => void) => void;
  /** Nicht mehr lauschen (eine laufende Aufnahme bleibt unberührt). */
  stillHalten: () => void;
  /** Aufnehmen bis zur Stille. `schonGesprochen`: Paul redet bereits
   *  (Dazwischenreden) — dann beginnt die Aufnahme mit dem Vorlauf und
   *  zählt schon als Rede. `nichtsMs`: so lange auf den ersten Laut warten. */
  nimmAuf: (opt?: { schonGesprochen?: boolean; nichtsMs?: number }) => Promise<Aufnahme>;
  fertigJetzt: () => void;
  abbrechen: () => void;
  schliesse: () => void;
}

type Modus =
  | { readonly art: "ruhe" }
  | { readonly art: "lauschen"; readonly z: LauschZustand; readonly beiSprache: () => void }
  | {
      readonly art: "aufnahme";
      readonly z: StilleZustand;
      readonly teile: readonly Float32Array[];
      readonly gesprochen: boolean;
      readonly fertig: (grund: Aufnahme["grund"], teile: readonly Float32Array[], gesprochen: boolean) => void;
    };

const RUHE: Modus = { art: "ruhe" };

export function mikrofonMoeglich(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
}

function leer(grund: Aufnahme["grund"], gesprochen: boolean): boolean {
  return grund === "abgebrochen" || grund === "nichts" || (!gesprochen && grund !== "stille");
}

/** Öffnet das Mikrofon. `onPegel` bekommt 0..1 für die Anzeige. */
export async function oeffneMikrofon(onPegel?: (p: number) => void): Promise<Mikrofon> {
  const strom = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const loslassen = () => strom.getTracks().forEach((t) => t.stop());
  let ctx: AudioContext | null = null;
  let quelle: MediaStreamAudioSourceNode;
  let proz: ScriptProcessorNode;
  try {
    ctx = new AudioContext();
    void ctx.resume();
    quelle = ctx.createMediaStreamSource(strom);
    proz = ctx.createScriptProcessor(FENSTER, 1, 1);
    const stumm = ctx.createGain();
    stumm.gain.value = 0;   // der Prozessor muss am Ausgang hängen, sonst läuft er nicht
    quelle.connect(proz);
    proz.connect(stumm);
    stumm.connect(ctx.destination);
  } catch (e) {
    loslassen();   // sonst bliebe das Mikrofon-Lämpchen an
    void ctx?.close();
    throw e;
  }
  const audioCtx = ctx;

  const dtMs = (FENSTER / audioCtx.sampleRate) * 1000;
  const vorlaufMax = Math.max(1, Math.ceil(VORLAUF_MS / dtMs));
  let vorlauf: readonly Float32Array[] = [];
  let modus: Modus = RUHE;
  let zu = false;

  proz.onaudioprocess = (e) => {
    const f = new Float32Array(e.inputBuffer.getChannelData(0));
    const pegel = rms(f);
    onPegel?.(Math.min(1, pegel * 8));
    vorlauf = [...vorlauf.slice(1 - vorlaufMax), f];
    const m = modus;
    if (m.art === "lauschen") {
      const r = lauschSchritt(m.z, pegel, dtMs);
      if (r.ausgeloest) { modus = RUHE; m.beiSprache(); } else modus = { ...m, z: r.zustand };
    } else if (m.art === "aufnahme") {
      const z = stilleSchritt(m.z, pegel, dtMs);
      const teile = [...m.teile, f];
      const gesprochen = m.gesprochen || z.phase === "spricht";
      if (z.phase === "fertig") { modus = RUHE; m.fertig(z.grund ?? "stille", teile, gesprochen); }
      else modus = { ...m, z, teile, gesprochen };
    }
  };

  const beendeAufnahme = (grund: Aufnahme["grund"]) => {
    const m = modus;
    if (m.art !== "aufnahme") return;
    modus = RUHE;
    m.fertig(grund, m.teile, m.gesprochen);
  };

  const nimmAuf = ({ schonGesprochen = false, nichtsMs }: { schonGesprochen?: boolean; nichtsMs?: number } = {}): Promise<Aufnahme> => {
    beendeAufnahme("abgebrochen");
    return new Promise((ok) => {
      modus = {
        art: "aufnahme",
        z: schonGesprochen ? { ...START, phase: "spricht" } : { ...START, nichtsMs },
        teile: schonGesprochen ? vorlauf : [],   // sonst wäre der Vorlauf nur Echo von Hermes oder dem Briefing
        gesprochen: schonGesprochen,
        fertig: (grund, teile, gesprochen) => {
          onPegel?.(0);
          const blob = leer(grund, gesprochen) ? null : new Blob([alsWav(teile, audioCtx.sampleRate) as BlobPart], { type: "audio/wav" });
          ok({ blob, grund });
        },
      };
    });
  };

  return {
    lausche: (beiSprache) => {
      if (zu || modus.art === "aufnahme") return;
      modus = { art: "lauschen", z: modus.art === "lauschen" ? modus.z : LAUSCHEN, beiSprache };
    },
    stillHalten: () => { if (modus.art === "lauschen") modus = RUHE; },
    nimmAuf,
    fertigJetzt: () => beendeAufnahme("stille"),
    abbrechen: () => beendeAufnahme("abgebrochen"),
    schliesse: () => {
      if (zu) return;
      zu = true;
      beendeAufnahme("abgebrochen");
      modus = RUHE;
      proz.onaudioprocess = null;
      quelle.disconnect();
      proz.disconnect();
      loslassen();
      void audioCtx.close();
      onPegel?.(0);
    },
  };
}
