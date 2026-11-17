// „Mit Hermes sprechen" — ein Mikrofon-Knopf im Intro, unter dem Hörbriefing.
//
// Paul drückt, redet, hört auf. Die Aufnahme endet von selbst
// (lib/mikrofon.ts), der Server erkennt den Satz (faster-whisper auf der
// VM), Hermes antwortet — der Agent selbst, nicht ein Ersatzmodell — und
// Daily liest die Antwort Satz für Satz vor. Danach hört der Knopf wieder zu,
// bis Paul nichts mehr sagt: ein Gespräch, kein Formular.
//
// EINFACH LOSREDEN (seit 2026-11-02)
// Läuft das Hörbriefing, hört der Knopf mit („Sprich einfach los"). Redet
// Paul dazwischen, hält das Briefing an, die Aufnahme beginnt mit der Sekunde
// davor (sein erstes Wort fehlt nicht), und Hermes erfährt, bis wohin Paul
// gehört hat. Ist das Gespräch vorbei, läuft das Briefing weiter. Genauso
// lässt sich Hermes selbst ins Wort fallen. Absprache mit dem Player:
// lib/briefingFunk.ts; das Erkennen trotz Lautsprecher-Echo: lib/dazwischen.ts.
//
// SCHNELL STATT ÜBER HERMES (seit 2026-11-03)
// Die meisten Sätze versteht und erledigt Daily selbst, in ein bis zwei
// Sekunden statt zehn (electron/hermesStimme.cjs, „Der schnelle Weg"):
// Aufgabe für heute, diese Woche oder einen Tag; Termin aus dem Tag nehmen;
// im Brain nachsehen; die Brain-Frage beantworten; „weiter". Hermes antwortet,
// wenn Paul ihn anspricht („Hermes, …") oder etwas wissen will.
//
// Was dabei in der App passiert (Aufgabe angelegt, Termin ausgeblendet, Frage
// beantwortet), steht als leise Zeile darunter, jeweils mit „zurücknehmen".
// Ein falsch verstandener Satz darf nichts anrichten, das bleibt.
//
// Tippen während …
//   … Paul redet:     fertig, abschicken
//   … Hermes spricht: unterbrechen und selbst reden
//   … Hermes denkt:   abbrechen
// Esc beendet das Gespräch.

import { useCallback, useEffect, useRef, useState } from "react";
import { mikrofonMoeglich, oeffneMikrofon, type Aufnahme, type Mikrofon } from "../lib/mikrofon";
import { bittePause, bitteWeiter, hoereBriefing, type BriefingStand } from "../lib/briefingFunk";
import { ereignisse } from "../lib/stimmeStrom";
import { vorleser, type Vorleser } from "../lib/vorleser";
import { zieheJetzt } from "../lib/sync";
import { FRAGE_GEAENDERT } from "../lib/brainQuestion";
import { hideCalendarEvent, isEventHidden, loadHiddenEventIds, unhideCalendarEvent } from "../lib/hiddenEvents";
import "./hermesStimme.css";

type Phase = "bereit" | "hoert" | "versteht" | "denkt" | "spricht";
type Stand = { hoeren: boolean; hermes: boolean };
type Getan = { art: "todo" | "antwort" | "termin" | "brain" | "streichen" | "erledigt"; id: string; text: string; ids?: string[]; zurueck?: boolean };
type Stelle = { sek: number; gesamt: number };
// Nach einer Runde: weiter zuhören, Paul redet schon (Aufnahme läuft), oder Schluss.
// `kurz`: Daily hat selbst geantwortet — dann reicht eine kurze Nachfrage-Frist.
type Runde = { weiter: false } | { weiter: true; aufnahme: Promise<Aufnahme> | null; kurz: boolean };

// Nach so langer Pause fängt ein neues Gespräch an — Hermes soll nicht auf
// einen Satz von heute Morgen Bezug nehmen, als wäre er eben gefallen.
const GESPRAECH_PAUSE_MS = 10 * 60_000;
// So viele Aufnahmen hintereinander ohne verständlichen Satz, dann ist Schluss —
// sonst hörte der Knopf neben laufendem Fernseher endlos weiter zu.
const MAX_LEERE_RUNDEN = 2;
// So lange darf der Player nach „weiter" brauchen, bis er wieder spielt.
const WEITER_FRIST_MS = 1500;
// Nach einer Antwort von Daily: so lange auf einen weiteren Befehl warten, dann
// läuft das Briefing weiter. Vor dem ersten Satz und nach einer Antwort von
// Hermes (er fragt oft zurück) gilt die längere Frist (stille.ts).
const NACHFRAGE_MS = 3000;
const GETAN_WORT: Record<Getan["art"], string> = {
  todo: "Auf der Liste: ",
  antwort: "Antwort gespeichert: ",
  termin: "Aus deinem Tag: ",
  brain: "Im Brain: ",
  streichen: "Gestrichen: ",
  erledigt: "Abgehakt: ",
};
const KEIN_BRIEFING: BriefingStand = { spielt: false, sek: 0, gesamt: 0 };

const WORT: Record<Phase, string> = {
  bereit: "Sprechen",
  hoert: "Ich höre zu",
  versteht: "Verstehe …",
  denkt: "Moment …",
  spricht: "Antwortet",
};

function neueId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function meldung(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "Das Mikrofon ist nicht freigegeben.";
  if (name === "NotFoundError") return "Kein Mikrofon gefunden.";
  if (name === "AbortError") return "";
  return e instanceof Error ? e.message : "Etwas ist schiefgegangen.";
}

function gesperrtWeil(stand: Stand): string | null {
  if (!mikrofonMoeglich()) return "Das Mikrofon braucht HTTPS oder die Daily-App.";
  if (!stand.hoeren) return "Die Spracherkennung läuft nur auf der VM.";
  return null;
}

async function erkenne(blob: Blob, signal: AbortSignal): Promise<string> {
  const r = await fetch("/api/stimme/hoeren", { method: "POST", headers: { "Content-Type": blob.type }, body: blob, signal });
  const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!r.ok) throw new Error(j.error || `Spracherkennung: HTTP ${r.status}`);
  return (j.text || "").trim();
}

export function HermesStimme() {
  const [stand, setStand] = useState<Stand | null>(null);
  const [phase, setPhase] = useState<Phase>("bereit");
  const [mithoeren, setMithoeren] = useState(false);
  const [du, setDu] = useState("");
  const [hinweis, setHinweis] = useState("");
  const [getan, setGetan] = useState<Getan[]>([]);
  // Für gesprochenes „zurück": die Schleife unten sieht sonst nur den alten Stand.
  const getanRef = useRef<Getan[]>([]);
  useEffect(() => { getanRef.current = getan; }, [getan]);
  const knopf = useRef<HTMLButtonElement>(null);
  const lauf = useRef(0);
  const laufender = useRef(0);          // der Lauf, dem Mikrofon und Briefing-Pause gehören
  const aktiv = useRef(false);          // ein Gespräch läuft (Ref: Ereignisse kommen zwischen den Renders)
  const gespraech = useRef({ id: "", zuletzt: 0 });
  const vorleserRef = useRef<Vorleser | null>(null);
  const anfrage = useRef<AbortController | null>(null);
  const mikro = useRef<Mikrofon | null>(null);
  const mikroWird = useRef<Promise<Mikrofon> | null>(null);
  const mikroGewollt = useRef(false);
  const briefing = useRef<BriefingStand>(KEIN_BRIEFING);
  const stelle = useRef<Stelle | null>(null);   // wo wir das Briefing angehalten haben
  const darfMithoeren = useRef(false);
  const lauscheMitRef = useRef<() => Promise<void>>(async () => {});

  // Der Ring zeigt nur im Gespräch den Pegel — beim Mithören tanzte er zum Echo.
  const setPegel = useCallback((p: number) => {
    knopf.current?.style.setProperty("--hs-pegel", aktiv.current ? p.toFixed(2) : "0");
  }, []);

  const holeMikro = useCallback(async (): Promise<Mikrofon> => {
    mikroGewollt.current = true;
    if (mikro.current) return mikro.current;
    mikroWird.current ??= oeffneMikrofon(setPegel).finally(() => { mikroWird.current = null; });
    const m = await mikroWird.current;
    if (!mikroGewollt.current) { m.schliesse(); throw new DOMException("Mikrofon nicht mehr gebraucht", "AbortError"); }
    mikro.current = m;
    return m;
  }, [setPegel]);

  const lassMikro = useCallback(() => {
    mikroGewollt.current = false;
    mikro.current?.schliesse();
    mikro.current = null;
    setMithoeren(false);
  }, []);

  const beenden = useCallback(() => {
    lauf.current++;
    mikro.current?.abbrechen();
    vorleserRef.current?.stopp();
    anfrage.current?.abort();
    setPhase("bereit");
  }, []);

  // GET /api/stimme wärmt nebenbei die Spracherkennung an.
  useEffect(() => {
    let lebt = true;
    fetch("/api/stimme", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Stand>) : null))
      .then((s) => { if (lebt) setStand(s); })
      .catch(() => { if (lebt) setStand(null); });
    return () => { lebt = false; };
  }, []);

  useEffect(() => {
    if (phase === "bereit") return;
    const taste = (e: KeyboardEvent) => { if (e.key === "Escape") beenden(); };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [phase, beenden]);

  useEffect(() => () => { beenden(); lassMikro(); }, [beenden, lassMikro]);

  /** Eine Runde: Hermes fragen, Antwort vorlesen — und dabei lauschen, ob
   *  Paul dazwischenredet. Dann verstummt Hermes, und die Aufnahme läuft
   *  schon, während der Rest der Antwort (samt Aktionen) noch eintrifft. */
  const frageHermes = useCallback(async (text: string, lebt: () => boolean, m: Mikrofon): Promise<Runde> => {
    let aufnahme: Promise<Aufnahme> | null = null;
    const v = vorleser(() => {
      if (!lebt()) return;
      setPhase("spricht");
      setHinweis("");
      m.lausche(() => {
        if (!lebt()) return;
        v.stopp();
        aufnahme = m.nimmAuf({ schonGesprochen: true });
        setPhase("hoert");
        // Ist Paul fertig, bevor Hermes' Antwort ganz da ist: nicht weiter „Ich höre zu" zeigen.
        void aufnahme.then(() => { if (lebt()) setPhase("versteht"); });
      });
    });
    vorleserRef.current = v;
    const ac = new AbortController();
    anfrage.current = ac;
    try {
      const res = await fetch("/api/stimme/sag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, gespraech: gespraech.current.id, briefing: stelle.current ?? undefined }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(res.status === 401 ? "Anmeldung abgelaufen — lade die Seite neu." : j.error || `Hermes: HTTP ${res.status}`);
      }
      let fehler = "";
      let todoNeu = false;
      let frageNeu = false;
      let schluss = false;
      let kurz = false;
      for await (const e of ereignisse(res)) {
        if (!lebt()) return { weiter: false };
        if (e.typ === "satz") v.sag(e.text);
        else if (e.typ === "werkzeug") { if (!aufnahme) setHinweis("Hermes sieht nach …"); }
        else if (e.typ === "hinweis") setHinweis(e.text);
        else if (e.typ === "fehler") fehler = e.text;
        else if (e.typ === "ende") schluss = true;
        else if (e.typ === "fertig") kurz = e.quelle === "daily";
        else if (e.typ === "zurueck") {
          // Paul hat „zurück" gesagt — der Server hat es schon getan; hier
          // nur, was der Browser selbst gemacht hatte (ausgeblendete Termine).
          const alt = getanRef.current.find((g) => g.id === e.id);
          if (e.art === "termin") alt?.ids?.forEach(unhideCalendarEvent);
          if (e.art === "antwort") frageNeu = true;
          else todoNeu = true;
          setGetan((g) => g.map((x) => (x.id === e.id ? { ...x, zurueck: true } : x)));
        }
        else if (e.typ === "aktion") {
          if (e.art === "todo" || e.art === "streichen" || e.art === "erledigt") todoNeu = true;
          else if (e.art === "antwort") frageNeu = true;
          // Nur merken, was erst die Stimme ausgeblendet hat — „zurücknehmen"
          // soll nichts einblenden, das Paul vorher selbst weggeklickt hatte.
          let ids: string[] | undefined;
          if (e.art === "termin") {
            const schon = loadHiddenEventIds();
            ids = e.ids.filter((id) => !isEventHidden(id, schon));
            ids.forEach(hideCalendarEvent);
          }
          setGetan((g) => [...g, { art: e.art, id: e.id, text: e.text, ids }].slice(-4));
        }
      }
      if (todoNeu) void zieheJetzt();
      if (frageNeu) window.dispatchEvent(new Event(FRAGE_GEAENDERT));
      await v.fertig();
      if (schluss && !aufnahme) return { weiter: false };   // „weiter": Briefing läuft gleich weiter
      if (fehler) {
        setHinweis(fehler);
        // Was Paul schon dazwischengesagt hat, geht nicht verloren.
        if (aufnahme) return { weiter: true, aufnahme, kurz: false };
        return { weiter: false };
      }
      return { weiter: true, aufnahme, kurz };
    } catch (e) {
      m.abbrechen();   // eine laufende Dazwischen-Aufnahme nicht offen stehen lassen
      throw e;
    } finally {
      m.stillHalten();
    }
  }, []);

  // Nach „weiter" nicht auf ein play-Ereignis verlassen, das vielleicht nie
  // kommt (Paul hat selbst getippt, das Briefing ist zu Ende, play() scheitert):
  // spielt es, mithören; sonst nach kurzer Frist das Mikrofon schliessen.
  const nachDemGespraech = useCallback(() => {
    const pruefe = () => {
      if (aktiv.current) return;
      if (briefing.current.spielt && darfMithoeren.current) void lauscheMitRef.current();
      else if (!briefing.current.spielt) lassMikro();
    };
    if (briefing.current.spielt) pruefe();
    else setTimeout(pruefe, WEITER_FRIST_MS);
  }, [lassMikro]);

  const gespraechFuehren = useCallback(async (meinLauf: number, schonGesprochen: boolean) => {
    const lebt = () => lauf.current === meinLauf;
    let leer = 0;
    let laeuft: Promise<Aufnahme> | null = null;
    let schon = schonGesprochen;
    try {
      const m = await holeMikro();
      let kurz = false;
      while (lebt()) {
        setPhase("hoert");
        const a = await (laeuft ?? m.nimmAuf({ schonGesprochen: schon, nichtsMs: kurz ? NACHFRAGE_MS : undefined }));
        laeuft = null;
        schon = false;
        if (!lebt() || !a.blob) break;      // nichts mehr gesagt → Gespräch zu Ende
        setPhase("versteht");
        const ac = new AbortController();
        anfrage.current = ac;   // „Beenden" bricht auch eine hängende Erkennung ab
        const text = await erkenne(a.blob, ac.signal);
        if (!lebt()) break;
        if (!text) {
          if (++leer >= MAX_LEERE_RUNDEN) { setHinweis("Nichts verstanden — ich höre auf."); break; }
          setHinweis("Nichts verstanden — sag es nochmal.");
          continue;
        }
        leer = 0;
        setDu(text);
        setHinweis("");
        setPhase("denkt");
        gespraech.current = { ...gespraech.current, zuletzt: Date.now() };
        const r = await frageHermes(text, lebt, m);
        if (!r.weiter) break;
        laeuft = r.aufnahme;
        kurz = r.kurz;
      }
    } catch (e) {
      if (lebt()) setHinweis(meldung(e));
    } finally {
      if (lebt()) { lauf.current++; setPhase("bereit"); }
      if (laufender.current === meinLauf) {
        aktiv.current = false;
        setPegel(0);
        mikro.current?.abbrechen();
        if (stelle.current) {
          stelle.current = null;
          bitteWeiter();
          nachDemGespraech();
        } else lassMikro();
      }
    }
  }, [holeMikro, lassMikro, frageHermes, setPegel, nachDemGespraech]);

  const starte = useCallback((schonGesprochen: boolean) => {
    const g = gespraech.current;
    if (!g.id || Date.now() - g.zuletzt > GESPRAECH_PAUSE_MS) gespraech.current = { id: neueId(), zuletzt: Date.now() };
    aktiv.current = true;   // vor bittePause: dessen „spielt nicht mehr" soll das Mikrofon nicht schliessen
    setMithoeren(false);
    if (briefing.current.spielt) {
      bittePause();         // der Player meldet die Stelle sofort zurück
      stelle.current = { sek: briefing.current.sek, gesamt: briefing.current.gesamt };
    }
    setHinweis("");
    const meinLauf = ++lauf.current;
    laufender.current = meinLauf;
    void gespraechFuehren(meinLauf, schonGesprochen);
  }, [gespraechFuehren]);

  // Mithören, solange das Briefing spielt und kein Gespräch läuft.
  const lauscheMit = useCallback(async () => {
    try {
      const m = await holeMikro();
      if (aktiv.current || !briefing.current.spielt) return;
      m.lausche(() => { if (!aktiv.current && briefing.current.spielt) starte(true); });
      setMithoeren(true);
    } catch (e) {
      const text = meldung(e);
      if (text) { darfMithoeren.current = false; setHinweis(`Mithören geht nicht: ${text}`); }
    }
  }, [holeMikro, starte]);
  // gespraechFuehren braucht es, ist aber selbst Teil von starte
  useEffect(() => { lauscheMitRef.current = lauscheMit; }, [lauscheMit]);

  useEffect(() => {
    darfMithoeren.current = !!stand && !gesperrtWeil(stand);
    // Lief das Briefing schon, bevor der Stand da war: jetzt mithören.
    if (darfMithoeren.current && briefing.current.spielt && !aktiv.current) void lauscheMit();
  }, [stand, lauscheMit]);

  useEffect(() => hoereBriefing((s) => {
    const vorher = briefing.current;
    briefing.current = s;
    if (aktiv.current) return;
    if (s.spielt && !vorher.spielt && darfMithoeren.current) void lauscheMit();
    else if (!s.spielt && vorher.spielt) lassMikro();
  }), [lauscheMit, lassMikro]);

  const klick = () => {
    if (phase === "hoert") return mikro.current?.fertigJetzt();
    if (phase === "spricht") return vorleserRef.current?.stopp();   // Runde endet, Knopf hört wieder zu
    if (phase !== "bereit") return beenden();
    starte(false);
  };

  const zuruecknehmen = async (g: Getan) => {
    // Ausgeblendet hat der Browser — also blendet er auch wieder ein, selbst
    // wenn der Server das Protokoll gerade nicht berichtigen kann.
    if (g.art === "termin") g.ids?.forEach(unhideCalendarEvent);
    try {
      const r = await fetch("/api/stimme/zuruecknehmen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ art: g.art, id: g.id }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setGetan((alle) => alle.map((x) => (x.id === g.id ? { ...x, zurueck: true } : x)));
      if (g.art === "todo" || g.art === "streichen" || g.art === "erledigt") void zieheJetzt();
      else if (g.art === "antwort") window.dispatchEvent(new Event(FRAGE_GEAENDERT));
    } catch (e) {
      setHinweis(`Zurücknehmen ging nicht: ${meldung(e)}`);
    }
  };

  if (!stand || !stand.hoeren) return null;
  const sperre = gesperrtWeil(stand);
  const aktivJetzt = phase !== "bereit";
  const lauscht = !aktivJetzt && mithoeren;

  return (
    <section className="hs" aria-label="Sprechen">
      <div className="hs-zeile">
        <button
          ref={knopf}
          type="button"
          className={`hs-knopf hs-${phase}${lauscht ? " hs-mithoeren" : ""}`}
          onClick={klick}
          disabled={!!sperre}
          title={sperre ?? (phase === "spricht" ? "Rede einfach dazwischen — oder tippe" : phase === "hoert" ? "Tippen, wenn du fertig bist" : lauscht ? "Das Briefing hält an, sobald du redest" : undefined)}
          aria-pressed={aktivJetzt}
        >
          <span className="hs-zeichen" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" fill="currentColor" /></svg>
          </span>
          <span className="hs-wort">{lauscht ? "Sprich einfach los" : WORT[phase]}</span>
        </button>
        {aktivJetzt && <button type="button" className="hs-ende" onClick={beenden}>Beenden</button>}
      </div>
      <div className="hs-leise" aria-live="polite">
        {du && <p className="hs-du">„{du}"</p>}
        {hinweis && <p className="hs-hinweis">{hinweis}</p>}
        {getan.map((g) => (
          <p key={g.id} className={"hs-getan" + (g.zurueck ? " weg" : "")}>
            <span>{g.zurueck ? "Zurückgenommen: " : GETAN_WORT[g.art]}{g.text}</span>
            {!g.zurueck && g.art !== "brain" && <button type="button" onClick={() => void zuruecknehmen(g)}>zurücknehmen</button>}
          </p>
        ))}
      </div>
    </section>
  );
}
