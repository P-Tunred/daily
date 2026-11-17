// Stil „G" — die Akte eines Projekts: wo Paul aufgehört hat, der nächste
// Schritt, Hermes' Vorschlag, Fortschritt, Notizen und Ideen.
// Alle Änderungen laufen über `tu` (useProjekte, mit Versionsprüfung);
// hier lebt nur, was aufgeklappt oder ausgewählt ist.

import { useState, type FormEvent } from "react";
import {
  STATUS_NAME, entferneEintrag, entferneProjekt, entferneSchritt, entscheide, erledigtZahl, fuegeEintragHinzu,
  fuegeSchritteHinzu, hakeAb, neuerClaudeStand, hakeZurueck, offeneSchritte, setzeStatus, setzeZuletzt, wannText, wuenscheVorschlag,
  zuletztAktiv, type MerkArt, type Projekt, type ProjektStatus,
} from "../../lib/projekte";
import type { Aenderung } from "../../lib/useProjekte";
import { Striche } from "./GProjektStriche";

const MERK: { art: MerkArt; name: string; leer: string; platz: (n: string) => string }[] = [
  { art: "notizen", name: "Notizen", leer: "Noch keine Notizen.", platz: (n) => `Notiz zu ${n} …` },
  { art: "ideen", name: "Ideen", leer: "Noch keine Ideen.", platz: (n) => `Idee für ${n} …` },
];
const STATUS: ProjektStatus[] = ["laeuft", "idee", "pause"];

export function Haken() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>;
}
export function Plus() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
}
function Kreuz() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
}

/** Ein Textfeld, das beim Absenden geleert wird — nur wenn gespeichert wurde. */
function Eingabe({ id, label, platz, start = "", knopf, onSenden }: {
  id: string; label: string; platz?: string; start?: string; knopf: "plus" | "haken"; onSenden: (t: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(start);
  async function senden(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t && (await onSenden(t))) setText("");
  }
  return (
    <form className="g-eingabe klein" onSubmit={senden}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input id={id} value={text} placeholder={platz} autoComplete="off" onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="g-rund" aria-label={knopf === "plus" ? "Hinzufügen" : "Speichern"}>{knopf === "plus" ? <Plus /> : <Haken />}</button>
    </form>
  );
}

function Vorschlag({ p, tu, jetzt }: { p: Projekt; tu: (a: Aenderung) => Promise<boolean>; jetzt: number }) {
  const [welcher, setWelcher] = useState(0);
  if (!p.vorschlaege.length) {
    if (p.vorschlagGewuenscht) {
      return <p className="p-leer p-holen" role="status">Gewünscht {wannText(p.vorschlagGewuenscht, jetzt)}. Hermes schaut beim nächsten Lauf drauf.</p>;
    }
    return <button type="button" className="p-textknopf p-holen" onClick={() => tu((s, k) => wuenscheVorschlag(s, p.id, k))}>Vorschlag holen</button>;
  }
  const v = p.vorschlaege[welcher % p.vorschlaege.length];
  const fertig = async (ergebnis: "uebernommen" | "verworfen") => { if (await tu((s, k) => entscheide(s, p.id, v.id, ergebnis, k))) setWelcher(0); };
  return (
    <div className="p-vorschlag">
      <p className="p-marke">Vorschlag von Hermes, {wannText(v.am, jetzt)}</p>
      <p className="p-vtext">{v.text}</p>
      {v.schritte.length > 0 && <ul className="p-alle">{v.schritte.map((t, i) => <li key={i}><span>{t}</span></li>)}</ul>}
      <div className="p-knoepfe">
        <button type="button" className="g-pille klein hell" onClick={() => fertig("uebernommen")}>
          {v.schritte.length ? "Als Schritte übernehmen" : "Passt"}
        </button>
        {p.vorschlaege.length > 1 && <button type="button" className="g-pille klein" onClick={() => setWelcher((w) => w + 1)}>Anderer Vorschlag</button>}
        <button type="button" className="g-pille klein" onClick={() => fertig("verworfen")}>Verwerfen</button>
      </div>
    </div>
  );
}

function Merkliste({ p, tu, jetzt }: { p: Projekt; tu: (a: Aenderung) => Promise<boolean>; jetzt: number }) {
  const [art, setArt] = useState<MerkArt>("notizen");
  const m = MERK.find((x) => x.art === art) ?? MERK[0];
  const liste = p[art];
  return (
    <div className="p-merk">
      <div className="g-tabs" role="tablist" aria-label="Notizen und Ideen">
        {MERK.map((x) => (
          <button key={x.art} type="button" role="tab" aria-selected={art === x.art} className={art === x.art ? "an" : ""} onClick={() => setArt(x.art)}>
            {x.name} {p[x.art].length}
          </button>
        ))}
      </div>
      <Eingabe key={art} id="p-merk-text" label={art === "notizen" ? "Neue Notiz" : "Neue Idee"} platz={m.platz(p.name)} knopf="plus"
        onSenden={(t) => tu((s, k) => fuegeEintragHinzu(s, p.id, art, t, k))} />
      {liste.length ? (
        <ul className="p-liste">
          {liste.map((e) => (
            <li key={e.id}>
              <span>{e.text}</span>
              <span className="p-rechts">
                <time dateTime={e.am}>{e.von === "hermes" ? "Hermes, " : ""}{wannText(e.am, jetzt)}</time>
                <button type="button" className="p-weg" aria-label={`${art === "notizen" ? "Notiz" : "Idee"} entfernen`}
                  onClick={() => tu((s) => entferneEintrag(s, p.id, art, e.id))}><Kreuz /></button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="p-leer">{m.leer}</p>}
    </div>
  );
}

export function GProjektAkte({ projekt: p, tu, jetzt, onEntfernt }: {
  projekt: Projekt; tu: (a: Aenderung) => Promise<boolean>; jetzt: number; onEntfernt: () => void;
}) {
  const [schreibt, setSchreibt] = useState(false);
  const [alleOffen, setAlleOffen] = useState(p.schritte.length === 0);
  const [wirklich, setWirklich] = useState(false);
  const offen = offeneSchritte(p);
  const [naechster, danach] = offen;
  const erledigt = erledigtZahl(p);
  const ausClaude = schreibt ? null : neuerClaudeStand(p);

  return (
    <>
      <p className="p-marke">
        <span>Wo du aufgehört hast, {wannText(zuletztAktiv(p), jetzt)}</span>
        {p.zuletzt?.von === "hermes" && <span className="p-quelle">von Hermes</span>}
        {p.angelegt.von === "hermes" && !p.zuletzt && <span className="p-quelle">von Hermes angelegt</span>}
        <button type="button" className="p-textknopf" aria-expanded={schreibt} onClick={() => setSchreibt((x) => !x)}>{schreibt ? "abbrechen" : "ändern"}</button>
      </p>
      {schreibt ? (
        <Eingabe id="p-satz-text" label="Wo du aufgehört hast" start={p.zuletzt?.text ?? ""} knopf="haken"
          onSenden={async (t) => { const ok = await tu((s, k) => setzeZuletzt(s, p.id, t, k)); if (ok) setSchreibt(false); return ok; }} />
      ) : (
        <p className="p-satz">{p.zuletzt?.text ?? "Noch nicht begonnen."}</p>
      )}
      {ausClaude && (
        <div className="p-claude">
          <p className="p-marke">
            <span>Aus Claude, {wannText(ausClaude.am, jetzt)}</span>
            <span className="p-quelle">{ausClaude.titel}</span>
          </p>
          <p className="p-claude-text">{ausClaude.text}</p>
          <button type="button" className="p-textknopf" onClick={() => tu((s, k) => setzeZuletzt(s, p.id, ausClaude.text, k))}>
            Als „Wo du aufgehört hast“ übernehmen
          </button>
        </div>
      )}

      <div className="p-schritt">
        <p className="p-marke"><i className="g-funke" aria-hidden="true" /><span>Nächster Schritt</span></p>
        {naechster ? (
          <div className="p-jetzt">
            <button type="button" className="p-haken" aria-label={`${naechster.text} abhaken`} onClick={() => tu((s, k) => hakeAb(s, p.id, naechster.id, k))}><Haken /></button>
            <strong>{naechster.text}</strong>
          </div>
        ) : (
          <p className="p-satz">{p.schritte.length ? "Alle Schritte sind erledigt." : "Noch keine Schritte."}</p>
        )}
        {danach && <p className="p-danach">Danach: {danach.text}</p>}
        <Vorschlag p={p} tu={tu} jetzt={jetzt} />

        <div className="p-fort">
          <p className="g-zahl" aria-label={`${erledigt} von ${p.schritte.length} Schritten erledigt`}>
            <span>{erledigt}</span><span className="leise">/{p.schritte.length}</span>
          </p>
          <Striche gesamt={p.schritte.length} erledigt={erledigt} />
          <button type="button" className="p-textknopf" aria-expanded={alleOffen} onClick={() => setAlleOffen((x) => !x)}>
            {alleOffen ? "Schritte einklappen" : "Alle Schritte"}
          </button>
        </div>
        {alleOffen && (
          <>
            <ul className="p-alle">
              {p.schritte.map((s) => (
                <li key={s.id} className={s.erledigt ? "voll" : s.id === naechster?.id ? "jetzt" : ""}>
                  <span>{s.text}</span>
                  {s.erledigt
                    ? <button type="button" className="p-textknopf p-klein" onClick={() => tu((st) => hakeZurueck(st, p.id, s.id))}>zurück</button>
                    : <button type="button" className="p-textknopf p-klein" onClick={() => tu((st) => entferneSchritt(st, p.id, s.id))}>entfernen</button>}
                </li>
              ))}
            </ul>
            <Eingabe id="p-schritt-text" label="Neuer Schritt" platz="Schritt hinzufügen …" knopf="plus"
              onSenden={(t) => tu((s, k) => fuegeSchritteHinzu(s, p.id, [t], k))} />
          </>
        )}
      </div>

      <Merkliste p={p} tu={tu} jetzt={jetzt} />

      <div className="p-fuss">
        <div className="g-tabs" role="radiogroup" aria-label="Status">
          {STATUS.map((st) => (
            <button key={st} type="button" role="radio" aria-checked={p.status === st} className={p.status === st ? "an" : ""}
              onClick={() => p.status !== st && tu((s) => setzeStatus(s, p.id, st))}>{STATUS_NAME[st]}</button>
          ))}
        </div>
        {wirklich ? (
          <span className="p-knoepfe">
            <button type="button" className="g-pille klein" onClick={async () => { if (await tu((s) => entferneProjekt(s, p.id))) onEntfernt(); }}>Wirklich entfernen</button>
            <button type="button" className="g-pille klein still" onClick={() => setWirklich(false)}>Behalten</button>
          </span>
        ) : (
          <button type="button" className="p-textknopf" onClick={() => setWirklich(true)}>Projekt entfernen</button>
        )}
      </div>
    </>
  );
}
