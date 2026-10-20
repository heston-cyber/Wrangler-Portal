import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Phase 0 only: results of the frame-accuracy test page (lab/frametest.html).
  phase0Runs: defineTable({
    createdAt: v.string(),
    label: v.string(),
    device: v.string(),
    browser: v.string(),
    source: v.string(),
    engine: v.string(),
    pass: v.boolean(),
    userAgent: v.string(),
    results: v.any(),
    misses: v.any(),
  }),
});
