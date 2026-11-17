// Hermes' Antwort vorlesen, Satz für Satz und in der richtigen Reihenfolge.
//
// Jeder Satz wird sofort bei POST /api/stimme/vorlesen bestellt (Seraphina,
// electron/stimmeKurz.cjs), gespielt wird aber erst, wenn der vorige fertig
// ist — so liegt der nächste Satz meist schon bereit, wenn er dran ist.
// Klappt die Aufnahme nicht, spricht der Browser selbst (speechSynthesis):
// eine Antwort ohne Ton wäre schlimmer als eine mit schlichter Stimme.

export interface Vorleser {
  sag: (text: string) => void;
  /** Wird erfüllt, wenn alles Bestellte gesprochen (oder gestoppt) ist. */
  fertig: () => Promise<void>;
  stopp: () => void;
}

async function bestelle(text: string): Promise<string | null> {
  try {
    const r = await fetch("/api/stimme/vorlesen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  } catch {
    return null;
  }
}

function browserStimme(text: string, merke: (halt: () => void) => void): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  return new Promise((fertig) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    const de = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("de"));
    if (de) u.voice = de;
    u.onend = () => fertig();
    u.onerror = () => fertig();
    merke(() => { speechSynthesis.cancel(); fertig(); });
    speechSynthesis.speak(u);
  });
}

function spiele(url: string, merke: (halt: () => void) => void): Promise<void> {
  return new Promise((fertig) => {
    const a = new Audio(url);
    const ende = () => { URL.revokeObjectURL(url); fertig(); };
    a.onended = ende;
    a.onerror = ende;
    merke(() => { a.pause(); ende(); });
    a.play().catch(ende);
  });
}

/** `beimErstenTon` meldet, dass Hermes jetzt hörbar spricht. */
export function vorleser(beimErstenTon: () => void): Vorleser {
  let kette: Promise<void> = Promise.resolve();
  let aus = false;
  let halt: (() => void) | null = null;
  const merke = (h: () => void) => { halt = h; };

  const sag = (text: string) => {
    if (aus) return;
    const ton = bestelle(text);
    kette = kette.then(async () => {
      const url = await ton;
      if (aus) { if (url) URL.revokeObjectURL(url); return; }
      beimErstenTon();
      await (url ? spiele(url, merke) : browserStimme(text, merke));
      halt = null;
    });
  };

  const stopp = () => {
    aus = true;
    halt?.();
  };

  return { sag, fertig: () => kette, stopp };
}
