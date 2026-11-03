import { defineConfig } from "vitest/config";

// Nov 3: tests run on UTC, like GitHub's runners and Convex's servers, so a time-zone slip that only shows on the
// server fails here too (the calendar's offset-less Google times passed on a Chicago laptop and failed in CI).
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "convex/**/*.test.ts", "src/**/*.test.ts"],
  },
});
