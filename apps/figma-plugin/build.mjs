import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const html = await readFile(new URL('./ui.html', import.meta.url), 'utf8');
await build({
  configFile: false,
  root,
  define: { __html__: JSON.stringify(html) },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/code.ts', import.meta.url)),
      name: 'CaptureKitNativeImport',
      formats: ['iife'],
      fileName: () => 'code.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await Promise.all(['manifest.json', 'ui.html'].map((file) => copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url))));
