import { describe, expect, test } from "vitest";
import { frameAt, mapWords, playedRange, pointersFrom, transcriptText, type FrameLog } from "./voice";

describe("voice notes", () => {
  const log: FrameLog = [[0, 100], [42, 101], [84, 102], [2000, 150]];
  test("each moment maps to the frame on screen then", () => {
    expect([frameAt(log, 0), frameAt(log, 41), frameAt(log, 42), frameAt(log, 1999), frameAt(log, 5000)]).toEqual([100, 100, 101, 102, 150]);
    expect(frameAt([], 10)).toBe(0);
  });
  test("words get the frame at their start; spacing is dropped", () => {
    const w = mapWords([
      { text: "Make", start: 0.01, end: 0.2, type: "word" }, { text: " ", start: 0.2, end: 0.25, type: "spacing" },
      { text: "this", start: 0.05, end: 0.3, type: "word" }, { text: "brighter.", start: 2.1, end: 2.6, type: "word" },
    ], log);
    expect(w).toEqual([{ t: "Make", f: 100, s: 10, e: 200 }, { t: "this", f: 101, s: 50, e: 300 }, { t: "brighter.", f: 150, s: 2100, e: 2600 }]);
    expect(transcriptText(w)).toBe("Make this brighter.");
  });
  test("pointing words get one still per frame, at most 8", () => {
    const w = mapWords([
      { text: "This,", start: 0, end: 0.1 }, { text: "here", start: 0.01, end: 0.1 }, { text: "and", start: 0.1, end: 0.2 },
      { text: "THERE!", start: 2.2, end: 2.4 }, { text: "those", start: 2.5, end: 2.6 }, { text: "thistle", start: 2.7, end: 2.9 },
    ], log);
    expect(pointersFrom(w).map((p) => [p.word, p.f])).toEqual([["this", 100], ["there", 150]]);
    const many = mapWords(Array.from({ length: 20 }, (_, i) => ({ text: "here", start: i, end: i + 0.1 })), Array.from({ length: 20 }, (_, i) => [i * 1000, i] as [number, number]));
    expect(pointersFrom(many)).toHaveLength(8);
  });
  test("a note recorded while playing covers first to last frame shown; a still picture doesn't", () => {
    expect(playedRange(log)).toEqual({ a: 100, b: 150 });
    expect(playedRange([[0, 100]])).toBeNull();
    expect(playedRange([[0, 100], [40, 101]])).toBeNull();
  });
});
