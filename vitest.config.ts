import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "convex/**/*.test.ts", "src/**/*.test.ts"],
  },
});
