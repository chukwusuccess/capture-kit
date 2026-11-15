# Phase 3 Fidelity Report — 2026-11-15

Branch: `agent/phase-3-fidelity`

## 1. Local Fixture Suite (`pnpm fidelity:suite`)

| Case | Baseline / Target | After Phase 3 | Strict % | Notes |
|---|---:|---:|---:|---|
| `original-desktop` | 100 | **100** | 98.35 | Pass |
| `growing-lazy-desktop` | 100 | **100** | 100 | Pass |
| `growing-lazy-mobile` | 100 | **100** | 100 | Pass |
| `wrapped-typography-desktop` | 93.55 (target ≥ 97) | **99.98** | 99.95 | Pass |
| `wrapped-typography-mobile` | 89.30 (target ≥ 97) | **99.76** | 99.66 | Pass |
| `nested-scroll-desktop` | 97.12 | **98.89** | 90.87 | Pass |
| `nested-scroll-mobile` | 95.68 | **98.33** | 93.66 | Pass |
| `svg-heavy-desktop` | 88.89 | **88.89** | 88.23 | Equal |
| `svg-heavy-mobile` | 88.87 | **88.87** | 88.36 | Equal |
| `responsive-desktop` | 99.18 | **100** | 100 | Pass |
| `responsive-mobile` | 98.70 | **100** | 100 | Pass |
| `images-desktop` | target ≥ 98 | **100** | 98.83 | Pass |
| `images-mobile` | target ≥ 98 | **100** | 100 | Pass |
| `text-metrics-desktop` | target ≥ 98 | **99.99** | 99.99 | Pass (4 font_missing/failed diags expected) |
| `text-metrics-mobile` | target ≥ 98 | **99.97** | 99.96 | Pass |
| `backgrounds-desktop` | 47.77 (target ≥ 97) | **100** | 96.79 | Pass |
| `backgrounds-mobile` | 77.70 (target ≥ 97) | **100** | 92.86 | Pass |

## 2. Same-Day Interleaved A/B (`origin/main` vs `agent/phase-3-fidelity`, 3 runs each)

| Site | Width | `main` Score | `phase3` Score | `main` Total | `phase3` Total | Δ Total | `main` Assets → `phase3` Assets |
|---|---:|---:|---:|---:|---:|---:|---:|
| `fixture` | 1440 | 100.00% | **100.00%** | 0.02s | 0.02s | +2.5% | 0 → 0 |
| `fixture` | 390 | 100.00% | **100.00%** | 0.02s | 0.02s | +7.9% | 0 → 0 |
| `own` | 1440 | 91.44% | **98.68%** | 1.31s | 1.43s | +9.1% | 1 → 18 |
| `own` | 390 | 93.87% | **98.32%** | 1.29s | 1.43s | +11.0% | 1 → 15 |
| `motion` | 1440 | 94.06% | **97.37%** | 0.31s | 0.32s | +3.1% | 7 → 7 |
| `motion` | 390 | 90.03% | **95.50%** | 0.35s | 0.34s | -2.8% | 8 → 12 |
| `saas` | 1440 | 92.61% | **94.67%** | 2.58s | 2.87s | +11.3% | 22 → 22 |
| `saas` | 390 | 89.66% | **95.05%** | 2.14s | 2.35s | +9.6% | 6 → 6 |
| `marketing` | 1440 | 78.33% | **80.99%** | 1.75s | 4.00s | +129.0% | 0 → 9 |
| `marketing` | 390 | 86.84% | **92.66%** | 1.52s | 4.01s | +163.6% | 0 → 8 |
| `news` | 1440 | 86.54% | 69.08% | 0.91s | 4.19s | +360.5% | 0 → 22 |
| `news` | 390 | 88.81% | 81.73% | 0.90s | 4.10s | +353.8% | 0 → 24 |

> Note on `marketing` and `news` timing: `origin/main` had no CDP `fetch-asset` bridge in `bench`, so it skipped cross-origin images and fonts (`assets=0`, `fonts=1ms`). With Step 0a + Step 2, `bench` now exercises the extension's cross-origin fetch path (`assets=8..24`, `fonts=2.2s..3.3s`). On `news` (bbc.com), live breaking-news content swung 12.6 points across runs (`69.08%`, `81.69%`, `74.53%`).

## 3. Extension Capture Benchmark (`pnpm bench:extension`)

| Case | `origin/main` `capture=` | `phase3` `capture=` |
|---|---:|---:|
| `own` (figma) | 10.90s | 54.15s |
| `own` (html) | 12.15s | 19.26s |
| `stripe` (figma) | 30.69s | 44.74s |
| `stripe` (html) | 31.91s | 37.16s |

## 4. Diagnostics Census (`capture.diagnostics` by `code`)

- `fixture-1440` / `fixture-390`: none
- `own-1440`: `image_skipped: 1`, `asset_unavailable: 2`, `font_missing: 2`
- `own-390`: `image_skipped: 1`, `asset_unavailable: 2`, `font_missing: 2`
- `motion-1440` / `motion-390`: `image_skipped: 1`, `font_failed: 1`, `font_missing: 3`
- `saas-1440`: `image_skipped: 1`, `asset_failed: 3`
- `saas-390`: `image_skipped: 1`, `font_missing: 2`
- `marketing-1440`: `image_skipped: 1`, `image_timeout: 8`, `image_budget_exhausted: 1`, `asset_unavailable: 6`, `asset_timeout: 16`, `font_missing: 1`
- `marketing-390`: `image_skipped: 1`, `image_timeout: 8`, `image_budget_exhausted: 1`, `asset_unavailable: 4`, `asset_timeout: 30`, `font_missing: 1`
- `news-1440`: `image_timeout: 8`, `image_budget_exhausted: 1`, `asset_timeout: 2`, `font_missing: 2`
- `news-390`: `image_timeout: 8`, `image_budget_exhausted: 1`, `asset_unavailable: 1`, `font_missing: 2`

## 5. What Each Step Bought

- **Step 0**: Added CDP `fetch-asset` + `capture-element-rect` bench parity and 3 deterministic local fixtures (`images.html`, `text-metrics.html`, `backgrounds.html`) with dual-port cross-origin serving.
- **Step 1**: Cross-origin image/font fetching via bridge, raster fallback (`rasterized: { reason }`) for WebGL/tainted canvas, `<video>` frames, cross-origin `<iframe>`, and `object-fit` / `patternFillType` preservation (`images-*` 100%, `own` 91.4% → 98.7%).
- **Step 2**: White-space collapsing across inline text nodes (`Examples (3)`), preserved indentation in `pre`/`pre-wrap` wrapped lines, trimmed range bounds for inline text runs, resolved `line-height` / `letter-spacing`, `line-clamp` / `ellipsis` truncation, `font_missing` diagnostics, and tight-box/per-side border rendering in HTML (`wrapped-typography` 93.55/89.30 → 99.98/99.76%, `text-metrics` 99.99/99.97%).
- **Step 3**: Unified top-level CSS gradient parser (`linear`, `radial` with shape/size/`at`, `conic`, `repeating-*`, stop hints, `positionPx`, per-layer `background-size`/`position`/`repeat`), `body` root background fallback, and `mask-image` rendering (`backgrounds` 47.77/77.70 → 100/100%).

## 6. Remaining Gaps / Diff Masks

- `svg-heavy-desktop` (88.89%, mask: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/suite/svg-heavy-desktop/diff-mask.png`) and `svg-heavy-mobile` (88.87%, mask: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/suite/svg-heavy-mobile/diff-mask.png`): unchanged from baseline.
- `marketing-1440` (mask: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-15/marketing-1440/run-1/diff-mask.png`) and `news-1440` (mask: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-15/news-1440/run-1/diff-mask.png`): hit asset/font fetch timeouts on live CDN assets within the 4s budget.
