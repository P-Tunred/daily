// ─────────────────────────────────────────────────────────────────────────────
// App sound layer — Paul's own recordings (public/sounds/*.m4a, recorded
// 2026-07-05). The set is built around two "main" sounds per his direction:
//
//   komp-tip.m4a    → neutral click (every button) — the typing tap. Played
//                     with a hair of random pitch variation so rapid clicking
//                     sounds like real typing, and pitched DOWN for dismiss so
//                     delete/skip stays in the same family but reads "away".
//   save-chat.m4a   → confirm (save / add / done / attend)
//   final-sound.m4a → session-complete milestone
//
// Hand recordings carry leading/trailing room silence, so every sample is
// auto-trimmed (first/last sample above a noise floor) and peak-normalized
// once at decode time — the files on disk stay untouched.
// ─────────────────────────────────────────────────────────────────────────────

type RoleSpec = {
  url: string;
  /** Output level after peak-normalization (1 = sample's full recorded peak). */
  gain: number;
  /** Fixed pitch/speed factor (dismiss plays the tap lower + slower). */
  rate?: number;
  /** Random per-play pitch spread (±fraction) — keeps rapid clicks organic. */
  rateJitter?: number;
};

const ROLES: Record<"click" | "confirm" | "dismiss" | "complete", RoleSpec> = {
  click:    { url: "/sounds/komp-tip.m4a",    gain: 0.5,  rateJitter: 0.04 },
  confirm:  { url: "/sounds/save-chat.m4a",   gain: 0.55 },
  dismiss:  { url: "/sounds/komp-tip.m4a",    gain: 0.45, rate: 0.72 },
  complete: { url: "/sounds/final-sound.m4a", gain: 0.6 },
};

let ctx: AudioContext | null = null;

function getCtx() {
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

/** Schedule `fn` once the context is actually running. Needed because the
 *  very first sound of a session hits a "suspended" context — resume() is
 *  async, so scheduling sources before it settles can play silently. */
function whenRunning(ac: AudioContext, fn: () => void) {
  if (ac.state === "suspended") {
    void ac.resume().then(fn);
  } else {
    fn();
  }
}

// ── Sample loading: fetch eagerly, decode lazily, trim + normalize once ──────

const bytesCache = new Map<string, Promise<ArrayBuffer>>();

function fetchBytes(url: string): Promise<ArrayBuffer> {
  if (!bytesCache.has(url)) {
    bytesCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`sound ${url}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }));
  }
  return bytesCache.get(url)!;
}

// Warm the HTTP cache at app start (no AudioContext needed for this part).
for (const spec of Object.values(ROLES)) void fetchBytes(spec.url).catch(() => {});

type TrimmedSample = {
  buffer: AudioBuffer;
  /** Seconds into the buffer where the actual sound starts. */
  offset: number;
  /** Seconds of buffer content to play from `offset`. */
  duration: number;
  /** Peak-normalization factor (capped so a quiet take isn't boosted to hiss). */
  norm: number;
};

/** Find the audible span: first/last sample above a noise floor derived from
 *  the recording's own peak. Keeps 3 ms pre-roll and 60 ms natural tail. */
function analyzeSample(buffer: AudioBuffer): TrimmedSample {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  const threshold = Math.max(0.01, peak * 0.05);
  let first = 0;
  while (first < data.length && Math.abs(data[first]) < threshold) first += 1;
  let last = data.length - 1;
  while (last > first && Math.abs(data[last]) < threshold) last -= 1;

  const sr = buffer.sampleRate;
  const offset = Math.max(0, first / sr - 0.003);
  const end = Math.min(buffer.duration, last / sr + 0.06);
  return {
    buffer,
    offset,
    duration: Math.max(0.02, end - offset),
    norm: peak > 0 ? Math.min(1 / peak, 4) : 1,
  };
}

const sampleCache = new Map<string, Promise<TrimmedSample>>();

function getSample(ac: AudioContext, url: string): Promise<TrimmedSample> {
  if (!sampleCache.has(url)) {
    sampleCache.set(
      url,
      fetchBytes(url)
        // decodeAudioData detaches the buffer — hand it a copy so the byte
        // cache stays reusable.
        .then((bytes) => ac.decodeAudioData(bytes.slice(0)))
        .then(analyzeSample),
    );
  }
  return sampleCache.get(url)!;
}

// ── Playback ─────────────────────────────────────────────────────────────────

function playRole(role: keyof typeof ROLES) {
  if (!soundEnabled) return;
  try {
    const ac = getCtx();
    whenRunning(ac, () => {
      void getSample(ac, ROLES[role].url)
        .then((s) => {
          const spec = ROLES[role];
          const jitter = spec.rateJitter ?? 0;
          const rate = (spec.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * jitter);

          const src = ac.createBufferSource();
          src.buffer = s.buffer;
          src.playbackRate.value = rate;

          // Constant level with a short release ramp at the cut point, so the
          // trim never ends in an audible click.
          const g = ac.createGain();
          const level = spec.gain * s.norm;
          const now = ac.currentTime;
          const wallDur = s.duration / rate;
          g.gain.setValueAtTime(level, now);
          g.gain.setValueAtTime(level, now + Math.max(0, wallDur - 0.03));
          g.gain.linearRampToValueAtTime(0.0001, now + wallDur);

          src.connect(g).connect(ac.destination);
          src.start(now, s.offset, s.duration);
        })
        .catch(() => {/* sample missing/undecodable — stay silent */});
    });
  } catch {
    /* audio unavailable — silent */
  }
}

/** Neutral UI tap — Paul's KompTip recording with organic pitch variation. */
export function playClick() {
  playRole("click");
}

/** Positive-action cue (save / add / attend / done) — SaveChat recording. */
export function playConfirm() {
  playRole("confirm");
}

/** Dismiss-action cue (delete / skip / discard / undo) — KompTip pitched down. */
export function playDismiss() {
  playRole("dismiss");
}

/** Session-complete milestone — FinalSound recording. (Name kept so
 *  TimerContext's existing import keeps working.) */
export function playChime() {
  playRole("complete");
}

// ── Global mute toggle ───────────────────────────────────────────────────────
// Plain module state (not React) so the click-sound event delegate — a single
// document-level listener, not per-component wiring — can check it on every
// click without a re-render round-trip. The TopNav toggle mirrors this value
// into local state purely for its own rendering.

const SOUND_KEY = "morning.soundEnabled";
let soundEnabled = loadSoundEnabled();

function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    /* quota */
  }
}
