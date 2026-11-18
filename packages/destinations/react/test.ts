import assert from 'node:assert';
import { type Capture, emptyCapture, type Node } from '@capture-kit/model';
import { buildTailwindLayoutClasses, modelToReact } from './src/index.js';

function runReactDestinationTests(): void {
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
          interactiveClasses: ['hover:opacity-80', 'transition-all', 'cursor-pointer'],
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
          content: 'Pro Tier Subscription & Benefits',
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

  const tsx = modelToReact(sampleCardCapture, { componentName: 'PricingCard' });

  // 1. Assert React import and component function
  assert.ok(tsx.includes("import React from 'react';"), 'React import missing');
  assert.ok(tsx.includes('export function PricingCard() {'), 'Component function declaration missing');

  // 2. Assert root card container classes
  assert.ok(tsx.includes('w-[380px] h-[460px]'), 'Root dimensions missing in Tailwind classes');
  assert.ok(tsx.includes('bg-white'), 'Background class missing');
  assert.ok(tsx.includes('rounded-2xl'), 'Radius class missing (16px should map to rounded-2xl)');
  assert.ok(tsx.includes('border-[1px] border-solid'), 'Border classes missing');

  // 3. Assert nested badge child classes
  assert.ok(
    tsx.includes('left-[24px] top-[24px] w-[95px] h-[24px]'),
    'Badge relative positioning missing'
  );
  assert.ok(tsx.includes('rounded-md'), 'Badge radius missing (6px should map to rounded-md)');

  // 4. Assert text element rendering
  assert.ok(tsx.includes('<h2 className='), 'Heading tag missing');
  assert.ok(tsx.includes('text-[24px] font-bold'), 'Typography classes missing');
  assert.ok(
    tsx.includes('Pro Tier Subscription &amp; Benefits'),
    'JSX text escaping missing'
  );
  assert.ok(
    tsx.includes('hover:opacity-80') && tsx.includes('transition-all') && tsx.includes('cursor-pointer'),
    'Interactive Tailwind classes missing from React output'
  );

  console.log('packages/destinations/react tests passed: 4/4 assertions verified');
}

function runLayoutAndSemanticTagTests(): void {
  const headerNode: Node = {
    id: 'header-top',
    name: 'Header · Top',
    type: 'frame',
    box: { x: 0, y: 0, w: 1200, h: 64 },
    style: {
      fills: [],
      strokes: [],
      opacity: 1,
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      shadows: [],
      clip: true,
      layout: {
        mode: 'horizontal',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'between',
      },
    },
  };

  assert.strictEqual(
    buildTailwindLayoutClasses(headerNode),
    'flex flex-row items-center justify-between gap-[16px] overflow-hidden',
    'buildTailwindLayoutClasses mismatch for Header node'
  );

  const semanticCapture: Capture = emptyCapture({
    url: 'https://example.com/layout',
    version: '0.1.0',
    frame: { width: 1200, height: 800, baseURI: 'https://example.com/layout' },
    nodes: [
      headerNode,
      {
        id: 'nav-main',
        parentId: 'header-top',
        name: 'Nav · Links',
        type: 'frame',
        box: { x: 24, y: 12, w: 400, h: 40 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          clip: false,
          layout: { mode: 'horizontal', gap: 12, wrap: true, alignItems: 'start', justifyContent: 'end' },
        },
      },
      {
        id: 'main-content',
        name: 'Main · Body',
        type: 'frame',
        box: { x: 0, y: 64, w: 1200, h: 500 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          clip: false,
          layout: { mode: 'vertical', gap: 24.4, alignItems: 'stretch', justifyContent: 'start' },
        },
      },
      {
        id: 'section-grid',
        parentId: 'main-content',
        name: 'Section · Cards',
        type: 'frame',
        box: { x: 0, y: 64, w: 1200, h: 300 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          clip: false,
          layout: { mode: 'grid', gap: 20, justifyContent: 'around' },
        },
      },
      {
        id: 'article-card',
        parentId: 'section-grid',
        name: 'Article · Post',
        type: 'frame',
        box: { x: 0, y: 64, w: 300, h: 200 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          clip: false,
          layout: { mode: 'vertical', alignItems: 'end', justifyContent: 'evenly' },
        },
      },
      {
        id: 'cta-button',
        parentId: 'article-card',
        name: 'Button · Submit',
        type: 'frame',
        box: { x: 16, y: 200, w: 120, h: 40 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          clip: false,
        },
      },
      {
        id: 'footer-bar',
        name: 'Footer · Legal',
        type: 'frame',
        box: { x: 0, y: 700, w: 1200, h: 100 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          clip: false,
        },
      },
    ],
  });

  const tsx = modelToReact(semanticCapture, { componentName: 'LayoutPage' });

  assert.ok(
    /<header className="[^"]*flex flex-row items-center justify-between gap-\[16px\] overflow-hidden"/.test(tsx),
    'Header semantic tag or Tailwind layout classes missing'
  );
  assert.ok(
    /<nav className="[^"]*flex flex-row flex-wrap items-start justify-end gap-\[12px\]"/.test(tsx),
    'Nav semantic tag or wrap/align/justify classes missing'
  );
  assert.ok(
    /<main className="[^"]*flex flex-col items-stretch justify-start gap-\[24px\]"/.test(tsx),
    'Main semantic tag or vertical layout classes missing'
  );
  assert.ok(
    /<section className="[^"]*grid justify-around gap-\[20px\]"/.test(tsx),
    'Section semantic tag or grid layout classes missing'
  );
  assert.ok(
    /<article className="[^"]*flex flex-col items-end justify-evenly"/.test(tsx),
    'Article semantic tag or layout classes missing'
  );
  assert.ok(tsx.includes('<button className='), 'Button semantic tag missing');
  assert.ok(tsx.includes('<footer className='), 'Footer semantic tag missing');

  console.log('packages/destinations/react layout & semantic tag tests passed: 8/8 assertions verified');
}

runReactDestinationTests();
runLayoutAndSemanticTagTests();
