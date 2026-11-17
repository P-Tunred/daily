// Stil „G" — Score › Klausuren: wie viel Zeit bleibt, wie weit Paul ist, was
// er mehr schieben muss. Paul (2026-11-13): „sehen, wie viel Zeit ich noch
// habe und wie weit ich bin, und was ich mehr pushen muss".
//
// Nur Ansicht: gerechnet wird in lib/klausurStand.ts (über lernHeute, dieselbe
// Rechnung wie das Tagesziel). Die Zahl des Scores ändert das nicht.

import { LAGE_TEXT, standSatz, stundenText, type KlausurStand, type Lage } from "../../lib/klausurStand";

const MARKE: Record<Lage, string> = { vorne: "g-ok", "im-plan": "g-ok", knapp: "g-warn", hinten: "g-krit" };
const TON: Record<Lage, string> = { vorne: " g-gut", "im-plan": "", knapp: " g-knapp", hinten: " g-schlecht" };

function tageText(n: number): string {
  if (n === 0) return "heute";
  return n === 1 ? "morgen" : `in ${n} Tagen`;
}

function Karte({ s }: { s: KlausurStand }) {
  const bis = s.phase === "lernen" ? "bis zur Wiederholung" : "bis zur Klausur";
  return (
    <li className="g-kl">
      <div className="g-kl-kopf">
        <span className="g-kl-name">{s.klausur}</span>
        <span className={"g-kl-lage" + TON[s.lage]}><i className={MARKE[s.lage]} aria-hidden="true" />{LAGE_TEXT[s.lage]}</span>
        <span className="g-kl-wann">{s.phase === "wiederholung" ? "Wiederholung · " : ""}Klausur {tageText(s.tageBisKlausur)}</span>
      </div>
      <div className="g-kl-fort">
        <span className="g-linie" aria-hidden="true">
          <i style={{ width: `${Math.round(s.erledigt * 100)}%` }} />
          {s.erledigt > 0 && <b style={{ left: `${Math.round(s.erledigt * 100)}%` }} />}
        </span>
        <small>{Math.round(s.erledigt * 100)} % geschafft</small>
      </div>
      <dl className="g-kl-zahlen">
        <div><dt>Zeit übrig</dt><dd>{stundenText(s.zeitMin)}</dd><small>{s.tageUebrig} {s.tageUebrig === 1 ? "Lerntag" : "Lerntage"} {bis}</small></div>
        <div><dt>Arbeit übrig</dt><dd>{stundenText(s.restMin)}</dd><small>bei deinem Tempo</small></div>
        <div>
          <dt>Puffer</dt>
          <dd className={s.pufferMin >= 30 ? "g-gut" : s.pufferMin <= -30 ? "g-schlecht" : ""}>
            {Math.abs(s.pufferMin) < 30 ? "±0" : `${s.pufferMin > 0 ? "+" : "−"}${stundenText(Math.abs(s.pufferMin))}`}
          </dd>
          <small>{s.pufferMin >= 30 ? "mehr Zeit als Arbeit" : s.pufferMin <= -30 ? "mehr Arbeit als Zeit" : "geht genau auf"}</small>
        </div>
      </dl>
      <p className="g-kl-satz">{standSatz(s)}</p>
      {s.schieben.length > 0 && <>
        <p className="g-unterkopf">{s.phase === "wiederholung" ? "Zuerst wiederholen" : "Mehr schieben"}</p>
        <ol className="g-kl-schieben">
          {s.schieben.map((x) => (
            <li key={x.titel}><span>{x.titel}</span><small>{x.warum}</small></li>
          ))}
        </ol>
      </>}
    </li>
  );
}

export function GKlausurStand({ staende }: { staende: readonly KlausurStand[] }) {
  if (staende.length === 0) return null;
  const sortiert = [...staende].sort((a, b) => a.tageBisKlausur - b.tageBisKlausur);
  return (
    <section className="g-blatt g-span-12 g-klausuren" aria-labelledby="g-kl-h">
      <div className="g-kopf">
        <div><h2 id="g-kl-h">Klausuren</h2><p>Zeit übrig, wie weit du bist, was du mehr schieben musst</p></div>
      </div>
      <ul className={"g-kl-liste" + (sortiert.length === 1 ? " eine" : "")}>
        {sortiert.map((s) => <Karte key={s.klausur} s={s} />)}
      </ul>
    </section>
  );
}

