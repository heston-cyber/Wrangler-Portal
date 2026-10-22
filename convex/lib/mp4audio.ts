// Finds the sound in an MP4 so it can be decoded without the picture: the AAC decoder's settings (from 'esds')
// and where each chunk of audio sits in the file (from the sample tables). Works whether 'moov' is at the start or the end.

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) + b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

type Box = { type: string; start: number; body: number; end: number };

function children(buf: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(buf, o);
    let body = o + 8;
    if (size === 1) { size = u64(buf, o + 8); body = o + 16; } else if (size === 0) size = to - o;
    if (size < 8 || o + size > to) break;
    out.push({ type: fourcc(buf, o + 4), start: o, body, end: o + size });
    o += size;
  }
  return out;
}
const child = (buf: Uint8Array, box: Box | undefined, t: string) => (box ? children(buf, box.body, box.end).find((c) => c.type === t) : undefined);
const bodyOf = (buf: Uint8Array, box: Box | undefined) => (box ? buf.subarray(box.body, box.end) : undefined);

export type AudioChunk = { off: number; sizes: number[] };
export type AudioTrack = {
  asc: Uint8Array; // the AAC AudioSpecificConfig
  seconds: number; // the track's length
  chunks: AudioChunk[]; // in decode order
  frames: number;
  // Box bodies the decoder uses to trim the encoder's priming (gapless playback).
  boxes: { elst?: Uint8Array; mdhd?: Uint8Array; stts?: Uint8Array; mvhd?: Uint8Array };
};

// MPEG-4 descriptor length: 1–4 bytes, 7 bits each, high bit = more follows.
function descLen(b: Uint8Array, o: number): [number, number] {
  let len = 0, i = 0;
  for (; i < 4; i++) { const x = b[o + i]; len = (len << 7) | (x & 0x7f); if (!(x & 0x80)) { i++; break; } }
  return [len, o + i];
}

// The AudioSpecificConfig inside an 'esds' box body: ES_Descriptor(3) → DecoderConfigDescriptor(4) → DecoderSpecificInfo(5).
export function ascFromEsds(esds: Uint8Array): Uint8Array | null {
  let o = 4; // version + flags
  if (esds[o] !== 0x03) return null;
  let [len, p] = descLen(esds, o + 1);
  const esEnd = Math.min(esds.length, p + len);
  const flags = esds[p + 2];
  p += 3;
  if (flags & 0x80) p += 2; // dependsOn_ES_ID
  if (flags & 0x40) p += 1 + esds[p]; // URL
  if (flags & 0x20) p += 2; // OCR_ES_Id
  while (p < esEnd) {
    const tag = esds[p];
    [len, o] = descLen(esds, p + 1);
    if (tag === 0x04) {
      let q = o + 13; // objectTypeIndication, streamType, bufferSizeDB, maxBitrate, avgBitrate
      const end = Math.min(esEnd, o + len);
      while (q < end) {
        const t2 = esds[q];
        const [l2, d] = descLen(esds, q + 1);
        if (t2 === 0x05) return esds.slice(d, d + l2);
        q = d + l2;
      }
      return null;
    }
    p = o + len;
  }
  return null;
}

// The audio track from a complete 'moov' box. null = no audio track; "unsupported" = sound that isn't AAC.
export function audioTrackFromMoov(moov: Uint8Array): AudioTrack | null | "unsupported" {
  const top = children(moov, 0, moov.length)[0];
  if (!top || top.type !== "moov") return null;
  const mvhd = child(moov, top, "mvhd");
  let unsupported = false;
  for (const trak of children(moov, top.body, top.end).filter((c) => c.type === "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = child(moov, mdia, "hdlr");
    if (!hdlr || fourcc(moov, hdlr.body + 8) !== "soun") continue;
    const mdhd = child(moov, mdia, "mdhd");
    const stbl = child(moov, child(moov, mdia, "minf"), "stbl");
    const stsd = child(moov, stbl, "stsd");
    if (!stbl || !stsd || !mdhd) continue;

    // First sample entry; AAC is 'mp4a' with an 'esds' inside (QuickTime may wrap it in 'wave').
    const entry = children(moov, stsd.body + 8, stsd.end)[0];
    if (!entry || entry.type !== "mp4a") { unsupported = true; continue; }
    const qtVersion = u16(moov, entry.body + 8);
    const kids = entry.body + 28 + (qtVersion === 1 ? 16 : qtVersion === 2 ? 36 : 0);
    let esds = children(moov, kids, entry.end).find((c) => c.type === "esds");
    if (!esds) { const wave = children(moov, kids, entry.end).find((c) => c.type === "wave"); esds = child(moov, wave, "esds"); }
    const asc = esds ? ascFromEsds(moov.subarray(esds.body, esds.end)) : null;
    if (!asc || asc.length < 2) { unsupported = true; continue; }

    // Sample sizes, chunk → samples map, chunk offsets.
    const stsz = child(moov, stbl, "stsz");
    const stsc = child(moov, stbl, "stsc");
    const stco = child(moov, stbl, "stco") ?? child(moov, stbl, "co64");
    if (!stsz || !stsc || !stco) return null; // fragmented: samples live in 'moof' boxes
    const fixed = u32(moov, stsz.body + 4), count = u32(moov, stsz.body + 8);
    const size = (i: number) => (fixed ? fixed : u32(moov, stsz.body + 12 + i * 4));
    const is64 = stco.type === "co64";
    const nChunks = u32(moov, stco.body + 4);
    const offset = (i: number) => (is64 ? u64(moov, stco.body + 8 + i * 8) : u32(moov, stco.body + 8 + i * 4));
    const runs = u32(moov, stsc.body + 4);
    const run = (i: number) => ({ first: u32(moov, stsc.body + 8 + i * 12), per: u32(moov, stsc.body + 12 + i * 12) });

    const chunks: AudioChunk[] = [];
    let sample = 0;
    for (let r = 0; r < runs && sample < count; r++) {
      const { first, per } = run(r);
      const last = r + 1 < runs ? run(r + 1).first - 1 : nChunks;
      for (let c = first; c <= last && sample < count; c++) {
        const sizes: number[] = [];
        for (let k = 0; k < per && sample < count; k++) sizes.push(size(sample++));
        chunks.push({ off: offset(c - 1), sizes });
      }
    }

    const ts = u32(moov, mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
    const durTicks = moov[mdhd.body] === 1 ? u64(moov, mdhd.body + 24) : u32(moov, mdhd.body + 16);
    const edts = child(moov, trak, "edts");
    return {
      asc, chunks, frames: sample, seconds: ts ? durTicks / ts : 0,
      boxes: { elst: bodyOf(moov, child(moov, edts, "elst")), mdhd: bodyOf(moov, mdhd), stts: bodyOf(moov, child(moov, stbl, "stts")), mvhd: bodyOf(moov, mvhd) },
    };
  }
  return unsupported ? "unsupported" : null;
}

// Groups chunks into reads of at most `maxBytes` (one HTTP range each), keeping decode order.
// maxGap (R3): for a full-size review render, don't read across long runs of picture between audio chunks;
// read the sound chunks on their own instead (the reads then run a few at a time).
export function readPlan(chunks: AudioChunk[], maxBytes = 8_000_000, maxGap = Infinity): Array<{ start: number; end: number; from: number; to: number }> {
  const out: Array<{ start: number; end: number; from: number; to: number }> = [];
  let i = 0;
  const endOf = (c: AudioChunk) => c.off + c.sizes.reduce((a, b) => a + b, 0);
  while (i < chunks.length) {
    const start = chunks[i].off;
    let end = endOf(chunks[i]);
    let j = i + 1;
    while (j < chunks.length && chunks[j].off >= end && chunks[j].off - end <= maxGap && endOf(chunks[j]) - start <= maxBytes) { end = endOf(chunks[j]); j++; }
    out.push({ start, end, from: i, to: j });
    i = j;
  }
  return out;
}
