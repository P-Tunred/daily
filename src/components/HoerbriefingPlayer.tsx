// „Dein Tag zum Anhören" — das Hörbriefing im Intro, als EIN Knopf.
//
// Hermes schreibt den Text, der Server macht die Aufnahme (electron/
// hoerbriefing.cjs). Hier wird nur abgespielt — wann, entscheidet Paul
// („ich spiele sie ab"); nichts startet von selbst.
//
// SCHLICHT, SEIT 2026-11-01
// Paul: „etwas schlichter bitte integrieren". Also nur noch ein ruhiger Knopf
// mit Dauer: Klick spielt, Klick pausiert, die Zahl zählt herunter, eine
// Haarlinie zeigt den Fortschritt. Kein Text, kein Mitlesen, keine
// Spulleiste, kein Tempo, keine Frage darunter (die steht in „Kurze Frage").
// Gibt es keine fertige Aufnahme — noch nicht, gerade in Arbeit, oder
// fehlgeschlagen —, zeigt das Intro nichts. Den Ausfall meldet die
// Kanäle-Übersicht. Die Regeln dazu: src/lib/hoerbriefingKnopf.ts.
//
// DAZWISCHENREDEN (seit 2026-11-02)
// Der Knopf meldet, ob und wo er spielt (src/lib/briefingFunk.ts). Redet Paul
// dazwischen, hält er auf Bitte von „Mit Hermes sprechen" an und läuft nach
// dem Gespräch zwei Sekunden vor der Stelle weiter — aber nur, wenn ER es war,
// der angehalten hat. Hat Paul selbst pausiert, bleibt es pausiert.

import { useEffect, useRef, useState } from "react";
import { hoereBitten, meldeBriefing } from "../lib/briefingFunk";
import { abspielbar, knopfZeit, naechsterBlick, type Abspielbar, type HoerbriefingStand } from "../lib/hoerbriefingKnopf";
import "./hoerbriefing.css";

const NACH_NETZFEHLER_MS = 30_000;
// Umfang des Rings im Still-Intro (r = 21 in einem 44er-Feld).
const RING_UMFANG = 2 * Math.PI * 21;

/** "wort" ist der Knopf des Original-Intros, "ring" der des Still-Intros:
 *  nur der Abspielpunkt mit einem Ring als Fortschritt und die Zeit daneben. */
export type HoerbriefingVariante = "wort" | "ring";

export function HoerbriefingPlayer({ variante = "wort" }: { variante?: HoerbriefingVariante }) {
  const [stand, setStand] = useState<HoerbriefingStand | null>(null);

  // Laden; nachsehen, solange es noch keine Aufnahme gibt; und beim
  // Wieder-sichtbar-Werden des Fensters erneut — so kommt morgens das neue
  // Hörbriefing, auch wenn das Fenster über Nacht offen stand.
  useEffect(() => {
    let lebt = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hole = async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      try {
        const r = await fetch("/api/hoerbriefing", { cache: "no-store" });
        const s = (r.ok ? await r.json() : { datum: null }) as HoerbriefingStand;
        if (!lebt) return;
        setStand(s);
        const ms = naechsterBlick(s);
        if (ms !== null) timer = setTimeout(hole, ms);
      } catch {
        if (lebt) timer = setTimeout(hole, NACH_NETZFEHLER_MS);
      }
    };
    const beiSicht = () => { if (document.visibilityState === "visible") void hole(); };
    void hole();
    document.addEventListener("visibilitychange", beiSicht);
    return () => {
      lebt = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", beiSicht);
    };
  }, []);

  const aufnahme = abspielbar(stand);
  if (!aufnahme) return null;
  // `key`: ein neuer Tag ist eine neue Aufnahme — Fortschritt und Fehlerstand
  // der alten fangen nicht mit hinüber.
  return <Knopf key={aufnahme.datum} aufnahme={aufnahme} variante={variante} />;
}

function Knopf({ aufnahme, variante }: { aufnahme: Abspielbar; variante: HoerbriefingVariante }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [pos, setPos] = useState(0);
  const [dauer, setDauer] = useState(0);
  // Die MP3 liess sich nicht laden — dann lieber nichts als ein toter Knopf.
  const [kaputt, setKaputt] = useState(false);
  // Angehalten, weil Paul dazwischenredet — nur dann geht es von selbst weiter.
  const fuerHermes = useRef(false);

  const melde = (a: HTMLAudioElement, spielt = !a.paused) => {
    const gesamt = Number.isFinite(a.duration) ? a.duration : aufnahme.dauerSek;
    meldeBriefing({ spielt, sek: a.currentTime, gesamt });
  };

  useEffect(() => {
    const ab = hoereBitten(
      () => {
        const a = audio.current;
        if (!a || a.paused) return;
        fuerHermes.current = true;
        a.pause();
        melde(a, false);   // sofort, nicht erst im pause-Ereignis: die Stimme braucht die Stelle jetzt
      },
      (zurueck) => {
        const a = audio.current;
        if (!a || !fuerHermes.current) return;
        fuerHermes.current = false;
        a.currentTime = Math.max(0, a.currentTime - zurueck);
        a.play().catch(() => { /* dann bleibt es eben pausiert; Paul kann tippen */ });
      },
    );
    return () => {
      ab();
      meldeBriefing({ spielt: false, sek: 0, gesamt: 0 });
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- melde liest nur aufnahme.dauerSek, und `key` erneuert den Knopf je Tag

  if (kaputt) return null;

  const gesamt = dauer || aufnahme.dauerSek;
  const zahl = knopfZeit(pos, gesamt);
  const anteil = gesamt > 0 ? Math.min(1, pos / gesamt) : 0;

  const umschalten = () => {
    const a = audio.current;
    if (!a) return;
    fuerHermes.current = false;   // Paul entscheidet selbst
    // AbortError heisst nur: pausiert, bevor es lief — kein Defekt.
    if (a.paused) a.play().catch((e: unknown) => { if ((e as Error)?.name !== "AbortError") setKaputt(true); });
    else a.pause();
  };

  return (
    <div className="hb">
      <audio
        ref={audio}
        src={`/api/hoerbriefing/audio?datum=${aufnahme.datum}`}
        preload="metadata"
        onPlay={(e) => { setLaeuft(true); melde(e.currentTarget, true); }}
        onPause={(e) => { setLaeuft(false); melde(e.currentTarget, false); }}
        onEnded={(e) => { setLaeuft(false); setPos(0); e.currentTarget.currentTime = 0; fuerHermes.current = false; melde(e.currentTarget, false); }}
        onTimeUpdate={(e) => { setPos(e.currentTarget.currentTime); if (!e.currentTarget.paused) melde(e.currentTarget, true); }}
        onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDauer(e.currentTarget.duration); }}
        onError={() => setKaputt(true)}
      />
      {variante === "ring" ? (
        <button
          type="button"
          className={"hb-ring-knopf" + (laeuft ? " an" : "")}
          onClick={umschalten}
          aria-pressed={laeuft}
          aria-label={`Dein Tag zum Anhören${zahl && !pos ? `, ${zahl}` : ""}`}
          title={aufnahme.ersatz ? "Heute mit Ersatzstimme — die natürliche Stimme war nicht erreichbar" : undefined}
        >
          <span className="hb-ring" aria-hidden="true">
            <svg viewBox="0 0 44 44">
              <circle className="hb-ring-spur" cx="22" cy="22" r="21" />
              <circle
                className="hb-ring-fuellung" cx="22" cy="22" r="21"
                strokeDasharray={RING_UMFANG}
                style={{ strokeDashoffset: RING_UMFANG * (1 - anteil) }}
              />
            </svg>
            <span className="hb-ring-zeichen">{laeuft ? "❚❚" : "▶"}</span>
          </span>
          {zahl && <span className="hb-ring-zeit num" aria-hidden="true">{zahl}</span>}
        </button>
      ) : (
        <button
          type="button"
          className={"hb-knopf" + (laeuft ? " an" : "")}
          onClick={umschalten}
          aria-pressed={laeuft}
          aria-label={`Dein Tag zum Anhören${zahl && !pos ? `, ${zahl}` : ""}`}
          // Sagen, wenn die Reserve sprach — leise, nur beim Drüberfahren.
          title={aufnahme.ersatz ? "Heute mit Ersatzstimme — die natürliche Stimme war nicht erreichbar" : undefined}
          style={{ ["--hb-anteil" as string]: anteil }}
        >
          <span className="hb-zeichen" aria-hidden="true">{laeuft ? "❚❚" : "▶"}</span>
          <span className="hb-wort">Dein Tag zum Anhören</span>
          {zahl && <span className="hb-dauer num" aria-hidden="true">{zahl}</span>}
        </button>
      )}
    </div>
  );
}
