import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        frametest: resolve(__dirname, "lab/frametest.html"),
        r1: resolve(__dirname, "lab/r1.html"),
        ios: resolve(__dirname, "lab/ios.html"),
      },
    },
  },
});
