// Aufnahme als WAV, 16 kHz mono 16 Bit — das Format, mit dem Whisper rechnet.
//
// Warum nicht MediaRecorder (Opus/WebM)? Beim Dazwischenreden braucht die
// Aufnahme die Sekunde VOR dem Auslösen, sonst fehlt Pauls erstes Wort. Aus
// einem laufenden WebM-Strom lässt sich kein Stück von vorn herausschneiden;
// aus rohen Samples schon. 16 kHz halten die Datei klein (32 KB je Sekunde).

export const ZIEL_RATE = 16000;

/** Float-Samples (-1..1) bei `rate` → WAV-Bytes bei 16 kHz. */
export function alsWav(teile: readonly Float32Array[], rate: number): Uint8Array {
  const gesamt = teile.reduce((n, t) => n + t.length, 0);
  const quelle = new Float32Array(gesamt);
  let o = 0;
  for (const t of teile) { quelle.set(t, o); o += t.length; }

  const schritt = rate / ZIEL_RATE;
  const n = Math.floor(gesamt / schritt);
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const text = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) b[pos + i] = s.charCodeAt(i); };
  text(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); text(8, "WAVE");
  text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, ZIEL_RATE, true); v.setUint32(28, ZIEL_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    // Mittelwert über das Fenster: einfacher Tiefpass gegen Aliasing.
    const von = Math.floor(i * schritt);
    const bis = Math.max(von + 1, Math.floor((i + 1) * schritt));
    let summe = 0;
    for (let k = von; k < bis; k++) summe += quelle[k];
    const s = Math.max(-1, Math.min(1, summe / (bis - von)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return b;
}
