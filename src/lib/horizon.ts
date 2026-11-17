// „Dein Horizont" — Kalendertermine und wichtige Termine in EINER Ordnung.
//
// WARUM ZUSAMMENGELEGT
// Vorher standen dieselben Dinge an zwei Stellen: die Kalenderkarte zeigte, was
// im Google-Kalender steht, „Am Horizont" zeigte Klausuren, Fristen und
// Geburtstage. Wer wissen wollte, was als Nächstes kommt, musste beides lesen
// und im Kopf sortieren — und ein Termin, der in beiden Quellen steckt, stand
// zweimal da.
//
// WARUM DIE DOPPELTEN ÜBERHAUPT ENTSTEHEN
// `useCalendarSync` spiegelt erkannte Klausuren und Geburtstage aus dem
// Kalender in die wichtigen Termine — mit `gcal-<kalenderId>` als Kennung.
// Dasselbe Ereignis liegt damit absichtlich in beiden Ablagen. Diese Datei ist
// die Stelle, die daraus wieder EINEN Eintrag macht.
//
// WAS AUSDRÜCKLICH NICHT ZUSAMMENGEFÜHRT WIRD
// Ähnlichkeit allein reicht nicht. „Vertrag unterschreiben" und
// „Schlüsselübergabe klären" gehören zum selben Vorhaben, sind aber zwei
// verschiedene Handlungen — wer sie zusammenwirft, verliert eine davon.
// Zusammengelegt wird nur bei einer belegbaren Verbindung (Kennung) oder bei
// exakt gleichem normalisiertem Titel am exakt gleichen Tag.

import type { CalendarEvent } from "../types";
import type { ImportantEvent, EventKind } from "../important/types";

export type HorizonKind = EventKind | "appointment";

export type HorizonItem = {
  /** Stabil über Renders — bei zusammengelegten Einträgen die Kalender-Kennung. */
  id: string;
  title: string;
  /** Berliner Kalendertag, JJJJ-MM-TT. */
  date: string;
  /** HH:MM, nur bei Kalenderterminen mit echter Uhrzeit. */
  time?: string;
  kind: HorizonKind;
  /** Woher der Eintrag stammt — für die ruhige Quellenmarkierung. */
  source: "calendar" | "important" | "beide";
  /** Kalenderfarbe/-name (Uni, Privat …), falls die Quelle ihn mitgibt. */
  calendar?: string;
  note?: string;
  /** Die Kennungen der BEITRAGENDEN Quellen — je Ablage getrennt.
   *
   *  WARUM DAS NOETIG IST
   *  Beim Zusammenlegen ueberlebt nur EINE `id` (die des Kalenders). Wer den
   *  Eintrag danach loeschen will, braucht aber beide: den eigenen Termin aus
   *  `important.events` UND den Kalendertermin zum Ausblenden. Ohne dieses Feld
   *  liesse sich ein zusammengelegter Eintrag nur halb entfernen — und taeuchte
   *  beim naechsten Aufbau aus der anderen Quelle wieder auf, als haette der
   *  Klick nicht gewirkt. */
  quellIds?: { calendar?: string[]; important?: string[] };
  /** Steht dieser Eintrag wirklich im echten Kalender?
   *
   *  Nur bei eigenen Eintraegen gesetzt, die dorthin sollen. Die Karte MUSS
   *  das zeigen: wer glaubt, ein Termin stehe im Kalender, obwohl er es nicht
   *  tut, ist schlechter dran als vorher — er verlaesst sich auf etwas, das
   *  nicht existiert. Ein exportierter Eintrag traegt das Feld nie; er IST ja
   *  der Kalender. */
  syncState?: "offen" | "im-kalender" | "fehlgeschlagen" | "loeschen-offen";
};

/** Berliner Kalendertag eines ISO-Zeitpunkts. Ohne feste Zeitzone gilt ein
 *  Termin um 00:30 je nach Rechnerzeitzone als der Vortag. */
export function berlinTag(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

export function berlinZeit(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
  });
}

/** Für den vorsichtigen Titel-Vergleich: Kleinschreibung, Umlaute vereinheitlicht,
 *  Satzzeichen und Mehrfach-Leerzeichen raus. Bewusst KEIN Fuzzy-Matching —
 *  zwei Titel gelten nur als gleich, wenn sie nach dieser Reinigung identisch
 *  sind. Alles Weichere führt dazu, dass verschiedene Vorgänge verschwinden. */
export function normalisiereTitel(t: string): string {
  return t
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Die Kalender-Kennung hinter einem gespiegelten wichtigen Termin, oder null.
 *  `useCalendarSync` legt sie als `gcal-<id>` an — das ist die belastbarste
 *  Verbindung, die es zwischen den beiden Ablagen gibt. */
export function gcalKennung(importantId: string): string | null {
  return importantId.startsWith("gcal-") ? importantId.slice("gcal-".length) : null;
}

/** Tage zwischen zwei Kalendertagen. Auf Tagen gerechnet, nicht auf Stunden:
 *  „morgen" soll auch um 23:50 noch „morgen" heissen. */
export function tageBis(vonIso: string, bisIso: string): number {
  const [ay, am, ad] = vonIso.split("-").map(Number);
  const [by, bm, bd] = bisIso.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

type BauenOptionen = {
  heute: string;
  /** Wie viele zukünftige Einträge nach den heutigen höchstens gezeigt werden. */
  maxZukunft?: number;
  /** Geburtstage erst ab hier zeigen — ein Geburtstag in 200 Tagen ist kein
   *  Horizont, sondern Rauschen. */
  geburtstagFensterTage?: number;
};

/**
 * Führt Kalendertermine und wichtige Termine zu einer chronologischen Liste
 * zusammen und entfernt dabei die Doppelten.
 *
 * Reihenfolge der Verschmelzung, von belastbar nach vorsichtig:
 *   1. `gcal-`-Verknüpfung — der wichtige Termin nennt die Kalender-Kennung
 *   2. gleiche Kennung auf beiden Seiten
 *   3. gleicher normalisierter Titel am gleichen Berliner Tag
 */
export function baueHorizont(
  kalender: CalendarEvent[],
  wichtige: ImportantEvent[],
  { heute, maxZukunft = 6, geburtstagFensterTage = 21 }: BauenOptionen,
): HorizonItem[] {
  const ausKalender = new Map<string, HorizonItem>();
  // id → nackte CalDAV-UID. Nicht am HorizonItem: die UID ist ein Detail des
  // Zusammenfuehrens, kein Anzeigefeld.
  const kalenderUid = new Map<string, string>();

  for (const e of kalender) {
    const date = berlinTag(e.start);
    if (tageBis(heute, date) < 0) continue;           // Vergangenes gehört nicht auf den Horizont
    ausKalender.set(e.id, {
      id: e.id,
      title: e.title,
      date,
      time: e.allDay ? undefined : berlinZeit(e.start),
      kind: "appointment",
      source: "calendar",
      calendar: e.calendar,
    });
    if (e.uid) kalenderUid.set(e.id, e.uid);
  }

  // STUFE 0 — die CalDAV-UID. Belastbarer als alles andere: sie stammt vom
  // Kalender selbst.
  //
  // WARUM DAS DIE WICHTIGSTE STUFE IST
  // Legt Daily einen Termin an, merkt es sich dessen UID (`calUid`). Beim
  // naechsten Export kommt derselbe Termin ueber `upcoming_events.json`
  // zurueck — mit genau dieser UID. Ohne diese Stufe stuende er dann ZWEIMAL
  // im Horizont: einmal als eigener Eintrag, einmal als Kalendertermin.
  // Der exportierte gewinnt, weil er die Wahrheit aus dem Kalender traegt
  // (verschobene Zeit, geaenderter Titel). Der lokale bleibt in der Ablage
  // stehen — als Beleg, dass Daily ihn erzeugt hat, und damit ein spaeteres
  // Loeschen die UID noch kennt. Er wird nur nicht mehr gezeigt.
  const nachUid = new Map<string, string>();
  for (const [id, uid] of kalenderUid) {
    if (!nachUid.has(uid)) nachUid.set(uid, id);
  }

  // Nachschlagewerk für die dritte Stufe. Erster Treffer gewinnt; steht
  // derselbe Titel am selben Tag zweimal im Kalender, ist das ein echtes
  // Doppel im Kalender und nicht unser Problem.
  const nachTitelTag = new Map<string, string>();
  for (const [id, item] of ausKalender) {
    const schluessel = `${normalisiereTitel(item.title)}|${item.date}`;
    if (!nachTitelTag.has(schluessel)) nachTitelTag.set(schluessel, id);
  }

  const ergebnis: HorizonItem[] = [];

  for (const w of wichtige) {
    if (w.dismissed) continue;
    const date = naechstesVorkommen(w, heute);
    if (date === null) continue;

    if (w.kind === "birthday" && tageBis(heute, date) > geburtstagFensterTage) continue;

    // Stufe 0 — die CalDAV-UID eines von Daily angelegten Termins.
    let treffer = w.calUid ? nachUid.get(w.calUid) ?? null : null;
    // Stufe 1 + 2 — Kennung
    const kennung = gcalKennung(w.id);
    if (!treffer) treffer = kennung && ausKalender.has(kennung) ? kennung : null;
    // Stufe 3 — gleicher Titel am gleichen Tag
    if (!treffer) treffer = nachTitelTag.get(`${normalisiereTitel(w.title)}|${date}`) ?? null;

    if (treffer) {
      // Zusammenlegen: Die ART kommt vom wichtigen Termin (eine Klausur ist
      // mehr als ein Kalendereintrag), die UHRZEIT vom Kalender.
      const k = ausKalender.get(treffer)!;
      ausKalender.set(treffer, {
        ...k, kind: w.kind, source: "beide", note: w.note ?? k.note,
        quellIds: {
          calendar: k.quellIds?.calendar ?? [k.id],
          // Mehrere eigene Eintraege koennen auf denselben Kalendertermin
          // treffen — dann muessen beim Loeschen auch alle weg.
          important: [...(k.quellIds?.important ?? []), w.id],
        },
      });
      continue;
    }

    ergebnis.push({
      id: w.id, title: w.title, date, kind: w.kind, source: "important", note: w.note,
      quellIds: { important: [w.id] },
      syncState: w.syncState,
    });
  }

  ergebnis.push(...ausKalender.values());

  ergebnis.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Innerhalb eines Tages: mit Uhrzeit vor ganztägig, sonst nach Uhrzeit.
    if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    if (a.time) return -1;
    if (b.time) return 1;
    return a.title.localeCompare(b.title, "de");
  });

  // Alles von heute bleibt; von der Zukunft nur die nächsten `maxZukunft`.
  const heutige = ergebnis.filter((i) => i.date === heute);
  const kuenftige = ergebnis.filter((i) => i.date > heute).slice(0, maxZukunft);
  return [...heutige, ...kuenftige];
}

/** Das nächste Vorkommen eines wichtigen Termins ab heute.
 *  Jährliche (Geburtstage) rollen ins nächste Jahr, alle anderen fallen
 *  heraus, sobald sie vorbei sind — ein Kalendereintrag beweist weder
 *  Teilnahme noch Erledigung, also wird Vergangenes nicht wiederbelebt. */
function naechstesVorkommen(e: ImportantEvent, heute: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  if (tageBis(heute, e.date) >= 0) return e.date;
  if (!e.recurringYearly) return null;
  const [, m, d] = e.date.split("-");
  const jahr = Number(heute.slice(0, 4));
  const diesesJahr = `${jahr}-${m}-${d}`;
  return tageBis(heute, diesesJahr) >= 0 ? diesesJahr : `${jahr + 1}-${m}-${d}`;
}

/** Ruhige Gruppenüberschrift: Heute · Morgen · Wochentag · In N Tagen · Später */
export function gruppe(date: string, heute: string): string {
  const d = tageBis(heute, date);
  if (d === 0) return "Heute";
  if (d === 1) return "Morgen";
  if (d <= 6) {
    const [y, m, dd] = date.split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString("de-DE", { weekday: "long" });
  }
  // 7 und 8 Tage bekamen vorher je eine EIGENE Überschrift — bei sechs
  // Einträgen entstanden so fünf Gruppen mit je einer Zeile, und die Liste
  // zerfiel in Überschriften. Ab hier wird zusammengefasst.
  if (d <= 13) return "Nächste Woche";
  if (d <= 30) return "In zwei bis vier Wochen";
  return "Später";
}
