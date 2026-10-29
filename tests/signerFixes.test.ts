// Final test (Oct 28): fixes found while Heston signed WS-00005 as two clients.
import { describe, expect, test } from "vitest";
import { initialsOf } from "../src/modules/docs/lib/SignaturePad";
import { isLightColour } from "../src/lib/theme";

describe("T-S6 signer page fixes", () => {
  test("initials only count words that start with a letter", () => {
    expect(initialsOf("Heston Hill (Client 1)")).toBe("HH");
    expect(initialsOf("  mary-jane  o'brien ")).toBe("MO");
    expect(initialsOf("Émile Zola")).toBe("ÉZ");
    expect(initialsOf("Anna Beth Carter Dunn")).toBe("ABC");
    expect(initialsOf("# 1")).toBe("");
  });

  test("a light backdrop picks the light theme; a dark one, or anything unreadable, the dark", () => {
    expect(isLightColour("#e9e7e2")).toBe(true);  // the Wrangler style's backdrop (WS-00005)
    expect(isLightColour("#fff")).toBe(true);
    expect(isLightColour("#ffffffcc")).toBe(true);
    expect(isLightColour("#1d1d1f")).toBe(false);
    expect(isLightColour("#0b0a0c")).toBe(false);
    expect(isLightColour("red")).toBe(false);
    expect(isLightColour(undefined)).toBe(false);
  });
});
