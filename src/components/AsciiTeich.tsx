// ASCII-Teich — Tiere aus Schriftzeichen hinter dem Thema „Glas". Die
// Rechnung steht in src/lib/asciiTeich.ts und asciiTiere.ts, gezeichnet wird
// in teichBild.ts. Welche Tiere: lib/teichMotiv.ts (Einstellungen → Tiere).
//
// LEISE HEISST
// · zurückhaltend: Zeichen mit 10–30 % Deckkraft (Kulisse etwas leiser), zur
//   Mitte hin stufenlos dichter; nur das dichte Innere trägt die Farbe des
//   Tiers, die Ränder bleiben in der Textfarbe
// · feines Raster (10 px Schrift, 12 px Zeile), damit die Tiere Kontur haben
// · scheu: berührt der Mauszeiger ein Tier, flieht es sofort (lib/asciiTeich.ts)
// · Zeichen nach Form: sechs Proben je Zelle, das passendste Zeichen gewinnt
//   (lib/glyphenForm.ts) — Rundungen und Kanten feiner als eine Zelle
// · Licht von links oben: die zugewandte Seite dichter, die Tiere wirken rund
// · jedes Tier hat seine Kulisse (lib/kulisse.ts): Koi und Libellen einen
//   Teich mit Seerosen, Tropfen und Glanz; Falter eine Wiese mit Blüten, die
//   sie anfliegen; Quallen Tang, Blasen und Lichtstrahlen; Vögel ziehende
//   Wolken und Wind unter sich
// · ~30 Bilder/s statt 60, ohne Fokus 20 — für Hintergrund reicht das, und es spart Akku
// · steht still, wenn das Fenster verdeckt ist (requestAnimationFrame ruht
//   dann von selbst) und während eines Fokus-Timers (dann ausgeblendet)
// · „Bewegung reduzieren" in macOS: ein einziges stehendes Bild
// · liegt unter dem Inhalt (z 1) und fängt keine Klicks ab

import { useEffect, useRef } from "react";
import { neuerTeich, schritt, teichAufGroesse, type Art, type Punkt } from "../lib/asciiTeich";
import type { Kulisse } from "../lib/kulisse";
import { neueKulisse } from "../lib/kulissen";
import { neueWellen, wellenSchritt, type Anstoss, type Wellen } from "../lib/teichWellen";
import { probenStellen, zeichne, LEERER_SPEICHER, SCHRIFT, type Zwischenspeicher } from "./teichBild";

const BILD_MS = 1000 / 30;
// Ohne Fokus (Daily liegt sichtbar daneben) reichen 20 Bilder/s: berühren
// kann man die Tiere dann nicht, und ihr langsames Ziehen sieht im
// Zeichenraster gleich aus — ein Drittel weniger Arbeit im Hintergrund.
const BILD_MS_OHNE_FOKUS = 1000 / 20;

type Props = {
  art: Art;
  isPausiert: boolean;
};

function wellenFortschreiben(wellen: Wellen, neu: readonly Anstoss[], schritte: number): Wellen {
  let w = wellenSchritt(wellen, neu);
  for (let i = 1; i < schritte; i++) w = wellenSchritt(w, []);
  return w;
}

export default function AsciiTeich({ art, isPausiert }: Props) {
  const leinwand = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = leinwand.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let teich = neuerTeich(window.innerWidth, window.innerHeight, art);
    let kulisse: Kulisse = neueKulisse(art, teich);
    // Wellen laufen nur, wo Wasser ist (Koi, Libellen).
    let wellen: Wellen | null = null;
    let speicher: Zwischenspeicher = LEERER_SPEICHER;
    let zelleB = 7;
    let stellen = probenStellen(zelleB);

    const einrichten = () => {
      const dpr = window.devicePixelRatio || 1;
      const b = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(b * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${b}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = SCHRIFT;
      ctx.textBaseline = "top";
      zelleB = Math.max(5, Math.round(ctx.measureText("M").width));
      stellen = probenStellen(zelleB);
      if (b !== teich.breite || h !== teich.hoehe) kulisse = kulisse.aufGroesse(b / teich.breite, h / teich.hoehe, b, h);
      wellen = kulisse.wasser ? neueWellen(b, h) : null;
      teich = { ...teichAufGroesse(teich, b, h), ziele: kulisse.ziele };
      speicher = zeichne(ctx, teich, zelleB, stellen, kulisse, wellen, LEERER_SPEICHER);
    };
    einrichten();
    window.addEventListener("resize", einrichten);

    if (ruhig || isPausiert) {
      return () => window.removeEventListener("resize", einrichten);
    }

    // Der Zeiger: die Leinwand selbst fängt keine Ereignisse (pointer-events:
    // none), deshalb wird am Fenster gelauscht. Verlässt er das Fenster, ist
    // er für die Tiere weg.
    let maus: Punkt | null = null;
    const bewegt = (e: PointerEvent) => { maus = { x: e.clientX, y: e.clientY }; };
    const raus = () => { maus = null; };
    window.addEventListener("pointermove", bewegt, { passive: true });
    document.documentElement.addEventListener("pointerleave", raus);
    window.addEventListener("blur", raus);

    let id = 0;
    let zuletzt = performance.now();
    let wellenZeit = 0;
    const lauf = (jetzt: number) => {
      id = requestAnimationFrame(lauf);
      const dt = jetzt - zuletzt;
      if (dt < (document.hasFocus() ? BILD_MS : BILD_MS_OHNE_FOKUS)) return;
      zuletzt = jetzt;
      const vorher = teich;
      teich = schritt(teich, dt / 1000, Math.random, maus);
      const weiter = kulisse.weiter({ dt: Math.min(dt / 1000, 0.1), vorher, nachher: teich, maus, wellen, zufall: Math.random });
      kulisse = weiter.kulisse;
      teich = { ...teich, ziele: kulisse.ziele };
      if (wellen) {
        // Wellen laufen in festen 1/30-s-Schritten, damit sie bei weniger
        // Bildern nicht langsamer werden.
        wellenZeit = Math.min(wellenZeit + dt, 3 * BILD_MS);
        const schritte = Math.max(1, Math.floor(wellenZeit / BILD_MS));
        wellenZeit = Math.max(0, wellenZeit - schritte * BILD_MS);
        wellen = wellenFortschreiben(wellen, weiter.anstoesse, schritte);
      }
      speicher = zeichne(ctx, teich, zelleB, stellen, kulisse, wellen, speicher);
    };
    id = requestAnimationFrame(lauf);

    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", einrichten);
      window.removeEventListener("pointermove", bewegt);
      document.documentElement.removeEventListener("pointerleave", raus);
      window.removeEventListener("blur", raus);
    };
  }, [art, isPausiert]);

  return (
    <canvas
      // Neue Art = neue Leinwand, damit sie sanft neu einblendet.
      key={art}
      ref={leinwand}
      className={`ascii-teich${isPausiert ? " ascii-teich--aus" : ""}`}
      aria-hidden="true"
    />
  );
}
