# capture-kit

Free, open-source web capture toolkit. Captures any website into a neutral intermediate JSON model, then exports it to pluggable design destinations. Sketch is treated as a first-class destination alongside SVG and future targets.

## Repo Map

```
capture-kit/
├── apps/
│   ├── extension/            # MV3 Chrome extension (popup, background service worker, serializer injector)
│   └── playground/           # Vite demonstration harness for DOM capture and file downloads
├── packages/
│   ├── model/                # Canonical Zod schemas, TypeScript types, emptyCapture factory, assertions
│   ├── serializer/           # Browser DOM -> Capture model extractor
│   └── destinations/
│       ├── sketch/           # Capture -> open sketch-file-format zip (.sketch)
│       ├── svg/              # Capture -> SVG string (.svg)
│       └── figma/            # Capture -> Figma payload stub (Phase 3)
├── tools/
│   └── diff/                 # Automated screenshot and rendering diff harness specification (Phase 4)
├── pnpm-workspace.yaml       # Workspace package definitions
├── tsconfig.base.json        # Base TypeScript compiler settings
├── package.json              # Root package configuration and scripts
└── README.md                 # Project documentation and roadmap
```

## Architecture

- Single neutral JSON model (`@capture-kit/model`): The serializer produces a single, flat, deterministic data structure describing frame bounds, layer geometry, typography, and assets.
- Pure destinations: Exporters (`sketch`, `svg`, `figma`) are pure transforms from model to target format without side-effects or browser API dependencies.
- Browser API boundary: Only `apps/extension` touches `chrome.*` APIs. Packages remain importable in standards-compliant browser environments.

## Phase Plan

- Phase 0 (Done): Core model, Phase 0 DOM serializer, valid Sketch archive generator, SVG export, extension MV3 shell, playground app.
- Phase 1 (Done): Serializer v1 with deeper real-page accuracy (Range text metrics, inline SVG vector serialization, CSS background-images, form controls, visual container and text separation).
- Phase 2 (Done): Sketch destination fidelity (strokes and borders, outer/inner box shadows, embedded image assets and native bitmap layers, multiple stacked fills, hierarchical group layers from parentId).
- Phase 3: Interactive visual element picker and Figma clipboard payload exporter.
- Phase 4: Accuracy harness in `tools/diff` (Playwright screenshot comparison, automated diff report), full-page scroll stitching, iframe traversal, and pseudo-elements.
- Phase 5: Production packaging, store zips, user options, and HTML export.

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
6. Click the capture-kit icon in the Chrome toolbar and press "Capture this tab". The serialized `capture.json` will be downloaded automatically.
