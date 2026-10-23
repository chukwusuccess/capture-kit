import assert from 'node:assert';
import { type Capture, emptyCapture } from '@capture-kit/model';
import { modelToFigma } from './src/index.js';

function runFigmaDestinationTests() {
  const sampleCapture: Capture = emptyCapture({
    url: 'https://test.figma-destination.local',
    version: '0.1.0',
    frame: {
      width: 1200,
      height: 800,
      baseURI: 'https://test.figma-destination.local/',
    },
    nodes: [
      {
        id: 'node-card',
        type: 'frame',
        box: { x: 50, y: 50, w: 400, h: 250 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 1)' }],
          strokes: [{ color: 'rgba(59, 130, 246, 1)', width: 2, style: 'dashed' }],
          opacity: 0.95,
          radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
          shadows: [],
        },
      },
      {
        id: 'node-title',
        parentId: 'node-card',
        type: 'text',
        box: { x: 70, y: 70, w: 200, h: 32 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Figma Card Title & Subtitle',
          fontFamily: 'Inter, sans-serif',
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(15, 23, 42, 1)',
        },
      },
      {
        id: 'node-thumb',
        parentId: 'node-card',
        type: 'image',
        box: { x: 70, y: 120, w: 100, h: 100 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 6, topRight: 6, bottomRight: 6, bottomLeft: 6 },
          shadows: [],
        },
        assetRef: 'img-thumb',
      },
    ],
    assets: {
      'img-thumb': {
        kind: 'image',
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    },
  });

  const payload = modelToFigma(sampleCapture);

  // 1. Assert clipboard payload keys exist
  assert.ok(payload.html, 'Missing html payload');
  assert.ok(payload.svg, 'Missing svg payload');
  assert.ok(payload.plain, 'Missing plain payload');

  // 2. Assert HTML clipboard fragment comments
  assert.ok(
    payload.html.includes('<!--StartFragment-->'),
    'Missing StartFragment comment in HTML'
  );
  assert.ok(
    payload.html.includes('<!--EndFragment-->'),
    'Missing EndFragment comment in HTML'
  );

  // 3. Assert SVG root attributes
  assert.ok(
    payload.svg.includes('width="1200" height="800"'),
    'SVG dimensions mismatch'
  );
  assert.ok(
    payload.svg.includes('viewBox="0 0 1200 800"'),
    'SVG viewBox mismatch'
  );

  // 4. Assert dashed stroke and rx on card
  assert.ok(
    payload.svg.includes('stroke-dasharray="6,4"'),
    'Missing stroke-dasharray on dashed stroke'
  );
  assert.ok(
    payload.svg.includes('rx="12"'),
    'Missing corner radius on card'
  );

  // 5. Assert XML escaping and text node
  assert.ok(
    payload.svg.includes('Figma Card Title &amp; Subtitle'),
    'Text content not properly XML-escaped'
  );
  assert.ok(
    payload.svg.includes('font-size="20"'),
    'Font size missing on text node'
  );

  // 6. Assert embedded image data URI
  assert.ok(
    payload.svg.includes('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'),
    'Embedded base64 image data URI missing'
  );

  // 7. Assert group hierarchy wrapping
  assert.ok(
    payload.svg.includes('<g id="group-node-card">'),
    'Parent group element missing'
  );

  console.log('packages/destinations/figma tests passed: 7/7 assertions verified');
}

runFigmaDestinationTests();
