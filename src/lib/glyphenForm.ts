// Zeichen nach Form wählen — nicht nur nach Helligkeit.
//
// WARUM
// Paul, 2026-11-16: „I want even higher quality". Nach Alex Harri, „ASCII
// characters are not pixels" (alexharri.com/blog/ascii-rendering): Jede
// Schriftzelle wird an sechs Stellen abgetastet (2 Spalten × 3 Zeilen), und
// gewählt wird das Zeichen, dessen eigene Form diesen sechs Werten am
// nächsten kommt. Ein Körper, der nur die untere Hälfte einer Zelle füllt,
// wird so zu „_" oder „.", eine schräge Kante zu „/" — feiner, als eine
// Zelle pro Zeichen sonst erlaubt.
//
// WOHER DIE ZAHLEN
// Gemessen am 2026-11-16 in Daily selbst: jedes Zeichen in
// ui-monospace/SF Mono 10 px, achtfach gerendert, Deckung je Sechstel über
// das Band, in dem Zeichen liegen (oberste 9,5 px der Zelle). Andere
// Monospace-Schriften weichen etwas ab, die Formen bleiben dieselben.
//
// Auswahl nach den Regeln der ASCII-Künstler (Rowan Crawford, „ASCII
// Graphical Techniques", roysac.com): Kanten mit Zeichen glätten, deren Form
// zur Richtung passt (d b P Y V l j L J …); Flächen mit wenigen, ruhigen
// Füllzeichen (@ # 0 O 8 H); „*" gilt als billig, $ & % als unruhig — draußen.

/** Anteil der Schriftgröße, den die Zeichen senkrecht einnehmen. */
export const ZEICHEN_BAND = 0.95;

type Form = readonly [number, number, number, number, number, number];

/** Deckung je Sechstel: oben links, oben rechts, Mitte links, Mitte rechts, unten links, unten rechts. */
const GEMESSEN: readonly (readonly [string, Form])[] = [
  [".", [0, 0, 0.1, 0.059, 0.153, 0.09]],
  [",", [0, 0, 0.057, 0.048, 0.328, 0.118]],
  [":", [0.118, 0.082, 0.136, 0.094, 0.129, 0.09]],
  [";", [0.118, 0.082, 0.129, 0.098, 0.3, 0.118]],
  ["'", [0.162, 0.215, 0, 0, 0, 0]],
  ['"', [0.379, 0.378, 0, 0, 0, 0]],
  ["`", [0.107, 0.047, 0, 0, 0, 0]],
  ["^", [0.36, 0.362, 0.003, 0.003, 0, 0]],
  ["-", [0, 0, 0.254, 0.272, 0, 0]],
  ["_", [0, 0, 0, 0, 0.295, 0.295]],
  ["~", [0.031, 0, 0.357, 0.377, 0, 0]],
  ["=", [0.126, 0.126, 0.391, 0.392, 0, 0]],
  ["+", [0.055, 0.087, 0.335, 0.408, 0.026, 0.041]],
  ["<", [0.011, 0.206, 0.458, 0.3, 0, 0.05]],
  [">", [0.207, 0.011, 0.297, 0.461, 0.051, 0]],
  ["!", [0.115, 0.222, 0.071, 0.137, 0.07, 0.115]],
  ["/", [0.001, 0.33, 0.254, 0.106, 0.253, 0]],
  ["\\", [0.332, 0, 0.161, 0.198, 0, 0.252]],
  ["|", [0.086, 0.227, 0.086, 0.227, 0.086, 0.227]],
  ["(", [0.216, 0.125, 0.33, 0.024, 0.058, 0.162]],
  [")", [0.165, 0.176, 0.063, 0.292, 0.181, 0.04]],
  ["[", [0.103, 0.267, 0.103, 0.237, 0.069, 0.262]],
  ["]", [0.177, 0.193, 0.148, 0.193, 0.202, 0.13]],
  ["{", [0.121, 0.251, 0.324, 0.148, 0.056, 0.276]],
  ["}", [0.216, 0.158, 0.118, 0.355, 0.255, 0.078]],
  ["c", [0.143, 0.212, 0.37, 0.003, 0.161, 0.221]],
  ["v", [0.13, 0.13, 0.348, 0.349, 0.113, 0.115]],
  ["x", [0.141, 0.143, 0.337, 0.341, 0.16, 0.16]],
  ["o", [0.183, 0.185, 0.365, 0.363, 0.202, 0.204]],
  ["#", [0.363, 0.485, 0.495, 0.448, 0.144, 0.098]],
  ["@", [0.288, 0.393, 0.561, 0.469, 0.333, 0.401]],
  ["0", [0.381, 0.494, 0.553, 0.436, 0.192, 0.192]],
  ["O", [0.396, 0.398, 0.382, 0.379, 0.201, 0.202]],
  ["8", [0.405, 0.407, 0.427, 0.43, 0.223, 0.224]],
  ["H", [0.367, 0.368, 0.466, 0.468, 0.146, 0.146]],
  // Kantenzeichen der ASCII-Künstler (Rowan Crawford): d b P für obere
  // Rundungen, V Y für untere, l j L J für Seiten. Füll-Buchstaben wie U u a n
  // fliegen raus: in Flächen lesen sie sich wie Text („UUUU“).
  ["d", [0.192, 0.435, 0.361, 0.365, 0.21, 0.244]],
  ["b", [0.434, 0.196, 0.373, 0.362, 0.243, 0.213]],
  ["P", [0.431, 0.438, 0.467, 0.259, 0.147, 0]],
  ["Y", [0.359, 0.36, 0.219, 0.224, 0.072, 0.074]],
  ["V", [0.342, 0.342, 0.342, 0.343, 0.11, 0.113]],
  ["T", [0.383, 0.394, 0.176, 0.191, 0.07, 0.076]],
  ["A", [0.291, 0.295, 0.467, 0.47, 0.151, 0.152]],
  ["L", [0.339, 0, 0.368, 0, 0.235, 0.257]],
  ["J", [0.118, 0.399, 0.008, 0.369, 0.264, 0.161]],
  ["j", [0.158, 0.213, 0.041, 0.292, 0.199, 0.253]],
  ["l", [0.256, 0.191, 0.147, 0.195, 0.017, 0.248]],
  ["7", [0.227, 0.452, 0.126, 0.252, 0.15, 0.005]],
];

// Auf die stärkste gemessene Deckung bezogen, damit ein voll gefülltes
// Sechstel (Dichte 1) dem dichtesten Zeichen entspricht.
const HOECHSTE = Math.max(...GEMESSEN.flatMap(([, f]) => f));

/** Die wählbaren Zeichen; Index 0 = Leerzeichen (nichts zeichnen). */
export const GLYPHEN: readonly string[] = [" ", ...GEMESSEN.map(([z]) => z)];
const FORMEN: readonly Form[] = [
  [0, 0, 0, 0, 0, 0],
  ...GEMESSEN.map(([, f]) => f.map((v) => v / HOECHSTE) as unknown as Form),
];

// Kontrast innerhalb der Zelle (Harri): das hellste Sechstel bleibt, die
// anderen rücken davon ab — Kanten werden scharf, Flächen bleiben gleichmäßig.
const KONTRAST = 1.6;

// Jede Probe wird auf STUFEN Werte gerundet; so passen alle Fälle in einen
// Zwischenspeicher, und die Suche läuft je Kombination nur einmal.
const STUFEN = 8;
const speicher = new Uint8Array(STUFEN ** 6).fill(255);

function suche(proben: Form): number {
  let beste = 0;
  let besteAbstand = Infinity;
  for (let g = 0; g < FORMEN.length; g++) {
    const f = FORMEN[g];
    let a = 0;
    for (let k = 0; k < 6; k++) {
      const d = proben[k] - f[k];
      a += d * d;
    }
    if (a < besteAbstand) {
      besteAbstand = a;
      beste = g;
    }
  }
  return beste;
}

/** Sechs Proben (je 0..1) mit Kontrast versehen — gibt neue Werte zurück. */
export function mitKontrast(proben: ArrayLike<number>, versatz = 0): Form {
  let hoechste = 0;
  for (let k = 0; k < 6; k++) hoechste = Math.max(hoechste, proben[versatz + k]);
  if (hoechste <= 0) return [0, 0, 0, 0, 0, 0];
  const v = (k: number) => hoechste * Math.pow(Math.min(1, proben[versatz + k] / hoechste), KONTRAST);
  return [v(0), v(1), v(2), v(3), v(4), v(5)];
}

/** Index in GLYPHEN für sechs Proben ab `versatz`; 0 = leer lassen. */
export function glyphFuer(proben: ArrayLike<number>, versatz = 0): number {
  const k = mitKontrast(proben, versatz);
  let schluessel = 0;
  for (let i = 0; i < 6; i++) {
    schluessel = schluessel * STUFEN + Math.min(STUFEN - 1, Math.round(Math.min(1, k[i]) * (STUFEN - 1)));
  }
  const bekannt = speicher[schluessel];
  if (bekannt !== 255) return bekannt;
  const gerundet = Array.from({ length: 6 }, (_, i) => {
    const stufe = Math.floor(schluessel / STUFEN ** (5 - i)) % STUFEN;
    return stufe / (STUFEN - 1);
  }) as unknown as Form;
  const g = suche(gerundet);
  speicher[schluessel] = g;
  return g;
}

// Die Dichte der Tiere fällt über 30–60 px weich ab; innerhalb einer Zelle
// unterscheiden sich die sechs Proben dann kaum, und die Suche fände keine
// Kante. Deshalb bekommt die Form einen scharfen Umriss (wie „solid art"
// bei Rowan Crawford: klare Silhouette, innen gefüllt), und nur innen bleibt
// die weiche Schattierung erhalten.
const UMRISS_AB = 0.04;
const UMRISS_BIS = 0.16;
const INNEN_MIN = 0.4;

/** Probe → Formwert: scharfe Silhouette, innen weich schattiert (0..1). */
export function geformt(v: number): number {
  const t = Math.min(1, Math.max(0, (v - UMRISS_AB) / (UMRISS_BIS - UMRISS_AB)));
  return t * t * (3 - 2 * t) * (INNEN_MIN + (1 - INNEN_MIN) * v);
}

/**
 * Für ein ganzes Bild: je Zelle der Index in GLYPHEN (0 = leer).
 * `proben` = sechs Werte je Zelle (asciiTeich.rasternProben), `dichte` das
 * Zellmittel, `hell` dasselbe mit Licht (asciiTeich.beleuchten) — das Licht
 * hebt oder senkt alle sechs Proben einer Zelle gleich.
 */
export function glyphenBild(proben: Float32Array, dichte: Float32Array, hell: Float32Array, sichtbarAb: number): Uint8Array {
  const bild = new Uint8Array(dichte.length);
  const zelle = new Float32Array(6);
  for (let i = 0; i < dichte.length; i++) {
    if (dichte[i] < sichtbarAb) continue;
    const licht = hell[i] / dichte[i];
    for (let k = 0; k < 6; k++) zelle[k] = geformt(Math.min(1, proben[i * 6 + k] * licht));
    bild[i] = glyphFuer(zelle);
  }
  return bild;
}
