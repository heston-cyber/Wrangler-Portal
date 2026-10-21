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
