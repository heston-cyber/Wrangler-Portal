"use node";
// Decodes a version's sound into waveform peaks, reading only the audio chunks of the MP4 by range
// (a few 8 MB reads), so memory stays small however long the cut is. AAC via FAAD2 compiled to WASM.
import { decoder, gapless } from "@audio/decode-aac";
import { readMoov, type RangeRead } from "./mp4";
import { audioTrackFromMoov, readPlan } from "./mp4audio";
import { PeakMeter, peakRate } from "./peaks";

export type PeaksResult =
  | { status: "done"; rate: number; seconds: number; peaks: Uint8Array }
  | { status: "none"; reason: string };

export async function peaksFromMp4(read: RangeRead): Promise<PeaksResult> {
  const moov = await readMoov(read);
  if (!moov) throw new Error("Couldn't find the MP4's index (moov).");
  const track = audioTrackFromMoov(moov);
  if (track === null) return { status: "none", reason: "No audio track." };
  if (track === "unsupported") return { status: "none", reason: "The audio isn't AAC." };
  if (!track.chunks.length) return { status: "none", reason: "The audio track is empty." };

  const rate = peakRate(track.seconds);
  const window = gapless({ ...track.boxes, asc: track.asc });
  const dec = await decoder(window ? { asc: track.asc, gapless: window } : { asc: track.asc });
  const meter = new PeakMeter(rate);
  try {
    for (const part of readPlan(track.chunks)) {
      const buf = await read(part.start, part.end - 1);
      if (buf.length < part.end - part.start) throw new Error("The MP4 ended early.");
      const frames: Uint8Array[] = [];
      for (let k = part.from; k < part.to; k++) {
        let o = track.chunks[k].off - part.start;
        for (const s of track.chunks[k].sizes) { frames.push(buf.subarray(o, o + s)); o += s; }
      }
      // A few seconds of sound per call keeps the decoded samples (and the decoder's own memory) small.
      for (let k = 0; k < frames.length; k += 256) {
        const out = dec.decode(frames.slice(k, k + 256));
        meter.push(out.channelData, out.sampleRate);
      }
    }
    const tail = dec.flush();
    meter.push(tail.channelData, tail.sampleRate);
  } finally {
    dec.free();
  }
  const peaks = meter.done();
  return { status: "done", rate, seconds: peaks.length / rate, peaks };
}
