import { defineConfig } from "vite";
import { resolve } from "node:path";

// Background worker + popup. Content script builds separately (IIFE) because
// content scripts injected as files can't be ES modules.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        popup: resolve(__dirname, "popup.html"),
      },
      output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js" },
    },
  },
});
