import { describe, it, expect } from "vitest";
import { markersEdl } from "./edl";

describe("markersEdl", () => {
  it("writes Resolve marker lines with record timecode and duration", () => {
    const edl = markersEdl("Spirit Intro v3", [
      { kind: "range", inFrame: 300, outFrame: 359, text: "Tighten | this", status: "open", authorName: "Heston" },
      { kind: "frame", inFrame: 100, text: "Logo too small", status: "open", authorName: "Heston" },
    ], "01:00:00:00", { num: 24000, den: 1001 });
    expect(edl).toContain("TITLE: Spirit Intro v3");
    expect(edl).toContain("001  001      V     C        01:00:04:04 01:00:04:05 01:00:04:04 01:00:04:05");
    expect(edl).toContain(" |C:ResolveColorBlue |M:Logo too small |D:1");
    expect(edl).toContain("002  001      V     C        01:00:12:12 01:00:12:13");
    expect(edl).toContain(" |C:ResolveColorYellow |M:Tighten this |D:60");
  });

  it("puts notes that start on the same frame into one marker", () => {
    const edl = markersEdl("T", [
      { kind: "general", text: "Louder", status: "open", authorName: "H" },
      { kind: "frame", inFrame: 0, text: "Slate", status: "open", authorName: "H" },
      { kind: "range", inFrame: 0, outFrame: 23, text: "Fade up", status: "open", authorName: "H" },
    ], "01:00:00:00", { num: 24000, den: 1001 });
    expect(edl.match(/^\d{3} /gm)).toHaveLength(1);
    expect(edl).toContain(" |C:ResolveColorYellow |M:Whole video: Louder / Slate / Fade up |D:24");
  });
});
