// C8 (Oct 26): the preview picture for a version — the first frame that isn't black, with the Wrangler wordmark in
// the corner — made once in Heston's browser, uploaded as a still, remembered on the version (library.setPoster).
// It becomes the link preview, the player's poster and the thumbnail in lists.
//
// A hidden <video> plays the smallest exact copy available (a 1080p MP4 for stream versions; the 360p scrub copy or
// the render itself for file versions), seeks through a few early moments and measures each frame's brightness.
// 1200×630 (what chat apps show), the frame fitted inside on black, wordmark bottom-left.
import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { asset } from "../config";
const wordmark = asset("/brand/wordmark-cream.png");

const W = 1200, H = 630;
const TRY_AT = [0.5, 1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 45, 60];

type Source = { url: string; type: "mp4" };

export type PosterInput = { source: string; media: { mp4: Record<number, string>; file: string | null; scrub: { mp4: string } | null } };
function pickSource(v: PosterInput): Source | null {
  if (v.source === "file") {
    if (v.media.scrub?.mp4) return { url: v.media.scrub.mp4, type: "mp4" };
    return v.media.file ? { url: v.media.file, type: "mp4" } : null;
  }
  const heights = Object.keys(v.media.mp4).map(Number).sort((a, b) => a - b);
  const h = heights.find((x) => x >= 720) ?? heights[heights.length - 1];
  const u = h ? v.media.mp4[h] : null;
  return u ? { url: u, type: "mp4" } : null;
}

const seekTo = (video: HTMLVideoElement, t: number) => new Promise<void>((res, rej) => {
  const done = () => { video.removeEventListener("seeked", done); video.removeEventListener("error", fail); res(); };
  const fail = () => { video.removeEventListener("seeked", done); video.removeEventListener("error", fail); rej(new Error("seek failed")); };
  video.addEventListener("seeked", done);
  video.addEventListener("error", fail);
  video.currentTime = Math.min(t, Math.max(0, (video.duration || t + 1) - 0.1));
});

// Mean brightness and spread of a frame, from a small sample. Black leaders and flat slates score low.
function measure(video: HTMLVideoElement): { mean: number; spread: number } {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 36;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, 64, 36);
  const d = ctx.getImageData(0, 0, 64, 36).data;
  let sum = 0, sq = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; sq += l * l; }
  const mean = sum / n;
  return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("wordmark")); im.src = src; });
}

/** Makes and uploads the poster; returns its URL, or null when the browser couldn't (codec, CORS, no source). */
export async function makePoster(convex: ConvexReactClient, versionId: Id<"versions">, v: PosterInput): Promise<string | null> {
  const src = pickSource(v);
  if (!src) return null;
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src.url;
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("metadata timeout")), 20_000);
      video.addEventListener("loadedmetadata", () => { clearTimeout(t); res(); }, { once: true });
      video.addEventListener("error", () => { clearTimeout(t); rej(new Error("load error")); }, { once: true });
    });
    const dur = video.duration || 0;
    let best: { t: number; score: number } | null = null;
    for (const t of TRY_AT) {
      if (dur && t > dur - 0.2) break;
      await seekTo(video, t);
      await new Promise((r) => setTimeout(r, 40)); // let the frame paint
      const m = measure(video);
      const score = m.mean + m.spread * 2;
      if (m.mean > 18 && m.spread > 8) { best = { t, score }; break; } // first frame with a real picture in it
      if (!best || score > best.score) best = { t, score };
    }
    // Nothing early had a picture: try the middle before settling for the brightest early frame.
    if (best && best.score < 30 && dur > 2) {
      await seekTo(video, dur / 2);
      await new Promise((r) => setTimeout(r, 40));
      const m = measure(video);
      if (m.mean + m.spread * 2 > best.score) best = { t: dur / 2, score: m.mean + m.spread * 2 };
    }
    if (best) await seekTo(video, best.t);
    await new Promise((r) => setTimeout(r, 40));

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#030104";
    ctx.fillRect(0, 0, W, H);
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const s = Math.min(W / vw, H / vh);
    const dw = Math.round(vw * s), dh = Math.round(vh * s);
    ctx.drawImage(video, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
    // A soft scrim behind the wordmark so it reads on anything.
    const g = ctx.createLinearGradient(0, H - 190, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.72)");
    ctx.fillStyle = g; ctx.fillRect(0, H - 190, W, 190);
    try {
      const wm = await loadImage(wordmark);
      const ww = 260, wh = Math.round(ww * (wm.naturalHeight / wm.naturalWidth));
      ctx.drawImage(wm, 48, H - wh - 40, ww, wh);
    } catch { /* no wordmark: the frame alone */ }
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.86));
    const dataBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
    const url = await convex.action(api.stills.upload, { dataBase64, contentType: "image/jpeg" });
    await convex.mutation(api.library.setPoster, { versionId, url });
    return url;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
