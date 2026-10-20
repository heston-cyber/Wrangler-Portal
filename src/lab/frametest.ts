// Phase 0 frame-accuracy test (T0.1 + T0.4).
// The test clip carries its frame number as a 12-bit barcode (plus an inverted check row).
// We read it off the picture and compare it with the frame the player reports.
import Hls from "hls.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import { BUNNY_CDN_HOST } from "../config";

const FD = 1001 / 24000; // one frame at 23.976, in seconds
const TOTAL = 480; // frames in the test clip
const BITS = 12, BW = 120, BH = 90, X0 = 240, YA = 60, YB = 170; // barcode layout, 1920x1080 space

const $ = (id: string) => document.getElementById(id)!;
const v = $("v") as HTMLVideoElement;
const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

const cv = document.createElement("canvas");
cv.width = 960;
cv.height = 540;
const ctx = cv.getContext("2d", { willReadFrequently: true })!;

let offset = 0; // seconds between the stream's clock and frame 0 of the clip
let pixelsBlocked = false;
const frameOf = (t: number) => Math.round((t - offset) / FD);
const timeOf = (n: number) => offset + (n + 0.5) * FD;
const tc = (n: number | null) => {
  if (n == null || n < 0) return "—";
  const f = n % 24, s = Math.floor(n / 24) % 60, m = Math.floor(n / 1440) % 60, h = 1 + Math.floor(n / 86400);
  return [h, m, s, f].map((x) => String(x).padStart(2, "0")).join(":");
};
const pad = (n: number | null | undefined) => (n == null ? "----" : String(n).padStart(4, "0"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- source ----------
const params = new URLSearchParams(location.search);
const cdnHost = BUNNY_CDN_HOST;
let source = (document.getElementById("clip") as HTMLSelectElement).value;
let engine = "file";
let hls: Hls | null = null;
if (params.get("bunny")) {
  const guid = params.get("bunny")!.replace(/[^a-zA-Z0-9-]/g, "");
  const host = params.get("host") || cdnHost;
  const mp4 = params.get("mp4");
  source = mp4 ? `https://${host}/${guid}/play_${mp4.replace(/\D/g, "")}p.mp4` : `https://${host}/${guid}/playlist.m3u8`;
} else if (params.get("src")) {
  source = params.get("src")!;
}
const remote = /^https?:/.test(source);
if (remote) {
  const sel = $("clip") as HTMLSelectElement;
  sel.innerHTML = "";
  const o = document.createElement("option");
  o.textContent = params.get("bunny") ? `Bunny · ${params.get("mp4") ? params.get("mp4") + "p MP4" : "stream"}` : "Custom link";
  sel.appendChild(o);
  sel.disabled = true;
}

function load(src: string) {
  if (hls) { hls.destroy(); hls = null; }
  offset = 0;
  lastMedia = null;
  if (remote) v.crossOrigin = "anonymous";
  const isHls = /\.m3u8(\?|$)/.test(src);
  if (isHls && v.canPlayType("application/vnd.apple.mpegurl")) {
    engine = "native HLS";
    v.src = src;
  } else if (isHls && Hls.isSupported()) {
    engine = "hls.js";
    hls = new Hls({ capLevelToPlayerSize: false, startLevel: -1 });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (hls) hls.currentLevel = hls.levels.length - 1; });
    hls.loadSource(src);
    hls.attachMedia(v);
  } else {
    engine = isHls ? "unsupported" : "file";
    v.src = src;
  }
  $("src").textContent = `Source: ${src} · Player: ${engine}`;
}

// ---------- reading the barcode ----------
function decode(): number | null {
  try {
    ctx.drawImage(v, 0, 0, 960, 540);
    const band = ctx.getImageData(0, 0, 960, 132).data;
    const lum = (x: number, y: number) => {
      let s = 0, c = 0;
      for (let dy = -4; dy < 4; dy++)
        for (let dx = -4; dx < 4; dx++) {
          const i = ((y + dy) * 960 + (x + dx)) * 4;
          s += 0.299 * band[i] + 0.587 * band[i + 1] + 0.114 * band[i + 2];
          c++;
        }
      return s / c;
    };
    let val = 0;
    for (let b = 0; b < BITS; b++) {
      const cx = Math.round((X0 + b * BW + BW / 2) / 2);
      const a = lum(cx, Math.round((YA + BH / 2) / 2)) > 128;
      const z = lum(cx, Math.round((YB + BH / 2) / 2)) > 128;
      if (a === z) return null;
      val = (val << 1) | (a ? 1 : 0);
    }
    return val;
  } catch (e) {
    if ((e as Error).name === "SecurityError") pixelsBlocked = true;
    return null;
  }
}

// ---------- live readout ----------
let lastMedia: number | null = null;
function updateReadout() {
  const rep = lastMedia == null ? null : frameOf(lastMedia);
  $("rep").textContent = pad(rep);
  $("tc").textContent = tc(rep);
  if (v.paused) $("shown").textContent = pixelsBlocked ? "BLOCKED" : pad(decode());
}
if (hasRVFC) {
  const tick = (_n: number, md: VideoFrameCallbackMetadata) => { lastMedia = md.mediaTime; updateReadout(); v.requestVideoFrameCallback(tick); };
  v.requestVideoFrameCallback(tick);
} else {
  v.addEventListener("timeupdate", () => { lastMedia = v.currentTime; updateReadout(); });
}
v.addEventListener("seeked", () => setTimeout(updateReadout, 60));
v.addEventListener("pause", () => setTimeout(updateReadout, 120));
v.addEventListener("loadeddata", () => { if (lastMedia == null) lastMedia = v.currentTime; updateReadout(); });

function nextFrame(timeout: number): Promise<VideoFrameCallbackMetadata | null> {
  return new Promise((res) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(null); } }, timeout);
    if (hasRVFC) v.requestVideoFrameCallback((_n, md) => { if (!done) { done = true; clearTimeout(t); res(md); } });
  });
}
function once(el: EventTarget, ev: string, timeout: number) {
  return new Promise<boolean>((res) => {
    const h = () => { clearTimeout(t); el.removeEventListener(ev, h); res(true); };
    const t = setTimeout(() => { el.removeEventListener(ev, h); res(false); }, timeout);
    el.addEventListener(ev, h);
  });
}
async function seekTime(t: number) {
  const p = nextFrame(2000);
  const s = once(v, "seeked", 2000);
  v.currentTime = t;
  const md = await p;
  await s;
  if (!md) await sleep(150);
  if (md) lastMedia = md.mediaTime;
  return { md, shown: decode() };
}
// Jump to frame n, then check which frame actually landed and nudge until it's right.
// Some players (iPhone) land a frame late on a plain jump; the learned bias carries to later jumps.
let seekBias = 0; // seconds added to every jump, learned from corrections
let corrections = 0, firstTryLanded = 0, jumpsTotal = 0;
async function seekTo(n: number) {
  let t = timeOf(n) + seekBias;
  let r = await seekTime(t);
  let rep = r.md ? frameOf(r.md.mediaTime) : frameOf(v.currentTime - FD / 2);
  jumpsTotal++;
  if (rep === n) firstTryLanded++;
  for (let attempt = 0; attempt < 3 && r.md && rep !== n; attempt++) {
    corrections++;
    t -= (rep - n) * FD * 0.6;
    r = await seekTime(t);
    rep = r.md ? frameOf(r.md.mediaTime) : frameOf(v.currentTime - FD / 2);
    if (rep === n) seekBias = t - timeOf(n);
  }
  return { shown: r.shown, rep, callback: !!r.md };
}
const current = () => (lastMedia == null ? 0 : frameOf(lastMedia));
function stepBy(d: number) {
  v.pause();
  const n = Math.min(TOTAL - 1, Math.max(0, current() + d));
  seekTo(n).then(updateReadout);
}

const status = (t: string) => { $("status").textContent = t; };
window.addEventListener("error", (e) => status("Page error: " + e.message));

// iPhones load nothing until a video has played once, so play briefly first.
async function prepare(playing: Promise<void>): Promise<string | null> {
  status("Loading the video…");
  try { await playing; } catch (e) { return "The video wouldn't play on this device: " + (e as Error).message; }
  const md = await nextFrame(8000);
  v.pause();
  if (!md && v.readyState < 2) return "The video didn't load on this device.";
  await sleep(200);
  return null;
}

// Work out where frame 0 sits on this stream's clock (HLS can start the clock late).
async function calibrate() {
  offset = 0;
  const { md, shown } = await seekTime(24.5 * FD);
  if (md && shown != null) offset = md.mediaTime - shown * FD;
  return { offsetSeconds: Math.round(offset * 1e6) / 1e6, offsetFrames: Math.round((offset / FD) * 1000) / 1000, calibratedOn: shown };
}

// ---------- controls ----------
$("back").onclick = () => stepBy(-1);
$("fwd").onclick = () => stepBy(1);
$("play").onclick = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
v.addEventListener("play", () => { $("play").textContent = "Pause"; });
v.addEventListener("pause", () => { $("play").textContent = "Play"; });
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("select, input, textarea")) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); stepBy(1); }
  else if (e.key === " ") { e.preventDefault(); $("play").click(); }
});
($("clip") as HTMLSelectElement).onchange = (e) => { v.pause(); source = (e.target as HTMLSelectElement).value; load(source); };

function device() {
  const ua = navigator.userAgent;
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const dev = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || touchMac ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Other";
  const br = /CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  return { dev, br, label: `${dev} · ${br}` };
}
const D = device();
$("device").textContent = D.label + (hasRVFC ? "" : " · no exact-frame support");

// ---------- results ----------
type R = { ok: number; total: number; pass: boolean; [k: string]: unknown };
const TESTS: [string, string, string][] = [
  ["jump", "Jump to a frame", "40 random jumps: lands on the right frame and reports it"],
  ["step", "Step one frame", "10 forward, 10 back"],
  ["playback", "While playing", "Every frame shown during 8 s of playback"],
  ["pause", "Pause and note", "10 random pauses: the frame you'd leave a note on"],
  ["allFrames", "Every frame present", "All 480 frames survived conversion, none doubled or dropped"],
];
function renderRows(results: Record<string, R>, running: string | null) {
  const box = $("rows");
  box.innerHTML = "";
  for (const [key, name, sub] of TESTS) {
    const r = results[key];
    const row = document.createElement("div"); row.className = "row";
    const nm = document.createElement("div"); nm.className = "name"; nm.textContent = name;
    const sm = document.createElement("small"); sm.textContent = sub; nm.appendChild(sm);
    const ct = document.createElement("span"); ct.className = "count"; ct.textContent = r ? `${r.ok}/${r.total}` : "";
    const ch = document.createElement("span");
    ch.className = "chip " + (r ? (r.pass ? "pass" : "fail") : running === key ? "run" : "");
    ch.textContent = r ? (r.pass ? "PASS" : "FAIL") : running === key ? "RUNNING" : "WAITING";
    row.append(nm, ct, ch); box.appendChild(row);
  }
}
renderRows({}, null);
const setProg = (f: number) => { ($("prog") as HTMLElement).style.width = Math.round(f * 100) + "%"; };
function randFrames(k: number, lo: number, hi: number) {
  const out: number[] = []; let prev = -1;
  while (out.length < k) { const n = lo + Math.floor(Math.random() * (hi - lo)); if (n !== prev) { out.push(n); prev = n; } }
  return out;
}

async function run() {
  const playing = v.play(); // start inside the tap, before any await (iPhone rule)
  ($("run") as HTMLButtonElement).disabled = true;
  $("saved").textContent = "";
  ($("detail") as HTMLElement).hidden = true;
  const prepError = await prepare(playing);
  seekBias = 0; corrections = 0; firstTryLanded = 0; jumpsTotal = 0;
  const results: Record<string, R> = {};
  const misses: Record<string, unknown>[] = [];
  const totalSteps = 1 + 40 + 20 + 1 + 10 + TOTAL;
  let done = 0;
  const tickProg = () => setProg(++done / totalSteps);

  const stopEarly = async (why: string) => {
    $("verdict").textContent = "Fail: " + why;
    $("verdict").className = "verdict fail";
    status("");
    ($("run") as HTMLButtonElement).disabled = false;
    $("run").textContent = "Run again";
    await save({ label: D.label, device: D.dev, browser: D.br, source, engine, pass: false, userAgent: navigator.userAgent,
      results: { stoppedEarly: why, pixelsBlocked, exactFrameSupport: hasRVFC, readyState: v.readyState, videoSize: `${v.videoWidth}x${v.videoHeight}` }, misses: [] });
  };
  if (prepError) return stopEarly(prepError);
  status("Finding frame 0 on this stream…");
  let cal = await calibrate();
  for (let i = 0; i < 3 && cal.calibratedOn == null && !pixelsBlocked; i++) { await sleep(400); cal = await calibrate(); }
  tickProg();
  if (pixelsBlocked) return stopEarly("the browser shows the video but won't let the page read its pixels (CORS)");
  if (cal.calibratedOn == null) return stopEarly("the page couldn't read a frame after jumping (the picture never appeared)");

  // 1. Jumps
  renderRows(results, "jump");
  let land = 0, repOk = 0;
  const jumps = randFrames(40, 0, TOTAL);
  for (const [i, n] of jumps.entries()) {
    status(`Jumping: ${i + 1} of 40`);
    const r = await seekTo(n);
    if (r.shown === n) land++;
    if (r.shown === r.rep) repOk++;
    if (r.shown !== n || r.shown !== r.rep) misses.push({ test: "jump", asked: n, shown: r.shown, reported: r.rep });
    tickProg();
  }
  results.jump = { ok: Math.min(land, repOk), total: 40, landed: land, reported: repOk, pass: land === 40 && repOk === 40 };

  // 2. Steps
  renderRows(results, "step");
  let sOk = 0, n = 120 + Math.floor(Math.random() * 200);
  await seekTo(n);
  for (let i = 0; i < 20; i++) {
    status(`Stepping: ${i + 1} of 20`);
    n += i < 10 ? 1 : -1;
    const r = await seekTo(n);
    if (r.shown === n && r.rep === n) sOk++; else misses.push({ test: "step", asked: n, shown: r.shown, reported: r.rep });
    tickProg();
  }
  results.step = { ok: sOk, total: 20, pass: sOk === 20 };

  // 3. Playback
  renderRows(results, "playback");
  status("Playing for 8 seconds…");
  await seekTo(10);
  const pb = await new Promise<{ checked: number; bad: { shown: number | null; reported: number }[]; gaps: number; error?: string }>(async (resolve) => {
    if (!hasRVFC) return resolve({ checked: 0, bad: [], gaps: 0, error: "no frame callbacks" });
    let checked = 0, gaps = 0, lastPF: number | null = null;
    const bad: { shown: number | null; reported: number }[] = [];
    const end = performance.now() + 8000;
    const cb = (_now: number, md: VideoFrameCallbackMetadata) => {
      const shown = decode(), r = frameOf(md.mediaTime);
      checked++;
      if (shown !== r) bad.push({ shown, reported: r });
      if (lastPF !== null && md.presentedFrames - lastPF > 1) gaps += md.presentedFrames - lastPF - 1;
      lastPF = md.presentedFrames;
      if (performance.now() < end && !v.ended) v.requestVideoFrameCallback(cb);
      else { v.pause(); resolve({ checked, bad, gaps }); }
    };
    v.requestVideoFrameCallback(cb);
    try { await v.play(); } catch (e) { resolve({ checked: 0, bad: [], gaps: 0, error: "Playback was blocked: " + (e as Error).message }); }
  });
  await sleep(200);
  for (const b of pb.bad.slice(0, 15)) misses.push({ test: "playback", shown: b.shown, reported: b.reported });
  results.playback = { ok: pb.checked - pb.bad.length, total: pb.checked, skippedFrames: pb.gaps, error: pb.error ?? null, pass: !pb.error && pb.checked > 50 && pb.bad.length === 0 };
  tickProg();

  // 4. Pause and note
  renderRows(results, "pause");
  let pOk = 0, ctOk = 0;
  for (let i = 0; i < 10; i++) {
    status(`Pausing: ${i + 1} of 10`);
    await seekTo(20 + Math.floor(Math.random() * 280));
    try { await v.play(); } catch { /* ignore */ }
    await sleep(400 + Math.random() * 1100);
    v.pause();
    await sleep(300);
    const shown = decode();
    const repR = lastMedia == null ? null : frameOf(lastMedia);
    const repCT = Math.floor((v.currentTime - offset) / FD + 1e-6);
    if (shown === repR) pOk++; else misses.push({ test: "pause", shown, reported: repR, fromCurrentTime: repCT });
    if (shown === repCT) ctOk++;
    tickProg();
  }
  results.pause = { ok: pOk, total: 10, currentTimeMethodOk: ctOk, pass: pOk === 10 };

  // 5. Every frame present (step through the whole clip)
  renderRows(results, "allFrames");
  let fOk = 0;
  const missing: number[] = [];
  for (let k = 0; k < TOTAL; k++) {
    if (k % 10 === 0) status(`Checking every frame: ${k} of ${TOTAL}`);
    const r = await seekTo(k);
    if (r.shown === k) fOk++; else { missing.push(k); if (missing.length <= 10) misses.push({ test: "allFrames", asked: k, shown: r.shown, reported: r.rep }); }
    tickProg();
  }
  results.allFrames = { ok: fOk, total: TOTAL, firstMisses: missing.slice(0, 20), pass: fOk === TOTAL };

  renderRows(results, null);
  setProg(1);
  status("");
  const pass = Object.values(results).every((r) => r.pass) && !pixelsBlocked;
  $("verdict").textContent = pass ? "Pass: frames are exact on this device" : pixelsBlocked ? "Fail: pixels blocked (CORS)" : "Fail: see the details below";
  $("verdict").className = "verdict " + (pass ? "pass" : "fail");
  if (misses.length) {
    const d = $("detail");
    d.hidden = false;
    d.textContent = misses.slice(0, 20).map((m: any) => `${String(m.test).padEnd(9)} asked ${pad(m.asked)}  picture ${pad(m.shown)}  player ${pad(m.reported)}`).join("\n");
  }
  ($("run") as HTMLButtonElement).disabled = false;
  $("run").textContent = "Run again";

  await save({
    label: D.label, device: D.dev, browser: D.br, source, engine, pass, userAgent: navigator.userAgent,
    results: { ...results, calibration: cal, pixelsBlocked, exactFrameSupport: hasRVFC, videoSize: `${v.videoWidth}x${v.videoHeight}`,
      seeking: { jumps: jumpsTotal, firstTryLanded, corrections, learnedBiasFrames: Math.round((seekBias / FD) * 100) / 100 } },
    misses: misses.slice(0, 30),
  });
}
$("run").onclick = () => run().catch((e) => { $("verdict").textContent = "The test stopped: " + (e as Error).message; $("verdict").className = "verdict fail"; ($("run") as HTMLButtonElement).disabled = false; });

// ---------- saving ----------
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = convexUrl ? new ConvexHttpClient(convexUrl) : null;
async function save(rec: FunctionArgs<typeof api.phase0.saveRun>) {
  if (!client) { $("saved").textContent = "Not saved (no backend yet). Tell Claude the verdict and counts above."; return; }
  try { await client.mutation(api.phase0.saveRun, rec); $("saved").textContent = "Saved. Claude can read this run."; refreshRuns(); }
  catch (e) { $("saved").textContent = "Couldn't save this run: " + (e as Error).message; }
}
async function refreshRuns() {
  if (!client) return;
  try {
    const runs = await client.query(api.phase0.listRuns, {});
    const box = $("runs");
    if (!runs.length) return;
    box.innerHTML = "";
    for (const r of runs) {
      const row = document.createElement("div"); row.className = "row";
      const nm = document.createElement("div"); nm.className = "name";
      const src = r.source.includes("playlist.m3u8") ? "Bunny stream" : r.source.includes("play_") ? "Bunny MP4" : r.source.includes("hevc") ? "H.265 file" : "H.264 file";
      nm.textContent = `${r.label} · ${src}`;
      const res = r.results as Record<string, R>;
      const sm = document.createElement("small");
      sm.textContent = `${new Date(r.createdAt).toLocaleString()} · ${["jump", "step", "playback", "pause", "allFrames"].map((k) => (res[k] ? `${k} ${res[k].ok}/${res[k].total}` : "")).filter(Boolean).join(" · ")}`;
      nm.appendChild(sm);
      const ch = document.createElement("span"); ch.className = "chip " + (r.pass ? "pass" : "fail"); ch.textContent = r.pass ? "PASS" : "FAIL";
      row.append(nm, ch); box.appendChild(row);
    }
  } catch { /* backend not ready */ }
}

load(source);
refreshRuns();
