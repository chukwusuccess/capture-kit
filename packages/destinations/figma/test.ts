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
      {
        id: 'node-skip-offscreen',
        type: 'text',
        box: { x: 637, y: 24, w: 117, h: 18 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          transform: 'matrix(1, 0, 0, 1, 0, -84)',
          transformOrigin: '0 0',
        },
        text: {
          content: 'Skip to content',
          fontFamily: 'Inter, sans-serif',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(255, 255, 255, 1)',
        },
      },
      {
        id: 'node-shifted-pill',
        type: 'rect',
        box: { x: 200, y: 100, w: 120, h: 40 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(15, 23, 42, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
          shadows: [],
          transform: 'matrix(1, 0, 0, 1, -60, 0)',
          transformOrigin: '0 0',
        },
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

  assert.ok(
    !payload.svg.includes('dominant-baseline="text-before-edge"'),
    'Should not emit dominant-baseline="text-before-edge" (ignored by Figma)'
  );
  assert.ok(
    payload.svg.includes('x="70" y="93"'),
    'Text baseline y should be placed inside the text box (70 + 32/2 + 20*0.35 = 93)'
  );
  assert.ok(
    !payload.svg.includes('Skip to content'),
    'Off-screen transformed nodes (y + ty < 0) should be omitted from Figma paste'
  );
  assert.ok(
    payload.svg.includes('id="node-shifted-pill"') && payload.svg.includes('transform="matrix(1 0 0 1 -60 0)"'),
    'Transforms must be emitted as native SVG transform attributes, not CSS inline styles'
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

  // 8. Several captures share one paste: a row per page, its sizes side by side
  const mobile: Capture = { ...sampleCapture, frame: { ...sampleCapture.frame, width: 390, height: 900 } };
  const pricing: Capture = { ...sampleCapture, url: 'https://test.figma-destination.local/pricing' };
  const multi = modelToFigma([sampleCapture, mobile, pricing]).svg;
  assert.ok(multi.startsWith('<svg width="1710" height="1820"'), 'Combined frame size wrong');
  assert.ok(multi.includes('transform="translate(1320 0)"'), 'Second size not beside the first');
  assert.ok(multi.includes('transform="translate(0 1020)"'), 'Second page not on its own row');
  assert.ok(multi.includes('id="/pricing @ 1200"'), 'Capture group not labelled');

  console.log('packages/destinations/figma tests passed: 8/8 assertions verified');
}

runFigmaDestinationTests();
