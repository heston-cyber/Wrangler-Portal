// Reads the exact number of video frames from an MP4 without downloading the whole file:
// finds the 'moov' box with a few range reads, then counts samples in the video track.
// The browser's duration includes audio that can run past the last picture, so it can't be trusted for this.

export type RangeRead = (start: number, end: number) => Promise<Uint8Array>; // end inclusive

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

type Box = { type: string; start: number; body: number; end: number };

// Child boxes inside buf[from, to).
function children(buf: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(buf, o);
    let body = o + 8;
    if (size === 1) { size = u64(buf, o + 8); body = o + 16; } else if (size === 0) size = to - o;
    if (size < 8 || o + size > to) break;
    out.push({ type: type(buf, o + 4), start: o, body, end: o + size });
    o += size;
  }
  return out;
}

const child = (buf: Uint8Array, box: Box, t: string) => children(buf, box.body, box.end).find((c) => c.type === t);

// Video frame count from a complete 'moov' box (buf holds just that box).
export function frameCountFromMoov(moov: Uint8Array): number | null {
  const top = children(moov, 0, moov.length)[0];
  if (!top || top.type !== "moov") return null;
  for (const trak of children(moov, top.body, top.end).filter((c) => c.type === "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = mdia && child(moov, mdia, "hdlr");
    // hdlr: version/flags(4) pre_defined(4) handler_type(4)
    if (!mdia || !hdlr || type(moov, hdlr.body + 8) !== "vide") continue;
    const minf = child(moov, mdia, "minf");
    const stbl = minf && child(moov, minf, "stbl");
    if (!stbl) return null;
    // stsz: version/flags(4) sample_size(4) sample_count(4)
    const stsz = child(moov, stbl, "stsz") ?? child(moov, stbl, "stz2");
    if (stsz) {
      const n = u32(moov, stsz.body + 8);
      if (n > 0) return n;
    }
    // stts: version/flags(4) entry_count(4) then (sample_count, sample_delta) pairs
    const stts = child(moov, stbl, "stts");
    if (stts) {
      const entries = u32(moov, stts.body + 4);
      let n = 0;
      for (let i = 0; i < entries; i++) n += u32(moov, stts.body + 8 + i * 8);
      if (n > 0) return n;
    }
    return null; // fragmented MP4: samples live in 'moof' boxes
  }
  return null;
}

// Walks top-level boxes with small range reads until it finds 'moov' (start or end of file) and returns that whole box.
export async function readMoov(read: RangeRead, maxMoovBytes = 64_000_000): Promise<Uint8Array | null> {
  let o = 0;
  for (let i = 0; i < 64; i++) {
    const h = await read(o, o + 15);
    if (h.length < 8) return null;
    let size = u32(h, 0);
    if (size === 1) size = u64(h, 8);
    const t = type(h, 4);
    if (t === "moov") {
      if (size < 8 || size > maxMoovBytes) return null;
      const moov = await read(o, o + size - 1);
      return moov.length < size ? null : moov;
    }
    if (size < 8) return null; // size 0 = runs to end of file, nothing after it
    o += size;
  }
  return null;
}

export async function mp4FrameCount(read: RangeRead, maxMoovBytes = 64_000_000): Promise<number | null> {
  const moov = await readMoov(read, maxMoovBytes);
  return moov ? frameCountFromMoov(moov) : null;
}

// Range reads over HTTP (server or browser). Throws on HTTP errors.
// referer: Bunny Stream libraries can be locked to the site's own address.
export function httpRangeReader(url: string, referer?: string): RangeRead {
  return async (start, end) => {
    const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
    if (referer) { headers.Referer = referer; headers.Origin = new URL(referer).origin; }
    const res = await fetch(url, { headers });
    if (res.status === 416) return new Uint8Array(0);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range sends the whole file; slice what was asked for.
    return res.status === 200 ? buf.slice(start, end + 1) : buf;
  };
}

// Is the file complete enough to import? Every top-level box must be there in full, ending exactly at the end of
// the file, and one of them must be the index ('moov'). A render that's still being written, or still uploading,
// fails this: its last box runs past the end of what's there, or there's no moov yet (Resolve writes it last).
export async function mp4HasIndex(read: RangeRead, fileSize?: number): Promise<boolean> {
  let o = 0, moov = false;
  for (let i = 0; i < 256; i++) {
    if (fileSize !== undefined && o === fileSize) return moov;
    const h = await read(o, o + 15);
    if (h.length === 0) return moov && fileSize === undefined;
    if (h.length < 8) return false;
    let size = u32(h, 0);
    if (size === 1) size = u64(h, 8);
    if (size < 8) return false; // 0 means "runs to the end": the writer never went back to fill it in
    const last = await read(o + size - 1, o + size - 1);
    if (last.length !== 1) return false;
    if (type(h, 4) === "moov") moov = true;
    o += size;
  }
  return false;
}

// ---------- Render-to-review (Phase R3, Oct 22) ----------
// Is this file a review export the site can play as it is? H.264 video, AAC (or no) sound, the index ('moov') at the
// front, a steady frame rate. Reads only the box headers and the index, a few range reads.
export type ExportCheck =
  | { ok: true; frames: number; fpsNum: number; fpsDen: number; width: number; height: number; seconds: number; audio: "aac" | "none"; bframes: boolean }
  | { ok: false; reason: string; codec?: string };

const CODEC_NAMES: Record<string, string> = {
  avc1: "H.264", avc3: "H.264", hvc1: "H.265", hev1: "H.265", apcn: "ProRes 422", apch: "ProRes 422 HQ", apcs: "ProRes 422 LT",
  apco: "ProRes 422 Proxy", ap4h: "ProRes 4444", ap4x: "ProRes 4444 XQ", av01: "AV1", vp09: "VP9", mp4v: "MPEG-4", dvh1: "Dolby Vision",
};
const KNOWN_FPS: Array<[number, number]> = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1], [60000, 1001], [60, 1], [120, 1]];

function trakInfo(moov: Uint8Array, trak: Box) {
  const mdia = child(moov, trak, "mdia");
  const hdlr = mdia && child(moov, mdia, "hdlr");
  const mdhd = mdia && child(moov, mdia, "mdhd");
  const minf = mdia && child(moov, mdia, "minf");
  const stbl = minf && child(moov, minf, "stbl");
  const stsd = stbl && child(moov, stbl, "stsd");
  if (!mdia || !hdlr || !mdhd || !stbl || !stsd) return null;
  const handler = type(moov, hdlr.body + 8);
  const v1 = moov[mdhd.body] === 1;
  const timescale = u32(moov, mdhd.body + (v1 ? 20 : 12));
  const duration = v1 ? u64(moov, mdhd.body + 24) : u32(moov, mdhd.body + 16);
  // stsd: version/flags(4) entry_count(4) then the first sample entry: size(4) type(4)
  const entry = stsd.body + 8;
  const codec = type(moov, entry + 4);
  return { handler, timescale, duration, codec, entry, stbl };
}

export function checkMoov(moov: Uint8Array): ExportCheck {
  const top = children(moov, 0, moov.length)[0];
  if (!top || top.type !== "moov") return { ok: false, reason: "No index in the file." };
  const traks = children(moov, top.body, top.end).filter((c) => c.type === "trak").map((t) => trakInfo(moov, t)).filter(Boolean) as NonNullable<ReturnType<typeof trakInfo>>[];
  const vid = traks.find((t) => t.handler === "vide");
  if (!vid) return { ok: false, reason: "No picture track." };
  if (vid.codec !== "avc1" && vid.codec !== "avc3") {
    const name = CODEC_NAMES[vid.codec] ?? vid.codec;
    return { ok: false, reason: `${name} video, not H.264.`, codec: name };
  }
  const sounds = traks.filter((t) => t.handler === "soun");
  if (sounds.some((t) => t.codec !== "mp4a")) return { ok: false, reason: `${sounds.map((t) => t.codec).join(", ")} sound, not AAC.` };
  // avc1 sample entry: size(4) type(4) reserved(6) data_ref(2) pre_defined(2) reserved(2) pre_defined(12) width(2) height(2)
  const width = (moov[vid.entry + 32] << 8) | moov[vid.entry + 33];
  const height = (moov[vid.entry + 34] << 8) | moov[vid.entry + 35];
  const stts = child(moov, vid.stbl, "stts");
  const stsz = child(moov, vid.stbl, "stsz");
  if (!stts || !stsz) return { ok: false, reason: "The picture track has no frame table (fragmented MP4?)." };
  const frames = u32(moov, stsz.body + 8) || (() => { let n = 0; const e = u32(moov, stts.body + 4); for (let i = 0; i < e; i++) n += u32(moov, stts.body + 8 + i * 8); return n; })();
  // The most common frame duration decides the rate.
  const counts = new Map<number, number>();
  const entries = u32(moov, stts.body + 4);
  for (let i = 0; i < entries; i++) counts.set(u32(moov, stts.body + 12 + i * 8), (counts.get(u32(moov, stts.body + 12 + i * 8)) ?? 0) + u32(moov, stts.body + 8 + i * 8));
  const delta = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  if (!delta || !vid.timescale || !frames) return { ok: false, reason: "Couldn't read the frame rate." };
  const rate = vid.timescale / delta;
  const known = KNOWN_FPS.find(([n, d]) => Math.abs(n / d - rate) < 0.002);
  if (!known) return { ok: false, reason: `Unusual frame rate (${rate.toFixed(3)} fps).` };
  if (entries > 3) return { ok: false, reason: "Variable frame rate." };
  return {
    ok: true, frames, fpsNum: known[0], fpsDen: known[1], width, height, seconds: vid.duration / vid.timescale,
    audio: sounds.length ? "aac" : "none", bframes: Boolean(child(moov, vid.stbl, "ctts")),
  };
}

// Top-level box order plus the index check: a review export must have 'moov' before 'mdat' (fast start).
export async function checkReviewExport(read: RangeRead, fileSize: number): Promise<ExportCheck> {
  let o = 0, moovAt = -1, mdatAt = -1;
  for (let i = 0; i < 64 && o < fileSize; i++) {
    const h = await read(o, o + 15);
    if (h.length < 8) break;
    let size = u32(h, 0);
    if (size === 1) size = u64(h, 8);
    if (size === 0) size = fileSize - o;
    const t = type(h, 4);
    if (t === "moov" && moovAt < 0) moovAt = o;
    if (t === "mdat" && mdatAt < 0) mdatAt = o;
    if (moovAt >= 0 && mdatAt >= 0) break;
    if (size < 8) break;
    o += size;
  }
  if (moovAt < 0) return { ok: false, reason: "No index in the file." };
  if (mdatAt >= 0 && moovAt > mdatAt) return { ok: false, reason: "The index is at the end of the file (turn on Network Optimization)." };
  const h = await read(moovAt, moovAt + 15);
  let size = u32(h, 0);
  if (size === 1) size = u64(h, 8);
  if (size < 8 || size > 64_000_000) return { ok: false, reason: "The index is too big." };
  const moov = await read(moovAt, moovAt + size - 1);
  return checkMoov(moov);
}
