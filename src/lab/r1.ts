// Phase R1 (Oct 22): how each candidate review export behaves when played straight from the CDN.
// The link carries the CDN folder in its hash (#k=<folder>&h=<host>), so nothing about the test files is in the page.
const FPS = 24;
const FD = 1 / FPS;
const TOTAL = 5699; // frames in 4M_LC_AZ_Story_v11
const FILES = [
  { id: "A", label: "A · H.264 10 Mbps · key 12", file: "R1_A_h264_10M_k12.mp4" },
  { id: "B", label: "B · H.264 16 Mbps · key 12", file: "R1_B_h264_16M_k12.mp4" },
  { id: "C", label: "C · H.264 24 Mbps · key 24", file: "R1_C_h264_24M_k24.mp4" },
  { id: "D", label: "D · H.265 10-bit 8 Mbps · key 24", file: "R1_D_h265_10bit_8M_k24.mp4" },
];

const $ = (id: string) => document.getElementById(id)!;
const v = $("v") as HTMLVideoElement;
const hash = new URLSearchParams(location.hash.slice(1));
const folder = (hash.get("k") ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
const host = (hash.get("h") ?? "").replace(/[^a-zA-Z0-9.-]/g, "");
const urlOf = (f: string) => `https://${host}/r1-test/${folder}/${f}`;
const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frameOf = (t: number) => Math.round(t * FPS);
const tc = (n: number) => [1 + Math.floor(n / 86400), Math.floor(n / 1440) % 60, Math.floor(n / 24) % 60, n % 24].map((x) => String(x).padStart(2, "0")).join(":");

type Row = { id: string; run: number; load: number; jumpMed: number; jump90: number; jumpMax: number; exact: number; jumps: number; misses: number[]; step: number; dropped: number; frames: number; stalls: number; errors: string[] };
const results: Row[] = [];
const runs: Record<string, number> = {};
let busy = false;
let errors: string[] = [];
let stalls = 0;

$("device").textContent = `${navigator.userAgent.match(/(iPhone|iPad|Macintosh|Windows|Android)[^;)]*/)?.[0] ?? "?"} · ${navigator.userAgent.match(/(Chrome|CriOS|Firefox|FxiOS|Version)\/[\d.]+/)?.[0]?.replace("Version", "Safari") ?? ""} · ${hasRVFC ? "frame callback" : "no frame callback"}`;
const pick = $("pick") as HTMLSelectElement;
for (const f of FILES) {
  const o = document.createElement("option");
  o.value = f.id; o.textContent = f.label; pick.appendChild(o);
}
if (!folder || !host) $("status").textContent = "This link is missing its test folder. Use the link from Claude.";

v.addEventListener("waiting", () => { stalls++; });
v.addEventListener("error", () => { errors.push(`${v.error?.code}: ${(v.error?.message ?? "").slice(0, 80)}`); });

let shown = -1;
function watch() {
  if (!hasRVFC) return;
  const tick = (_n: number, md: VideoFrameCallbackMetadata) => { shown = frameOf(md.mediaTime); readout(); v.requestVideoFrameCallback(tick); };
  v.requestVideoFrameCallback(tick);
}
function readout() {
  const f = hasRVFC ? shown : frameOf(v.currentTime);
  $("frame").textContent = f >= 0 ? String(f).padStart(4, "0") : "—";
  $("tc").textContent = f >= 0 ? tc(f) : "—";
}
v.addEventListener("seeked", () => { if (!hasRVFC) readout(); });

function nextFrame(timeout = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeout);
    if (hasRVFC) {
      v.requestVideoFrameCallback((_n, md) => { if (!done) { done = true; clearTimeout(t); resolve(frameOf(md.mediaTime)); } });
    } else {
      v.addEventListener("seeked", () => { if (!done) { done = true; clearTimeout(t); resolve(frameOf(v.currentTime)); } }, { once: true });
    }
  });
}

async function seekTo(f: number): Promise<{ ms: number; landed: number | null }> {
  const t0 = performance.now();
  const p = nextFrame();
  v.currentTime = (f + 0.5) * FD;
  const landed = await p;
  return { ms: performance.now() - t0, landed };
}

function load(id: string): Promise<number> {
  const f = FILES.find((x) => x.id === id)!;
  errors = []; stalls = 0;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ok = () => { cleanup(); resolve(performance.now() - t0); };
    const bad = () => { cleanup(); resolve(-1); };
    const cleanup = () => { v.removeEventListener("loadeddata", ok); v.removeEventListener("error", bad); };
    v.addEventListener("loadeddata", ok, { once: true });
    v.addEventListener("error", bad, { once: true });
    v.src = urlOf(f.file);
    v.load();
    watch();
  });
}

// Same "random" frames for every file, so the comparison is fair.
function targets(n: number) {
  let s = 20261022;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; out.push(Math.floor((s / 2147483648) * (TOTAL - 30))); }
  return out;
}
const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : 0; };
const prog = (x: number) => { ($("prog") as HTMLElement).style.width = `${Math.round(x * 100)}%`; };

async function run(id: string) {
  const status = $("status");
  pick.value = id;
  status.textContent = `${id}: loading…`; prog(0);
  v.pause();
  const loadMs = await load(id);
  const row: Row = { id, run: (runs[id] = (runs[id] ?? 0) + 1), load: Math.round(loadMs), jumpMed: 0, jump90: 0, jumpMax: 0, exact: 0, jumps: 0, misses: [], step: 0, dropped: 0, frames: 0, stalls: 0, errors: [] };
  if (loadMs < 0) { row.errors = errors.slice(); results.push(row); render(); status.textContent = `${id}: couldn't load.`; return; }
  const T = targets(25);
  const ms: number[] = [];
  for (let i = 0; i < T.length; i++) {
    status.textContent = `${id}: jump ${i + 1} of ${T.length}`; prog((i + 1) / 45);
    const r = await seekTo(T[i]);
    ms.push(r.ms);
    $("last").textContent = `${Math.round(r.ms)} ms`;
    if (r.landed === T[i]) row.exact++; else row.misses.push(T[i]);
    row.jumps++;
  }
  row.jumpMed = Math.round(pct(ms, 0.5)); row.jump90 = Math.round(pct(ms, 0.9)); row.jumpMax = Math.round(Math.max(...ms));
  // frame steps from the middle
  const sms: number[] = [];
  let f = Math.floor(TOTAL / 2);
  await seekTo(f);
  for (let i = 0; i < 12; i++) {
    status.textContent = `${id}: step ${i + 1} of 12`; prog((26 + i) / 45);
    f++;
    const r = await seekTo(f);
    sms.push(r.ms);
    if (r.landed !== f) row.misses.push(f);
  }
  row.step = Math.round(pct(sms, 0.5));
  // play 15 s from a third of the way in
  status.textContent = `${id}: playing 15 s`; prog(40 / 45);
  await seekTo(Math.floor(TOTAL / 3));
  const q0 = v.getVideoPlaybackQuality?.();
  const s0 = stalls;
  try { await v.play(); } catch (e) { errors.push(`play: ${String(e).slice(0, 60)}`); }
  await sleep(15000);
  v.pause();
  const q1 = v.getVideoPlaybackQuality?.();
  if (q0 && q1) { row.dropped = q1.droppedVideoFrames - q0.droppedVideoFrames; row.frames = q1.totalVideoFrames - q0.totalVideoFrames; }
  row.stalls = stalls - s0;
  row.errors = errors.slice();
  results.push(row);
  render();
  prog(1);
  status.textContent = `${id}: done.`;
}

function render() {
  const tb = ($("tbl") as HTMLTableElement).tBodies[0];
  tb.innerHTML = "";
  for (const r of results) {
    const tr = document.createElement("tr");
    const cells: [string, string?][] = [
      [r.id], [String(r.run)], [r.load < 0 ? "fail" : String(r.load), r.load < 0 ? "bad" : undefined],
      [String(r.jumpMed)], [String(r.jump90)],
      [`${r.exact}/${r.jumps}`, r.exact === r.jumps && r.misses.length === 0 ? "good" : "bad"],
      [String(r.step)], [`${r.dropped}/${r.frames}`, r.dropped > 2 ? "bad" : undefined], [String(r.stalls), r.stalls > 0 ? "bad" : undefined],
      [r.errors.length ? String(r.errors.length) : "0", r.errors.length ? "bad" : "good"],
    ];
    for (const [t, cls] of cells) { const td = document.createElement("td"); td.textContent = t; if (cls) td.className = cls; tr.appendChild(td); }
    tb.appendChild(tr);
  }
  (window as any).__r1 = { device: $("device").textContent, results };
}

async function guard(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  for (const b of ["run", "all"]) ($(b) as HTMLButtonElement).disabled = true;
  try { await fn(); } finally {
    busy = false;
    for (const b of ["run", "all"]) ($(b) as HTMLButtonElement).disabled = false;
  }
}
$("run").addEventListener("click", () => guard(() => run(pick.value)));
$("all").addEventListener("click", () => guard(async () => { for (const f of FILES) await run(f.id); }));
pick.addEventListener("change", () => { if (!busy) load(pick.value); });
$("fwd").addEventListener("click", () => { if (!busy) { v.pause(); seekTo(frameOf(v.currentTime) + 1); } });
$("back").addEventListener("click", () => { if (!busy) { v.pause(); seekTo(Math.max(0, frameOf(v.currentTime) - 1)); } });
$("play").addEventListener("click", () => { if (busy) return; if (v.paused) v.play(); else v.pause(); });
v.addEventListener("play", () => { $("play").textContent = "Pause"; });
v.addEventListener("pause", () => { $("play").textContent = "Play"; });
$("copy").addEventListener("click", async () => {
  const text = JSON.stringify((window as any).__r1 ?? {}, null, 1);
  try { await navigator.clipboard.writeText(text); $("copied").textContent = "Copied."; } catch { $("copied").textContent = "Couldn't copy."; }
});
if (folder && host) load(pick.value);
