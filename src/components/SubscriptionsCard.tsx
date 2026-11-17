// Die Abo-Karte ganz unten — was Paul zahlt, wie voll es ist, wann es kippt.
//
// WARUM DIE SUMME OBEN UND GROSS STEHT
// Eine Kostenübersicht liest man in einer anderen Reihenfolge als eine
// Aufgabenliste: erst „was kostet mich das alles", dann „woraus besteht es".
// Die Aufteilung ist die Antwort auf eine Frage, die man erst stellt, wenn man
// die Summe gesehen hat. Der Betrag trägt die Hierarchie deshalb über Grösse,
// nicht über Farbe — dasselbe Prinzip wie in der Horizont-Karte.
//
// WARUM UNBEKANNT ANDERS AUSSIEHT ALS VOLL
// Ein leerer Balken und ein nicht abrufbarer Wert sehen im Vorbeigehen gleich
// aus und bedeuten das Gegenteil: einmal ist Luft, einmal weiss man nichts.
// Genau diese Verwechslung hat die Claude-Anzeige acht Tage lang gedeckt —
// „Login nötig" stand da auch am ersten Tag, also fiel nicht auf, dass es
// vorher funktioniert hatte. Wo kein Wert vorliegt, gibt es deshalb gar keinen
// Balken, sondern eine Kante in Ton und einen Satz, der sagt, was zu tun ist.

import { useEffect, useState, type CSSProperties } from "react";
import { Card } from "./Card";
import { fetchAbos, type Abo, type AboUebersicht } from "../lib/subscriptions";

const NACHLADEN_MS = 10 * 60 * 1000;
/** Ab hier färbt sich der Balken — nicht als Alarm, sondern als Vorwarnung. */
const VOLL_AB = 85;
/** Ab hier ist das 5-Stunden-Fenster die interessantere Zahl als die Woche. */
const ENG_AB = 60;

function geld(betrag: number, waehrung: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: waehrung,
    maximumFractionDigits: betrag % 1 === 0 ? 0 : 2,
  }).format(betrag);
}

function datum(iso: string | null | undefined, lang = false): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-DE", { day: "numeric", month: lang ? "long" : "short" });
}

/** „vor 9 Tagen" — der Abstand ist die eigentliche Nachricht, nicht das Datum:
 *  ein Stand von gestern ist gut, derselbe Satz mit „vor 9 Tagen" ist ein
 *  Defekt. */
function vorWieLange(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const stunden = Math.round(ms / 3_600_000);
  if (stunden < 1) return "gerade eben";
  if (stunden < 24) return `vor ${stunden} h`;
  const tage = Math.round(stunden / 24);
  return tage === 1 ? "vor einem Tag" : `vor ${tage} Tagen`;
}

function Zeile({ abo }: { abo: Abo }) {
  const v = abo.verbrauch;
  const voll = !!v && v.wocheProzent >= VOLL_AB;
  const eng = !!v && v.fuenfStundenProzent !== null && v.fuenfStundenProzent >= ENG_AB;
  const reset = datum(v?.resetAt ?? null);
  const laufzeit = datum(abo.laufzeitBis, true);
  const stand = vorWieLange(abo.standVon);

  // Die Nebenangaben unterscheiden sich je Dienst — z.ai kennt echte Credits,
  // Codex nur Prozente, Claude ein 5-Stunden-Fenster. Statt für jeden Fall eine
  // eigene Zeile zu bauen, wird gesammelt, was da ist.
  const links: string[] = [];
  if (v?.fuenfStundenProzent !== null && v?.fuenfStundenProzent !== undefined) {
    links.push(`5 h ${Math.round(v.fuenfStundenProzent)} %`);
  }
  if (v?.credits) {
    links.push(`${v.credits.uebrig.toLocaleString("de-DE")} Credits übrig`);
  }
  const rechts = laufzeit ? `Vertrag bis ${laufzeit}` : null;

  return (
    <li className={"abo-row" + (voll ? " voll" : "")}>
      <div className="abo-kopf">
        <span className="abo-name">{abo.name}</span>
        {abo.plan && <span className="abo-plan">{abo.plan}</span>}
        <span className="abo-anbieter">{abo.anbieter}</span>
        <span className={"abo-preis" + (abo.kosten ? "" : " leer")}>
          {abo.kosten
            ? geld(abo.kosten.betrag, abo.kosten.waehrung) + (abo.kosten.zyklus === "jaehrlich" ? "/J" : "")
            : "—"}
        </span>
      </div>

      {abo.status === "ok" && v ? (
        <>
          <div className="abo-mess">
            <div
              className="abo-spur"
              title={
                v.credits
                  ? `${v.credits.verbraucht.toLocaleString("de-DE")} von ${v.credits.gesamt.toLocaleString("de-DE")} Credits verbraucht`
                  : `${Math.round(v.wocheProzent)} % der Wochenmenge verbraucht`
              }
            >
              <span
                className="abo-fuell"
                style={{ "--f": Math.max(0.008, v.wocheProzent / 100) } as CSSProperties}
              />
            </div>
            <span className="abo-zahl">{Math.round(v.wocheProzent)} %</span>
            {reset && <span className="abo-reset">Reset {reset}</span>}
          </div>
          {(links.length > 0 || rechts || abo.hinweis) && (
            <div className="abo-detail">
              <span className={eng ? "eng" : undefined}>
                {links.join(" · ")}
                {abo.hinweis && stand && `${links.length ? " · " : ""}Stand ${stand}`}
              </span>
              {rechts && <span>{rechts}</span>}
            </div>
          )}
        </>
      ) : abo.status === "ok" ? (
        // Läuft, aber ohne messbaren Verbrauch. Kein leerer Balken — der sähe
        // aus wie „nichts verbraucht". Normalschrift statt Versalien: hier
        // steht ein Satz, keine Marke.
        <div className="abo-notiz">
          <span>{abo.hinweis}</span>
          {rechts && <span className="bis">{rechts}</span>}
        </div>
      ) : (
        <p className="abo-fehlt">
          {abo.hinweis}
          {stand && <span className="wann"> · zuletzt gelesen {stand}</span>}
        </p>
      )}
    </li>
  );
}

export function SubscriptionsCard() {
  const [daten, setDaten] = useState<AboUebersicht | null>(null);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    let lebt = true;
    const laden = () => {
      void fetchAbos().then((d) => {
        if (!lebt) return;
        setDaten(d);
        setGeladen(true);
      });
    };
    laden();
    const t = setInterval(laden, NACHLADEN_MS);
    return () => {
      lebt = false;
      clearInterval(t);
    };
  }, []);

  if (!geladen) return null;
  if (!daten) {
    return (
      <Card title="Abos" size="small">
        <p className="abo-fuss" style={{ border: 0, margin: 0, padding: 0 }}>
          Übersicht gerade nicht abrufbar.
        </p>
      </Card>
    );
  }

  const summe = daten.gesamt;
  const offen = daten.dienste.filter((d) => d.status !== "ok").length;

  return (
    <Card title="Abos" size="small" meta={`${daten.dienste.length} Dienste`}>
      {summe && (
        <div className="abo-summe">
          <span className="abo-summe-zahl">{geld(summe.betragProMonat, summe.waehrung)}</span>
          <span className="abo-summe-label">
            pro Monat{summe.vollstaendig ? "" : " · unvollständig"}
          </span>
        </div>
      )}

      <ul className="abo-liste">
        {daten.dienste.map((d) => (
          <Zeile key={d.id} abo={d} />
        ))}
      </ul>

      {(daten.kostenHinweis || offen > 0) && (
        <p className="abo-fuss">
          {daten.kostenHinweis}
          {daten.kostenHinweis && offen > 0 && " · "}
          {offen > 0 &&
            `${offen === 1 ? "Ein Dienst meldet" : `${offen} Dienste melden`} keinen Verbrauch — die Zahlen oben sind nicht vollständig.`}
        </p>
      )}
    </Card>
  );
}
