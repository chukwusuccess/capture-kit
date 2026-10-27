# tools/diff

`compareCaptureAccuracy` compares model node identity, bounding-box overlap,
first solid fill and text discrepancies. Its weighted accuracy score is not a
screenshot score and does not establish native importer fidelity.

## HTML screenshot harness

The adjacent `tools/fidelity` harness uses the existing raw Chrome CDP client,
the built extension serializer and the real HTML exporter. No Playwright or
additional image dependency is used.

```sh
pnpm fidelity
pnpm fidelity https://example.com --width=1280 --scroll-stitch
pnpm fidelity:suite
pnpm fidelity:suite --min=90 --out=/tmp/capture-fidelity
pnpm test:fidelity:cli
```

Build the extension first. Set `CHROME_PATH` if Chrome is not at the default
platform path. The suite preserves the original fixture and adds named desktop
and mobile cases for growing lazy content, wrapped mixed typography, nested
scrolling visible surfaces, SVG-heavy content, and responsive layouts. All
difficult fixtures are local and use no remote resources. Readiness and
scroll-stitch budgets pass through `runFidelity({ serializeOptions: ... })` to
the shipped serializer. The reference screenshot is taken after serialization
settles lazy content, at the same viewport and retained nested scroll offsets.
Screenshots use an explicit full-document clip without resizing the viewport.
The lazy fixture requires its final serialized batch marker; failing to reveal
the content is an error rather than a deceptively high score on a shorter page.

Each case writes `capture.json`, `render.html`, original/rendered PNGs, a red
pixel-difference mask and `report.json`. The suite writes `summary.json` with
every requested case; errors are retained in per-case `error.json` and cause a
nonzero exit while allowing the other cases to run. Capture diagnostics, exact
source/render dimensions and absolute size deltas remain visible. Worst-region
output provides grid coordinates, pixel bounds and mismatch counts. The
informational non-white pixel score excludes pixels near white in both images;
it is not semantic content segmentation, and colored backgrounds still count.

`--min` is an explicitly requested per-case whole-page percentage, never a suite
average. Invalid percentages, missing cases and capture errors cannot pass.
Without `--min`, the suite collects measurements only: no difficult-case quality
baseline has been inferred or invented. The example minimum above is usage
syntax, not an observed passing baseline. Inspect source images, masks, size
deltas and worst regions before adopting measured regression gates; blank
background can inflate the whole-page score. The original fixture's existing
pixel, geometry and worst-region gates remain in `pnpm test:fidelity`.

## Destination limits

This suite tests HTML raster fidelity only. It does not launch Sketch or Figma,
exercise native importers or clipboard behavior, verify editability, preserve
native vector semantics, or test native Auto Layout. A high HTML score must not
be reported as proof of Sketch/Figma parity. Unsupported HTML features and
serializer asset warnings are not hidden or exempted from measurements.
