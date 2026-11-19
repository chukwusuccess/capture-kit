# tools/diff — screenshot-diff harness (future)

Placeholder for the accuracy harness planned in Phase 4:

- Drive a headless browser (Playwright) over a set of fixture pages.
- Capture the page screenshot AND run the capture-kit serializer + an
  exporter (SVG or headless-rendered HTML) for the same page.
- Diff the two images (pixel diff, e.g. pixelmatch) and report a per-page
  accuracy score, so serializer changes are measurable rather than vibes.

Nothing here yet. Phase 4.
