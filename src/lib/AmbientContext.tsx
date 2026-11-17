import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type WeatherCondition = "clear" | "cloudy" | "rain" | "snow" | "storm" | "fog";
type TimeOfDay = "night" | "dawn" | "morning" | "midday" | "afternoon" | "evening";

type AmbientCtx = {
  setWeatherCode: (wmoCode: number) => void;
};

const AmbientContext = createContext<AmbientCtx>({ setWeatherCode: () => {} });

export function useAmbient(): AmbientCtx {
  return useContext(AmbientContext);
}

// ── Time-of-day helper ────────────────────────────────────────────────────────

function getTimeOfDay(date: Date): TimeOfDay {
  const h = date.getHours();
  if (h >= 22 || h < 5)  return "night";
  if (h >= 5  && h < 8)  return "dawn";
  if (h >= 8  && h < 12) return "morning";
  if (h >= 12 && h < 15) return "midday";
  if (h >= 15 && h < 19) return "afternoon";
  return "evening"; // 19-22
}

// ── WMO weather-code → condition ─────────────────────────────────────────────
// Mirrors the bucketing in WeatherCard.describeWeather

function wmoToCondition(code: number): WeatherCondition {
  if (code <= 1)  return "clear";
  if (code <= 3)  return "cloudy";
  if (code <= 57) return "fog";
  if (code <= 82) return "rain";
  if (code <= 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

// ── Gradient lookup table ─────────────────────────────────────────────────────
// Each entry: { r, g, b } (hex color from design system) + opacity (0-1)
// Values are intentionally subtle (4-13%) so they don't overpower the dark UI.

type GradientEntry = { r: number; g: number; b: number; opacity: number };

function hex(r: number, g: number, b: number, opacity: number): GradientEntry {
  return { r, g, b, opacity };
}

const TABLE: Record<TimeOfDay, Record<WeatherCondition, GradientEntry>> = {
  night: {
    clear:   hex(94,  92,  230, 0.08), // indigo
    cloudy:  hex(94,  92,  230, 0.05),
    fog:     hex(94,  92,  230, 0.04),
    rain:    hex(10,  132, 255, 0.06), // blue
    snow:    hex(100, 210, 255, 0.04), // cyan
    storm:   hex(191, 90,  242, 0.07), // purple
  },
  dawn: {
    clear:   hex(255, 159, 10,  0.10), // orange
    cloudy:  hex(172, 142, 104, 0.07), // brown/warm-gray
    fog:     hex(172, 142, 104, 0.05),
    rain:    hex(64,  200, 224, 0.07), // teal
    snow:    hex(100, 210, 255, 0.05),
    storm:   hex(191, 90,  242, 0.07),
  },
  morning: {
    clear:   hex(100, 210, 255, 0.10), // cyan
    cloudy:  hex(10,  132, 255, 0.07),
    fog:     hex(102, 212, 207, 0.05), // mint
    rain:    hex(10,  132, 255, 0.09),
    snow:    hex(255, 255, 255, 0.05),
    storm:   hex(191, 90,  242, 0.08),
  },
  midday: {
    clear:   hex(255, 214, 10,  0.07), // yellow
    cloudy:  hex(100, 210, 255, 0.05),
    fog:     hex(102, 212, 207, 0.04),
    rain:    hex(10,  132, 255, 0.10),
    snow:    hex(100, 210, 255, 0.07),
    storm:   hex(232, 93,  104, 0.07), // red
  },
  afternoon: {
    clear:   hex(255, 159, 10,  0.09), // orange
    cloudy:  hex(100, 210, 255, 0.05),
    fog:     hex(172, 142, 104, 0.04),
    rain:    hex(10,  132, 255, 0.09),
    snow:    hex(100, 210, 255, 0.06),
    storm:   hex(191, 90,  242, 0.08),
  },
  evening: {
    clear:   hex(255, 55,  95,  0.09), // pink
    cloudy:  hex(191, 90,  242, 0.07), // purple
    fog:     hex(172, 142, 104, 0.05),
    rain:    hex(64,  200, 224, 0.07), // teal
    snow:    hex(100, 210, 255, 0.05),
    storm:   hex(191, 90,  242, 0.09),
  },
};

function buildGradient(tod: TimeOfDay, cond: WeatherCondition): string {
  const { r, g, b, opacity } = TABLE[tod][cond];
  return (
    `radial-gradient(ellipse 900px 700px at 50% 110%, ` +
    `rgba(${r},${g},${b},${opacity}), transparent 70%)`
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [timeOfDay, setTimeOfDay]       = useState<TimeOfDay>(() => getTimeOfDay(new Date()));
  const [condition, setCondition]       = useState<WeatherCondition>("clear");

  // Refresh time-of-day every 5 minutes
  useEffect(() => {
    const id = setInterval(() => setTimeOfDay(getTimeOfDay(new Date())), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const setWeatherCode = useCallback((code: number) => {
    setCondition(wmoToCondition(code));
  }, []);

  const gradient = buildGradient(timeOfDay, condition);

  return (
    <AmbientContext.Provider value={{ setWeatherCode }}>
      {/*
        Fixed ambient background — rendered below all content (z-index: -1).
        Glass cards' backdrop-filter picks up this gradient automatically,
        giving the dark-glass surfaces a subtle environmental tint.
        The opacity transition makes weather/time changes feel organic.
      */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -1,
          pointerEvents: "none",
          background: gradient,
          opacity: 1,
          transition: "opacity 2s ease",
        }}
      />
      {children}
    </AmbientContext.Provider>
  );
}
