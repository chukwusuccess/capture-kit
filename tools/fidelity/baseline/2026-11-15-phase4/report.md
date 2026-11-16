# Phase 4 Report — Fonts & Native Exports (2026-11-15)

Branch: `agent/phase-4-fonts-exports` vs `origin/main (743c258)`

## Part A: Fonts Everywhere & Diagnostics

### Implemented
- **A1 (`@font-face` everywhere)**: Extended `FontSchema` with `stretch`, `unicodeRange`, `embedded`, `fallbackStack`, exported shared `buildFontFaceCss(capture)` in `@capture-kit/model`, and wired it into non-standalone `modelToHtml`, `modelToReact`, and `modelToSvg` (`<defs><style>`).
- **A2 & A3 (Font-matching & fallback stacks)**: Added `doesFontFaceCover(face, family, weight, style)` and `reconcileMissingFonts(nodes, fonts, report)` in `@capture-kit/serializer` with CSS numeric weight + variable range (`"1 1000"`) + style matching, aggregated `font_missing` diagnostics (1 per missing family), and `embedded: false` + `fallbackStack` recording.
- **A4 (`bbc@390` inspection)**: Pixel-band inspection showed `y=900..1400` at `0.0%` mismatch (no 6px vertical offset); `0..844` mismatch on live runs comes from a cross-origin fullscreen Celtra interstitial ad (`node-873`).

### Same-Day Interleaved A/B (3 runs each)

| Site | main median | phase-4 median | main ser total | phase-4 ser total | hDelta (main / p4) |
|---|---:|---:|---:|---:|---|
| marketing@1440 | 85.38% | 87.16% | 4003 ms | 4005.4 ms | 0 / 0 |
| marketing@390 | 81.5% | 82.18% | 4007.9 ms | 4005.1 ms | 1 / 1 |
| news@1440 | 83.18% | 97.34% | 2449.2 ms | 2314.2 ms | 12 / 0 |
| news@390 | 92.01% | 77.55% | 1840.6 ms | 1874.4 ms | 0 / 14 |

## Part B: Native Exports Verified (`pnpm fidelity:native`)

- **`nativeImportersVerified`**: `html: true`, `sketch: true` (rendered at 1x via `sketchtool export artboards`), `figma: false` (Figma desktop app has no headless CLI importer; verified via headless native plan check only).
- **B2 Fonts**: Embedded `fontReferences` in Sketch `document.json` + PostScript font resolution & `paragraphStyle` metrics; ordered Figma font substitution (`exact -> nearest weight -> fallbackStack -> metric-compatible Google font table`) with `"N fonts substituted: A -> B"` reporting in `apps/figma-plugin` & `@capture-kit/destination-figma/native`.
- **B3 Top 3 Sketch Defects Fixed**:
  1. Artboard `backgroundColor` inheritance from root solid fill + CSS-to-Sketch fill stacking order + conic/radial gradients (`backgrounds-desktop`: `47.76% -> 89.35%`).
  2. Inline `image/svg+xml` asset conversion to Sketch vector layers instead of broken bitmap layers (`images-mobile`: `74.62% -> 86.72%`, `images-desktop`: `89.49% -> 94.8%`).
  3. Text layer PostScript font resolution, `paragraphStyle` alignment/line-height, kerning, and `fontReferences` (`growing-lazy-desktop`: `99.17%`, `own-desktop`: `96.84%`, `own-mobile`: `96.9%`).

| Case | HTML | Sketch (1x PNG diff) | Figma Plan |
|---|---:|---:|---|
| original-desktop | 100% | 96.09% (-3.91 pts) | ok (29 nodes, 1 subs) |
| growing-lazy-desktop | 100% | 99.27% (-0.73 pts) | ok (22 nodes, 1 subs) |
| growing-lazy-mobile | 100% | 97.59% (-2.41 pts) | ok (22 nodes, 1 subs) |
| wrapped-typography-desktop | 99.98% | 95.63% (-4.35 pts) | ok (49 nodes, 3 subs) |
| wrapped-typography-mobile | 99.76% | 91.88% (-7.88 pts) | ok (49 nodes, 3 subs) |
| nested-scroll-desktop | 98.89% | 98.18% (-0.71 pts) | ok (53 nodes, 1 subs) |
| nested-scroll-mobile | 98.33% | 95.24% (-3.09 pts) | ok (53 nodes, 1 subs) |
| svg-heavy-desktop | 88.89% | 83.34% (-5.55 pts) | ok (16 nodes, 1 subs) |
| svg-heavy-mobile | 88.87% | 79.48% (-9.39 pts) | ok (16 nodes, 1 subs) |
| responsive-desktop | 100% | 97.37% (-2.63 pts) | ok (46 nodes, 1 subs) |
| responsive-mobile | 100% | 94.22% (-5.78 pts) | ok (40 nodes, 1 subs) |
| images-desktop | 100% | 95.96% (-4.04 pts) | ok (29 nodes, 1 subs) |
| images-mobile | 100% | 89.54% (-10.46 pts) | ok (29 nodes, 1 subs) |
| text-metrics-desktop | 99.99% | 97.94% (-2.05 pts) | ok (19 nodes, 3 subs) |
| text-metrics-mobile | 99.97% | 91.72% (-8.25 pts) | ok (19 nodes, 3 subs) |
| backgrounds-desktop | 100% | 89.48% (-10.52 pts) | ok (28 nodes, 1 subs) |
| backgrounds-mobile | 100% | 76.66% (-23.34 pts) | ok (28 nodes, 1 subs) |
| own-desktop | 98.39% | 90.61% (-7.78 pts) | ok (218 nodes, 3 subs) |
| own-mobile | 97.73% | 80.96% (-16.77 pts) | ok (215 nodes, 3 subs) |
