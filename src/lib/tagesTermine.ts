// Der Morgendialog: gehst du heute zu diesen Terminen?
//
// WARUM ZUSÄTZLICH ZUR SERIEN-ENTSCHEIDUNG
// Bisher wurde einmal pro Serie gefragt und die Antwort galt für immer. Nach
// 166 entschiedenen Serien fragt das System praktisch nichts mehr — und trägt
// deshalb beide Übungsgruppen desselben Fachs in denselben Vormittag ein,
// obwohl Paul nur in einer ist. Am 12.09. standen sechs solcher Kollisionen im
// Kalender.
//
// WARUM DIE ANTWORT NUR FÜR HEUTE GILT
// Bei "FODS Gruppe 1 oder Gruppe 2" kann die Antwort nächste Woche anders
// ausfallen. Eine Serienentscheidung würde einen Fehlklick bis ins nächste
// Semester tragen; hier verschwindet der Termin für heute und steht morgen
// wieder zur Wahl.
//
// WARUM EIN MARKER PRO TAG
// Ohne ihn käme der Dialog nach jedem Neuladen wieder — und ein Dialog, den man
// zehnmal am Tag wegklickt, wird beim elften Mal auch dann weggeklickt, wenn
// etwas Wichtiges drinsteht.

const KEY = "morning.calendar.tagesabfrage";
const CHANGE_EVENT = "morning:tagestermine-change";

export type TagesStand = {
  /** Für welchen Tag dieser Stand gilt. */
  tag: string;
  /** Vorkommens-Kennungen, die heute schon beantwortet wurden. */
  beantwortet: string[];
  /** "Später" gedrückt — heute nicht mehr fragen. */
  vertagt: boolean;
};

export function heuteIso(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function leer(tag: string): TagesStand {
  return { tag, beantwortet: [], vertagt: false };
}

export function ladeStand(): TagesStand {
  const heute = heuteIso();
  try {
    const roh = localStorage.getItem(KEY);
    if (!roh) return leer(heute);
    const v = JSON.parse(roh) as Partial<TagesStand>;
    // Ein Stand von gestern ist wertlos — heute wird neu gefragt.
    if (v.tag !== heute) return leer(heute);
    return {
      tag: heute,
      beantwortet: Array.isArray(v.beantwortet) ? v.beantwortet.filter((x) => typeof x === "string") : [],
      vertagt: v.vertagt === true,
    };
  } catch {
    return leer(heute);
  }
}

function speichere(stand: TagesStand) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stand));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function merkeBeantwortet(eventId: string) {
  const s = ladeStand();
  if (s.beantwortet.includes(eventId)) return;
  speichere({ ...s, beantwortet: [...s.beantwortet, eventId] });
}

export function vertageHeute() {
  speichere({ ...ladeStand(), vertagt: true });
}

export const TAGESTERMINE_CHANGE = CHANGE_EVENT;
export const TAGESTERMINE_KEY = KEY;
