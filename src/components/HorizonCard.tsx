// „Dein Horizont" — was kommt, in EINER Ordnung.
//
// Ersetzt die getrennte Kalenderkarte und den Block „Am Horizont". Vorher
// musste man beides lesen und im Kopf sortieren, und ein Termin, der in beiden
// Quellen steckt, stand zweimal da. Die Verschmelzung und das Entdoppeln
// passieren in src/lib/horizon.ts — hier wird nur gezeigt.
//
// KEINE VERSCHACHTELTEN KARTEN, KEIN AKKORDEON
// Eine Fläche, Gruppen nur durch eine ruhige Überschrift getrennt. Wer mehr
// sehen will, geht in die volle Kalenderansicht — ein Aufklapper hier würde
// dieselbe Unruhe erzeugen, die die Zusammenlegung gerade beseitigt hat.

import { useMemo } from "react";
import { useImportantEvents } from "../important/store";
import { baueHorizont, gruppe, tageBis, type HorizonItem } from "../lib/horizon";
import type { CalendarEvent } from "../types";
import { useHiddenEventIds, hideCalendarEvent, unhideCalendarEvent } from "../lib/hiddenEvents";

/** Ruhige Typmarkierung statt Ampelwand: ein Wort, kein Farbblock. */
const TYP_LABEL: Record<HorizonItem["kind"], string> = {
  appointment: "Termin",
  exam: "Klausur",
  deadline: "Frist",
  birthday: "Geburtstag",
  note: "Notiz",
};

function Zeile({ item, heute, istNaechster, onWeg }: {
  item: HorizonItem; heute: string; istNaechster: boolean;
  onWeg: (item: HorizonItem) => void;
}) {
  const tage = tageBis(heute, item.date);
  // Kalendertermine tragen die exakte Uhrzeit, Fristen einen Countdown —
  // "noch 4 Tage" sagt mehr als "20.08." und umgekehrt.
  const links = item.time
    ? item.time
    : tage === 0 ? "heute"
    : tage === 1 ? "morgen"
    : `${tage} Tage`;

  // WARUM ZWEI VERSCHIEDENE WÖRTER
  // Ein eigener Eintrag lässt sich wirklich löschen — er gehört uns. Ein
  // Kalendertermin nicht: der kommt aus dem Export und stünde beim nächsten
  // Abgleich wieder da. Ihn "Löschen" zu nennen wäre eine Lüge, die man genau
  // einmal glaubt. Deshalb heisst es dort "Ausblenden", und das ist umkehrbar.
  const eigen = item.source === "important";
  const wort = eigen ? "Löschen" : "Ausblenden";
  const erklaerung = eigen
    ? "Diesen selbst angelegten Eintrag endgültig löschen"
    : item.source === "beide"
      ? "Eigenen Eintrag löschen und den Kalendertermin ausblenden"
      : "Aus dieser Ansicht ausblenden — im Kalender bleibt er stehen";

  return (
    <li className={"hz-row" + (istNaechster ? " next" : "")}>
      <span className="hz-when num">{links}</span>
      <span className="hz-title">{item.title}</span>
      <span className="hz-tag">{item.calendar ?? TYP_LABEL[item.kind]}</span>
      {/* Der ehrliche Teil. Ein Termin, der noch nicht im Kalender steht, sagt
          das — sonst verlaesst man sich auf etwas, das auf dem Telefon gar
          nicht existiert. Lieber ein sichtbares "noch nicht" als ein stilles
          Nichts. Eintraege OHNE syncState sind nicht dafuer vorgesehen und
          zeigen entsprechend auch nichts an. */}
      {item.syncState === "offen" && (
        <span className="hz-sync" title="Daily hat den Termin angelegt, Hermes trägt ihn noch in den echten Kalender ein">
          noch nicht im Kalender
        </span>
      )}
      {item.syncState === "loeschen-offen" && (
        <span className="hz-sync" title="Wird beim nächsten Durchgang aus dem echten Kalender entfernt">
          wird gelöscht
        </span>
      )}
      {item.syncState === "fehlgeschlagen" && (
        <span className="hz-sync warn" title="Dreimal versucht, dreimal fehlgeschlagen — dieser Termin steht NICHT im echten Kalender">
          ✕ nicht im Kalender
        </span>
      )}
      <button
        type="button"
        className="hz-weg"
        title={erklaerung}
        aria-label={`${wort}: ${item.title}`}
        onClick={() => onWeg(item)}
      >
        {wort}
      </button>
    </li>
  );
}

export function HorizonCard({ events, upcoming, loading, error, onOpenCalendar, className = "card span-6" }: {
  /** Rasterbreite. Seit „Heute" und „Diese Woche" eine gemeinsame Karte
   *  sind, steht der Horizont allein in seiner Zeile (`card span-12`). */
  className?: string;
  events: CalendarEvent[];
  upcoming: CalendarEvent[];
  loading?: boolean;
  error?: string | null;
  onOpenCalendar?: () => void;
}) {
  const { events: wichtige, deleteEvent } = useImportantEvents();
  const versteckt = useHiddenEventIds();
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  /** Einen Eintrag loswerden — je nach Herkunft anders.
   *
   *  Bei „beide" ist der Eintrag aus zwei Quellen zusammengelegt: der eigene
   *  wird gelöscht, der Kalendertermin ausgeblendet. Nur eines von beidem
   *  liesse ihn beim nächsten Aufbau aus der anderen Quelle wieder auftauchen —
   *  und das sähe aus, als hätte der Klick nicht gewirkt. */
  const wegDamit = (item: HorizonItem) => {
    if (item.source === "important" || item.source === "beide") {
      for (const id of item.quellIds?.important ?? [item.id]) deleteEvent(id);
    }
    if (item.source === "calendar" || item.source === "beide") {
      for (const id of item.quellIds?.calendar ?? [item.id]) hideCalendarEvent(id);
    }
  };

  const items = useMemo(() => {
    // `upcoming` enthält heute mit — `events` ist die Teilmenge von heute.
    // Beides zu übergeben würde jeden heutigen Termin doppelt einspeisen.
    const quelle = upcoming.length ? upcoming : events;
    return baueHorizont(quelle, wichtige, { heute });
  }, [upcoming, events, wichtige, heute]);

  // Der nächste Fixpunkt wird dezent hervorgehoben — der erste Eintrag mit
  // Uhrzeit heute, sonst schlicht der erste überhaupt.
  const naechsterId = items.find((i) => i.date === heute && i.time)?.id ?? items[0]?.id;

  const gruppen = useMemo(() => {
    const map = new Map<string, HorizonItem[]>();
    for (const i of items) {
      const g = gruppe(i.date, heute);
      const liste = map.get(g);
      if (liste) liste.push(i); else map.set(g, [i]);
    }
    return [...map.entries()];
  }, [items, heute]);

  // Dieselbe Kartenform wie die Nachbarn im Raster (`card span-6`) statt der
  // Aurora-`Card`: die Fläche steht zwischen „Was heute zählt" und den
  // Wochenaufgaben, und zwei Kartensprachen nebeneinander wären genau die
  // Unruhe, die das Zusammenlegen gerade beseitigt hat.
  return (
    <div className={className}>
      <div className="card-head">
        <span className="ttl">Dein Horizont</span>
        <div className="flex items-center gap-3">
          {/* Der Rückweg. Ohne ihn wäre Ausblenden eine Einbahnstraße: ein
              versehentlich weggeklickter Termin wäre für immer fort, obwohl er
              im Kalender noch steht. Die Zahl steht dabei, sonst weiss niemand,
              dass es überhaupt etwas zurückzuholen gibt. */}
          {versteckt.size > 0 && (
            <button
              type="button"
              className="hz-all"
              title="Alle ausgeblendeten Kalendertermine wieder anzeigen"
              onClick={() => { for (const id of versteckt) unhideCalendarEvent(id); }}
            >
              {versteckt.size} ausgeblendet ↺
            </button>
          )}
          {error
            ? <span className="hz-all" style={{ color: "var(--warn)" }}>Kalender offline</span>
            : onOpenCalendar && (
                <button type="button" className="hz-all" onClick={onOpenCalendar}>Alle Termine</button>
              )}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="empty-row">Wird geladen…</div>
      ) : items.length === 0 ? (
        <div className="empty-row">
          {error
            ? "Der Kalender antwortet gerade nicht. Deine eingetragenen Termine stehen hier, sobald welche anstehen."
            : "Nichts am Horizont — weder heute noch in den nächsten Wochen steht etwas Festes an."}
        </div>
      ) : (
        <div className="hz">
          {gruppen.map(([name, liste]) => (
            <section key={name} className="hz-group">
              <h3 className="hz-when-label">{name}</h3>
              <ul>
                {liste.map((i) => (
                  <Zeile key={i.id} item={i} heute={heute} istNaechster={i.id === naechsterId} onWeg={wegDamit} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
