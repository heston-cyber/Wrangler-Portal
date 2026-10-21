// @vitest-environment node
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mp4FrameCount, mp4HasIndex, type RangeRead } from "./mp4";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../../tests/fixtures", name)));
const reader = (file: Uint8Array, log: [number, number][] = []): RangeRead => async (s, e) => { log.push([s, e]); return file.slice(s, e + 1); };

describe("mp4FrameCount", () => {
  // 49 frames at 23.976 with audio running to 2.08 s: duration ÷ frame length gives 50, the file holds 49.
  test("counts video frames, not duration (moov at end)", async () => {
    expect(await mp4FrameCount(reader(fixture("moov-end-long-audio.mp4")))).toBe(49);
  });
  test("counts video frames (moov at start)", async () => {
    expect(await mp4FrameCount(reader(fixture("moov-start-long-audio.mp4")))).toBe(49);
  });
  test("only reads headers and the moov box", async () => {
    const f = fixture("moov-end-long-audio.mp4");
    const log: [number, number][] = [];
    await mp4FrameCount(reader(f, log));
    expect(log.length).toBeLessThanOrEqual(6);
  });
  test("returns null for something that isn't an MP4", async () => {
    expect(await mp4FrameCount(reader(new TextEncoder().encode("not a video at all, just text")))).toBeNull();
  });
});

describe("mp4HasIndex (is the render finished?)", () => {
  test("a finished file passes, with or without its size", async () => {
    for (const name of ["moov-end-long-audio.mp4", "moov-start-long-audio.mp4"]) {
      const f = fixture(name);
      expect(await mp4HasIndex(reader(f), f.length)).toBe(true);
      expect(await mp4HasIndex(reader(f))).toBe(true);
    }
  });
  test("a file cut off part-way fails, wherever the index is", async () => {
    for (const name of ["moov-end-long-audio.mp4", "moov-start-long-audio.mp4"]) {
      const f = fixture(name);
      for (const keep of [100, Math.floor(f.length / 2), f.length - 1]) {
        const part = f.slice(0, keep);
        expect(await mp4HasIndex(reader(part), part.length)).toBe(false);
      }
    }
  });
  test("a file whose data box was never closed (size 0) fails", async () => {
    const f = fixture("moov-end-long-audio.mp4").slice();
    // find mdat and zero its size, as a muxer does before it finishes
    for (let o = 0; o < f.length - 8;) {
      const size = (f[o] << 24 >>> 0) + (f[o + 1] << 16) + (f[o + 2] << 8) + f[o + 3];
      const t = String.fromCharCode(f[o + 4], f[o + 5], f[o + 6], f[o + 7]);
      if (t === "mdat") { f[o] = f[o + 1] = f[o + 2] = f[o + 3] = 0; break; }
      o += size;
    }
    expect(await mp4HasIndex(reader(f), f.length)).toBe(false);
  });
});
