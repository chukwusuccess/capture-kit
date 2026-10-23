import assert from 'node:assert';
import { type Capture, emptyCapture } from '@capture-kit/model';
import { modelToMarkdown } from './src/index.js';

function runMarkdownDestinationTests(): void {
  const sampleCardCapture: Capture = emptyCapture({
    url: 'https://example.com/pricing',
    version: '0.1.0',
    frame: { width: 380, height: 460, baseURI: 'https://example.com/pricing' },
    nodes: [
      {
        id: 'node-card',
        type: 'frame',
        box: { x: 0, y: 0, w: 380, h: 460 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 1)' }],
          strokes: [{ color: 'rgba(226, 232, 240, 1)', width: 1, style: 'solid' }],
          opacity: 1,
          radius: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
          shadows: [{ x: 0, y: 10, blur: 15, color: 'rgba(0, 0, 0, 0.08)', inset: false }],
        },
      },
      {
        id: 'node-badge',
        parentId: 'node-card',
        type: 'rect',
        box: { x: 24, y: 24, w: 95, h: 24 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(224, 242, 254, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 6, topRight: 6, bottomRight: 6, bottomLeft: 6 },
          shadows: [],
        },
      },
      {
        id: 'node-heading',
        parentId: 'node-card',
        type: 'text',
        box: { x: 24, y: 64, w: 332, h: 32 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Pro Tier Subscription',
          fontFamily: 'Inter',
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 32,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(15, 23, 42, 1)',
        },
      },
    ],
  });

  const md = modelToMarkdown(sampleCardCapture, { componentName: 'PricingCard' });

  // 1. Assert Component header
  assert.ok(
    md.includes('# Component Specification: PricingCard'),
    'Component specification title missing'
  );

  // 2. Assert Bounding Canvas
  assert.ok(
    md.includes('380px width × 460px height'),
    'Canvas dimensions missing'
  );

  // 3. Assert Typography Tokens
  assert.ok(
    md.includes('Font: Inter, Size: 24px, Weight: 700'),
    'Typography token missing'
  );
  assert.ok(
    md.includes('rgba(15, 23, 42, 1)'),
    'Typography color missing'
  );

  // 4. Assert Hierarchy & Parent-Child Indentation
  assert.ok(
    md.includes('- **Container/Frame** (node-card) [x: 0, y: 0, w: 380, h: 460]'),
    'Card container frame missing in hierarchy'
  );
  assert.ok(
    md.includes('  - **Text** ("Pro Tier Subscription") [x: 24, y: 64, w: 332, h: 32]'),
    'Nested text node missing or indentation wrong'
  );

  // 5. Assert Clean Copy Block
  assert.ok(
    md.includes('> Pro Tier Subscription'),
    'Clean copy block missing content'
  );

  // 6. Assert AI Reproduction Prompt
  assert.ok(
    md.includes('## 5. AI Reproduction Prompt'),
    'AI prompt section missing'
  );
  assert.ok(
    md.includes('Recreate this "PricingCard" component faithfully in React with Tailwind CSS'),
    'AI prompt template mismatch'
  );

  console.log('packages/destinations/markdown tests passed: 6/6 assertions verified');
}

runMarkdownDestinationTests();
