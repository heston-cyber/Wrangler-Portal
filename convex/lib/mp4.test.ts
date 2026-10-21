// @vitest-environment node
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mp4FrameCount, type RangeRead } from "./mp4";

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
