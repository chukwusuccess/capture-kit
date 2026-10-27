# capture-kit

Free, open-source web capture toolkit. It captures available page structure and assets into a neutral JSON model, then exports that model to design and development destinations. A capture is an observation of accessible browser state, not a guarantee of pixel equivalence or a replay of application behavior.

## Repository map

- `apps/extension/`: Manifest V3 Chrome extension for capture, element selection, sessions, and exports.
- `apps/figma-plugin/`: Figma development plugin for importing Capture JSON into editable Figma layers.
- `apps/playground/`: local demonstration harness.
- `packages/model/`: shared Capture model and validation.
- `packages/serializer/`: DOM and asset capture, readiness handling, and diagnostics.
- `packages/destinations/`: Sketch, SVG, Figma SVG clipboard, HTML, Markdown, and React exporters; Figma native import planning is also here.
- `tools/diff/`: preserved baseline fidelity fixture.
- `tools/fidelity/`: real-browser HTML capture/export comparison suite and report tooling.
- `scripts/`: Sketch archive verification and extension packaging.

## Install and build

Requires Node.js and pnpm. Install dependencies and build all workspace packages:

```bash
pnpm install
pnpm -r build
```

To load the unpacked Chrome extension, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`.

## Capture readiness, budgets, and diagnostics

Capture waits are bounded; pages that keep changing cannot hold the capture open indefinitely. Full-page scroll stitching defaults to at most 100 passes, 15 seconds, 100,000 pixels of scroll height, and two stable bottom passes. These limits can be changed through the serializer options. Image readiness defaults to a 2.5-second per-image deadline, a 5-second discovery-pass deadline, and concurrency of 8. Font readiness and asset processing default to 2.5 seconds; asset fetch concurrency defaults to 8.

The serializer records structured diagnostics when readiness is incomplete or a budget is reached. Examples include `image_timeout`, `image_failed`, `image_budget_exhausted`, `font_timeout`, `asset_timeout`, and scroll-stitch budget diagnostics. Consumers should inspect the capture diagnostics rather than treating a completed export as proof that every image, font, lazy-loaded section, or dynamic state was captured. A timed-out browser decode cannot be cancelled, so the serializer does not start replacement work in that slot while it may still be pending.

Captures contain the DOM and assets that the extension can observe. They do not execute or replay application logic, and cannot reliably preserve cross-origin frames, WebGL/canvas internals, animation over time, inaccessible content, or every browser-specific text-rendering effect.

## Saved capture sessions

The extension stores session indexes and completed Capture results in `chrome.storage.local`. It checkpoints session/job state so a service-worker restart can reconcile an interrupted job with saved results and leave unfinished work recoverable. The popup can reopen saved sessions and export completed results without recapturing them. Session state is scoped to the Chrome profile and its available extension storage; it is not a cloud backup.

Retention is bounded to eight saved sessions. When pruning is needed, active work and the newest completed result are protected; older eligible sessions and their results may be removed. Storage errors are surfaced, and a failed checkpoint is not represented as saved. Unsupported stored index versions are rejected rather than overwritten.

## Export formats and known limits

- **Figma SVG clipboard** exports an SVG payload for pasting. It is distinct from the native plugin and does not create Capture JSON-based native layers.
- **Figma native plugin** imports a `.capture.json` file downloaded using the extension's Figma Native export. Supported content is translated into editable frames, text, image, paint, and vector layers where available. Horizontal/vertical layout metadata can produce fixed-size Auto Layout frames; grid, wrapping, complex positioning, and unsupported or conflicting geometry use captured positions or diagnostics. Fonts, effects, and browser text shaping can render differently. Plugin build and automated tests do not establish that a logged-in Figma application successfully imported a file; that must be verified in Figma itself.
- **Sketch** exports a `.sketch` archive. Supported SVG paths are represented as editable vectors for path commands `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, and `Z`; arc paths are approximated with cubic curves. This does not mean all SVG elements, filters, clipping, or effects are preserved as vectors.
- **HTML** is a standalone HTML/CSS representation of the captured model. Its fidelity suite measures only this destination.
- **React** output is generated from the captured structure; responsive behavior is not guaranteed.
- **Markdown** exports a structured specification. **SVG** is a standalone SVG export.

## Tests and fidelity measurements

Run workspace builds and focused checks:

```bash
pnpm -r build
pnpm test
pnpm test:serializer
pnpm test:sketch
pnpm test:figma
pnpm test:html
pnpm test:react
pnpm test:markdown
pnpm test:diff
pnpm test:extension
pnpm test:fidelity:cli
pnpm test:fidelity
```

Run the preserved baseline browser fidelity check with `pnpm fidelity`. Run the difficult-page browser suite with:

```bash
pnpm fidelity:suite
```

The suite measures the preserved fixture and growing-lazy, wrapped-typography, nested-scroll, SVG-heavy, and responsive cases at desktop and mobile sizes using the HTML exporter. Without a minimum option, suite output is measurements, not a pass/fail claim that all cases meet a fidelity target. Current measured whole-page scores (desktop/mobile) are: original 100%; growing-lazy 100%/100%; wrapped-typography 93.55%/89.3%; nested-scroll 97.12%/95.68%; SVG-heavy 88.89%/88.87%; responsive 99.18%/98.7%. Use `pnpm fidelity:suite --min=88` as an explicit per-case regression floor, not as a claim that every region is accurate. The current run met that floor in all 11 cases. Review every case's score, worst regions, dimensions, source/render images, and diff masks: for example, the SVG-heavy mobile worst region was 52.2% mismatched and its desktop worst region was 95% mismatched. These measured gaps are known limitations; they are not evidence of native Sketch or Figma regression, and this suite does not validate Sketch rendering, Figma import/editability, Auto Layout, or SVG clipboard paste behavior.

## Figma plugin installation and import

Build the plugin with `pnpm --filter @capture-kit/figma-plugin build`. In Figma, use **Plugins > Development > Import plugin from manifest...** and select `apps/figma-plugin/dist/manifest.json`. In the extension, choose the Figma Native export to download a `.capture.json` file; run the imported development plugin in Figma and select that file. The plugin is separate from the Figma SVG clipboard destination. A successful TypeScript build or unit test is not a substitute for exercising the import in the actual Figma application.

## Extension packaging

Create the Chrome Web Store distribution archive with:

```bash
pnpm package:extension
```
