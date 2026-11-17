// Stil „G" — Wetter im Aufbau von Seite G (Artboard „Glas-Planung", Karte
// „Wetter · München"). Paul (2026-11-03): „Wetter Stockholm kannst du auch
// anpassen zu dem, was du da hattest in deinem Design."
//
// Nur Ansicht: Standort, Abruf, Cache und Hintergrund-Stimmung bleiben in
// WeatherCard. Statt Emoji und Satellitenkarte: Hoch/Tief als gespaltene
// Zahl, gefühlt · Wind · Sonnenuntergang, eine Stundenleiste mit Linien-
// Symbolen und ein Satz, wann Regen kommt.

import type { WeatherData, HourlySlot } from "../WeatherCard";
import { describeWeather } from "../WeatherCard";
import "./g.css";

type Art = "sonne" | "mond" | "wolke" | "regen" | "schnee";
const art = (code: number, tag = true): Art =>
  code <= 1 ? (tag ? "sonne" : "mond")
    : (code >= 71 && code <= 77) || code === 85 || code === 86 ? "schnee"
    : code >= 51 ? "regen"
    : "wolke";
const nass = (s: HourlySlot) => art(s.code) === "regen" || art(s.code) === "schnee" || (s.prob ?? 0) >= 50;
const stunde = (s: HourlySlot) => String(Number(s.time.slice(11, 13)));

function Symbol({ a }: { a: Art }) {
  const p = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (a === "sonne") return <svg {...p}><circle cx="10" cy="10" r="3.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></svg>;
  if (a === "mond") return <svg {...p}><path d="M15.5 12.6A6 6 0 0 1 7.4 4.5a6 6 0 1 0 8.1 8.1z" /></svg>;
  if (a === "wolke") return <svg {...p}><path d="M6 15h8.5a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.3 8.2 3.4 3.4 0 0 0 6 15z" /></svg>;
  if (a === "schnee") return <svg {...p}><path d="M6 12h8.5a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.3 5.2 3.4 3.4 0 0 0 6 12z" /><path d="M7.5 15.5h.01M11 16.5h.01M14.5 15.5h.01" strokeWidth={2} /></svg>;
  return <svg {...p}><path d="M6 12h8.5a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.3 5.2 3.4 3.4 0 0 0 6 12z" /><path d="M7.5 14.5l-1 2M11 14.5l-1 2M14.5 14.5l-1 2" /></svg>;
}

/** „ab 15 Uhr Regen" / „gerade Regen" / „trocken" — aus den nächsten 12 Stunden. */
function regenSatz(h: HourlySlot[]): { kurz: string | null; lang: string | null } {
  const naechste = h.slice(0, 12);
  if (naechste.length === 0) return { kurz: null, lang: null };
  const wort = (s: HourlySlot) => (art(s.code) === "schnee" ? "Schnee" : "Regen");
  if (nass(naechste[0])) return { kurz: `gerade ${wort(naechste[0])}`, lang: null };
  const ab = naechste.find(nass);
  if (ab) {
    return {
      kurz: `ab ${stunde(ab)} Uhr ${wort(ab)}`,
      lang: ab.prob != null ? `${wort(ab) === "Schnee" ? "Schnee" : "Regen"}wahrscheinlichkeit ab ${stunde(ab)} Uhr ${ab.prob} %.` : null,
    };
  }
  const hoechst = Math.max(...naechste.map(s => s.prob ?? 0));
  return { kurz: "trocken", lang: hoechst < 20 ? "Die nächsten zwölf Stunden bleibt es trocken." : null };
}

export function GWetter({ weather, isStale, loading }: { weather: WeatherData | null; isStale: boolean; loading: boolean }) {
  if (!weather) {
    return (
      <section className="g-blatt" aria-labelledby="g-wx-h">
        <div className="g-kopf"><div><h2 id="g-wx-h">Wetter</h2><p>{loading ? "Standort wird ermittelt …" : "gerade nicht abrufbar"}</p></div></div>
      </section>
    );
  }
  const desc = describeWeather(weather.weatherCode);
  const regen = regenSatz(weather.hourly);
  // Acht Punkte über den Tag: jetzt, dann alle zwei Stunden.
  const leiste = weather.hourly.filter((_, i) => i % 2 === 0).slice(0, 8);
  const hoch = weather.max ?? weather.temp;
  const tief = weather.min;

  return (
    <section className="g-blatt g-wetter" aria-labelledby="g-wx-h">
      <div className="g-kopf">
        <div>
          <h2 id="g-wx-h">Wetter · {weather.city}</h2>
          <p>{[desc.label.toLowerCase(), regen.kurz].filter(Boolean).join(", ")}{isStale && !loading ? " · letzte bekannte Daten" : ""}</p>
        </div>
        <span className="g-leise">jetzt {weather.temp}°</span>
      </div>
      <div className="g-wetter-kern">
        <p className="g-zahl gross" aria-label={`Heute bis ${hoch} Grad${tief != null ? `, tiefstens ${tief} Grad` : ""}`}>
          <span>{hoch}°</span>{tief != null && <span className="leise">/{tief}°</span>}
        </p>
        <p className="g-notiz g-wetter-werte">
          gefühlt {weather.feelsLike}° · Wind {weather.windSpeed} km/h
          {weather.sunset ? <><br />Sonnenuntergang {weather.sunset}</> : null}
        </p>
      </div>
      {leiste.length > 0 && (
        <div className="g-stunden" role="img" aria-label={`Stündlich: ${leiste.map(s => `${stunde(s)} Uhr ${s.temp} Grad ${describeWeather(s.code).label}`).join(", ")}`}>
          {leiste.map((s, i) => (
            <div key={s.time} className={"g-stunde" + (i === 0 ? " jetzt" : "") + (nass(s) ? " nass" : "")}>
              <span>{i === 0 ? "jetzt" : stunde(s)}</span>
              <Symbol a={art(s.code, s.day !== false)} />
              <b>{s.temp}°</b>
            </div>
          ))}
        </div>
      )}
      {regen.lang && <p className="g-notiz">{regen.lang}</p>}
    </section>
  );
}
