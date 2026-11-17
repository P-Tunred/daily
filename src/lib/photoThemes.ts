// Background-photo ↔ accent-palette pairings — the calibrated reference set
// from the design handoff (design_handoff_morning_dashboard_colors/README.md).
//
// Each entry captures a background photo together with the accent colors that
// were tuned to match it — hand-picked per the handoff's derivation formula
// (accent = the photo's most saturated non-shadow color, normalized to
// S 70–85% / L 50–58%; accentDeep = same hue, 12–15pt darker; warn = accent's
// hue +25–40° toward amber; crit = a warm clay tone if accent is cool, or a
// darker/desaturated ember tone if accent is already warm) — not auto-extracted.
//
// Both entries below are now LIVE themes, toggled via data-theme on the app
// shell (App.tsx / TopNav.tsx) — see the matching [data-theme="abendrot"]
// block in index.css (Setzling's values live in :root as the default). This
// module documents the palette derivation and is the reference for adding a
// third photo+theme pair; index.css remains the actual runtime source, so any
// new entry here must be mirrored there by hand — see the handoff README's
// "Vorgehen für eine neue Variante" for the exact derivation steps.

export type PhotoTheme = {
  id: string;
  /** Matches the data-theme attribute value used to activate this palette. */
  themeId: "setzling" | "abendrot" | "nachtblau" | "glas";
  /** Path under public/. */
  file: string;
  /** What's visually in the shot — for deriving a fitting palette, not a claim
   *  about when it was actually taken. */
  note: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  warn: string;
  crit: string;
};

export const PHOTO_THEMES: PhotoTheme[] = [
  {
    id: "sapling-forest-floor",
    themeId: "setzling",
    file: "/setzling/bg.png",
    note: "Junger Nadelbaum-Setzling im Waldmoos, weiches diffuses Grün, dunkler Waldboden",
    accent: "#AECB82",
    accentDeep: "#86A95E",
    accentSoft: "rgba(174, 203, 130, 0.16)",
    warn: "#E0C07A",
    crit: "#E0986E",
  },
  {
    id: "sunset-horizon",
    themeId: "abendrot",
    file: "/setzling/abendrot.png",
    note: "Sonnenuntergang, glühende Sonnenscheibe am Horizont, warmer dunkler Himmel",
    accent: "#E8592F",
    accentDeep: "#B23C22",
    accentSoft: "rgba(232, 89, 47, 0.16)",
    warn: "#D9A75E",
    crit: "#B8503F",
  },
  {
    id: "moonlit-summit",
    themeId: "nachtblau",
    file: "/setzling/nachtblau.jpg",
    note: "Mondbeleuchteter Schneegipfel unter tiefblauem Sternenhimmel — Pauls Wahl aus drei Kandidaten (Aug 2026), das ruhigste Motiv mit viel dunkler Fläche",
    accent: "#4A83DC",
    accentDeep: "#2F5FAE",
    accentSoft: "rgba(74, 131, 220, 0.16)",
    warn: "#D9B36A",
    crit: "#C9705A",
  },
  {
    id: "moonlit-summit-glass",
    themeId: "glas",
    // Kein eigenes Bild: im Thema "Glas" bleibt die Bühne leer, dahinter liegt
    // der Schreibtisch. Die Palette stammt trotzdem aus DIESEM Foto — Paul
    // wollte die Akzente vom Bergbild auch für die durchsichtige Fassung.
    file: "/setzling/nachtblau.jpg",
    note: "Dieselbe Vorlage wie Nachtblau, aber ohne Bühne: gemessen wurden 96 % der Fläche auf Farbton 210, gesättigtster Punkt H208/S90/L15 — das Bild trägt praktisch einen einzigen Ton",
    accent: "#4497E4",
    accentDeep: "#1F73C1",
    accentSoft: "rgba(68, 151, 228, 0.16)",
    warn: "#DCBA6A",
    crit: "#D37E69",
  },
];
