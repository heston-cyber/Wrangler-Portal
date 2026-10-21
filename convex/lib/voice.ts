// Voice notes (Phase 3): matching what you said to what was on screen.
// While recording, the page logs [ms since the recording started, frame on screen] every time the frame changes.
// ElevenLabs returns each word with its start/end in seconds; each word gets the frame showing when you said it.

export type FrameLog = Array<[number, number]>; // [ms, frame], ms ascending
export type VoiceWord = { t: string; f: number; s: number; e: number }; // text, frame, start ms, end ms
export type Pointer = { word: string; i: number; f: number; s: number; still?: string };

const POINTING = new Set(["this", "here", "that", "there", "these", "those"]);
export const MAX_POINTER_STILLS = 8;

// The frame on screen at `ms` into the recording.
export function frameAt(log: FrameLog, ms: number): number {
  if (!log.length) return 0;
  let lo = 0, hi = log.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid][0] <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return log[ans][1];
}

export function mapWords(words: Array<{ text: string; start: number; end: number; type?: string }>, log: FrameLog): VoiceWord[] {
  const out: VoiceWord[] = [];
  for (const w of words) {
    if (w.type && w.type !== "word") continue;
    const t = (w.text ?? "").trim();
    if (!t) continue;
    const s = Math.max(0, Math.round(w.start * 1000)), e = Math.max(s, Math.round(w.end * 1000));
    out.push({ t, f: frameAt(log, s), s, e });
  }
  return out;
}

const bare = (t: string) => t.toLowerCase().replace(/[^a-z']/g, "");

// Pointing words ("this", "here", ...) and the frame each was said on. One per frame, at most MAX_POINTER_STILLS.
export function pointersFrom(words: VoiceWord[]): Pointer[] {
  const out: Pointer[] = [];
  const seen = new Set<number>();
  words.forEach((w, i) => {
    if (!POINTING.has(bare(w.t)) || seen.has(w.f) || out.length >= MAX_POINTER_STILLS) return;
    seen.add(w.f);
    out.push({ word: bare(w.t), i, f: w.f, s: w.s });
  });
  return out;
}

// Did the picture move while you talked? Then the note covers what was shown: first frame to last.
export function playedRange(log: FrameLog): { a: number; b: number } | null {
  if (log.length < 2) return null;
  let a = Infinity, b = -Infinity;
  for (const [, f] of log) { a = Math.min(a, f); b = Math.max(b, f); }
  return b - a >= 2 ? { a, b } : null; // a frame or two of jitter isn't "playing"
}

export const transcriptText = (words: VoiceWord[]) => words.map((w) => w.t).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
