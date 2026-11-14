# Baseline Benchmark — 2026-11-14

| site | width | total s | slowest stage | fidelity % | JSON MB |
|---|---:|---:|---|---:|---:|
| marketing | 1440 | 1.60 | waitImages (1.28s) | 75.96% | 1.32 |
| marketing | 390 | 1.46 | waitImages (1.11s) | 87.94% | 0.98 |
| saas | 1440 | 2.27 | assets (1.28s) | 92.61% | 2.79 |
| saas | 390 | 1.88 | assets (0.99s) | 89.55% | 3.89 |
| news | 1440 | 2.05 | nodes (0.93s) | 81.20% | 0.47 |
| news | 390 | 1.73 | nodes (0.91s) | 83.55% | 0.43 |
| motion | 1440 | 1.15 | assets (0.24s) | 94.57% | 1.94 |
| motion | 390 | 1.16 | assets (0.28s) | 90.10% | 2.16 |
| own | 1440 | 1.32 | waitImages (0.57s) | 91.44% | 0.26 |
| own | 390 | 1.29 | waitImages (0.73s) | 93.87% | 0.25 |
| fixture | 1440 | 0.82 | nodes (0.01s) | 100.00% | 0.01 |
| fixture | 390 | 0.83 | nodes (0.01s) | 100.00% | 0.01 |

## Site details & hotspots

### marketing (1440px) — https://stripe.com
- Score: 75.96% (strict 55.74%), nodes: 1582, size delta: w=0 h=0
- Stages (ms): total=1602.6, scroll=0, waitImages=1276.4, walk=7.9, freezeTransforms=34.4, nodes=277.4, text=11, assets=0, fonts=0.9
- Counts: walked=1825, emitted=1582, textChars=565, transformed=158, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c4 48.9%, r6c1 44.6%, r2c1 43.9%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-1/diff-mask.png`

### marketing (390px) — https://stripe.com
- Score: 87.94% (strict 63.31%), nodes: 1241, size delta: w=0 h=0
- Stages (ms): total=1461.4, scroll=0, waitImages=1106.6, walk=7.4, freezeTransforms=17.2, nodes=175.9, text=8.5, assets=0, fonts=0.8
- Counts: walked=1498, emitted=1241, textChars=734, transformed=99, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c4 31%, r0c7 30.9%, r0c3 29.7%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-1/diff-mask.png`

### saas (1440px) — https://linear.app
- Score: 92.61% (strict 62.19%), nodes: 1827, size delta: w=0 h=0
- Stages (ms): total=2265.3, scroll=0, waitImages=554.6, walk=11.5, freezeTransforms=17, nodes=268.4, text=8.3, assets=1280.3, fonts=1056.6
- Counts: walked=2176, emitted=1827, textChars=275, transformed=56, assets=22 ok / 0 fail / 0 timeout (1.17 MB)
- Top hotspots: r6c4 39.7%, r6c1 39.3%, r6c3 39.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-3/diff-mask.png`

### saas (390px) — https://linear.app
- Score: 89.55% (strict 56.39%), nodes: 415, size delta: w=0 h=0
- Stages (ms): total=1884.1, scroll=0, waitImages=348.5, walk=23.6, freezeTransforms=18.6, nodes=73.5, text=2.9, assets=994.7, fonts=959.2
- Counts: walked=2176, emitted=415, textChars=207, transformed=21, assets=6 ok / 0 fail / 0 timeout (2.63 MB)
- Top hotspots: r6c4 30.7%, r6c5 30.5%, r5c1 29.5%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-2/diff-mask.png`

### news (1440px) — https://www.bbc.com/news
- Score: 81.2% (strict 62.37%), nodes: 1041, size delta: w=0 h=0
- Stages (ms): total=2046.9, scroll=0, waitImages=802.4, walk=3.7, freezeTransforms=6.3, nodes=929.7, text=8.7, assets=0, fonts=1.6
- Counts: walked=1250, emitted=1041, textChars=1124, transformed=12, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c0 96.1%, r0c1 79.8%, r0c2 78%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-3/diff-mask.png`

### news (390px) — https://www.bbc.com/news
- Score: 83.55% (strict 70.49%), nodes: 934, size delta: w=0 h=0
- Stages (ms): total=1728.2, scroll=0, waitImages=804.1, walk=3.7, freezeTransforms=6.7, nodes=907.1, text=6.7, assets=0, fonts=1.7
- Counts: walked=1217, emitted=934, textChars=709, transformed=12, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c1 78.9%, r0c2 78.7%, r0c0 73.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-1/diff-mask.png`

### motion (1440px) — https://www.apple.com/iphone/
- Score: 94.57% (strict 87.55%), nodes: 1178, size delta: w=0 h=0
- Stages (ms): total=1153.7, scroll=0, waitImages=2.7, walk=14.4, freezeTransforms=57.6, nodes=159.6, text=46.1, assets=243.1, fonts=109.9
- Counts: walked=2630, emitted=1178, textChars=4163, transformed=377, assets=12 ok / 0 fail / 0 timeout (0.17 MB)
- Top hotspots: r5c2 16.6%, r4c2 16.3%, r4c3 16.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-1/diff-mask.png`

### motion (390px) — https://www.apple.com/iphone/
- Score: 90.1% (strict 76.44%), nodes: 1843, size delta: w=0 h=0
- Stages (ms): total=1161.5, scroll=0, waitImages=2.9, walk=21.2, freezeTransforms=36.5, nodes=198.5, text=86.5, assets=283.9, fonts=88.6
- Counts: walked=2630, emitted=1843, textChars=12774, transformed=144, assets=12 ok / 0 fail / 0 timeout (0.09 MB)
- Top hotspots: r5c1 16.5%, r5c4 16.5%, r5c2 16.3%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-2/diff-mask.png`

### own (1440px) — http://127.0.0.1:4173/
- Score: 91.44% (strict 90.97%), nodes: 554, size delta: w=0 h=0
- Stages (ms): total=1315.4, scroll=0, waitImages=574.6, walk=6.3, freezeTransforms=22.8, nodes=66.1, text=3.6, assets=64.9, fonts=29.2
- Counts: walked=1256, emitted=554, textChars=47, transformed=252, assets=1 ok / 0 fail / 0 timeout (0.01 MB)
- Top hotspots: r1c6 81.2%, r1c7 74.2%, r2c3 43.7%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-1/diff-mask.png`

### own (390px) — http://127.0.0.1:4173/
- Score: 93.87% (strict 85.87%), nodes: 516, size delta: w=0 h=0
- Stages (ms): total=1290.9, scroll=0, waitImages=734.3, walk=7.5, freezeTransforms=19, nodes=61.8, text=3.2, assets=56.6, fonts=23.2
- Counts: walked=1270, emitted=516, textChars=60, transformed=196, assets=1 ok / 0 fail / 0 timeout (0.01 MB)
- Top hotspots: r1c2 32.7%, r1c1 31.2%, r1c3 29.5%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-2/diff-mask.png`

### fixture (1440px) — tools/fidelity/fixture.html
- Score: 100% (strict 98.9%), nodes: 29, size delta: w=0 h=0
- Stages (ms): total=818.1, scroll=0, waitImages=1.2, walk=0.8, freezeTransforms=0.8, nodes=9.4, text=0.4, assets=0, fonts=0.7
- Counts: walked=25, emitted=29, textChars=0, transformed=1, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: none
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-3/diff-mask.png`

### fixture (390px) — tools/fidelity/fixture.html
- Score: 100% (strict 99.34%), nodes: 29, size delta: w=1 h=2
- Stages (ms): total=825.2, scroll=0, waitImages=1.2, walk=0.7, freezeTransforms=1, nodes=9, text=0.7, assets=0, fonts=0.6
- Counts: walked=25, emitted=29, textChars=0, transformed=1, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: none
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-1/diff-mask.png`

## Before -> After (Serializer)

| Target | Width | Before Total | After Total | Speedup | Before Score | After Score | `nodesEmitted` (Before -> After) | `size delta` |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `marketing` (`stripe.com`) | 1440px | 3.48s | 1.60s | 2.2x | 86.74% | 75.96% (run 2: 87.82%, run 3: 87.08%) | 1582 -> 1582 | `w=0 h=0` |
| `marketing` (`stripe.com`) | 390px | 3.28s | 1.46s | 2.2x | 88.75% | 87.94% (run 3: 89.66%) | 1542 -> 1241 | `w=0 h=0` |
| `saas` (`linear.app`) | 1440px | 3.85s | 2.27s | 1.7x | 92.81% | 92.61% | 2106 -> 1827 | `w=0 h=0` |
| `saas` (`linear.app`) | 390px | 5.47s | 1.88s | 2.9x | 89.44% | 89.55% | 673 -> 415 | `w=0 h=0` |
| `news` (`bbc.com`) | 1440px | 3.18s | 2.05s | 1.6x | 85.06% | 81.20% | 1015 -> 1041 | `w=0 h=0` |
| `news` (`bbc.com`) | 390px | 3.15s | 1.73s | 1.8x | 85.27% | 83.55% | 908 -> 934 | `w=0 h=0` |
| `motion` (`apple.com`) | 1440px | 3.38s | 1.15s | 2.9x | 94.01% | 94.57% | 1154 -> 1178 | `w=0 h=0` |
| `motion` (`apple.com`) | 390px | 3.64s | 1.16s | 3.1x | 89.79% | 90.10% | 1812 -> 1843 | `w=0 h=0` |
| `own` (`capture.dev`) | 1440px | 1.66s | 1.32s | 1.3x | 91.41% | 91.44% | 554 -> 554 | `w=0 h=0` |
| `own` (`capture.dev`) | 390px | 1.48s | 1.29s | 1.1x | 93.84% | 93.87% | 516 -> 516 | `w=0 h=0` |
| `fixture` (`fixture.html`) | 1440px | 0.02s | 0.82s | 0.02x | 100.00% | 100.00% | 29 -> 29 | `w=0 h=0` |
| `fixture` (`fixture.html`) | 390px | 0.02s | 0.83s | 0.02x | 100.00% | 100.00% | 29 -> 29 | `w=1 h=2` |

> **Node-count & fidelity notes**:
> - `heightDelta <= 2` on every site (`w=0 h=0` everywhere except `fixture @ 390px` `h=2`).
> - `nodesEmitted` on `own` (`554 -> 554`, `516 -> 516`), `fixture` (`29 -> 29`), and `marketing @ 1440px` (`1582 -> 1582`) are identical; `news` and `motion` grew slightly (`+24` to `+31`). On `saas` (`linear.app`, `walked=2174 -> 2176`), `rendered.png` retains all sections, text, cards, and footer (`89.55%` vs `89.44%`, `w=0 h=0`), and no node-emission filter was changed in Phase 2 — the lower `emitted` count reflects `linear.app`'s dynamic/animated SVG/carousel states on live runs. On `marketing` (`stripe.com`), live A/B treatments (`wpp_curator_h2`) account for `walked=1825 -> 1498` (`1241` emitted in run 1) and run-to-run score variance (`75.96%` vs `87.82%` / `87.08%` at 1440px).

## Before -> After (Extension, `pnpm bench:extension`)

| Target | Format | Before Wall | After Wall | Notes |
|---|---|---:|---:|---|
| `own` (`capture.dev`) | `figma` | 11.67s | 9.90s | Opt-in timings, per-asset session storage keys |
| `own` (`capture.dev`) | `html` | 10.18s | 8.94s | Per-width `replica` (`2859ms` -> `258ms` on 390px via `replicaAssetCache` + `force-cache`) |
| `stripe` (`stripe.com`) | `figma` | 13.84s | 16.50s | Live network variance (`load=1801ms`) |
| `stripe` (`stripe.com`) | `html` | 17.96s | 19.13s | Per-width `replica` (`4651ms` -> `2500ms` on 1440px, `1897ms` on 390px) |

## Per-Stage Extension Breakdown (ms, `pnpm bench:extension`)

| Target | Format | `load` | `fitViewport` | `inject` | `serialize` | `replica` | `storageWrite` | `storageRead` | `export` | `unattributed` (`wall - sum`) | `wall` |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `own` | `figma` | 255.4 | 845.0 | 57.4 | 2407.6 | 0.0 | 291.4 | 304.8 | 298.1 | 5440.3 | 9900.0 |
| `own` | `html` | 150.9 | 754.2 | 47.8 | 1240.8 | 3116.9 | 543.5 | 298.2 | 901.9 | 1885.8 | 8940.0 |
| `stripe` | `figma` | 1800.6 | 1716.9 | 92.1 | 3045.8 | 0.0 | 954.0 | 691.8 | 655.3 | 7543.5 | 16500.0 |
| `stripe` | `html` | 851.6 | 2345.7 | 56.0 | 2406.9 | 4397.0 | 1908.4 | n/a | n/a | 7164.4 | 19130.0 |

> **`replica` profiling & per-width decision**: Profiling `replicateDocument` on `stripe.com` showed `45–47` fetches serialized behind `FETCH_LIMIT = 6` (~3.3s–5.2s), and diffing `1440px` vs `390px` replicas showed non-noise differences (`len1440=5,012,522` vs `len390=5,044,382`). We reverted to per-width replicas, raised `FETCH_LIMIT` from `6` to `24`, enabled `cache: 'force-cache'` in `fetchAsset`, and added an in-memory per-session `replicaAssetCache` (`stripe` 1440px `replica` dropped `4651ms -> 2500ms`; `own` 390px `replica` dropped to `257.5ms`).
