import { describe, expect, test } from "vitest";
import { contrast, shade, textOn, LIGHT_TEXT, DARK_TEXT } from "../convex/lib/color";
import { brandVars } from "../src/lib/brand";

describe("colour", () => {
  test("contrast matches WCAG", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
    expect(contrast("nope", "#fff")).toBeNull();
  });
  test("button text is picked to reach 4.5:1", () => {
    expect(textOn("#1F3A8A")).toMatchObject({ text: LIGHT_TEXT, ok: true }); // dark blue: light text
    expect(textOn("#F2C94C")).toMatchObject({ text: DARK_TEXT, ok: true });  // yellow: dark text
    expect(textOn("#4B7BE5").ok).toBe(true);                                // a mid blue still finds one that passes
    for (const c of ["#1F3A8A", "#F2C94C", "#4B7BE5", "#7A9E7E", "#FF0000"]) expect(textOn(c).ratio).toBeGreaterThanOrEqual(4.5);
  });
  test("shades and brand variables", () => {
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(brandVars(null)).toEqual({});
    expect(brandVars({ name: "W", accent: null, background: null, logoUrl: null })).toEqual({}); // Wrangler: no overrides
    const v = brandVars({ name: "J", accent: "#4B7BE5", background: "#0B1020", logoUrl: null });
    expect(v["--accent"]).toBe("#4B7BE5");
    expect(v["--surface-base"]).toBe("#0B1020");
    expect([LIGHT_TEXT, DARK_TEXT]).toContain(v["--on-accent"]);
  });
});
