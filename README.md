# capture-kit

Free, open-source web capture toolkit. Captures any website into a neutral intermediate JSON model, then exports it to pluggable design destinations. Sketch is treated as a first-class destination alongside SVG, Figma, and standalone HTML.

## Repo Map

```
capture-kit/
├── apps/
│   ├── extension/            # MV3 Chrome extension (popup, background service worker, element picker, multi-format export)
│   └── playground/           # Vite demonstration harness for DOM capture, element inspector, and file downloads
├── packages/
│   ├── model/                # Canonical Zod schemas, TypeScript types, emptyCapture factory, assertions
│   ├── serializer/           # Browser DOM -> Capture model extractor (Range text metrics, SVGs, iframes, pseudo-elements)
│   └── destinations/
│       ├── sketch/           # Capture -> open sketch-file-format zip (.sketch) with bitmap assets, groups, and multi-fills
│       ├── svg/              # Capture -> SVG string (.svg)
│       ├── figma/            # Capture -> Figma HTML/SVG clipboard payload (Cmd+V into Figma canvas)
│       ├── html/             # Capture -> standalone HTML/CSS component document (.html)
│       ├── markdown/         # Capture -> structured design-token component specification (.md) for AI reproduction
│       └── react/            # Capture -> production-ready React + Tailwind CSS component (.tsx)
│   └── diff/                 # Automated layout comparison engine (IoU geometry, color matching, diff reports)
├── scripts/
│   ├── verify-sketch.ts      # Programmatic .sketch archive structure and coordinate verification
│   └── package-extension.ts  # Chrome Web Store distribution zip packager
├── pnpm-workspace.yaml       # Workspace package definitions
├── tsconfig.base.json        # Base TypeScript compiler settings
├── package.json              # Root package configuration and scripts
└── README.md                 # Project documentation and roadmap
```

## Architecture

- Single neutral JSON model (`@capture-kit/model`): The serializer produces a single, flat, deterministic data structure describing frame bounds, layer geometry, typography, and assets.
- Pure destinations: Exporters (`sketch`, `svg`, `figma`, `html`, `markdown`, `react`) are pure transforms from model to target format without side-effects or browser API dependencies.
- Browser API boundary: Only `apps/extension` touches `chrome.*` APIs. Packages remain importable in standards-compliant browser environments.

## Phase Plan

- Phase 0 (Done): Core model, Phase 0 DOM serializer, valid Sketch archive generator, SVG export, extension MV3 shell, playground app.
- Phase 1 (Done): Serializer v1 with deeper real-page accuracy (Range text metrics, inline SVG vector serialization, CSS background-images, form controls, visual container and text separation).
- Phase 2 (Done): Sketch destination fidelity (strokes and borders, outer/inner box shadows, embedded image assets and native bitmap layers, multiple stacked fills, hierarchical group layers from parentId).
- Phase 3 (Done): Interactive visual element picker and Figma clipboard payload exporter (paste vectors directly into Figma with Cmd+V).
- Phase 4 (Done): Accuracy diff harness in `tools/diff`, full-page scroll stitching and lazy-load trigger, same-origin iframe traversal, and pseudo-elements (::before & ::after).
- Phase 5 (Done): Production packaging (`pnpm package:extension`), store zip generation, persistent user options in Chrome storage, and standalone HTML export destination.

## Commands

Install dependencies:
```bash
pnpm install
```

Build all packages and apps:
```bash
pnpm -r build
```

Run model validation tests:
```bash
pnpm test
```

Run serializer accuracy tests:
```bash
pnpm test:serializer
```

Run programmatic .sketch archive verification:
```bash
pnpm test:sketch
```

Run Figma destination clipboard tests:
```bash
pnpm test:figma
```

Run HTML destination export tests:
```bash
pnpm test:html
```

Run Markdown AI export tests:
```bash
pnpm test:markdown
```

Run React Tailwind export tests:
```bash
pnpm test:react
```

Run visual accuracy diff harness tests:
```bash
pnpm test:diff
```

Package extension for Chrome Web Store:
```bash
pnpm package:extension
```

Start the playground demo locally:
```bash
pnpm --filter @capture-kit/playground dev
```

## How to Load the Extension in Chrome

1. Build the extension package:
   ```bash
   pnpm -r build
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable the "Developer mode" toggle in the upper right corner.
4. Click "Load unpacked".
5. Select the directory:
   `<repo-root>/apps/extension/dist`
6. Click the capture-kit icon in the Chrome toolbar. You can capture the full tab, inspect and pick an individual element, configure auto-scroll stitching, or copy directly to Figma.
