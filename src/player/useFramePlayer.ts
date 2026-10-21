// Frame-exact player, built on what Phase 0 proved:
// - the frame on screen comes from requestVideoFrameCallback's mediaTime (never currentTime),
// - jumps aim at the middle of a frame, then check where they landed and nudge (iPhones land late),
// - the learned nudge carries over to later jumps.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Hls from "hls.js";
import { frameDuration, type Fps } from "../../convex/lib/frames";

export type FrameClock = {
  get: () => number;
  subscribe: (l: () => void) => () => void;
  set: (f: number) => void;
};

function makeClock(): FrameClock {
  let frame = 0;
  const ls = new Set<() => void>();
  return {
    get: () => frame,
    subscribe: (l) => { ls.add(l); return () => ls.delete(l); },
    set: (f) => { if (f !== frame) { frame = f; ls.forEach((l) => l()); } },
  };
}

export const useFrame = (clock: FrameClock) => useSyncExternalStore(clock.subscribe, clock.get);

export type Player = ReturnType<typeof useFramePlayer>;

// exactFrameCount: counted from the file by the backend. Without it, the player estimates from the
// video's length, which can be one high when audio runs past the last picture.
export function useFramePlayer(src: string | null, fps: Fps, exactFrameCount: number | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const clock = useMemo(makeClock, []);
  const [playing, setPlaying] = useState(false);
  const [estimatedFrameCount, setEstimatedFrameCount] = useState<number | null>(null);
  const frameCount = exactFrameCount ?? estimatedFrameCount;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bias = useRef(0);
  const lastMedia = useRef<number | null>(null);
  const FD = frameDuration(fps);
  const frameOf = (t: number) => Math.max(0, Math.round(t / FD));
  const hasRVFC = typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  // Attach the source.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    setReady(false);
    setError(null);
    lastMedia.current = null;
    clock.set(0);
    let hls: Hls | null = null;
    v.crossOrigin = "anonymous";
    const isHls = /\.m3u8(\?|$)/.test(src);
    if (isHls && !v.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
      hls = new Hls({ capLevelToPlayerSize: false });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (hls) hls.currentLevel = hls.levels.length - 1; });
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) setError("The video couldn't load. Try the other quality."); });
      hls.loadSource(src);
      hls.attachMedia(v);
    } else {
      v.src = src;
    }
    const onMeta = () => {
      setReady(true);
      if (isFinite(v.duration) && v.duration > 0) setEstimatedFrameCount(Math.round(v.duration / FD));
    };
    const onErr = () => setError("The video couldn't load. Try the other quality, or refresh.");
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onErr);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    let handle = 0;
    let alive = true;
    const tick = (_n: number, md: VideoFrameCallbackMetadata) => {
      if (!alive) return;
      lastMedia.current = md.mediaTime;
      clock.set(frameOf(md.mediaTime));
      handle = v.requestVideoFrameCallback(tick);
    };
    const onTime = () => { lastMedia.current = v.currentTime; clock.set(frameOf(v.currentTime)); };
    if (hasRVFC) handle = v.requestVideoFrameCallback(tick);
    else v.addEventListener("timeupdate", onTime);
    return () => {
      alive = false;
      if (hasRVFC) v.cancelVideoFrameCallback(handle);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onErr);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      if (hls) hls.destroy();
      v.removeAttribute("src");
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, FD]);

  function nextFrame(timeout: number): Promise<VideoFrameCallbackMetadata | null> {
    const v = videoRef.current!;
    return new Promise((res) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; res(null); } }, timeout);
      if (hasRVFC) v.requestVideoFrameCallback((_n, md) => { if (!done) { done = true; clearTimeout(t); res(md); } });
    });
  }

  async function seekTime(t: number) {
    const v = videoRef.current!;
    const p = nextFrame(2000);
    v.currentTime = Math.max(0, t);
    const md = await p;
    if (md) { lastMedia.current = md.mediaTime; clock.set(frameOf(md.mediaTime)); }
    return md ? frameOf(md.mediaTime) : frameOf(v.currentTime);
  }

  const seekChain = useRef<Promise<number>>(Promise.resolve(0));
  // Where queued jumps are headed, so quick key presses add up instead of all starting from the same frame.
  const pending = useRef<{ target: number; id: number } | null>(null);
  const seq = useRef(0);
  async function seekToFrameNow(n: number) {
    const v = videoRef.current;
    if (!v) return n;
    const max = (frameCount ?? Infinity) - 1;
    const target = Math.max(0, Math.min(n, max));
    if (!v.paused) v.pause();
    if (clock.get() === target && lastMedia.current !== null) return target;
    let t = (target + 0.5) * FD + bias.current;
    let landed = await seekTime(t);
    for (let i = 0; i < 3 && landed !== target; i++) {
      t -= (landed - target) * FD * 0.6;
      landed = await seekTime(t);
      if (landed === target) bias.current = t - (target + 0.5) * FD;
    }
    return landed;
  }
  // Jumps run one after another so fast key repeats don't fight.
  function seekToFrame(n: number) {
    const max = (frameCount ?? Infinity) - 1;
    const target = Math.max(0, Math.min(n, max));
    const id = ++seq.current;
    pending.current = { target, id };
    const run = () => seekToFrameNow(target);
    seekChain.current = seekChain.current.then(run, run).finally(() => { if (pending.current?.id === id) pending.current = null; });
    return seekChain.current;
  }

  const api = {
    videoRef,
    clock,
    fps,
    frameCount,
    estimatedFrameCount,
    ready,
    playing,
    error,
    seekToFrame,
    step: (d: number) => seekToFrame((pending.current?.target ?? clock.get()) + d),
    play: () => videoRef.current?.play().catch(() => {}),
    pause: () => videoRef.current?.pause(),
    toggle: () => { const v = videoRef.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); },
    // After pausing, wait for the paused frame to settle so a note gets the frame you're looking at.
    settle: async () => { const v = videoRef.current; if (v && !v.paused) { v.pause(); await new Promise((r) => setTimeout(r, 150)); } return clock.get(); },
  };
  return api;
}
