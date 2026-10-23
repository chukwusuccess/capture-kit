import assert from 'node:assert';
import JSZip from 'jszip';
import { type Capture, emptyCapture } from '../packages/model/src/index.js';
import { modelToSketch } from '../packages/destinations/sketch/src/index.js';

interface SketchFrame {
  _class: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SketchLayer {
  _class: string;
  do_objectID: string;
  frame: SketchFrame;
  layers?: SketchLayer[];
}

interface SketchPage {
  _class: string;
  layers: SketchLayer[];
}

async function runSketchVerification(): Promise<void> {
  const sampleCapture: Capture = emptyCapture({
    url: 'https://test.capture-kit.local',
    version: '0.1.0',
    frame: {
      width: 1440,
      height: 900,
      baseURI: 'https://test.capture-kit.local/',
    },
    nodes: [
      {
        id: 'node-rect-1',
        type: 'rect',
        box: { x: 50, y: 80, w: 300, h: 150 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(34, 197, 94, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
          shadows: [],
        },
      },
      {
        id: 'node-text-1',
        type: 'text',
        box: { x: 50, y: 260, w: 400, h: 44 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Test Heading Text',
          fontFamily: 'system-ui',
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.4,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(15, 23, 42, 1)',
        },
      },
      {
        id: 'node-image-1',
        type: 'image',
        box: { x: 500, y: 80, w: 240, h: 180 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
          shadows: [],
        },
      },
    ],
  });

  const blob = await modelToSketch(sampleCapture);
  assert.ok(blob, 'modelToSketch returned empty result');

  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Assert all four required files exist in zip
  const requiredFiles = [
    'document.json',
    'meta.json',
    'user.json',
    'pages/page-1.json',
  ];

  for (const filename of requiredFiles) {
    const file = zip.file(filename);
    assert.ok(file, `Missing required Sketch archive entry: ${filename}`);
  }

  // 2. Parse meta.json and document.json
  const metaText = await zip.file('meta.json')!.async('text');
  const meta = JSON.parse(metaText);
  assert.strictEqual(meta.app, 'com.bohemiancoding.sketch3');

  const docText = await zip.file('document.json')!.async('text');
  const docJson = JSON.parse(docText);
  assert.strictEqual(docJson._class, 'document');
  assert.strictEqual(docJson.pages[0]._ref, 'pages/page-1');

  // 3. Parse and assert page and artboard coordinates
  const pageText = await zip.file('pages/page-1.json')!.async('text');
  const pageJson: SketchPage = JSON.parse(pageText);

  assert.strictEqual(pageJson._class, 'page');
  assert.strictEqual(pageJson.layers.length, 1, 'Expected one artboard layer on page');

  const artboard = pageJson.layers[0];
  assert.strictEqual(artboard._class, 'artboard');
  assert.strictEqual(artboard.frame.width, sampleCapture.frame.width, 'Artboard width mismatch');
  assert.strictEqual(artboard.frame.height, sampleCapture.frame.height, 'Artboard height mismatch');
  assert.strictEqual(artboard.frame.x, 0, 'Artboard x mismatch');
  assert.strictEqual(artboard.frame.y, 0, 'Artboard y mismatch');

  // 4. Assert layer boxes match capture coordinates
  const childLayers = artboard.layers ?? [];
  assert.strictEqual(childLayers.length, sampleCapture.nodes.length, 'Layer count mismatch');

  for (const node of sampleCapture.nodes) {
    const layer = childLayers.find((l) => l.do_objectID === node.id);
    assert.ok(layer, `Could not find layer for node ID: ${node.id}`);

    assert.strictEqual(
      layer.frame.x,
      node.box.x,
      `Layer ${node.id} x coordinate mismatch: expected ${node.box.x}, got ${layer.frame.x}`
    );
    assert.strictEqual(
      layer.frame.y,
      node.box.y,
      `Layer ${node.id} y coordinate mismatch: expected ${node.box.y}, got ${layer.frame.y}`
    );
    assert.strictEqual(
      layer.frame.width,
      node.box.w,
      `Layer ${node.id} width coordinate mismatch: expected ${node.box.w}, got ${layer.frame.width}`
    );
    assert.strictEqual(
      layer.frame.height,
      node.box.h,
      `Layer ${node.id} height coordinate mismatch: expected ${node.box.h}, got ${layer.frame.height}`
    );
  }

  console.log('Programmatic .sketch verification passed: all 4 required files exist and artboard/layer boxes match');
}

runSketchVerification().catch((err) => {
  console.error('Programmatic .sketch verification failed:', err);
  process.exit(1);
});
