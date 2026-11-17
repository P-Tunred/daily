import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import { useAmbient } from "../lib/AmbientContext";
import { useStil } from "../lib/stil";
import { GWetter } from "./g/GWetter";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeatherData {
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  city: string;
  hourly: HourlySlot[];
  /** Tageshoch/-tief und Sonnenuntergang (HH:MM) — fehlen in alten Caches. */
  max?: number;
  min?: number;
  sunset?: string;
}

export interface HourlySlot {
  time: string;   // ISO, Ortszeit des Standorts
  temp: number;
  code: number;
  precip: number; // mm
  /** Regenwahrscheinlichkeit in % — fehlt in alten Caches. */
  prob?: number;
  /** false nach Sonnenuntergang — fehlt in alten Caches. */
  day?: boolean;
}

interface Coords {
  lat: number;
  lon: number;
}

// ── WMO weather-code → emoji + label ─────────────────────────────────────────

export function describeWeather(code: number): { label: string; emoji: string } {
  if (code === 0)  return { emoji: "☀️",  label: "Klar" };
  if (code <= 2)   return { emoji: "🌤️", label: "Überwiegend klar" };
  if (code === 3)  return { emoji: "☁️",  label: "Bedeckt" };
  if (code <= 49)  return { emoji: "🌫️", label: "Nebel" };
  if (code <= 57)  return { emoji: "🌦️", label: "Nieselregen" };
  if (code <= 67)  return { emoji: "🌧️", label: "Regen" };
  if (code <= 77)  return { emoji: "🌨️", label: "Schnee" };
  if (code <= 82)  return { emoji: "🌧️", label: "Regenschauer" };
  if (code <= 86)  return { emoji: "🌨️", label: "Schneeschauer" };
  if (code >= 95)  return { emoji: "⛈️",  label: "Gewitter" };
  return { emoji: "🌡️", label: "Unbekannt" };
}

// ── Location cache (localStorage) ────────────────────────────────────────────
// Stores the last successfully resolved location so the app starts with the
// right city/coords even before the IP-geo request completes or if it fails.

const LOC_CACHE_KEY = "morning.location.cache";

type LocCache = { coords: Coords; city: string; ts: number };

function loadLocCache(): { coords: Coords; city: string } | null {
  try {
    const raw = localStorage.getItem(LOC_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as LocCache;
    // Use cache as warm start even if > 4 h old — still better than München
    return { coords: c.coords, city: c.city };
  } catch { return null; }
}

function saveLocCache(coords: Coords, city: string) {
  try {
    localStorage.setItem(LOC_CACHE_KEY, JSON.stringify({ coords, city, ts: Date.now() }));
  } catch { /* storage quota — ignore */ }
}

// ── Weather cache (localStorage) ─────────────────────────────────────────────
// Stores the last fetched weather so the card is never empty on reload.
// Data is always shown — fresh data replaces it silently, errors keep it with
// a subtle "veraltet" indicator.

const WEATHER_CACHE_KEY = "morning.weather.cache";

type WeatherCache = { weather: WeatherData; ts: number };

function loadWeatherCache(): WeatherData | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as WeatherCache).weather;
  } catch { return null; }
}

function saveWeatherCache(w: WeatherData) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ weather: w, ts: Date.now() }));
  } catch { /* quota — ignore */ }
}

// ── IP-based geolocation ──────────────────────────────────────────────────────
// Uses a chain of three free CORS-friendly services.
// Result is persisted to localStorage so subsequent loads are instant.

const MUNICH_FALLBACK: { coords: Coords; city: string } = {
  coords: { lat: 48.1351, lon: 11.5820 },
  city: "München",
};

async function detectLocation(): Promise<{ coords: Coords; city: string }> {
  const attempts: Array<() => Promise<{ lat: number; lon: number; city: string }>> = [
    async () => {
      // ip-api.com — 45 req/min, no daily limit; http is fine in Electron
      const r = await fetch("http://ip-api.com/json/?fields=city,lat,lon,status");
      if (!r.ok) throw new Error("ip-api.com failed");
      const d = await r.json();
      if (d.status !== "success") throw new Error("ip-api.com: " + d.message);
      return { lat: d.lat, lon: d.lon, city: d.city };
    },
    async () => {
      const r = await fetch("https://ipwho.is/");
      if (!r.ok) throw new Error("ipwho.is failed");
      const d = await r.json();
      if (!d.success) throw new Error("ipwho.is returned no data");
      return { lat: d.latitude, lon: d.longitude, city: d.city };
    },
    async () => {
      const r = await fetch("https://ipapi.co/json/");
      if (!r.ok) throw new Error("ipapi.co failed");
      const d = await r.json();
      if (d.error) throw new Error("ipapi.co: " + d.reason);
      return { lat: d.latitude, lon: d.longitude, city: d.city };
    },
  ];

  for (const attempt of attempts) {
    try {
      const { lat, lon, city } = await attempt();
      if (Number.isFinite(lat) && Number.isFinite(lon) && city) {
        return { coords: { lat, lon }, city };
      }
    } catch { /* try next */ }
  }
  throw new Error("All IP geolocation services failed");
}

function useGeolocation() {
  // Warm start: use cached location (if any) so the map/weather
  // show the right place immediately, before the live lookup completes.
  const cached = loadLocCache();
  const [state, setState] = useState<{ coords: Coords; city: string }>(
    cached ?? MUNICH_FALLBACK,
  );

  useEffect(() => {
    /** Save and update state — called whenever we get a confirmed location */
    const applyLoc = (loc: { coords: Coords; city: string }) => {
      saveLocCache(loc.coords, loc.city);
      setState(loc);
    };

    if (!navigator.geolocation) {
      // No Geolocation API (some Electron builds) — IP fallback
      detectLocation().then(applyLoc).catch(() => {
        // If no cached data either, stay on München
        if (!cached) setState(MUNICH_FALLBACK);
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Precise GPS/WiFi coords available — fetch city name via IP in parallel
        const preciseCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        detectLocation()
          .then(({ city }) => applyLoc({ coords: preciseCoords, city }))
          .catch(() => applyLoc({ coords: preciseCoords, city: "Mein Standort" }));
      },
      () => {
        // Browser geo denied or unavailable — use IP geolocation
        detectLocation().then(applyLoc).catch(() => {
          // All services failed — stay on cache (already applied as initial state)
          if (!cached) setState(MUNICH_FALLBACK);
        });
      },
      { timeout: 6000, maximumAge: 5 * 60 * 1000 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

// ── Weather fetch (current + hourly) ─────────────────────────────────────────

async function fetchWeather(coords: Coords, city: string): Promise<WeatherData> {
  const { lat, lon } = coords;

  const weatherRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
    `&hourly=temperature_2m,weather_code,precipitation,precipitation_probability,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,sunset` +
    `&wind_speed_unit=kmh&timezone=auto&forecast_hours=24&forecast_days=1`,
  );
  if (!weatherRes.ok) throw new Error(`Open-Meteo: HTTP ${weatherRes.status}`);
  const w = await weatherRes.json();
  const c = w.current;

  // Die nächsten 24 Stunden ab der aktuellen. Die Zeiten sind Ortszeit des
  // Standorts (timezone=auto) — deshalb mit `current.time` vergleichen, nicht
  // mit toISOString() (UTC), sonst begann die Leiste eine Stunde zu früh.
  const nowHour = String(c.time ?? "").slice(0, 13); // "2026-05-06T10"
  const times: string[] = w.hourly.time;
  const temps: number[] = w.hourly.temperature_2m;
  const codes: number[] = w.hourly.weather_code;
  const precips: number[] = w.hourly.precipitation;
  const probs: (number | null)[] = w.hourly.precipitation_probability ?? [];
  const days: (number | null)[] = w.hourly.is_day ?? [];

  const startIdx = Math.max(0, times.findIndex((t) => t >= nowHour));
  const hourly: HourlySlot[] = times
    .slice(startIdx, startIdx + 24)
    .map((t, i) => ({
      time: t,
      temp: Math.round(temps[startIdx + i]),
      code: codes[startIdx + i],
      precip: precips[startIdx + i],
      ...(typeof probs[startIdx + i] === "number" ? { prob: probs[startIdx + i] as number } : {}),
      ...(typeof days[startIdx + i] === "number" ? { day: days[startIdx + i] === 1 } : {}),
    }));
  const d = w.daily ?? {};

  return {
    temp: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    windSpeed: Math.round(c.wind_speed_10m),
    weatherCode: c.weather_code,
    city,
    hourly,
    ...(Number.isFinite(d.temperature_2m_max?.[0]) ? { max: Math.round(d.temperature_2m_max[0]) } : {}),
    ...(Number.isFinite(d.temperature_2m_min?.[0]) ? { min: Math.round(d.temperature_2m_min[0]) } : {}),
    ...(typeof d.sunset?.[0] === "string" ? { sunset: d.sunset[0].slice(11, 16) } : {}),
  };
}

// ── Live map ──────────────────────────────────────────────────────────────────

function LiveMap({ coords }: { coords: Coords }) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  // Create the map once on mount
  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return;

    import("leaflet").then((L) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;

      const map = L.map(mapRef.current!, {
        center: [coords.lat, coords.lon],
        zoom: 4,                // unchanged — wider view of Europe + surroundings
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        dragging: false,
        keyboard: false,
        boxZoom: false,
        attributionControl: false,
        worldCopyJump: false,
      });

      // Satellite imagery (Esri World Imagery) — a real photographic map: land,
      // sea and cities as actual texture, NO roads / borders / grid lines. Reads
      // as a "normal", recognizable map without the vector-line clutter.
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          minZoom: 0,
          attribution: "Esri, Maxar, Earthstar Geographics",
        },
      ).addTo(map);

      // Location dot with a pulsing glow ring
      const dot = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:16px;height:16px;">
          <div style="
            position:absolute;inset:-6px;border-radius:50%;
            background:color-mix(in srgb, var(--accent) 22%, transparent);
            animation:pulse-ring 2.5s ease-out infinite;
          "></div>
          <div style="
            position:absolute;inset:0;border-radius:50%;
            background:var(--accent);border:2px solid rgba(255,255,255,0.92);
            box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent), 0 2px 8px rgba(0,0,0,0.6);
          "></div>
        </div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      markerRef.current = L.marker([coords.lat, coords.lon], { icon: dot }).addTo(map);
      instanceRef.current = map;
    });

    return () => {
      if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; }
      markerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update marker + pan when coords change
  useEffect(() => {
    if (!instanceRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([coords.lat, coords.lon]);
    instanceRef.current.panTo([coords.lat, coords.lon]);
  }, [coords.lat, coords.lon]);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: "var(--r-md)",
        border: "1px solid var(--line-1)",
        boxShadow: "var(--shadow-glow-sm)",
      }}
      className="w-full h-full overflow-hidden min-h-[200px]"
    >
      <div ref={mapRef} className="w-full h-full" />
      {/* Soft edge fade — blends the map into the card */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
        background: "radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.45) 100%)",
      }} />
    </div>
  );
}

// ── Hourly forecast strip ─────────────────────────────────────────────────────

function HourlyStrip({ slots }: { slots: HourlySlot[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {slots.slice(0, 8).map((s, i) => {
        const { emoji } = describeWeather(s.code);
        const isNow = i === 0;
        const label = isNow ? "Jetzt" : new Date(s.time).toLocaleTimeString("de-DE", {
          hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
        });
        return (
          <div
            key={s.time}
            className="flex flex-col items-center gap-1 shrink-0 min-w-[58px]"
            style={{
              padding: "8px 12px",
              borderRadius: "var(--r-md)",
              background: isNow
                ? "color-mix(in srgb, var(--accent) 14%, var(--ink-3))"
                : "var(--ink-3)",
              border: isNow
                ? "1px solid color-mix(in srgb, var(--accent) 32%, transparent)"
                : "1px solid var(--line-1)",
            }}
          >
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: isNow ? "var(--accent)" : "var(--text-3)" }}
            >
              {label}
            </span>
            <span className="text-lg leading-none">{emoji}</span>
            <span className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>
              {s.temp}°
            </span>
            {s.precip > 0 && (
              <span className="text-[10px] tabular-nums" style={{ color: "var(--accent)" }}>
                {s.precip.toFixed(1)} mm
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function WeatherCard() {
  const stil = useStil();
  const { coords, city: detectedCity } = useGeolocation();
  const { setWeatherCode } = useAmbient();

  // Warm start from cache — card is never blank on reload
  const [weather, setWeather] = useState<WeatherData | null>(() => loadWeatherCache());
  const [isStale, setIsStale]  = useState<boolean>(() => loadWeatherCache() !== null);
  const [loading, setLoading]  = useState(true);

  // Seed ambient background from cached weather on mount (before fresh fetch)
  useEffect(() => {
    const cached = loadWeatherCache();
    if (cached) setWeatherCode(cached.weatherCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFresh(w: WeatherData) {
    saveWeatherCache(w);
    setWeather(w);
    setIsStale(false);
    setWeatherCode(w.weatherCode); // update ambient background
  }

  // Fetch whenever detected location changes
  useEffect(() => {
    setLoading(true);
    fetchWeather(coords, detectedCity)
      .then((w) => { applyFresh(w); })
      .catch(() => { setIsStale(true); }) // keep cached data, mark as stale
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.lat, coords.lon, detectedCity]);

  // Auto-refresh every 30 minutes — silently, never clears the display
  useEffect(() => {
    const id = setInterval(() => {
      fetchWeather(coords, detectedCity)
        .then((w) => { applyFresh(w); })
        .catch(() => { setIsStale(true); });
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.lat, coords.lon, detectedCity]);

  const desc = weather ? describeWeather(weather.weatherCode) : null;

  // Card meta line: temperature + stale indicator if needed
  const metaStr = weather
    ? `${weather.temp}°C${isStale ? " · veraltet" : ""}`
    : "";

  if (stil === "g") return <GWetter weather={weather} isStale={isStale} loading={loading} />;

  return (
    <Card
      title={weather ? `Wetter · ${weather.city}` : "Wetter"}
      icon="🌤️"
      meta={metaStr}
    >
      {/* Loading state — no data yet */}
      {loading && !weather && (
        <p className="text-sm text-fg-tertiary">Standort wird ermittelt…</p>
      )}

      {/* ── Two-column layout: left=weather info, right=map ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        {/* Left column — current conditions + hourly */}
        {weather && desc && (
          <div className="flex flex-col gap-4">
            {/* Current condition */}
            <div className="flex items-center gap-4">
              <span className="text-5xl leading-none">{desc.emoji}</span>
              <div>
                <p
                  className="font-display font-semibold text-fg leading-none tabular-nums"
                  style={{ fontSize: 36, letterSpacing: "-0.03em" }}
                >
                  {weather.temp}°
                </p>
                <p className="text-[13px] text-fg-secondary mt-1">{desc.label}</p>
              </div>
            </div>

            {/* Quick stats — Aurora stat cells, emoji kept for warmth */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { emoji: "🌡️", label: "Gefühlt", value: `${weather.feelsLike}°` },
                { emoji: "💧", label: "Feuchte", value: `${weather.humidity}%` },
                { emoji: "💨", label: "km/h", value: `${weather.windSpeed}` },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex flex-col items-center gap-0.5 py-2.5 px-1"
                  style={{
                    background: "var(--ink-3)",
                    border: "1px solid var(--line-1)",
                    borderRadius: "var(--r-md)",
                  }}
                >
                  <span className="text-[15px] leading-none">{s.emoji}</span>
                  <span className="font-display font-semibold text-[15px] text-fg tabular-nums leading-none mt-1">
                    {s.value}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-fg-tertiary">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Hourly forecast */}
            {weather.hourly.length > 0 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-2">
                  Nächste Stunden
                </p>
                <HourlyStrip slots={weather.hourly} />
              </div>
            )}

            {/* Stale indicator */}
            {isStale && !loading && (
              <span
                className="self-start inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-mono"
                style={{
                  background: "var(--warn-soft)",
                  color: "var(--warn)",
                  border: "1px solid color-mix(in srgb, var(--warn) 25%, transparent)",
                }}
              >
                ⚠ Letzte bekannte Daten
              </span>
            )}
          </div>
        )}

        {/* Right column — map (always shown) */}
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
            Standort
          </p>
          <div className="h-[220px]">
            <LiveMap coords={coords} />
          </div>
        </div>
      </div>
    </Card>
  );
}
