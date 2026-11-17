// Stil „G" — Projekte, über Posteingang und Wetter.
// Links das Regal (alle Projekte mit Stand und nächstem Schritt), rechts die
// Akte des gewählten. Auf dem Handy steht das Regal oben.
// Daten und Versionsprüfung: lib/useProjekte.ts. Regeln: lib/projekte.ts.

import { useEffect, useState, type FormEvent } from "react";
import {
  STATUS_NAME, erledigtZahl, legeAn, naechsterSchritt, sortiert, wannText, zuletztAktiv,
  type Projekt, type ProjektStatus,
} from "../../lib/projekte";
import { useProjekte, type Aenderung } from "../../lib/useProjekte";
import { GProjektAkte, Plus } from "./GProjektAkte";
import { Striche } from "./GProjektStriche";
import "./g.css";
import "./g-projekte.css";

const GRUPPEN: ProjektStatus[] = ["laeuft", "idee", "pause"];
/** „heute"/„gestern" sollen nach Mitternacht stimmen, ohne neu zu laden. */
const UHR_MS = 60_000;

function zaehlText(projekte: Projekt[]): string {
  const laufen = projekte.filter((p) => p.status === "laeuft").length;
  const warten = projekte.filter((p) => p.status === "idee").length;
  if (!projekte.length) return "Noch keine";
  const teile = [laufen === 1 ? "1 läuft" : `${laufen} laufen`];
  if (warten) teile.push(warten === 1 ? "1 wartet" : `${warten} warten`);
  return teile.join(", ");
}

function Zeile({ p, an, jetzt, onWaehle }: { p: Projekt; an: boolean; jetzt: number; onWaehle: () => void }) {
  const n = naechsterSchritt(p);
  const wann = wannText(zuletztAktiv(p), jetzt);
  const laeuft = p.status === "laeuft";
  return (
    <button type="button" className={"p-zeile" + (an ? " an" : "")} aria-current={an ? "true" : undefined} onClick={onWaehle}>
      <span className="p-name">{p.name}</span>
      {laeuft
        ? <span className="p-stand"><b>{erledigtZahl(p)}</b>/{p.schritte.length}</span>
        : <span className="p-stand">{wann}</span>}
      <span className="p-naechst">{n ? n.text : p.schritte.length ? "Alle Schritte erledigt" : "Noch keine Schritte"}</span>
      {laeuft && (
        <span className="p-unten">
          <Striche gesamt={p.schritte.length} erledigt={erledigtZahl(p)} />
          <span className="p-wann">{wann}</span>
        </span>
      )}
    </button>
  );
}

export function GProjekte() {
  const { stand, aendere, busy, fehler } = useProjekte();
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const [neuName, setNeuName] = useState("");
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const uhr = setInterval(() => setJetzt(Date.now()), UHR_MS);
    return () => clearInterval(uhr);
  }, []);
  const liste = stand ? sortiert(stand.projekte) : [];
  const aktiv = liste.find((p) => p.id === gewaehlt) ?? liste[0] ?? null;
  const tu = (a: Aenderung) => aendere(a);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    const name = neuName.trim();
    if (!name) return;
    let neueId = "";
    const ok = await aendere((s, k) => { const r = legeAn(s, { name }, k); neueId = r.projekt.id; return r.stand; });
    if (ok) { setGewaehlt(neueId); setNeuName(""); setNeuOffen(false); }
  }

  return (
    <section className="g-blatt g-projekte" aria-labelledby="g-projekte-h">
      <div className="g-kopf">
        <div><h2 id="g-projekte-h">Projekte</h2><p>{stand ? zaehlText(liste) : "werden geladen …"}</p></div>
        <button type="button" className="g-pille klein" aria-expanded={neuOffen} onClick={() => setNeuOffen((x) => !x)}>Neues Projekt</button>
      </div>
      {fehler && <p role="alert" className="g-notiz p-fehler">{fehler}</p>}
      <fieldset disabled={busy || !stand} aria-busy={busy} className="g-feld">
        {neuOffen && (
          <form className="g-eingabe klein p-neu" onSubmit={anlegen}>
            <label className="sr-only" htmlFor="p-neu-text">Name des Projekts</label>
            <input id="p-neu-text" value={neuName} placeholder="Was willst du machen?" autoComplete="off" autoFocus onChange={(e) => setNeuName(e.target.value)} />
            <button type="submit" className="g-rund" aria-label="Projekt anlegen"><Plus /></button>
          </form>
        )}
        {stand && !liste.length ? (
          <p className="p-satz p-anfang">Noch keine Projekte. Leg eins an oder erzähl Hermes davon.</p>
        ) : stand && aktiv ? (
          <div className="p-bau">
            <nav className="p-regal" aria-label="Projekte">
              {GRUPPEN.map((g) => {
                const teil = liste.filter((p) => p.status === g);
                if (!teil.length) return null;
                return (
                  <div key={g} className="p-gruppe-block">
                    <p className="p-gruppe">{STATUS_NAME[g]}</p>
                    {teil.map((p) => <Zeile key={p.id} p={p} an={p.id === aktiv.id} jetzt={jetzt} onWaehle={() => setGewaehlt(p.id)} />)}
                  </div>
                );
              })}
            </nav>
            <div className="p-akte">
              <GProjektAkte key={aktiv.id} projekt={aktiv} tu={tu} jetzt={jetzt} onEntfernt={() => setGewaehlt(null)} />
            </div>
          </div>
        ) : null}
      </fieldset>
    </section>
  );
}
