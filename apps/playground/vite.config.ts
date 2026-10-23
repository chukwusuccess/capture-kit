import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/capture-kit/' : './',
  build: {
    target: 'esnext',
  },
});
