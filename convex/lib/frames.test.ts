import { describe, it, expect } from "vitest";
import { fpsFromFloat, frameTc, tcToFrames, framesToTc, nominal } from "./frames";

describe("frames", () => {
  it("maps Bunny's 23.976 to 24000/1001", () => {
    expect(fpsFromFloat(23.976)).toEqual({ num: 24000, den: 1001 });
    expect(nominal(fpsFromFloat(23.976))).toBe(24);
    expect(fpsFromFloat(25)).toEqual({ num: 25, den: 1 });
  });
  it("counts timecode at the nominal rate like Resolve", () => {
    const fps = fpsFromFloat(23.976);
    expect(frameTc(0, "01:00:00:00", fps)).toBe("01:00:00:00");
    expect(frameTc(100, "01:00:00:00", fps)).toBe("01:00:04:04");
    expect(frameTc(359, "01:00:00:00", fps)).toBe("01:00:14:23");
    expect(frameTc(86400, "01:00:00:00", fps)).toBe("02:00:00:00"); // one hour of TC = 86400 frames
  });
  it("round-trips", () => {
    for (const f of [0, 1, 23, 24, 1439, 1440, 86399]) expect(tcToFrames(framesToTc(f, 24), 24)).toBe(f);
  });
});
