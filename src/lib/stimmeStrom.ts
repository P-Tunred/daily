// Die Antwort von POST /api/stimme/sag lesen: eine JSON-Zeile je Ereignis
// (Format: electron/hermesStimme.cjs). Bröckchen aus dem Netz schneiden
// Zeilen beliebig — der Leser setzt sie wieder zusammen.

export type StimmEreignis =
  | { typ: "satz"; text: string }
  | { typ: "werkzeug"; name: string }
  | { typ: "aktion"; art: "todo"; id: string; text: string; wo: string }
  | { typ: "aktion"; art: "antwort"; id: string; text: string }
  | { typ: "aktion"; art: "termin"; id: string; ids: string[]; text: string }
  | { typ: "aktion"; art: "brain"; id: string; text: string; link?: string }
  | { typ: "aktion"; art: "streichen" | "erledigt"; id: string; text: string }
  | { typ: "zurueck"; art: "todo" | "antwort" | "termin" | "streichen" | "erledigt"; id: string; text: string }
  | { typ: "ende" }
  | { typ: "hinweis"; text: string }
  | { typ: "fertig"; text?: string; quelle?: "daily" | "hermes" }
  | { typ: "fehler"; text: string };

export interface ZeilenLeser {
  dazu: (stueck: string) => StimmEreignis[];
  ende: () => StimmEreignis[];
}

function lies(zeile: string): StimmEreignis | null {
  if (!zeile.trim()) return null;
  try {
    const v: unknown = JSON.parse(zeile);
    return v && typeof v === "object" && typeof (v as { typ?: unknown }).typ === "string" ? (v as StimmEreignis) : null;
  } catch {
    return null;
  }
}

export function zeilenLeser(): ZeilenLeser {
  let rest = "";
  const dazu = (stueck: string): StimmEreignis[] => {
    const teile = (rest + stueck).split("\n");
    rest = teile.pop() ?? "";
    return teile.map(lies).filter((e): e is StimmEreignis => e !== null);
  };
  const ende = (): StimmEreignis[] => {
    const e = lies(rest);
    rest = "";
    return e ? [e] : [];
  };
  return { dazu, ende };
}

/** Liest die Antwort eines fetch() Ereignis für Ereignis. */
export async function* ereignisse(res: Response): AsyncGenerator<StimmEreignis> {
  if (!res.body) return;
  const leser = zeilenLeser();
  const dekoder = new TextDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield* leser.dazu(dekoder.decode(value, { stream: true }));
  }
  yield* leser.ende();
}
