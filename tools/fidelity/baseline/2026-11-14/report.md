# Baseline Benchmark — 2026-11-14

| site | width | total s | slowest stage | fidelity % | JSON MB |
|---|---:|---:|---|---:|---:|
| marketing | 1440 | 3.48 | waitImages (3.14s) | 86.74% | 1.32 |
| marketing | 390 | 3.28 | waitImages (2.92s) | 88.75% | 1.26 |
| saas | 1440 | 3.85 | waitImages (2.58s) | 92.81% | 3.20 |
| saas | 390 | 5.47 | waitImages (4.18s) | 89.44% | 4.99 |
| news | 1440 | 3.18 | waitImages (2.50s) | 85.06% | 0.46 |
| news | 390 | 3.15 | waitImages (2.50s) | 85.27% | 0.42 |
| motion | 1440 | 3.38 | fonts (2.50s) | 94.01% | 0.87 |
| motion | 390 | 3.64 | fonts (2.50s) | 89.79% | 1.09 |
| own | 1440 | 1.66 | waitImages (0.94s) | 91.41% | 0.26 |
| own | 390 | 1.48 | waitImages (0.75s) | 93.84% | 0.25 |
| fixture | 1440 | 0.02 | nodes (0.01s) | 100.00% | 0.01 |
| fixture | 390 | 0.02 | nodes (0.01s) | 100.00% | 0.01 |

## Site details & hotspots

### marketing (1440px) — https://stripe.com
- Score: 86.74% (strict 78.93%), nodes: 1582, size delta: w=0 h=0
- Stages (ms): total=3475.4, scroll=0, waitImages=3144.2, walk=9, freezeTransforms=24.9, nodes=293, text=35.2, assets=0, fonts=0.7
- Counts: walked=1825, emitted=1582, textChars=5337, transformed=158, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c4 48.9%, r2c1 43.9%, r2c2 43.2%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-3/diff-mask.png`

### marketing (390px) — https://stripe.com
- Score: 88.75% (strict 80.73%), nodes: 1542, size delta: w=0 h=0
- Stages (ms): total=3279, scroll=0, waitImages=2917.7, walk=10.9, freezeTransforms=25.8, nodes=319.5, text=37.4, assets=0.1, fonts=0.8
- Counts: walked=1825, emitted=1542, textChars=5393, transformed=160, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r1c2 34%, r1c3 34%, r1c4 32.2%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-2/diff-mask.png`

### saas (1440px) — https://linear.app
- Score: 92.81% (strict 61.82%), nodes: 2106, size delta: w=0 h=0
- Stages (ms): total=3854.2, scroll=0, waitImages=2576, walk=10.7, freezeTransforms=18.1, nodes=340.7, text=13.9, assets=903, fonts=2.4
- Counts: walked=2174, emitted=2106, textChars=2526, transformed=56, assets=24 ok / 0 fail / 0 timeout (1.33 MB)
- Top hotspots: r6c4 39.7%, r6c1 39.3%, r6c3 39.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-2/diff-mask.png`

### saas (390px) — https://linear.app
- Score: 89.44% (strict 59.62%), nodes: 673, size delta: w=0 h=0
- Stages (ms): total=5473.1, scroll=0, waitImages=4180.7, walk=22.8, freezeTransforms=16.7, nodes=86.5, text=5.6, assets=1161, fonts=1.8
- Counts: walked=2174, emitted=673, textChars=1695, transformed=21, assets=9 ok / 0 fail / 0 timeout (3.30 MB)
- Top hotspots: r5c2 34.2%, r5c1 33.5%, r5c3 30.8%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-2/diff-mask.png`

### news (1440px) — https://www.bbc.com/news
- Score: 85.06% (strict 69.23%), nodes: 1015, size delta: w=0 h=0
- Stages (ms): total=3180.5, scroll=0, waitImages=2503, walk=3.1, freezeTransforms=5.5, nodes=122.5, text=25.2, assets=0.9, fonts=542.6
- Counts: walked=1225, emitted=1015, textChars=6513, transformed=12, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c3 62.6%, r0c4 61.9%, r0c5 57.4%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-2/diff-mask.png`

### news (390px) — https://www.bbc.com/news
- Score: 85.27% (strict 69.96%), nodes: 908, size delta: w=0 h=0
- Stages (ms): total=3150.8, scroll=0, waitImages=2504, walk=3, freezeTransforms=5.4, nodes=89.8, text=17, assets=0.5, fonts=545.9
- Counts: walked=1196, emitted=908, textChars=4713, transformed=12, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c1 71.1%, r0c0 68.5%, r0c2 66.4%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-1/diff-mask.png`

### motion (1440px) — https://www.apple.com/iphone/
- Score: 94.01% (strict 86.14%), nodes: 1154, size delta: w=0 h=0
- Stages (ms): total=3376, scroll=0, waitImages=0.9, walk=13.2, freezeTransforms=48.4, nodes=765.2, text=655.4, assets=42.7, fonts=2503
- Counts: walked=2630, emitted=1154, textChars=78135, transformed=380, assets=6 ok / 0 fail / 0 timeout (0.14 MB)
- Top hotspots: r5c2 16.6%, r4c2 16.3%, r4c3 16.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-1/diff-mask.png`

### motion (390px) — https://www.apple.com/iphone/
- Score: 89.79% (strict 75.78%), nodes: 1812, size delta: w=0 h=0
- Stages (ms): total=3644, scroll=0, waitImages=1.3, walk=25.6, freezeTransforms=46, nodes=1002.3, text=853.7, assets=61.4, fonts=2504.1
- Counts: walked=2630, emitted=1812, textChars=80058, transformed=157, assets=7 ok / 0 fail / 0 timeout (0.06 MB)
- Top hotspots: r5c1 16.5%, r5c4 16.5%, r5c2 16.3%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-1/diff-mask.png`

### own (1440px) — http://127.0.0.1:4173/
- Score: 91.41% (strict 90.94%), nodes: 554, size delta: w=0 h=0
- Stages (ms): total=1655.1, scroll=0, waitImages=941.3, walk=7.7, freezeTransforms=26.8, nodes=73, text=2.3, assets=32, fonts=1.5
- Counts: walked=1256, emitted=554, textChars=370, transformed=252, assets=1 ok / 0 fail / 0 timeout (0.01 MB)
- Top hotspots: r1c6 81.2%, r1c7 74.2%, r2c3 43.4%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-2/diff-mask.png`

### own (390px) — http://127.0.0.1:4173/
- Score: 93.84% (strict 85.85%), nodes: 516, size delta: w=0 h=0
- Stages (ms): total=1484.1, scroll=0, waitImages=748.4, walk=9.3, freezeTransforms=24.5, nodes=87, text=3.3, assets=31.4, fonts=1.5
- Counts: walked=1270, emitted=516, textChars=509, transformed=196, assets=1 ok / 0 fail / 0 timeout (0.01 MB)
- Top hotspots: r1c2 33%, r1c1 31.4%, r1c3 29.5%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-1/diff-mask.png`

### fixture (1440px) — tools/fidelity/fixture.html
- Score: 100% (strict 98.9%), nodes: 29, size delta: w=0 h=0
- Stages (ms): total=20.8, scroll=0, waitImages=3, walk=1.1, freezeTransforms=1.2, nodes=11.2, text=0, assets=0, fonts=0.6
- Counts: walked=25, emitted=29, textChars=0, transformed=1, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: none
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-1/diff-mask.png`

### fixture (390px) — tools/fidelity/fixture.html
- Score: 100% (strict 99.34%), nodes: 29, size delta: w=1 h=2
- Stages (ms): total=19, scroll=0, waitImages=2, walk=0.9, freezeTransforms=1.2, nodes=11, text=0, assets=0, fonts=0.6
- Counts: walked=25, emitted=29, textChars=0, transformed=1, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: none
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-2/diff-mask.png`

## Findings

### 1. Dominant stage per site (by share of `total`)
1. **`waitImages` dominates 4 of 5 real sites (50%–90% of total time):**
   - `marketing` (`stripe.com`): `3.14s` / `3.48s` (**90.5%**) at 1440px; `2.92s` / `3.28s` (**89.0%**) at 390px.
   - `news` (`bbc.com/news`): `2.50s` / `3.18s` (**78.7%**) at 1440px; `2.50s` / `3.15s` (**79.5%**) at 390px (hitting the 2500ms image-readiness deadline).
   - `saas` (`linear.app`): `2.58s` / `3.85s` (**66.8%**) at 1440px; `4.18s` / `5.47s` (**76.4%**) at 390px (`assets` is #2 at `0.90s` / `1.16s`).
   - `own` (Sales Canvas site): `0.94s` / `1.66s` (**56.9%**) at 1440px; `0.75s` / `1.48s` (**50.4%**) at 390px.
2. **`fonts` dominates `motion` (`apple.com/iphone/`):**
   - `fonts` (`extractWebFonts`) hits the `2500ms` budget: `2.50s` / `3.38s` (**74.1%**) at 1440px and `2.50s` / `3.64s` (**68.7%**) at 390px.
   - `nodes` is #2 at `0.77s` (1440px) and `1.00s` (390px).
3. **`fixture`**: `nodes` is `11.2ms` / `20.8ms` (1440px) and `11.0ms` / `19.0ms` (390px) — negligible, 100% fidelity.

### 2. Suspected hotspots — confirmed or ruled out
1. **Per-character Range measurement (`text` stage): Partially confirmed (site-dependent).**
   - Negligible on `marketing` (`35.2ms` / `37.4ms` for 5,337 / 5,393 chars), `saas` (`13.9ms` / `5.6ms` for 2,526 / 1,695 chars), `news` (`25.2ms` / `17.0ms` for 6,513 / 4,713 chars), and `own` (`2.3ms` / `3.3ms` for 370 / 509 chars).
   - Major on `motion` (`apple.com/iphone/`): **`655.4ms` (78,135 chars)** at 1440px and **`853.7ms` (80,058 chars)** at 390px (~85% of the `nodes` stage).
2. **Read/write interleave in `freezeTransform` loop: Ruled out as a primary bottleneck.**
   - `freezeTransforms` takes `5.4ms`–`48.4ms` across all sites (`12`–`380` transformed elements; ≤1.4% of total time even on `motion` with 380 transformed elements).
3. **Serial 2.5s waits (`waitForImages`, asset fetch, `transcodeToPng` / `fonts`): Confirmed as the #1 bottleneck.**
   - `waitImages` consumes `2.50s`–`4.18s` on `marketing`, `saas`, and `news`; `fonts` consumes `2.50s` on `motion`. Together, readiness/embedding timeouts account for most of the 3–5.5s runtime on real sites.
4. **Byte-by-byte `arrayBufferToBase64` and capture JSON transfer size: Partially confirmed for JSON size on asset-heavy pages.**
   - `saas` emits **`3.20 MB`** (1440px) and **`4.99 MB`** (390px, with `3.30 MB` of asset bytes across 9 assets) of capture JSON; `assets` takes `903ms` / `1161ms`. Other sites stay between `0.25 MB` (`own`) and `1.32 MB` (`marketing`).

### 3. Worst visual failure types observed in masks & screenshots
1. **Missing / unrendered images and media:**
   - `own` (1440px, hotspots `r1c6` 81.2%, `r1c7` 74.2%): product/example card photos are missing, leaving blank white cards.
   - `news` (1440px, hotspots `r0c3` 62.6%, `r0c4` 61.9%): article thumbnails and top hero/ad imagery are missing, with an oversized red `NEWS` block at the top.
   - `marketing` (1440px): hero WebGL/canvas graphics and product card illustrations are missing.
2. **Text wrapping, font-metrics, and overlapping text:**
   - `marketing`: hero headline wraps differently and overlaps `"and"`; section subheadings overlap body copy.
   - `saas` (`strictScore` 61.82% / 59.62%): pervasive 1–2px font/line-height drift across text and code blocks, plus `r6c4` (39.7%) solid mismatch on a testimonial card.
   - `own`: `Examples (3)` wraps as `Examples ( 3 )` and footer links overlap.
   - `motion`: dense legal footnote text shifts vertically across the lower half of the page.
3. **Missing or mispositioned gradients, blurs, and layered backgrounds:**
   - `marketing`: hero gradient and `"The backbone of global commerce"` backdrop render as a misplaced radial orange/purple blob on white, and a large yellow triangle overflows a lower card.
   - `saas`: dark-UI card surfaces and blur/gradient layers differ from the live render.

*(Cookie banners: no blocking full-page cookie modal covered the viewport on any of the 6 sites during capture.)*

## Replica path (added after review)

`pnpm fidelity:replica` on the same real sites, one run each (2026-11-14). Match = pixels
within tolerance; noise = antialiasing-level differences.

| site | width | replica match % | model match % (above) | replica size |
|---|---|---|---|---|
| marketing (stripe) | 1440 | 89.81 | 86.74 | 4.9 MB |
| marketing (stripe) | 768 | 91.06 | — | 5.0 MB |
| saas (linear) | 768 | 100.00 | — | 9.6 MB |
| saas (linear) | 390 | 99.84 | 89.44 | 9.5 MB |
| news (bbc) | 768 | 87.01 | — | 3.1 MB |
| news (bbc) | 390 | 99.79 | 85.27 | 3.1 MB |
| motion (apple) | 1440 | 98.30 | 94.01 | 2.2 MB |

5 of 12 runs failed in the harness, not the replica: `Page.captureScreenshot` errors and a
30 s screenshot timeout on pages 15,000+ px tall, and one 45 s `page.goto` timeout on bbc.

**Findings:** the replica beats the model path by 3–14 points wherever both ran, and is
near-perfect on linear/bbc mobile. Its cost is size (2–10 MB per page, all assets inlined).
The harness needs tiled screenshots for very tall pages before replica scores can gate CI.
