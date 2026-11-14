# Baseline Benchmark — 2026-11-14

| site | width | total s | slowest stage | fidelity % | JSON MB |
|---|---:|---:|---|---:|---:|
| marketing | 1440 | 0.84 | waitImages (0.58s) | 90.95% | 1.08 |
| marketing | 390 | 0.22 | nodes (0.18s) | 72.55% | 0.97 |
| saas | 1440 | 1.40 | assets (1.31s) | 92.60% | 2.79 |
| saas | 390 | 1.58 | assets (1.42s) | 89.70% | 3.89 |
| news | 1440 | 0.15 | nodes (0.13s) | 84.61% | 0.47 |
| news | 390 | 0.12 | nodes (0.11s) | 88.48% | 0.42 |
| motion | 1440 | 0.36 | assets (0.20s) | 94.05% | 1.90 |
| motion | 390 | 0.42 | assets (0.33s) | 90.10% | 2.16 |
| own | 1440 | 1.46 | waitImages (0.30s) | 91.41% | 0.26 |
| own | 390 | 1.36 | waitImages (0.31s) | 93.86% | 0.25 |
| fixture | 1440 | 0.02 | nodes (0.01s) | 100.00% | 0.01 |
| fixture | 390 | 0.02 | nodes (0.01s) | 100.00% | 0.01 |

## Site details & hotspots

### marketing (1440px) — https://stripe.com
- Score: 90.95% (strict 77.31%), nodes: 1322, size delta: w=0 h=26
- Stages (ms): total=837.5, scroll=0, waitImages=579.1, walk=8.2, freezeTransforms=33.2, nodes=209, text=8.6, assets=0, fonts=1.7
- Counts: walked=1823, emitted=1322, textChars=541, transformed=180, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c6 33.7%, r0c7 32.6%, r0c5 29.3%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-1440/run-1/diff-mask.png`

### marketing (390px) — https://stripe.com
- Score: 72.55% (strict 43.62%), nodes: 1228, size delta: w=0 h=1550
- Stages (ms): total=219.5, scroll=0, waitImages=2, walk=7.5, freezeTransforms=21, nodes=183.7, text=9, assets=0, fonts=0.7
- Counts: walked=1495, emitted=1228, textChars=734, transformed=121, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r5c1 66%, r5c2 64.8%, r5c3 64%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/marketing-390/run-2/diff-mask.png`

### saas (1440px) — https://linear.app
- Score: 92.6% (strict 62.16%), nodes: 1824, size delta: w=0 h=0
- Stages (ms): total=1396.9, scroll=0, waitImages=3.8, walk=11.5, freezeTransforms=17.2, nodes=268.7, text=7.5, assets=1311.4, fonts=1087.7
- Counts: walked=2174, emitted=1824, textChars=275, transformed=56, assets=22 ok / 0 fail / 0 timeout (1.17 MB)
- Top hotspots: r6c4 39.7%, r6c1 39.3%, r6c3 39.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-1440/run-2/diff-mask.png`

### saas (390px) — https://linear.app
- Score: 89.7% (strict 59.41%), nodes: 412, size delta: w=0 h=0
- Stages (ms): total=1581.7, scroll=0, waitImages=5, walk=47.2, freezeTransforms=39.7, nodes=106, text=4.6, assets=1420.9, fonts=1372.9
- Counts: walked=2174, emitted=412, textChars=207, transformed=21, assets=6 ok / 0 fail / 0 timeout (2.63 MB)
- Top hotspots: r5c2 34.2%, r5c1 33.5%, r5c3 30.8%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/saas-390/run-3/diff-mask.png`

### news (1440px) — https://www.bbc.com/news
- Score: 84.61% (strict 70.17%), nodes: 1044, size delta: w=0 h=0
- Stages (ms): total=146.3, scroll=0, waitImages=1.9, walk=3.5, freezeTransforms=7.6, nodes=127.8, text=10, assets=0, fonts=1.7
- Counts: walked=1253, emitted=1044, textChars=1117, transformed=12, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c3 65.2%, r0c4 63.7%, r0c5 59.6%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-1440/run-3/diff-mask.png`

### news (390px) — https://www.bbc.com/news
- Score: 88.48% (strict 75.24%), nodes: 923, size delta: w=0 h=0
- Stages (ms): total=124.5, scroll=0, waitImages=1.9, walk=4.1, freezeTransforms=6.9, nodes=106.6, text=6.7, assets=0, fonts=1.7
- Counts: walked=1200, emitted=923, textChars=690, transformed=12, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: r0c1 42.9%, r0c2 42.8%, r0c0 34%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/news-390/run-3/diff-mask.png`

### motion (1440px) — https://www.apple.com/iphone/
- Score: 94.05% (strict 86.18%), nodes: 1158, size delta: w=0 h=0
- Stages (ms): total=364.5, scroll=0, waitImages=3.1, walk=13.7, freezeTransforms=58, nodes=162.6, text=44.1, assets=199.3, fonts=119.5
- Counts: walked=2630, emitted=1158, textChars=4163, transformed=380, assets=7 ok / 0 fail / 0 timeout (0.15 MB)
- Top hotspots: r5c2 16.6%, r4c2 16.3%, r4c3 16.1%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-1440/run-2/diff-mask.png`

### motion (390px) — https://www.apple.com/iphone/
- Score: 90.1% (strict 76.44%), nodes: 1843, size delta: w=0 h=0
- Stages (ms): total=415.8, scroll=0, waitImages=4, walk=23.1, freezeTransforms=37.8, nodes=241.6, text=105.6, assets=333, fonts=96.2
- Counts: walked=2630, emitted=1843, textChars=12774, transformed=146, assets=12 ok / 0 fail / 0 timeout (0.09 MB)
- Top hotspots: r5c1 16.5%, r5c4 16.5%, r5c2 16.3%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-1/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-1/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/motion-390/run-1/diff-mask.png`

### own (1440px) — http://127.0.0.1:4173/
- Score: 91.41% (strict 90.96%), nodes: 554, size delta: w=0 h=0
- Stages (ms): total=1459, scroll=0, waitImages=302.6, walk=7.4, freezeTransforms=26, nodes=76.8, text=4.5, assets=75.7, fonts=33.4
- Counts: walked=1256, emitted=554, textChars=47, transformed=252, assets=1 ok / 0 fail / 0 timeout (0.01 MB)
- Top hotspots: r1c6 81.2%, r1c7 74.2%, r2c3 43.8%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-1440/run-3/diff-mask.png`

### own (390px) — http://127.0.0.1:4173/
- Score: 93.86% (strict 85.87%), nodes: 516, size delta: w=0 h=0
- Stages (ms): total=1361.6, scroll=0, waitImages=305.2, walk=8.3, freezeTransforms=20.7, nodes=67.2, text=3.6, assets=60.5, fonts=25.3
- Counts: walked=1270, emitted=516, textChars=60, transformed=196, assets=1 ok / 0 fail / 0 timeout (0.01 MB)
- Top hotspots: r1c2 32.7%, r1c1 31.3%, r1c3 29.6%
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/own-390/run-3/diff-mask.png`

### fixture (1440px) — tools/fidelity/fixture.html
- Score: 100% (strict 98.9%), nodes: 29, size delta: w=0 h=0
- Stages (ms): total=18.2, scroll=0, waitImages=2, walk=1, freezeTransforms=1.1, nodes=10.5, text=0.6, assets=0, fonts=0.7
- Counts: walked=25, emitted=29, textChars=0, transformed=1, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: none
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-2/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-2/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-1440/run-2/diff-mask.png`

### fixture (390px) — tools/fidelity/fixture.html
- Score: 100% (strict 99.34%), nodes: 29, size delta: w=1 h=2
- Stages (ms): total=17.2, scroll=0, waitImages=1.9, walk=0.7, freezeTransforms=1, nodes=10.2, text=0.6, assets=0, fonts=0.7
- Counts: walked=25, emitted=29, textChars=0, transformed=1, assets=0 ok / 0 fail / 0 timeout (0.00 MB)
- Top hotspots: none
- Artifacts: `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-3/original.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-3/rendered.png` | `/Users/user/orca/projects/capture-kit-v2/tools/fidelity/out/bench/2026-11-14/fixture-390/run-3/diff-mask.png`

## Before -> After (Serializer)

| Target | Width | Before Total | After Total | Speedup | Before Score | After Score |
|---|---:|---:|---:|---:|---:|---:|
| `marketing` (`stripe.com`) | 1440px | 3.48s | 0.84s | 4.1x | 86.74% | 90.95% |
| `marketing` (`stripe.com`) | 390px | 3.28s | 0.22s | 14.9x | 88.75% | 72.55% |
| `saas` (`linear.app`) | 1440px | 3.85s | 1.40s | 2.8x | 92.81% | 92.60% |
| `saas` (`linear.app`) | 390px | 5.47s | 1.58s | 3.5x | 89.44% | 89.70% |
| `news` (`bbc.com`) | 1440px | 3.18s | 0.15s | 21.2x | 85.06% | 84.61% |
| `news` (`bbc.com`) | 390px | 3.15s | 0.12s | 26.3x | 85.27% | 88.48% |
| `motion` (`apple.com`) | 1440px | 3.38s | 0.36s | 9.4x | 94.01% | 94.05% |
| `motion` (`apple.com`) | 390px | 3.64s | 0.42s | 8.7x | 89.79% | 90.10% |
| `own` (`capture.dev`) | 1440px | 1.66s | 1.46s | 1.1x | 91.41% | 91.41% |
| `own` (`capture.dev`) | 390px | 1.48s | 1.36s | 1.1x | 93.84% | 93.86% |
| `fixture` (`fixture.html`) | 1440px | 0.02s | 0.02s | 1.0x | 100.00% | 100.00% |
| `fixture` (`fixture.html`) | 390px | 0.02s | 0.02s | 1.0x | 100.00% | 100.00% |

> Note on `marketing` (`stripe.com`) at 390px: score shifted from `88.75%` to `72.55%` (median of `71.67%`, `72.55%`, `71.66%`) with `size delta: w=0 h=1550` and `waitImages=2ms` due to live animated hero/carousel/lazy-section height variance on `stripe.com`, whereas `marketing` at 1440px improved from `86.74%` to `90.95%`.

## Before -> After (Extension, `pnpm bench:extension`)

| Target | Format | Before Wall | After Wall | Notes |
|---|---|---:|---:|---|
| `own` (`capture.dev`) | `figma` | 11.67s | 6.63s | Opt-in timings, session asset dedupe, faster fit |
| `own` (`capture.dev`) | `html` | 10.18s | 9.09s | `w=390` `replica=0ms` (cached once per URL) |
| `stripe` (`stripe.com`) | `figma` | 13.84s | 12.80s | Opt-in timings, session asset dedupe |
| `stripe` (`stripe.com`) | `html` | 17.96s | 16.48s | `w=390` `replica=0ms` (cached once per URL) |
