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
  assert.strictEqual(parsedMinimal.version, '0.1.0');
  assert.strictEqual(parsedMinimal.nodes.length, 0);

  // 2. Accepts capture with full nodes
  const fullCapture: Capture = {
    url: 'https://example.com',
    version: '0.1.0',
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
    version: '0.1.0',
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

  console.log('packages/model tests passed: 7/7 assertions verified');
}

runTests();
