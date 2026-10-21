// Transcripts: ElevenLabs words (seconds) → frames of the version, grouped into readable lines.
import type { Fps } from "./frames";

export type SttWord = { text: string; start: number; end: number; type?: string; speaker_id?: string };
// Compact word: [text, inFrame, outFrame (inclusive), speaker index]
export type FrameWord = [string, number, number, number];
export type Segment = { speaker: number; in: number; out: number; text: string };
export type TranscriptFile = { v: 1; language: string | null; fps: Fps; frameCount: number | null; speakers: string[]; words: FrameWord[]; segments: Segment[] };

export function secondsToFrame(t: number, fps: Fps) {
  return Math.max(0, Math.floor((t * fps.num) / fps.den + 1e-6));
}

export function toFrameWords(words: SttWord[], fps: Fps, frameCount: number | null): { words: FrameWord[]; speakers: string[] } {
  const speakers: string[] = [];
  const out: FrameWord[] = [];
  const last = frameCount ? frameCount - 1 : Infinity;
  for (const w of words) {
    if (w.type && w.type !== "word") continue;
    const text = (w.text ?? "").trim();
    if (!text) continue;
    const sp = w.speaker_id ?? "speaker_0";
    let si = speakers.indexOf(sp);
    if (si < 0) { speakers.push(sp); si = speakers.length - 1; }
    const a = Math.min(secondsToFrame(w.start, fps), last);
    // end is when the word stops; the last frame it's heard on is the frame before that instant (but never before its start)
    const b = Math.min(Math.max(a, Math.ceil((w.end * fps.num) / fps.den - 1e-6) - 1), last);
    out.push([text, a, b, si]);
  }
  return { words: out, speakers };
}

// Lines break on a new speaker, a pause of ~0.7 s, a sentence end once a line has 6+ words, or at 24 words.
export function toSegments(words: FrameWord[], fps: Fps): Segment[] {
  const gap = Math.round((0.7 * fps.num) / fps.den);
  const segs: Segment[] = [];
  let cur: { speaker: number; in: number; out: number; words: string[] } | null = null;
  const flush = () => { if (cur) segs.push({ speaker: cur.speaker, in: cur.in, out: cur.out, text: cur.words.join(" ") }); cur = null; };
  for (const [text, a, b, sp] of words) {
    if (cur && (sp !== cur.speaker || a - cur.out > gap)) flush();
    if (!cur) cur = { speaker: sp, in: a, out: b, words: [] };
    cur.words.push(text);
    cur.out = Math.max(cur.out, b);
    if ((/[.!?…]["')\]]?$/.test(text) && cur.words.length >= 6) || cur.words.length >= 24) flush();
  }
  flush();
  return segs;
}

export function buildTranscript(stt: { language_code?: string | null; words?: SttWord[] }, fps: Fps, frameCount: number | null): TranscriptFile {
  const { words, speakers } = toFrameWords(stt.words ?? [], fps, frameCount);
  return { v: 1, language: stt.language_code ?? null, fps, frameCount, speakers, words, segments: toSegments(words, fps) };
}
