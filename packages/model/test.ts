import assert from 'node:assert';
import {
  CaptureSchema,
  SiteCaptureSchema,
  NodeSchema,
  emptyCapture,
  type Capture,
} from './src/index.js';

function runTests(): void {
  // 1. Accepts minimal capture
  const minimal = emptyCapture();
  const parsedMinimal = CaptureSchema.parse(minimal);
  assert.strictEqual(parsedMinimal.version, '0.2.2');
  assert.strictEqual(parsedMinimal.nodes.length, 0);
  assert.ok(!('diagnostics' in parsedMinimal), 'Old captures must not gain diagnostics by default');
  const warning = { code: 'image_timeout', message: 'Image loading timed out', severity: 'warning' as const, nodeId: 'image-1' };
  const withDiagnostics = CaptureSchema.parse(emptyCapture({ diagnostics: [warning] }));
  assert.deepStrictEqual(withDiagnostics.diagnostics, [warning]);
  assert.strictEqual(CaptureSchema.safeParse({ ...minimal, diagnostics: [{ ...warning, severity: 'error' }] }).success, false);

  // 2. Accepts capture with full nodes
  const fullCapture: Capture = {
    url: 'https://example.com',
    version: '0.2.2',
    frame: {
      width: 1440,
      height: 900,
      baseURI: 'https://example.com/',
    },
    nodes: [
      {
        id: 'node-root',
        type: 'frame',
        box: { x: 0, y: 0, w: 1440, h: 900 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'node-heading',
        parentId: 'node-root',
        type: 'text',
        box: { x: 40, y: 40, w: 600, h: 48 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Hello World',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 1.5,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(0, 0, 0, 1)',
        },
      },
      {
        id: 'node-image',
        parentId: 'node-root',
        type: 'image',
        box: { x: 40, y: 120, w: 200, h: 200 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
          shadows: [],
        },
        assetRef: 'img-1',
      },
    ],
    assets: {
      'img-1': {
        kind: 'image',
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    },
    fonts: [{ family: 'system-ui', weight: 700 }],
  };

  const parsedFull = CaptureSchema.parse(fullCapture);
  assert.strictEqual(parsedFull.nodes.length, 3);
  assert.strictEqual(parsedFull.nodes[1].text?.content, 'Hello World');

  // 3. Rejects malformed capture (missing frame or wrong types)
  const malformedCapture = {
    url: 'https://example.com',
    version: '0.2.2',
    // missing frame
    nodes: 'not an array',
  };
  const malformedResult = CaptureSchema.safeParse(malformedCapture);
  assert.strictEqual(malformedResult.success, false, 'Expected malformed capture to fail schema validation');

  // 4. Rejects a node with a bad box (negative width)
  const badBoxNode = {
    id: 'bad-box-1',
    type: 'rect',
    box: { x: 10, y: 10, w: -50, h: 100 },
    style: {
      fills: [],
      strokes: [],
      opacity: 1,
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      shadows: [],
    },
  };
  const badBoxResult = NodeSchema.safeParse(badBoxNode);
  assert.strictEqual(badBoxResult.success, false, 'Expected node with negative width to fail schema validation');

  // 5. Rejects a node with missing box coordinates
  const missingBoxNode = {
    id: 'bad-box-2',
    type: 'rect',
    box: { x: 10, y: 10 },
    style: {
      fills: [],
      strokes: [],
      opacity: 1,
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      shadows: [],
    },
  };
  const missingBoxResult = NodeSchema.safeParse(missingBoxNode);
  assert.strictEqual(missingBoxResult.success, false, 'Expected node with incomplete box to fail schema validation');

  // 6. Rejects invalid node type
  const badTypeNode = {
    id: 'bad-type-1',
    type: 'unknown_type',
    box: { x: 0, y: 0, w: 100, h: 100 },
    style: {
      fills: [],
      strokes: [],
      opacity: 1,
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      shadows: [],
    },
  };
  const badTypeResult = NodeSchema.safeParse(badTypeNode);
  assert.strictEqual(badTypeResult.success, false, 'Expected node with invalid type to fail schema validation');

  // 7. Accepts multi-page SiteCapture
  const siteCapture = {
    domain: 'example.com',
    capturedAt: new Date().toISOString(),
    pages: [
      {
        url: 'https://example.com/',
        path: '/',
        title: 'Home',
        capture: emptyCapture({ url: 'https://example.com/' }),
      },
      {
        url: 'https://example.com/pricing',
        path: '/pricing',
        title: 'Pricing',
        capture: emptyCapture({ url: 'https://example.com/pricing' }),
      },
    ],
  };
  const parsedSite = SiteCaptureSchema.parse(siteCapture);
  assert.strictEqual(parsedSite.pages.length, 2);
  assert.strictEqual(parsedSite.pages[1].path, '/pricing');

  // 8. Accepts optional rasterized metadata and per-fill layer properties while preserving old captures
  const rasterizedNode = NodeSchema.parse({
    id: 'node-raster',
    type: 'image',
    box: { x: 0, y: 0, w: 100, h: 100 },
    style: {
      fills: [
        {
          type: 'gradient',
          gradientType: 'conic',
          angle: 45,
          cx: 0.5,
          cy: 0.5,
          stops: [{ color: '#fff', position: 0 }, { color: '#000', position: 1 }],
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0',
          backgroundRepeat: 'repeat',
        },
      ],
      strokes: [],
      opacity: 1,
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      shadows: [],
    },
    assetRef: 'img-1',
    rasterized: { reason: 'webgl-canvas' },
  });
  assert.deepStrictEqual(rasterizedNode.rasterized, { reason: 'webgl-canvas' });
  assert.strictEqual(parsedFull.nodes[2].rasterized, undefined);

  const radialGradNode = NodeSchema.parse({
    id: 'node-grad',
    type: 'frame',
    box: { x: 0, y: 0, w: 200, h: 120 },
    style: {
      fills: [
        {
          type: 'gradient',
          gradientType: 'radial',
          repeating: true,
          radialShape: 'circle',
          radialSize: '55px',
          cx: 0.3,
          cy: 0.35,
          stops: [{ color: '#38bdf8', position: 0 }, { color: '#3b82f6', position: 0.55 }],
        },
      ],
      strokes: [],
      opacity: 1,
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      shadows: [],
    },
  });
  assert.strictEqual(radialGradNode.style.fills[0].radialSize, '55px');
  assert.strictEqual(radialGradNode.style.fills[0].repeating, true);

  console.log('packages/model tests passed: 9/9 assertions verified');
}

runTests();
