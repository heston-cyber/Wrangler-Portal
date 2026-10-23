// Phone jump test (Oct 22, R3): why jumping around a review render is slow or lands wrong on Heston's iPhone, when the
// R1 test page jumped fine on the same phone. Tries the same file four ways, one after another:
//   A  like the R1 page: muted, no CORS
//   B  muted, with CORS (the site needs CORS to grab note stills from the picture)
//   C  sound on, with CORS (the site before Oct 22)
//   D  muted, with CORS, while the 360p scrub copy downloads (the site today)
// Results are saved to the Phase 0 test log, where Claude reads them.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const q = new URLSearchParams(location.search);
const SRC = q.get("src") || "https://wrangler-review-stills.b-cdn.net/review/kn74vazj0ds7ftgwzhwg9b0wm18gr1d6/d4fd1a337e0c1a27/99999_R3Test_v3.mp4";
const SCRUB = q.get("scrub") || "https://vz-4b204d4f-b14.b-cdn.net/8d807551-e271-45f3-9038-628782d2967a/play_360p.mp4";
const FD = 1001 / 24000;
const TOTAL = Number(q.get("frames") || 12960);
const TARGETS = Array.from({ length: 12 }, (_, i) => Math.floor(((i * 7919) % 97) / 97 * (TOTAL - 50)) + 10);

type Way = { id: string; label: string; muted: boolean; cors: boolean; download: boolean };
const WAYS: Way[] = [
  { id: "A", label: "Muted, no CORS (R1 page)", muted: true, cors: false, download: false },
  { id: "B", label: "Muted, CORS", muted: true, cors: true, download: false },
  { id: "C", label: "Sound on, CORS (site before)", muted: false, cors: true, download: false },
  { id: "D", label: "Muted, CORS, scrub copy downloading (site now)", muted: true, cors: true, download: true },
];

const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (s: string) => { $("status").textContent = s; };
const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

function once(el: EventTarget, ev: string, ms: number) {
  return new Promise<boolean>((res) => {
    const h = () => { clearTimeout(t); res(true); };
    const t = setTimeout(() => { el.removeEventListener(ev, h); res(false); }, ms);
    el.addEventListener(ev, h, { once: true });
  });
}
function frame(v: HTMLVideoElement, ms: number) {
  return new Promise<number | null>((res) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
    if (hasRVFC) v.requestVideoFrameCallback((_n, md) => { if (!done) { done = true; clearTimeout(t); res(Math.round(md.mediaTime / FD)); } });
  });
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function tryWay(w: Way) {
  const box = $("screen");
  box.innerHTML = "";
  const v = document.createElement("video");
  v.playsInline = true; v.preload = "auto"; v.muted = w.muted;
  if (!w.muted) v.removeAttribute("muted");
  if (w.cors) v.crossOrigin = "anonymous";
  box.appendChild(v);
  const out: Record<string, unknown> = { way: w.id };
  let dl: Promise<unknown> | null = null;
  const ac = new AbortController();
  if (w.download) { const t0 = performance.now(); dl = fetch(SCRUB, { signal: ac.signal }).then((r) => r.blob()).then((b) => { out.downloadMs = Math.round(performance.now() - t0); out.downloadMb = Math.round(b.size / 1e5) / 10; }).catch((e) => { out.downloadError = String(e).slice(0, 80); }); }
  const t0 = performance.now();
  v.src = SRC;
  v.load();
  const meta = await once(v, "loadedmetadata", 20000);
  out.metaMs = meta ? Math.round(performance.now() - t0) : null;
  if (!meta) { out.error = v.error ? `error ${v.error.code}` : "no metadata in 20 s"; out.readyState = v.readyState; ac.abort(); return out; }
  const f0 = performance.now();
  const p0 = frame(v, 10000);
  v.currentTime = 0.5 * FD;
  out.firstFrame = await p0;
  out.firstFrameMs = Math.round(performance.now() - f0);
  const ms: number[] = [], misses: Array<[number, number | null]> = [];
  let timeouts = 0;
  for (const [i, n] of TARGETS.entries()) {
    status(`${w.id}: jump ${i + 1} of ${TARGETS.length}…`);
    const s0 = performance.now();
    const ok = once(v, "seeked", 10000);
    v.currentTime = (n + 0.5) * FD;
    const seeked = await ok;
    const landed = await frame(v, 1500);
    const t = Math.round(performance.now() - s0);
    ms.push(t);
    if (!seeked) timeouts++;
    if (landed !== n) misses.push([n, landed]);
    await sleep(150);
  }
  out.jumpMed = med(ms); out.jumpMax = Math.max(...ms); out.exact = TARGETS.length - misses.length; out.jumps = TARGETS.length; out.timeouts = timeouts;
  out.misses = misses.slice(0, 6); out.error = v.error ? `error ${v.error.code}` : null;
  if (dl) { await Promise.race([dl, sleep(15000)]); }
  ac.abort();
  v.removeAttribute("src"); v.load();
  return out;
}

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = convexUrl ? new ConvexHttpClient(convexUrl) : null;

$("run").onclick = async () => {
  ($("run") as HTMLButtonElement).disabled = true;
  $("rows").innerHTML = "";
  const all: Record<string, unknown>[] = [];
  for (const w of WAYS) {
    const r = await tryWay(w);
    all.push(r);
    const tr = document.createElement("tr");
    const good = r.exact === r.jumps && (r.jumpMed as number) < 1500;
    tr.innerHTML = `<td>${w.id} · ${w.label}</td><td>${r.metaMs ?? "—"} ms</td><td class="${good ? "good" : "bad"}">${r.jumpMed ?? "—"} / ${r.jumpMax ?? "—"} ms</td><td>${r.exact ?? 0}/${r.jumps ?? 0}</td><td>${[r.error, r.timeouts ? `${r.timeouts} timed out` : "", r.downloadMs ? `copy ${r.downloadMb} MB in ${r.downloadMs} ms` : ""].filter(Boolean).join(" · ")}</td>`;
    $("rows").appendChild(tr);
  }
  status("Done.");
  if (client) {
    try {
      const ua = navigator.userAgent;
      await client.mutation(api.phase0.saveRun, { label: "Phone jump test (R3)", device: /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "Computer", browser: /CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Other", source: SRC, engine: "ab", pass: all.every((r) => r.exact === r.jumps), userAgent: ua, results: { ways: all }, misses: [] });
      $("saved").textContent = "Saved. Claude can read this run.";
    } catch (e) { $("saved").textContent = "Couldn't save: " + (e as Error).message; }
  }
  ($("run") as HTMLButtonElement).disabled = false;
};
