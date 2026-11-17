import { isNudgesMuted, setNudgesMuted } from "../hooks/useProactiveNudges";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { INTRO_LAYOUTS, setIntroLayout, useIntroLayout, type IntroLayout } from "../lib/introLayout";
import { STILE, setStil, useStil, type Stil } from "../lib/stil";
import { MOTIV_NAMEN, TEICH_MOTIVE, setTeichMotiv, useTeichMotiv } from "../lib/teichMotiv";
import type { Theme } from "../App";

// SideRail — replaces the old TopNav entirely. A small vertical cluster fixed
// to the RIGHT EDGE, vertically centered: view icons (circle = Morgens, sword
// = Lernzeit) plus one gear that expands the settings panel to the left
// (Thema · Sound · Glas). The top of the screen stays completely clean.

type Tab = { id: string; label: string; icon?: string; hash: string };

type Props = {
  tabs: Tab[];
  active: string;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  soundOn: boolean;
  onSoundChange: (enabled: boolean) => void;
  /** Cycles the Kupferstich background plate — only passed in that theme. */
  onCycleBackground?: () => void;
  /** Frosted-glass transparency (Kupferstich only); undefined hides the row. */
  frost?: number;
  onFrostChange: (v: number) => void;
  frostRange: [number, number];
};

const THEME_SWATCHES: { id: Theme; label: string; color: string }[] = [
  { id: "setzling", label: "Setzling", color: "#AECB82" },
  { id: "abendrot", label: "Abendrot", color: "#E8592F" },
  { id: "nachtblau", label: "Nachtblau", color: "#4A83DC" },
  { id: "glas", label: "Glas (durchsichtig)", color: "#4497E4" },
  { id: "kupferstich", label: "Kupferstich", color: "#2B50C4" },
  { id: "arkadien", label: "Arkadien", color: "#6B8340" },
];

// ── Icons ─────────────────────────────────────────────────────────────────────
function CircleIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function SwordIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2 L8 10.2" />
      <path d="M5.6 10.4 L10.4 10.4" />
      <path d="M8 10.4 L8 13.6" />
    </svg>
  );
}
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 6 H4.8 L8 3.2 V12.8 L4.8 10 H2.5 Z" fill="currentColor" />
      {on ? (
        <path d="M10.5 5.5 a3.2 3.2 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      ) : (
        <path d="M10.5 6 L13.5 10 M13.5 6 L10.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Stil G: die Zeichen aus Seite G — Sonnenaufgang (Morgens), Stoppuhr
// (Lernzeit), Regler (Einstellungen). Kein Rahmen; „hier" ist ein Funke.
const G_ICON = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, "aria-hidden": true, width: 18, height: 18 };
function SunriseIcon() {
  return <svg {...G_ICON}><path d="M3 18h18" /><path d="M7 18a5 5 0 0 1 10 0" /><path d="M12 6v3M5.6 10.6l1.6 1.6M18.4 10.6l-1.6 1.6" /></svg>;
}
function StopwatchIcon() {
  return <svg {...G_ICON}><circle cx="12" cy="13.5" r="7" /><path d="M12 13.5V10M10 3h4" /></svg>;
}
function SlidersIcon() {
  return <svg {...G_ICON}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>;
}

function iconFor(tabId: string, isActive: boolean, stil: Stil) {
  if (stil === "g") return tabId === "lernzeit" ? <StopwatchIcon /> : <SunriseIcon />;
  if (tabId === "lernzeit") return <SwordIcon />;
  return <CircleIcon filled={isActive} />;
}

export function SideRail({
  tabs, active, theme, onThemeChange, soundOn, onSoundChange,
  onCycleBackground, frost, onFrostChange, frostRange,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const stil = useStil();
  const g = stil === "g";

  // Close the settings panel on an outside click or Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    function onDown(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setSettingsOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  const railBtn = (isOn: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    transitionDuration: "var(--dur-micro)",
    ...(isOn
      ? { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }
      : { color: "var(--text-3)", border: "1px solid var(--line-1)", background: "var(--glass-bg)" }),
  });

  return (
    <div
      ref={railRef}
      className="side-rail focus-mode-exempt"
      aria-label="Navigation und Einstellungen"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(t.hash)}
            aria-current={isActive ? "page" : undefined}
            aria-label={t.label}
            title={t.label}
            className={g ? "g-rail-btn" + (isActive ? " an" : "") : "transition-all focus:outline-none"}
            style={g ? undefined : railBtn(isActive)}
          >
            {iconFor(t.id, isActive, stil)}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setSettingsOpen((v) => !v)}
        aria-expanded={settingsOpen}
        aria-haspopup="true"
        title="Einstellungen"
        aria-label="Einstellungen"
        className={g ? "g-rail-btn" + (settingsOpen ? " offen" : "") : "transition-all focus:outline-none"}
        style={g ? undefined : railBtn(settingsOpen)}
      >
        {g ? <SlidersIcon /> : <GearIcon />}
      </button>

      {settingsOpen && (
        <div
          role="menu"
          className="side-rail-panel flex flex-col gap-3.5 rounded-[var(--r-md)] p-4"
        >
          {/* Thema */}
          <div className="flex flex-col gap-2">
            <span className="settings-label">Thema</span>
            <div className="flex items-center gap-2" role="group" aria-label="Design-Thema">
              {THEME_SWATCHES.map((s) => {
                const isActive = s.id === theme;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onThemeChange(s.id)}
                    aria-pressed={isActive}
                    title={s.label}
                    aria-label={`Thema: ${s.label}`}
                    className="rounded-full transition-all focus:outline-none"
                    style={{
                      width: 20, height: 20, background: s.color,
                      border: isActive ? "2px solid var(--text-1)" : "2px solid transparent",
                      boxShadow: isActive
                        ? `0 0 0 2px color-mix(in srgb, ${s.color} 45%, transparent)`
                        : "0 0 0 1px rgba(0,0,0,0.2)",
                      transitionDuration: "var(--dur-micro)",
                      opacity: isActive ? 1 : 0.6,
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Startseite — das bisherige Intro oder „Still". Beides bleibt,
              Paul will hin- und herschalten können. */}
          <IntroSchalter />

          {/* Stil — das bisherige Aussehen oder Seite G aus dem Design-Canvas. */}
          <StilSchalter />

          {/* Tiere — die ASCII-Tiere hinter dem Thema Glas. Nur dort. */}
          {theme === "glas" && <TeichSchalter />}

          {/* Sound */}
          <div className="flex items-center justify-between">
            <span className="settings-label">Sound</span>
            <button
              type="button"
              onClick={() => onSoundChange(!soundOn)}
              aria-pressed={soundOn}
              title={soundOn ? "Klick-Sounds an" : "Klick-Sounds aus"}
              aria-label={soundOn ? "Klick-Sounds ausschalten" : "Klick-Sounds einschalten"}
              className="rounded-full transition-all focus:outline-none flex items-center justify-center"
              style={{
                width: 28, height: 28,
                background: soundOn ? "var(--accent-soft)" : "var(--fill-1)",
                border: soundOn ? "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "1px solid transparent",
                color: soundOn ? "var(--accent)" : "var(--text-4)",
                transitionDuration: "var(--dur-micro)",
              }}
            >
              <SoundIcon on={soundOn} />
            </button>
          </div>

          {/* Hinweise — die Systemmeldungen aus useProactiveNudges (Klausur
              bald, mittags noch keine Lernzeit). Der Schalter stand früher im
              Chat bzw. in der Stimme; beide gibt es nicht mehr. */}
          <HinweiseSchalter />

          {/* Glas — Kupferstich only (motif + transparency) */}
          {frost !== undefined && (
            <div className="flex flex-col gap-2" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 12 }}>
              <div className="flex items-center justify-between">
                <span className="settings-label">Glas</span>
                {onCycleBackground && (
                  <button
                    type="button"
                    onClick={onCycleBackground}
                    title="Motiv wechseln"
                    aria-label="Hintergrund-Motiv wechseln"
                    className="rounded-full transition-all focus:outline-none flex items-center justify-center"
                    style={{ width: 24, height: 24, fontSize: 12, color: "var(--text-3)", border: "1px solid var(--line-1)", background: "transparent" }}
                  >
                    ⟳
                  </button>
                )}
              </div>
              <input
                type="range"
                min={frostRange[0]}
                max={frostRange[1]}
                step={0.01}
                value={frost}
                onChange={(e) => onFrostChange(Number(e.target.value))}
                aria-label="Glas-Transparenz"
                className="frost-slider"
                style={{ width: "100%" }}
              />
              <div className="flex items-center justify-between" style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-4)" }}>
                <span>Original</span>
                <span>Milchig</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const INTRO_NAMEN: Record<IntroLayout, string> = { original: "Original", still: "Still" };

function IntroSchalter() {
  const layout = useIntroLayout();
  // Im Stil G ist die Startseite immer „Still" — dann gibt es nichts zu wählen.
  if (useStil() === "g") return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="settings-label">Startseite</span>
      <div className="intro-schalter" role="radiogroup" aria-label="Startseite">
        {INTRO_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={l === layout}
            className={"intro-schalter-knopf" + (l === layout ? " an" : "")}
            onClick={() => setIntroLayout(l)}
          >
            {INTRO_NAMEN[l]}
          </button>
        ))}
      </div>
    </div>
  );
}

const STIL_NAMEN: Record<Stil, string> = { original: "Original", g: "G" };

function StilSchalter() {
  const stil = useStil();
  return (
    <div className="flex flex-col gap-2">
      <span className="settings-label">Stil</span>
      <div className="intro-schalter" role="radiogroup" aria-label="Stil">
        {STILE.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === stil}
            className={"intro-schalter-knopf" + (s === stil ? " an" : "")}
            onClick={() => setStil(s)}
          >
            {STIL_NAMEN[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

function TeichSchalter() {
  const motiv = useTeichMotiv();
  return (
    <div className="flex flex-col gap-2">
      <span className="settings-label">Tiere</span>
      <div className="intro-schalter teich-schalter" role="radiogroup" aria-label="Tiere im Hintergrund">
        {TEICH_MOTIVE.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={m === motiv}
            className={"intro-schalter-knopf" + (m === motiv ? " an" : "")}
            onClick={() => setTeichMotiv(m)}
          >
            {MOTIV_NAMEN[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

function HinweiseSchalter() {
  const [an, setAn] = useState(() => !isNudgesMuted());
  return (
    <div className="flex items-center justify-between">
      <span className="settings-label">Hinweise</span>
      <button
        type="button"
        onClick={() => { const n = !an; setAn(n); setNudgesMuted(!n); }}
        aria-pressed={an}
        title="Systemmeldungen: Klausur bald, noch keine Lernzeit"
        aria-label={an ? "Hinweise ausschalten" : "Hinweise einschalten"}
        className="rounded-full transition-all focus:outline-none flex items-center justify-center"
        style={{
          width: 28, height: 28, fontSize: 13,
          background: an ? "var(--accent-soft)" : "var(--fill-1)",
          border: an ? "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "1px solid transparent",
          color: an ? "var(--accent)" : "var(--text-4)",
          transitionDuration: "var(--dur-micro)",
        }}
      >
        {an ? "🔔" : "🔕"}
      </button>
    </div>
  );
}
