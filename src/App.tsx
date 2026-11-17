import { useEffect, useState } from "react";
import { SideRail } from "./components/SideRail";
import { useHashRoute } from "./lib/router";
import { DashboardPage } from "./pages/DashboardPage";
import { LernzeitPage } from "./tracker/LernzeitPage";
import { TrackerProvider } from "./tracker/store";
import { ImportantEventsProvider } from "./important/store";
import { TimerProvider, useTimerContext } from "./tracker/TimerContext";
import { TimerWidget } from "./tracker/TimerWidget";
import { SavedToast } from "./tracker/SavedToast";
import { UsageEdges } from "./components/UsageEdges";
import { BriefingAlertDialog } from "./components/BriefingAlertDialog";
import { useClickSounds } from "./hooks/useClickSounds";
import { useDoneTodoCleanup } from "./hooks/useDoneTodoCleanup";
import { useScoreSnapshot } from "./hooks/useScoreSnapshot";
import { isSoundEnabled, setSoundEnabled } from "./lib/sound";
import { useIntroLayout } from "./lib/introLayout";
import { useStil } from "./lib/stil";
import AsciiTeich from "./components/AsciiTeich";
import { artZumMotiv, useTeichMotiv } from "./lib/teichMotiv";
import "./g-stil.css";

const TABS = [
  { id: "morgens", label: "Morgens", icon: "☀", hash: "#/" },
  { id: "lernzeit", label: "Lernzeit", icon: "📚", hash: "#/lernzeit" },
];

function activeTab(hash: string): string {
  return hash.startsWith("#/lernzeit") ? "lernzeit" : "morgens";
}

// ── Themes: Setzling (green) · Abendrot (sunset) are dark photo themes.
// Kupferstich (cobalt engraving) and Arkadien (warm romantic landscapes) are
// LIGHT "glass" themes: a rotating set of painted/engraved plates behind a
// tunable frosted-glass wash. All from design handoffs; choice persisted. ─────
export type Theme = "setzling" | "abendrot" | "nachtblau" | "glas" | "kupferstich" | "arkadien";
const THEME_KEY = "morning.theme";

const THEMES: Theme[] = ["setzling", "abendrot", "nachtblau", "glas", "kupferstich", "arkadien"];

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY) as Theme | null;
    return v && THEMES.includes(v) ? v : "setzling";
  } catch {
    return "setzling";
  }
}

// ── Glass themes — each carries its own cycle of background plates (assets in
// public/setzling/<theme>/<plate>.jpg + <plate>-frost.jpg). Adding a plate is
// one array entry + the two jpgs. Cycled via the ⟳ in the settings panel. ─────
const PLATES = {
  kupferstich: ["knight", "portrait", "vortex", "stairway", "fingers"],
  arkadien: ["valley", "arcadia", "pastoral", "ruins"],
} as const;
type GlassTheme = keyof typeof PLATES;
function isGlassTheme(t: Theme): t is GlassTheme {
  return t === "kupferstich" || t === "arkadien";
}
// html background (behind the reserved scrollbar gutters) must match the theme,
// else the dark root shows as a black band on the light themes.
const PAPER_BG: Record<GlassTheme, string> = { kupferstich: "#F6F1D8", arkadien: "#F2E9D6" };

// Per-theme selected plate index, e.g. { kupferstich: 2, arkadien: 0 }.
const PLATE_KEY = "morning.plateIndex";
function loadPlateIdx(): Record<string, number> {
  try {
    const o = JSON.parse(localStorage.getItem(PLATE_KEY) ?? "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

// Frosted-glass transparency (the cream wash opacity), shared across glass
// themes, user-set via the slider. Lernzeit adds +0.10 on top (see index.css).
const FROST_KEY = "morning.kupferstichFrost";
const FROST_MIN = 0;      // fully transparent — the plate shows completely
const FROST_MAX = 0.72;   // near-opaque — motif only faintly visible
const FROST_DEFAULT = 0.2;

function loadFrost(): number {
  try {
    const n = Number(localStorage.getItem(FROST_KEY));
    return Number.isFinite(n) && n >= FROST_MIN && n <= FROST_MAX ? n : FROST_DEFAULT;
  } catch {
    return FROST_DEFAULT;
  }
}

// ── AppShell — must be inside <TimerProvider> to call useTimerContext ─────────

function AppShell() {
  const hash = useHashRoute();
  const active = activeTab(hash);
  const { isFocusRunning } = useTimerContext();
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [plateIdx, setPlateIdx] = useState<Record<string, number>>(() => loadPlateIdx());
  const [frost, setFrost] = useState<number>(() => loadFrost());

  // Stil „G" (lib/stil.ts): die ganze App im Aufbau von Seite G (g-stil.css).
  // Die Marken sitzen auf <html>, damit auch Dialoge in Portalen sie sehen.
  const introLayout = useIntroLayout();
  const stil = useStil();
  const teichArt = artZumMotiv(useTeichMotiv());
  useEffect(() => {
    document.documentElement.dataset.intro = introLayout;
    document.documentElement.dataset.stil = stil;
  }, [introLayout, stil]);

  useClickSounds();
  // Erledigte Todos verschwinden um 02:00 — app-weit, nicht nur auf dem Dashboard.
  useDoneTodoCleanup();
  // Der Score des Tages wird festgehalten, egal welche Seite offen ist.
  useScoreSnapshot();

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* quota */ }
    // data-theme lives on the app-shell div, so <html> keeps the root dark
    // --ink-0 — which shows through the reserved scrollbar gutters as a black
    // band on the left in the light themes. Match html to the theme's paper.
    // Das Thema "Glas" braucht eine Marke auf <html>: `data-theme` sitzt auf der
    // App-Huelle INNERHALB von body, der deckende Aurora-Verlauf liegt aber auf
    // body::before — von dort unerreichbar. Ueber das Attribut hier kommt die
    // CSS-Regel an beide heran und macht den ganzen Stapel durchsichtig, damit
    // im Electron-Fenster der Schreibtisch sichtbar wird.
    // NUR im Electron-Fenster durchsichtig schalten. Im Browser liegt hinter der
    // Seite kein Schreibtisch, sondern das WEISSE Standardblatt — heller Text
    // darauf ist unlesbar. Der Browser bekommt deshalb denselben dunklen
    // Mocha-Grund, den das Material sonst beisteuert; das Thema sieht dort dann
    // aus wie ein normales dunkles Thema, statt kaputt.
    if (theme === "glas") {
      // BEIDES gilt. "DailyShell" setzt die eigene Huelle (electron/main.cjs),
      // aber nur eine NEU gepackte — eine aeltere App auf der Platte kennt die
      // Kennung nicht und stuende sonst ploetzlich undurchsichtig da, obwohl
      // sich an ihr nichts geaendert hat. Genau das ist einmal passiert.
      // "Electron" allein reicht als Rueckfall: nur ein echtes Programmfenster
      // hat es, ein normaler Browser nie — und um den geht es hier, denn dort
      // liegt hinter der Seite Weiss statt eines Schreibtischs.
      const ua = navigator.userAgent;
      const imFenster = /\bDailyShell\//.test(ua) || /\bElectron\//.test(ua);
      if (imFenster) {
        document.documentElement.dataset.transparent = "1";
        document.documentElement.style.background = "transparent";
      } else {
        delete document.documentElement.dataset.transparent;
        document.documentElement.style.background = "#181825";
      }
    } else {
      delete document.documentElement.dataset.transparent;
      document.documentElement.style.background = isGlassTheme(theme) ? PAPER_BG[theme] : "#05060A";
    }

    // Dieselbe Marke NOCHMAL auf <html>, und zwar wegen der Portale.
    // `data-theme` unten haengt an der App-Huelle. Ein Dialog, der per
    // createPortal nach document.body geht, ist deren GESCHWISTER, kein Kind —
    // er erbt die Farben des Themas also nicht und faellt auf die Werte in
    // :root zurueck. Das Alert-Pop-up erschien deshalb immer in Setzling-Gruen,
    // egal welches Thema lief. Auf <html> gelten die Token fuer beide Baeume.
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(PLATE_KEY, JSON.stringify(plateIdx)); } catch { /* quota */ }
  }, [plateIdx]);

  useEffect(() => {
    try { localStorage.setItem(FROST_KEY, String(frost)); } catch { /* quota */ }
  }, [frost]);

  // Current plate for the active glass theme, and a cycler for its own set.
  const glass = isGlassTheme(theme);
  const currentPlate = glass ? PLATES[theme][(plateIdx[theme] ?? 0) % PLATES[theme].length] : null;
  const cyclePlate = () => {
    if (!glass) return;
    const len = PLATES[theme].length;
    setPlateIdx((prev) => ({ ...prev, [theme]: ((prev[theme] ?? 0) + 1) % len }));
  };

  const handleSoundChange = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setSoundOn(enabled);
  };

  return (
    <div
      className={`min-h-full${isFocusRunning ? " focus-mode-active" : ""}`}
      data-view={active}
      data-theme={theme}
      data-intro={introLayout}
      data-stil={stil}
      style={{
        // Sharp original + pre-blurred frost variant of the current plate —
        // the glass slider crossfades between them (see index.css).
        ...(glass && currentPlate
          ? {
              "--kbg-sharp": `url('/setzling/${theme}/${currentPlate}.jpg')`,
              "--kbg": `url('/setzling/${theme}/${currentPlate}-frost.jpg')`,
            }
          : {}),
        "--frost": frost,
      } as React.CSSProperties}
    >
      {/* Setzling/Abendrot photographic background (fixed, behind everything).
          On Lernzeit the photo gives way to a calm green ground either way. */}
      <div className="stage" aria-hidden="true" />
      <div className="veil" aria-hidden="true" />
      <div className="dim" aria-hidden="true" />
      {/* Nur im Thema Glas: leise ASCII-Tiere hinter dem Inhalt. */}
      {theme === "glas" && teichArt && <AsciiTeich art={teichArt} isPausiert={isFocusRunning} />}

      {/* Right-edge rail: view switch + settings. The top of the page is clean. */}
      <SideRail
        tabs={TABS}
        active={active}
        theme={theme}
        onThemeChange={setTheme}
        soundOn={soundOn}
        onSoundChange={handleSoundChange}
        onCycleBackground={glass ? cyclePlate : undefined}
        frost={glass ? frost : undefined}
        onFrostChange={setFrost}
        frostRange={[FROST_MIN, FROST_MAX]}
      />

      <div
        className="app-container mx-auto px-5 sm:px-8 lg:px-14 py-8 sm:py-10 flex flex-col gap-6"
        style={{ position: "relative", zIndex: 2 }}
      >
        {/* Timer widget — always visible; exempt from focus-mode dimming */}
        <TimerWidget className="focus-mode-exempt timer-schwebend" />

        {active === "morgens" ? <DashboardPage /> : <LernzeitPage />}
      </div>

      {/* Ambient weekly AI-usage meters at the screen edges (Claude top, GLM bottom) */}
      <UsageEdges />

      {/* Session-saved toast — mounted once at the app root so "Fokus fertig"
          or "Stoppuhr gespeichert" surfaces no matter which tab is open,
          not just while the Lernzeit page happens to be mounted. */}
      <SavedToast />

      {/* Das Pop-up für das eine wirklich Dringende. An der Wurzel montiert,
          damit es über jeder Ansicht liegt — und nicht nur dort, wo gerade
          zufällig die Tagesansicht offen ist. */}
      <BriefingAlertDialog />
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <TrackerProvider>
      <ImportantEventsProvider>
        <TimerProvider>
          <AppShell />
        </TimerProvider>
      </ImportantEventsProvider>
    </TrackerProvider>
  );
}
