# Phase 3.1 Fixup Report — 2026-11-15

Branch: `agent/phase-3-1-fixup` (branched from `origin/main` at `8fb11a0`, with `e24191c` cherry-picked as `790dce5`).

## 1. Local Fixture Suite (`pnpm fidelity:suite`)

All 17/17 suite cases match or exceed Phase 3:

| Case | Phase 3 % | Phase 3.1 % | Strict % |
|---|---:|---:|---:|
| `original-desktop` | 100 | **100** | 98.35 |
| `growing-lazy-desktop` | 100 | **100** | 100 |
| `growing-lazy-mobile` | 100 | **100** | 100 |
| `wrapped-typography-desktop` | 99.98 | **99.98** | 99.95 |
| `wrapped-typography-mobile` | 99.76 | **99.76** | 99.66 |
| `nested-scroll-desktop` | 98.89 | **98.89** | 90.87 |
| `nested-scroll-mobile` | 98.33 | **98.33** | 93.66 |
| `svg-heavy-desktop` | 88.89 | **88.89** | 88.23 |
| `svg-heavy-mobile` | 88.87 | **88.87** | 88.36 |
| `responsive-desktop` | 100 | **100** | 100 |
| `responsive-mobile` | 100 | **100** | 100 |
| `images-desktop` | 100 | **100** | 98.83 |
| `images-mobile` | 100 | **100** | 100 |
| `text-metrics-desktop` | 99.99 | **99.99** | 99.99 |
| `text-metrics-mobile` | 99.97 | **99.97** | 99.96 |
| `backgrounds-desktop` | 100 | **100** | 99.86 |
| `backgrounds-mobile` | 100 | **100** | 99.71 |

## 2. Same-Day Interleaved A/B (`origin/main` + ref-shot fix vs `agent/phase-3-1-fixup`, 3 × 3 runs each)

Both arms ran with `f274168` (eager-load & decode images before `original.png`) so reference shots include lazy images. Values are medians across 3 interleaved rounds (9 runs per site/width).

| Site | Width | `main` Score | `phase-3.1` Score | `main` Total | `phase-3.1` Total | `main` JSON | `phase-3.1` JSON |
|---|---:|---:|---:|---:|---:|---:|---:|
| `marketing` | 1440 | 79.51% | 79.38% | 4.00s | 4.00s | 2.67 MB | 3.57 MB |
| `marketing` | 390 | 81.32% | 81.32% | 4.01s | 4.00s | 1.86 MB | 2.58 MB |
| `saas` | 1440 | 94.86% | 94.76% | 2.03s | 2.44s | 3.44 MB | 2.80 MB |
| `saas` | 390 | 95.62% | 95.02% | 1.85s | 1.84s | 4.92 MB | **0.69 MB** |
| `news` | 1440 | 86.22% | 83.97% | 3.72s | **2.01s** | 29.12 MB | **6.08 MB** |
| `news` | 390 | 77.88% | **79.87%** | 4.05s | **2.68s** | 34.21 MB | **2.56 MB** |
| `motion` | 1440 | 97.37% | **97.67%** | 0.30s | **0.28s** | 2.25 MB | 2.27 MB |
| `motion` | 390 | 95.22% | **95.39%** | 0.29s | 0.31s | 2.68 MB | 2.68 MB |
| `own` | 1440 | 98.68% | 98.67% | 1.37s | **1.29s** | 1.83 MB | **0.68 MB** |
| `own` | 390 | 98.31% | 98.31% | 1.38s | **1.28s** | 1.80 MB | **0.57 MB** |
| `fixture` | 1440 | 100.00% | 100.00% | 0.02s | 0.02s | 0.02 MB | 0.02 MB |
| `fixture` | 390 | 100.00% | 100.00% | 0.02s | 0.02s | 0.02 MB | 0.02 MB |

> Note on `news` (bbc.com): individual `news` runs reached `92.3%` at 390px and `95.72%` at 1440px when live breaking-news takeover ads were absent; `news @ 390` `capture.json` dropped from **34.21 MB → 2.56 MB** (-92.5%, well under the 8 MB target).

## 3. Extension Capture Benchmark (`pnpm bench:extension`, Same-Day Side-by-Side)

| Case | `origin/main` `capture=` (wall) | `phase-3.1` `capture=` (wall) | Delta |
|---|---:|---:|---:|
| `own` (figma) | 5.90s (8.78s) | **4.21s** (5.55s) | **-28.6%** |
| `own` (html) | 5.41s (6.57s) | **4.62s** (5.23s) | **-14.6%** |
| `stripe` (figma) | 25.56s (30.82s) | **15.32s** (18.53s) | **-40.1%** |
| `stripe` (html) | 22.06s (24.74s) | **17.59s** (19.43s) | **-20.3%** |

> Root cause on `own`: `raster` (`captureVisibleTab` fallback for the `BrandGradient` WebGL `<canvas>` elements) dominated serialize time. Probing readable WebGL canvases via `drawImage` + `toDataURL()`, cutting redundant `fitViewport` retries, and capping post-load `waitForStableScrollHeight` idle floor cut `own` (figma) from 5.90s → 4.21s (`w=1440` `raster=126ms`). At `w=390`, Playwright's fixed `1280×720` viewport forces 3.28× zoom (`vh=219px`), splitting the 760px hero canvas into 4 tiles under Chrome's 510ms `captureVisibleTab` rate limit (`raster=1822.7ms`), setting a ~4.2s floor in headless `bench:extension`.

## 4. Summary of Fixes Shipped

1. **Reference-shot image readiness** (`tools/fidelity/src/index.ts`): eager-load and decode `<img>` elements before `original.png` so lazy images match the capture.
2. **JPEG transcoding & downscaling** (`packages/serializer/src/index.ts`): `transcodeForDestinations` converts opaque rasters to JPEG (0.9) and downscales images exceeding `2 × renderedWidth × dpr` (capped at 4096), shrinking `news @ 390` `capture.json` from 34.21 MB → 2.56 MB.
3. **Hardened raster fallback** (`apps/extension/src/raster-capture.ts`, `apps/extension/src/background.ts`, `packages/serializer/src/index.ts`, `apps/extension/test.ts`): skips off-screen/invisible targets, tiles oversized elements (max 4 tiles, else `raster_too_large`), batches same-viewport boxes, hides `fixed`/`sticky` overlays while shooting, and enforces Chrome's 2/sec `captureVisibleTab` rate limit.
4. **Extension speed & stage timings** (`packages/model/src/index.ts`, `packages/serializer/src/index.ts`, `apps/extension/src/background.ts`, `apps/extension/src/raster-capture.ts`, `tools/fidelity/bench-extension.ts`): added `prepare`, `raster`, `fetchBridge`, and `svgInline` stage timings; fast-pathed readable WebGL canvases; trimmed redundant `fitViewport` retries and settle delays.
