// R1 test page results: only a post with the test link's key is kept.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
// A stand-in key for the test (the real one is only in the test link).
beforeAll(() => { process.env.R1_KEY_SHA256_TEST = createHash("sha256").update("stand-in-key").digest("hex"); });

describe("r1 results", () => {
  test("needs the link's key; the list reads back", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.r1results.report, { k: "nope", device: "x", rows: "{}" })).rejects.toThrow(/Not allowed/);
    await t.mutation(api.r1results.report, { k: "stand-in-key", device: "iPhone", rows: JSON.stringify({ id: "A", jumpMed: 90 }) });
    const rows = await t.query(internal.r1results.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ device: "iPhone", rows: { id: "A", jumpMed: 90 } });
  });
});
