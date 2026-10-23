import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Content script: single IIFE bundle (content scripts injected as files must
// be classic scripts, not ES modules).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: resolve(__dirname, 'src/content.ts'),
      name: 'CaptureKitContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
