import assert from 'node:assert';
import { type Capture, emptyCapture } from '@capture-kit/model';
import { modelToHtml } from './src/index.js';

function runHtmlDestinationTests() {
  const sampleCapture: Capture = emptyCapture({
    url: 'https://test.html-dest.local',
    version: '0.1.0',
    frame: { width: 1000, height: 600, baseURI: 'https://test.html-dest.local/' },
    nodes: [
      {
        id: 'node-card',
        type: 'frame',
        box: { x: 40, y: 40, w: 320, h: 180 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 1)' }],
          strokes: [{ color: 'rgba(226, 232, 240, 1)', width: 1, style: 'solid' }],
          opacity: 1,
          radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
          shadows: [{ x: 0, y: 4, blur: 6, color: 'rgba(0, 0, 0, 0.05)', inset: false }],
        },
      },
      {
        id: 'node-title',
        parentId: 'node-card',
        type: 'text',
        box: { x: 56, y: 56, w: 200, h: 28 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'HTML Component <Header> & Title',
          fontFamily: 'Inter',
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(15, 23, 42, 1)',
        },
      },
      {
        id: 'node-icon',
        parentId: 'node-card',
        type: 'image',
        box: { x: 56, y: 100, w: 48, h: 48 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
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
  });

  const fullHtml = modelToHtml(sampleCapture, { title: 'Test Export' });

  // 1. Assert HTML5 structure
  assert.ok(fullHtml.includes('<!DOCTYPE html>'), 'Missing doctype');
  assert.ok(fullHtml.includes('<title>Test Export</title>'), 'Title mismatch');

  // 2. Assert canvas dimensions
  assert.ok(fullHtml.includes('width: 1000px; height: 600px'), 'Canvas dimensions mismatch');

  // 3. Assert HTML escaping
  assert.ok(
    fullHtml.includes('HTML Component &lt;Header&gt; &amp; Title'),
    'Text not properly HTML escaped'
  );

  // 4. Assert styles on card
  assert.ok(fullHtml.includes('left: 40px'), 'Card x coordinate missing');
  assert.ok(fullHtml.includes('border-radius: 8px 8px 8px 8px'), 'Card border radius missing');
  assert.ok(fullHtml.includes('box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.05)'), 'Card shadow missing');

  // 5. Assert image tag with base64 data URI
  assert.ok(
    fullHtml.includes('<img id="node-icon"'),
    'Image element missing'
  );
  assert.ok(
    fullHtml.includes('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'),
    'Image base64 data URI missing'
  );

  // 6. Assert non-standalone snippet
  const snippet = modelToHtml(sampleCapture, { standalone: false });
  assert.ok(!snippet.includes('<!DOCTYPE html>'), 'Standalone false should omit doctype');
  assert.ok(snippet.includes('class="capture-canvas"'), 'Snippet should contain canvas');

  console.log('packages/destinations/html tests passed: 6/6 assertions verified');
}

runHtmlDestinationTests();
