// Projekte: wo Paul steht, was als Nächstes kommt, was er sich dazu notiert.
//
// WARUM ES DAS GIBT
// Daily kannte bisher Tage (Aufgaben, Lernzeit, Routinen), aber keine Vorhaben,
// die über Wochen laufen: die Portfolio-Website, LearnHarness, GitHub. Deren
// Stand lebte in Pauls Kopf und verstreut im Brain. Hier steht er an einem Ort.
//
// DIE REGELN, DIE DIESE DATEI DURCHSETZT
// - Fortschritt ist „erledigte Schritte von allen". Keine geschätzte Prozentzahl.
// - Der nächste Schritt ist der erste offene. Es gibt keine zweite Markierung,
//   die davon abweichen könnte.
// - Hermes legt an und ergänzt, löscht aber nichts. Löschen kann nur Paul.
// - Pauls eigener Satz „Wo du aufgehört hast" wird von Hermes nie überschrieben.
// - Ein Vorschlag ändert nichts, bis Paul ihn übernimmt. Übernehmen und
//   Verwerfen landen in `entscheidungen`, damit Hermes daraus lernt.
//
// Diese Datei ist rein: kein fetch, kein Speicher, keine Uhr. Browser, Server
// und Tests rufen dieselben Funktionen mit Zeit und Id von außen auf. Der
// Server lädt sie direkt als TypeScript (Node 22), deshalb keine Importe.

export type Herkunft = "paul" | "hermes";
export type ProjektStatus = "laeuft" | "idee" | "pause";
export type MerkArt = "notizen" | "ideen";

export interface Schritt {
  id: string;
  text: string;
  erledigt: string | null; // ISO-Zeit des Abhakens
  von: Herkunft;
}

export interface Eintrag {
  id: string;
  text: string;
  am: string;
  von: Herkunft;
}

export interface Zuletzt {
  text: string;
  am: string;
  von: Herkunft;
}

/** Was Paul zuletzt mit Claude an diesem Projekt gemacht hat — die
 *  Schlusszusammenfassung der jüngsten passenden Sitzung, vom Mac geschickt
 *  (deploy/claude-stand/). Steht NEBEN „zuletzt", nie an dessen Stelle:
 *  Pauls eigener Satz bleibt seiner, er kann diesen hier übernehmen. */
export interface ClaudeStand {
  text: string;
  am: string;
  titel: string;
}

export interface Vorschlag {
  id: string;
  text: string;
  schritte: string[];
  am: string;
}

export interface Projekt {
  id: string;
  name: string;
  status: ProjektStatus;
  angelegt: { am: string; von: Herkunft };
  zuletzt: Zuletzt | null;
  schritte: Schritt[];
  notizen: Eintrag[];
  ideen: Eintrag[];
  vorschlaege: Vorschlag[];
  /** Paul hat „Vorschlag holen" gedrückt; Hermes sieht es beim nächsten Lauf. */
  vorschlagGewuenscht: string | null;
  /** Fehlt bei Projekten von vor 2026-11-10 — dann wie null. */
  claude?: ClaudeStand | null;
}

export interface Entscheidung {
  projekt: string;
  text: string;
  schritte: string[];
  ergebnis: "uebernommen" | "verworfen";
  am: string;
}

export interface ProjekteState {
  version: 1;
  projekte: Projekt[];
  entscheidungen: Entscheidung[];
}

export const GRENZEN = {
  projekte: 30,
  name: 80,
  text: 500,
  titel: 120,
  schritte: 40,
  eintraege: 100,
  vorschlaege: 3,
  vorschlagSchritte: 8,
  entscheidungen: 60,
} as const;

export const STATUS_NAME: Record<ProjektStatus, string> = {
  laeuft: "Läuft",
  idee: "Will ich machen",
  pause: "Pausiert",
};

export class ProjektFehler extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ProjektFehler";
    this.status = status;
  }
}

// ── Prüfen ──────────────────────────────────────────────────────────────────

const istObjekt = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const istText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const istZeit = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const istVon = (v: unknown): v is Herkunft => v === "paul" || v === "hermes";
const istStatus = (v: unknown): v is ProjektStatus => v === "laeuft" || v === "idee" || v === "pause";
const eindeutig = (liste: { id: string }[]) => new Set(liste.map((x) => x.id)).size === liste.length;

const istSchritt = (s: unknown): s is Schritt =>
  istObjekt(s) && istText(s.id, 64) && istText(s.text, GRENZEN.text) && (s.erledigt === null || istZeit(s.erledigt)) && istVon(s.von);
const istEintrag = (e: unknown): e is Eintrag =>
  istObjekt(e) && istText(e.id, 64) && istText(e.text, GRENZEN.text) && istZeit(e.am) && istVon(e.von);
const istVorschlag = (v: unknown): v is Vorschlag =>
  istObjekt(v) && istText(v.id, 64) && istText(v.text, GRENZEN.text) && istZeit(v.am)
  && Array.isArray(v.schritte) && v.schritte.length <= GRENZEN.vorschlagSchritte && v.schritte.every((t) => istText(t, GRENZEN.text));

const istClaudeStand = (c: unknown): c is ClaudeStand =>
  istObjekt(c) && istText(c.text, GRENZEN.text) && istZeit(c.am) && istText(c.titel, GRENZEN.titel);

function istProjekt(p: unknown): p is Projekt {
  if (!istObjekt(p)) return false;
  const a = p.angelegt, z = p.zuletzt;
  return istText(p.id, 64) && istText(p.name, GRENZEN.name) && istStatus(p.status)
    && istObjekt(a) && istZeit(a.am) && istVon(a.von)
    && (z === null || (istObjekt(z) && istText(z.text, GRENZEN.text) && istZeit(z.am) && istVon(z.von)))
    && Array.isArray(p.schritte) && p.schritte.length <= GRENZEN.schritte && p.schritte.every(istSchritt) && eindeutig(p.schritte as Schritt[])
    && Array.isArray(p.notizen) && p.notizen.length <= GRENZEN.eintraege && p.notizen.every(istEintrag)
    && Array.isArray(p.ideen) && p.ideen.length <= GRENZEN.eintraege && p.ideen.every(istEintrag)
    && Array.isArray(p.vorschlaege) && p.vorschlaege.length <= GRENZEN.vorschlaege && p.vorschlaege.every(istVorschlag)
    && (p.vorschlagGewuenscht === null || istZeit(p.vorschlagGewuenscht))
    && (p.claude === undefined || p.claude === null || istClaudeStand(p.claude));
}

const istEntscheidung = (e: unknown): e is Entscheidung =>
  istObjekt(e) && istText(e.projekt, GRENZEN.name) && istText(e.text, GRENZEN.text) && istZeit(e.am)
  && (e.ergebnis === "uebernommen" || e.ergebnis === "verworfen")
  && Array.isArray(e.schritte) && e.schritte.every((t) => typeof t === "string");

export function istGueltig(v: unknown): v is ProjekteState {
  return istObjekt(v) && v.version === 1
    && Array.isArray(v.projekte) && v.projekte.length <= GRENZEN.projekte && v.projekte.every(istProjekt) && eindeutig(v.projekte as Projekt[])
    && Array.isArray(v.entscheidungen) && v.entscheidungen.length <= GRENZEN.entscheidungen && v.entscheidungen.every(istEntscheidung);
}

export const leer = (): ProjekteState => ({ version: 1, projekte: [], entscheidungen: [] });

/** Liest den gespeicherten Text. `null` heißt: da, aber nicht lesbar — dann
 *  wird nichts überschrieben. Ein fehlender Wert ist der leere Anfang. */
export function lese(roh: string | null | undefined): ProjekteState | null {
  if (roh === null || roh === undefined) return leer();
  try {
    const v: unknown = JSON.parse(roh);
    return istGueltig(v) ? v : null;
  } catch {
    return null;
  }
}

// ── Ableiten ────────────────────────────────────────────────────────────────

export const erledigtZahl = (p: Projekt): number => p.schritte.filter((s) => s.erledigt).length;
export const offeneSchritte = (p: Projekt): Schritt[] => p.schritte.filter((s) => !s.erledigt);
export const naechsterSchritt = (p: Projekt): Schritt | null => offeneSchritte(p)[0] ?? null;

/** Wann zuletzt etwas passiert ist: Satz, Haken, Notiz oder Idee. */
export function zuletztAktiv(p: Projekt): string {
  const zeiten = [
    p.angelegt.am,
    p.zuletzt?.am,
    p.claude?.am,
    ...p.schritte.map((s) => s.erledigt),
    ...p.notizen.map((n) => n.am),
    ...p.ideen.map((n) => n.am),
  ].filter((t): t is string => !!t);
  return zeiten.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

const ZONE = "Europe/Berlin";
const tagIn = (iso: string | number) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: ZONE });

/** Der Stand aus Claude, wenn er neuer ist als Pauls Satz — sonst null. */
export function neuerClaudeStand(p: Projekt): ClaudeStand | null {
  if (!p.claude) return null;
  // Gleicher Text: schon übernommen — auch wenn die Uhr des Macs vorgeht.
  if (p.zuletzt && (p.zuletzt.text === p.claude.text || Date.parse(p.zuletzt.am) >= Date.parse(p.claude.am))) return null;
  return p.claude;
}

/** „heute", „gestern", „vor 3 Tagen", sonst „7. Nov." — immer in Berlin. */
export function wannText(iso: string, jetzt: number): string {
  const tage = Math.round((Date.parse(tagIn(jetzt)) - Date.parse(tagIn(iso))) / 86_400_000);
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 7) return `vor ${tage} Tagen`;
  return new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", timeZone: ZONE });
}

/** Läuft vor „will ich machen" vor pausiert; innerhalb zuletzt Aktives zuerst. */
export function sortiert(projekte: readonly Projekt[]): Projekt[] {
  const rang: Record<ProjektStatus, number> = { laeuft: 0, idee: 1, pause: 2 };
  return [...projekte].sort((a, b) =>
    rang[a.status] - rang[b.status] || Date.parse(zuletztAktiv(b)) - Date.parse(zuletztAktiv(a)));
}

// ── Ändern ──────────────────────────────────────────────────────────────────
// Jede Funktion gibt einen neuen Stand zurück und wirft ProjektFehler, wenn
// die Eingabe nicht passt. Den alten Stand fasst keine an.

export interface Kontext {
  am: string;
  von: Herkunft;
  neueId: () => string;
}

function sauber(v: unknown, max: number, feld: string): string {
  if (typeof v !== "string") throw new ProjektFehler(400, `Feld "${feld}" fehlt.`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) throw new ProjektFehler(400, `Feld "${feld}" ist leer.`);
  if (t.length > max) throw new ProjektFehler(400, `Feld "${feld}" ist länger als ${max} Zeichen.`);
  return t;
}

function textListe(v: unknown, max: number, feld: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ProjektFehler(400, `Feld "${feld}" muss eine Liste sein.`);
  if (v.length > max) throw new ProjektFehler(400, `Feld "${feld}" hat mehr als ${max} Einträge.`);
  return v.map((t, i) => sauber(t, GRENZEN.text, `${feld}[${i}]`));
}

export function findeProjekt(s: ProjekteState, idOderName: string): Projekt {
  const suche = idOderName.trim().toLowerCase();
  const p = s.projekte.find((x) => x.id === idOderName) ?? s.projekte.find((x) => x.name.toLowerCase() === suche);
  if (!p) throw new ProjektFehler(404, "Projekt nicht gefunden.");
  return p;
}

function ersetze(s: ProjekteState, p: Projekt): ProjekteState {
  return { ...s, projekte: s.projekte.map((x) => (x.id === p.id ? p : x)) };
}

export interface NeuesProjekt {
  name: unknown;
  status?: unknown;
  schritte?: unknown;
  zuletzt?: unknown;
  notiz?: unknown;
  idee?: unknown;
}

export function legeAn(s: ProjekteState, eingabe: NeuesProjekt, k: Kontext): { stand: ProjekteState; projekt: Projekt } {
  const name = sauber(eingabe.name, GRENZEN.name, "name");
  if (s.projekte.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new ProjektFehler(409, `Ein Projekt „${name}" gibt es schon.`);
  }
  if (s.projekte.length >= GRENZEN.projekte) throw new ProjektFehler(400, `Mehr als ${GRENZEN.projekte} Projekte nimmt Daily nicht an.`);
  const status = eingabe.status === undefined ? "idee" : eingabe.status;
  if (!istStatus(status)) throw new ProjektFehler(400, 'Feld "status" ist "laeuft", "idee" oder "pause".');
  const eintrag = (v: unknown, feld: string): Eintrag[] =>
    v === undefined || v === null ? [] : [{ id: k.neueId(), text: sauber(v, GRENZEN.text, feld), am: k.am, von: k.von }];
  const projekt: Projekt = {
    id: k.neueId(),
    name,
    status,
    angelegt: { am: k.am, von: k.von },
    zuletzt: eingabe.zuletzt === undefined || eingabe.zuletzt === null ? null : { text: sauber(eingabe.zuletzt, GRENZEN.text, "zuletzt"), am: k.am, von: k.von },
    schritte: textListe(eingabe.schritte, GRENZEN.schritte, "schritte").map((text) => ({ id: k.neueId(), text, erledigt: null, von: k.von })),
    notizen: eintrag(eingabe.notiz, "notiz"),
    ideen: eintrag(eingabe.idee, "idee"),
    vorschlaege: [],
    vorschlagGewuenscht: null,
  };
  return { stand: { ...s, projekte: [...s.projekte, projekt] }, projekt };
}

/** Schritte anhängen (Hermes, Paul) oder vor den nächsten offenen setzen
 *  (`vorn`, beim Übernehmen eines Vorschlags). */
export function fuegeSchritteHinzu(s: ProjekteState, projektId: string, texte: unknown, k: Kontext, vorn = false): ProjekteState {
  const p = findeProjekt(s, projektId);
  const neu = textListe(texte, GRENZEN.schritte, "schritte").map((text) => ({ id: k.neueId(), text, erledigt: null, von: k.von }));
  if (!neu.length) throw new ProjektFehler(400, 'Feld "schritte" ist leer.');
  if (p.schritte.length + neu.length > GRENZEN.schritte) throw new ProjektFehler(400, `Mehr als ${GRENZEN.schritte} Schritte pro Projekt nimmt Daily nicht an.`);
  const i = p.schritte.findIndex((x) => !x.erledigt);
  const pos = vorn && i >= 0 ? i : p.schritte.length;
  return ersetze(s, { ...p, schritte: [...p.schritte.slice(0, pos), ...neu, ...p.schritte.slice(pos)] });
}

/** Abhaken. Danach rückt „Wo du aufgehört hast" nach — das ist Pauls eigene
 *  Handlung, also darf sie seinen Satz ersetzen. */
export function hakeAb(s: ProjekteState, projektId: string, schrittId: string, k: Kontext): ProjekteState {
  const p = findeProjekt(s, projektId);
  const schritt = p.schritte.find((x) => x.id === schrittId);
  if (!schritt) throw new ProjektFehler(404, "Schritt nicht gefunden.");
  if (schritt.erledigt) return s;
  return ersetze(s, {
    ...p,
    status: p.status === "idee" ? "laeuft" : p.status,
    schritte: p.schritte.map((x) => (x.id === schrittId ? { ...x, erledigt: k.am } : x)),
    zuletzt: { text: `Erledigt: ${schritt.text}`, am: k.am, von: k.von },
  });
}

export function hakeZurueck(s: ProjekteState, projektId: string, schrittId: string): ProjekteState {
  const p = findeProjekt(s, projektId);
  if (!p.schritte.some((x) => x.id === schrittId)) throw new ProjektFehler(404, "Schritt nicht gefunden.");
  return ersetze(s, { ...p, schritte: p.schritte.map((x) => (x.id === schrittId ? { ...x, erledigt: null } : x)) });
}

/** Hermes darf den Satz nur setzen, solange keiner von Paul dasteht. */
export function setzeZuletzt(s: ProjekteState, projektId: string, text: unknown, k: Kontext): ProjekteState {
  const p = findeProjekt(s, projektId);
  if (k.von === "hermes" && p.zuletzt?.von === "paul") {
    throw new ProjektFehler(409, "Hier steht Pauls eigener Satz. Hermes überschreibt ihn nicht; leg es als Notiz an.");
  }
  return ersetze(s, { ...p, zuletzt: { text: sauber(text, GRENZEN.text, "zuletzt"), am: k.am, von: k.von } });
}

export function fuegeEintragHinzu(s: ProjekteState, projektId: string, art: MerkArt, text: unknown, k: Kontext): ProjekteState {
  const p = findeProjekt(s, projektId);
  const eintrag: Eintrag = { id: k.neueId(), text: sauber(text, GRENZEN.text, art === "notizen" ? "notiz" : "idee"), am: k.am, von: k.von };
  return ersetze(s, { ...p, [art]: [eintrag, ...p[art]].slice(0, GRENZEN.eintraege) });
}

export function setzeStatus(s: ProjekteState, projektId: string, status: unknown): ProjekteState {
  if (!istStatus(status)) throw new ProjektFehler(400, 'Feld "status" ist "laeuft", "idee" oder "pause".');
  const p = findeProjekt(s, projektId);
  return ersetze(s, { ...p, status });
}

/** Ein Vorschlag von Hermes. Höchstens drei warten; der älteste fällt raus.
 *  Ein Vorschlag erfüllt Pauls Wunsch, also verschwindet „gewünscht". */
export function schlageVor(s: ProjekteState, projektId: string, eingabe: { text?: unknown; schritte?: unknown }, k: Kontext): { stand: ProjekteState; vorschlag: Vorschlag } {
  const p = findeProjekt(s, projektId);
  const vorschlag: Vorschlag = {
    id: k.neueId(),
    text: sauber(eingabe.text, GRENZEN.text, "text"),
    schritte: textListe(eingabe.schritte, GRENZEN.vorschlagSchritte, "schritte"),
    am: k.am,
  };
  const vorschlaege = [...p.vorschlaege, vorschlag].slice(-GRENZEN.vorschlaege);
  return { stand: ersetze(s, { ...p, vorschlaege, vorschlagGewuenscht: null }), vorschlag };
}

export function wuenscheVorschlag(s: ProjekteState, projektId: string, k: Kontext): ProjekteState {
  const p = findeProjekt(s, projektId);
  return ersetze(s, { ...p, vorschlagGewuenscht: k.am });
}

/** Übernehmen setzt die Schritte vor den nächsten offenen; Verwerfen nur weg.
 *  Beides wird für Hermes festgehalten. */
export function entscheide(s: ProjekteState, projektId: string, vorschlagId: string, ergebnis: Entscheidung["ergebnis"], k: Kontext): ProjekteState {
  const p = findeProjekt(s, projektId);
  const v = p.vorschlaege.find((x) => x.id === vorschlagId);
  if (!v) throw new ProjektFehler(404, "Vorschlag nicht gefunden.");
  let stand = ersetze(s, { ...p, vorschlaege: p.vorschlaege.filter((x) => x.id !== vorschlagId) });
  if (ergebnis === "uebernommen" && v.schritte.length) stand = fuegeSchritteHinzu(stand, p.id, v.schritte, k, true);
  const entscheidung: Entscheidung = { projekt: p.name, text: v.text, schritte: v.schritte, ergebnis, am: k.am };
  return { ...stand, entscheidungen: [entscheidung, ...stand.entscheidungen].slice(0, GRENZEN.entscheidungen) };
}

/** Stand aus einer Claude-Sitzung. Nur ein neuerer ersetzt den alten, damit
 *  ein verspäteter Lauf (Mac war aus) nichts zurückdreht. */
export function setzeClaudeStand(s: ProjekteState, projektId: string, eingabe: { text?: unknown; am?: unknown; titel?: unknown }): { stand: ProjekteState; geaendert: boolean } {
  const p = findeProjekt(s, projektId);
  if (!istZeit(eingabe.am)) throw new ProjektFehler(400, 'Feld "am" ist keine Zeit.');
  const neu: ClaudeStand = {
    text: sauber(eingabe.text, GRENZEN.text, "text"),
    am: new Date(eingabe.am).toISOString(),
    titel: sauber(eingabe.titel, GRENZEN.titel, "titel"),
  };
  if (p.claude && Date.parse(p.claude.am) >= Date.parse(neu.am)) return { stand: s, geaendert: false };
  return { stand: ersetze(s, { ...p, claude: neu }), geaendert: true };
}

// ── Nur Paul ────────────────────────────────────────────────────────────────

export function entferneSchritt(s: ProjekteState, projektId: string, schrittId: string): ProjekteState {
  const p = findeProjekt(s, projektId);
  return ersetze(s, { ...p, schritte: p.schritte.filter((x) => x.id !== schrittId) });
}

export function entferneEintrag(s: ProjekteState, projektId: string, art: MerkArt, eintragId: string): ProjekteState {
  const p = findeProjekt(s, projektId);
  return ersetze(s, { ...p, [art]: p[art].filter((x) => x.id !== eintragId) });
}

export function entferneProjekt(s: ProjekteState, projektId: string): ProjekteState {
  const p = findeProjekt(s, projektId);
  return { ...s, projekte: s.projekte.filter((x) => x.id !== p.id) };
}
