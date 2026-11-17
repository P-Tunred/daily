// Die Brain-Seiten zu einem Fach — für den Hinweis unter dem laufenden Timer.
//
// Der Server (electron/brainPages.cjs) sucht die Seiten und kürzt sie; hier
// wird nur abgeholt und kurz gemerkt. Fünf Minuten reichen: das Brain ändert
// sich im Takt von Stunden, ein Timer läuft aber oft mehrmals am Tag an.

export type BrainFachSeite = {
  titel: string;
  datei: string;
  obsidian: string;
  stand: string;
  punkte: string[];
  offeneFragen: number;
  /** false: das Fach hat keine eigene Seite, es wird hier nur erwähnt. */
  eigeneSeite: boolean;
};

export type BrainFach = { ok: boolean; fach: string; seiten: BrainFachSeite[] };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: BrainFach }>();

function istSeite(x: unknown): x is BrainFachSeite {
  const s = x as BrainFachSeite;
  return !!s && typeof s.titel === "string" && typeof s.obsidian === "string"
    && s.obsidian.startsWith("obsidian://") && Array.isArray(s.punkte);
}

export async function ladeBrainFach(name: string): Promise<BrainFach> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const leer: BrainFach = { ok: false, fach: name, seiten: [] };
  if (!key) return leer;
  try {
    const r = await fetch(`/api/brain/fach?name=${encodeURIComponent(name)}`);
    if (!r.ok) return leer;
    const raw = (await r.json()) as Partial<BrainFach>;
    const data: BrainFach = {
      ok: raw.ok === true,
      fach: typeof raw.fach === "string" ? raw.fach : name,
      // Nur was die erwartete Form hat — und nur obsidian://-Links, damit aus
      // dem Wiki nie ein beliebiger Link in einen Klick wird.
      seiten: Array.isArray(raw.seiten) ? raw.seiten.filter(istSeite) : [],
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return leer;
  }
}
