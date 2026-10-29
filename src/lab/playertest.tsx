// Player test (Oct 22, R3): the site's own player (useFramePlayer) on its own page, scripted, with every media event
// logged, to find why jumps never finish on Heston's iPhone on the review page while a plain video jumps fine.
// Part 1 runs on its own (jumps, never played). Part 2 starts with a tap: plays 1 s with sound, pauses, jumps,
// drags, jumps. Results go to the Phase 0 test log.
import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { useFramePlayer } from "../modules/review/player/useFramePlayer";

const q = new URLSearchParams(location.search);
const SRC = q.get("src") || "https://wrangler-review-stills.b-cdn.net/review/kn74vazj0ds7ftgwzhwg9b0wm18gr1d6/d4fd1a337e0c1a27/99999_R3Test_v3.mp4";
const TOTAL = 12960;
const FPS = { num: 24000, den: 1001 };
const FD = 1001 / 24000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = performance.now();
const now = () => Math.round(performance.now() - T0);

const cv = document.createElement("canvas"); cv.width = 480; cv.height = 270;
const cx = cv.getContext("2d", { willReadFrequently: true })!;
// The test render carries its frame number (mod 480) as a 12-bit barcode.
function picture(v: HTMLVideoElement): number | null | string {
  try { cx.drawImage(v, 0, 0, 480, 270); } catch (e) { return `draw ${(e as Error).name}`; }
  const lum = (x: number, y: number) => { const d = cx.getImageData(x, y, 1, 1).data; return 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]; };
  let val = 0;
  for (let i = 0; i < 12; i++) { const x = Math.round((240 + i * 120 + 60) / 4); const a = lum(x, 26) > 128, z = lum(x, 54) > 128; if (a === z) return null; val = (val << 1) | (a ? 1 : 0); }
  return val;
}

function App() {
  const player = useFramePlayer(SRC, FPS, TOTAL, undefined);
  const [lines, setLines] = useState<string[]>([]);
  const [stage, setStage] = useState<"loading" | "part1" | "tap" | "part2" | "done">("loading");
  const log = useRef<string[]>([]);
  const results = useRef<Record<string, unknown>>({});
  const add = (s: string) => { log.current.push(`${now()} ${s}`); setLines([...log.current.slice(-80)]); };
  const v = () => player.videoRef.current!;
  const st = () => { const e = v(); return `rs${e.readyState} ns${e.networkState} seeking${e.seeking ? 1 : 0} t${e.currentTime.toFixed(2)} buf${e.buffered.length}`; };

  // Every media event, with the element's state.
  useEffect(() => {
    const e = player.videoRef.current;
    if (!e) return;
    const evs = ["loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough", "seeking", "seeked", "waiting", "stalled", "suspend", "abort", "error", "emptied", "play", "playing", "pause", "volumechange"];
    const h = (ev: Event) => add(`ev ${ev.type} ${st()}${ev.type === "error" && e.error ? ` code${e.error.code} ${e.error.message}` : ""}`);
    evs.forEach((n) => e.addEventListener(n, h));
    return () => evs.forEach((n) => e.removeEventListener(n, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function jumps(tag: string, targets: number[]) {
    const out: Array<{ n: number; ms: number; landed: number; pic: number | null | string }> = [];
    for (const n of targets) {
      const t = performance.now();
      const landed = await Promise.race([player.seekToFrame(n), sleep(20000).then(() => -1)]);
      const ms = Math.round(performance.now() - t);
      await sleep(80);
      const pic = picture(v());
      out.push({ n, ms, landed, pic });
      add(`${tag} jump ${n} → ${landed} pic ${pic} ${ms}ms ${st()}`);
    }
    results.current[tag] = out;
    return out;
  }

  useEffect(() => {
    if (!player.ready || stage !== "loading") return;
    setStage("part1");
    (async () => {
      add(`ready ${st()}`);
      await sleep(600);
      await jumps("A-notplayed", [3000, 9000, 1200, 6000, 11500]);
      setStage("tap");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.ready]);

  async function part2() {
    setStage("part2");
    add("tap: play with sound");
    player.setSound(true);
    player.play(); // inside the tap
    await sleep(1200);
    player.pause();
    await sleep(400);
    add(`paused ${st()} pic ${picture(v())}`);
    await jumps("B-afterplay", [4000, 10000, 2500, 7500, 12000]);
    // Drag: one move every 120 ms for 2 s, then let go.
    add("drag start");
    const t = performance.now();
    let f = 2000;
    for (let i = 0; i < 16; i++) { f += 300; player.scrubTo(f, i === 0); await sleep(120); }
    const landed = await Promise.race([player.endScrub(f), sleep(20000).then(() => -1)]);
    await sleep(80);
    const pic = picture(v());
    results.current.drag = { target: f, landed, pic, ms: Math.round(performance.now() - t) };
    add(`drag let go at ${f} → ${landed} pic ${pic} ${st()}`);
    await jumps("C-afterdrag", [500, 8800, 5100]);
    setStage("done");
    const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
    if (url) {
      try {
        const ua = navigator.userAgent;
        await new ConvexHttpClient(url).mutation(api.phase0.saveRun, { label: "Player test (R3)", device: /iPhone/.test(ua) ? "iPhone" : "Computer", browser: /CriOS/.test(ua) ? "Chrome" : "Safari", source: SRC, engine: "useFramePlayer", pass: true, userAgent: ua, results: results.current, misses: log.current.slice(-150) });
        add("saved");
      } catch (e) { add(`save failed ${(e as Error).message}`); }
    }
  }

  const ok = (x: { n: number; landed: number; pic: number | null | string }) => x.landed === x.n && x.pic === x.n % 480;
  return (
    <div className="wrap">
      <div className="eyebrow">Wrangler Review · player test</div>
      <h1>The review page's player, on its own</h1>
      <p>Part 1 runs by itself. When the button lights up, tap it and keep the page on screen for about a minute.</p>
      <div className="screen"><video ref={player.videoRef} playsInline preload="auto" /></div>
      <button disabled={stage !== "tap"} onClick={() => void part2()}>{stage === "loading" ? "Loading…" : stage === "part1" ? "Part 1 running…" : stage === "tap" ? "Tap to run part 2" : stage === "part2" ? "Part 2 running…" : "Done, thanks"}</button>
      <div className="status">
        {Object.entries(results.current).map(([k, r]) => Array.isArray(r) ? <div key={k} className={r.every(ok) ? "good" : "bad"}>{k}: {r.filter(ok).length}/{r.length} landed, {Math.max(...r.map((x) => x.ms))} ms worst</div> : <div key={k}>{k}: {JSON.stringify(r)}</div>)}
      </div>
      <pre>{lines.join("\n")}</pre>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
