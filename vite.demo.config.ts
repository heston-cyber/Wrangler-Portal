// Demo build: the real app with sample data (mock/), local sample media and an in-memory router,
// packaged to publish as an artifact in Claude. Not deployed to the site.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      { find: /^convex\/react$/, replacement: resolve(__dirname, "mock/convex-react.tsx") },
      { find: /^@convex-dev\/auth\/react$/, replacement: resolve(__dirname, "mock/convex-auth-react.tsx") },
      { find: /^\.\.\/config$/, replacement: resolve(__dirname, "mock/demo-config.ts") },
      { find: /^\.\.\/src\/config$/, replacement: resolve(__dirname, "mock/demo-config.ts") },
      { find: /^\.\/config$/, replacement: resolve(__dirname, "mock/demo-config.ts") },
      { find: /^\.\.\/lib\/router$/, replacement: resolve(__dirname, "mock/demo-router.ts") },
      { find: /^\.\/lib\/router$/, replacement: resolve(__dirname, "mock/demo-router.ts") },
    ],
  },
  build: { outDir: "dist-demo", assetsInlineLimit: 0, rollupOptions: { input: { main: resolve(__dirname, "index.html") } } },
});
