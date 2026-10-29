// Records a voice note in the browser and logs which frame is on screen the whole time.
// Chrome records WebM/Opus; iPhone Safari records MP4/AAC. Both go to ElevenLabs as-is.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameClock } from "../player/useFramePlayer";
import type { FrameLog } from "../../../../convex/lib/voice";

export type Recording = { blob: Blob; mime: string; durationMs: number; frames: FrameLog; strokeTimes: number[] };
type State = "idle" | "starting" | "recording" | "stopping";
type Rec = { mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; frames: FrameLog; strokes: number[]; unsub: () => void; ctx?: AudioContext; raf?: number; tick?: number; mime: string };

const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
export const canRecord = () => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export function useVoiceRecorder(clock: FrameClock) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0); // 0..1, for the meter
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);

  const cleanup = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.unsub();
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.tick) clearInterval(r.tick);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => null);
    rec.current = null;
    setLevel(0);
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    if (rec.current) return false;
    setError(null);
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const t0 = performance.now();
      const frames: FrameLog = [[0, clock.get()]];
      // Every frame change while recording: [ms since start, frame].
      const unsub = clock.subscribe(() => {
        const f = clock.get();
        if (frames[frames.length - 1][1] !== f) frames.push([Math.round(performance.now() - t0), f]);
      });
      const r: Rec = { mr, stream, chunks, t0, frames, strokes: [], unsub, mime: mr.mimeType || mime || "audio/webm" };
      rec.current = r;
      // Level meter (best effort).
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const x of buf) sum += ((x - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
          r.raf = requestAnimationFrame(loop);
        };
        r.ctx = ctx;
        loop();
      } catch { /* no meter */ }
      r.tick = window.setInterval(() => setElapsed(Math.round(performance.now() - t0)), 200);
      mr.start(500);
      setElapsed(0);
      setState("recording");
      return true;
    } catch (e) {
      cleanup();
      setState("idle");
      const name = (e as Error)?.name;
      setError(name === "NotAllowedError" ? "The microphone is blocked. Allow it for this site in your browser settings." : name === "NotFoundError" ? "No microphone found." : "Couldn't start recording.");
      return false;
    }
  }, [clock, cleanup]);

  // Pen strokes finished while recording, in ms since the start (so stills show what was drawn at each word).
  const markStroke = useCallback(() => {
    const r = rec.current;
    if (r) r.strokes.push(Math.round(performance.now() - r.t0));
  }, []);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const r = rec.current;
    if (!r) return null;
    setState("stopping");
    const durationMs = Math.round(performance.now() - r.t0);
    const done = new Promise<void>((res) => { r.mr.onstop = () => res(); });
    try { r.mr.stop(); } catch { /* already stopped */ }
    await done;
    const out: Recording = { blob: new Blob(r.chunks, { type: r.mime }), mime: r.mime, durationMs, frames: r.frames, strokeTimes: r.strokes };
    cleanup();
    setState("idle");
    return out;
  }, [cleanup]);

  const cancel = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    try { r.mr.stop(); } catch { /* ignore */ }
    cleanup();
    setState("idle");
  }, [cleanup]);

  const startedAt = useCallback(() => rec.current?.t0 ?? null, []);
  return { state, elapsed, level, error, start, stop, cancel, markStroke, startedAt, recording: state === "recording" };
}
