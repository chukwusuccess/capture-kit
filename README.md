# capture-kit

Capture any website into a **neutral intermediate model** (a flat node list
with boxes, styles, text and inlined assets) and export it to design-tool
formats through pluggable destinations.

- **Serializer** produces the neutral `Capture` model. Browser DOM only, no
  `chrome.*` APIs.
- **Destinations** are pure `model → file` transforms (Sketch `.sketch`,
  SVG, Figma clipboard — HTML planned).
- **Extension** is the only piece allowed to touch `chrome.*`.

## Repo map

```
apps/
  extension/       MV3 Chrome extension (popup + background SW + on-demand content script)
  playground/      Vite dev harness: run the serializer on a demo page, download JSON/.sketch/.svg
packages/
  model/           Capture types + zod schema + empty-capture factory (+ plain assert tests)
  serializer/      DOM → Capture
  destinations/
    sketch/        Capture → .sketch (jszip, open sketch-file-format)
    svg/           Capture → SVG string
    figma/         stub (Phase 3)
tools/
  diff/            future Playwright screenshot-diff accuracy harness (Phase 4)
```

## Commands

```sh
pnpm install
pnpm build        # typecheck all packages + build extension dist/ and playground dist/
pnpm test         # model schema checks (node assert, no test framework)

pnpm --filter @capture-kit/playground dev   # dev harness at http://localhost:5173
```

Load the extension: `pnpm --filter @capture-kit/extension build`, then Chrome
→ `chrome://extensions` → Developer mode → "Load unpacked" → `apps/extension/dist`.

## Phase plan

- **Phase 0 (this repo state)** — skeleton: model, serializer v0 (bg/opacity/
  radius/shadow/text/images), working .sketch writer (boxes + text), SVG
  writer, extension capture-to-`capture.json`, playground harness.
- **Phase 1** — serializer v1: nested frames, full box-shadow/multi-fill
  parsing, per-corner radius accuracy, better text.
- **Phase 2** — Sketch destination hardening: embedded images, strokes,
  shadows, nested groups, open-in-Sketch verification.
- **Phase 3** — export picker UI in the popup + Figma clipboard destination.
- **Phase 4** — hard accuracy: iframes, pseudo-elements, auto-scroll/lazy
  content, font embedding, screenshot-diff harness in `tools/diff`.
- **Phase 5** — polish: self-contained HTML destination, perf, error UX.

## License

MIT
