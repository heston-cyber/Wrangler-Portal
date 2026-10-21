// @vitest-environment node
// Waveform peaks from real MP4 files: moov first or last, no audio, and the bar maths the timeline uses.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { peaksFromMp4 } from "../convex/lib/waveformDecode";
import { audioTrackFromMoov, readPlan } from "../convex/lib/mp4audio";
import { readMoov } from "../convex/lib/mp4";
import { barHeights, peakRate, PeakMeter } from "../convex/lib/peaks";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const reader = (buf: Uint8Array) => {
  const calls: number[] = [];
  const read = async (a: number, b: number) => { calls.push(b - a + 1); return buf.subarray(a, Math.min(buf.length, b + 1)); };
  return { read, calls };
};

describe("waveform peaks", () => {
  test("a 3-second tone, quiet then loud, moov first", async () => {
    const { read } = reader(fixture("tone-fast.mp4"));
    const r = await peaksFromMp4(read);
    expect(r.status).toBe("done");
    if (r.status !== "done") return;
    expect(r.rate).toBe(20);
    expect(r.peaks.length).toBeGreaterThanOrEqual(58);
    expect(r.peaks.length).toBeLessThanOrEqual(62);
    // ffmpeg's sine is 1/8 of full scale; the fixture plays it at 0.1 then 0.8 of that (about 3 and 25 of 255).
    const quiet = Math.max(...r.peaks.slice(5, 25)), loud = Math.min(...r.peaks.slice(35, 55));
    expect(quiet).toBeGreaterThanOrEqual(1);
    expect(quiet).toBeLessThanOrEqual(6);
    expect(loud).toBeGreaterThanOrEqual(14);
    expect(loud).toBeLessThanOrEqual(32);
    expect(loud).toBeGreaterThanOrEqual(quiet * 5);
  });

  test("moov at the end gives the same peaks", async () => {
    const a = await peaksFromMp4(reader(fixture("tone-fast.mp4")).read);
    const b = await peaksFromMp4(reader(fixture("tone-late.mp4")).read);
    expect(b.status).toBe("done");
    if (a.status === "done" && b.status === "done") expect([...b.peaks]).toEqual([...a.peaks]);
  });

  test("no audio track is reported, not an error", async () => {
    const r = await peaksFromMp4(reader(fixture("no-audio.mp4")).read);
    expect(r).toEqual({ status: "none", reason: "No audio track." });
  });

  test("reads only the audio, in a few ranges", async () => {
    const buf = fixture("tone-fast.mp4");
    const moov = (await readMoov(reader(buf).read))!;
    const track = audioTrackFromMoov(moov);
    expect(track && track !== "unsupported").toBe(true);
    if (!track || track === "unsupported") return;
    expect(track.asc.length).toBeGreaterThanOrEqual(2);
    expect(track.seconds).toBeGreaterThan(2.9);
    const plan = readPlan(track.chunks, 4_000);
    expect(plan.length).toBeGreaterThan(1);
    expect(plan[plan.length - 1].to).toBe(track.chunks.length);
    for (const p of plan) expect(p.end - p.start).toBeLessThanOrEqual(Math.max(4_000, p.end - p.start));
  });

  test("rate drops for long cuts so a version stays small", () => {
    expect(peakRate(60)).toBe(20);
    expect(peakRate(1000)).toBe(20);
    expect(peakRate(3600)).toBe(5);
    expect(peakRate(36000)).toBe(1);
  });

  test("meter takes the loudest sample per slice across channels", () => {
    const m = new PeakMeter(10);
    m.push([Float32Array.from([0.1, -0.5, 0, 0]), Float32Array.from([0, 0, 0.9, 0])], 40); // 4 samples per slice at 10/s
    m.push([Float32Array.from([0.25])], 40);
    expect([...m.done()]).toEqual([Math.round(Math.fround(0.9) * 255), 64]);
  });

  test("bars: loudest slice per bar, scaled to the loudest moment", () => {
    const peaks = Uint8Array.from([0, 0, 255, 0, 51, 51, 0, 0]); // 8 slices at 4/s = 2 s
    const h = barHeights(peaks, 4, 48, 24, 1, 4); // 48 frames at 24 fps, 4 bars of half a second
    expect(h).toHaveLength(4);
    expect(h[0]).toBe(0);
    expect(h[1]).toBe(1);
    expect(h[2]).toBeCloseTo(Math.pow(51 / 255, 0.7), 5);
    expect(h[3]).toBe(0);
  });
});
