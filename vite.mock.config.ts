// Screenshot harness: the real app with Convex swapped for local sample data (mock/). Not deployed.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^convex\/react$/, replacement: resolve(__dirname, "mock/convex-react.tsx") },
      { find: /^@convex-dev\/auth\/react$/, replacement: resolve(__dirname, "mock/convex-auth-react.tsx") },
    ],
  },
  build: { outDir: "dist-mock", rollupOptions: { input: { main: resolve(__dirname, "index.html") } } },
});
