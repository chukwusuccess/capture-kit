import assert from 'node:assert';
import { type Capture, emptyCapture } from '@capture-kit/model';
import { modelToFigma } from './src/index.js';
import { formatFontSubstitutionSummary, resolveFigmaFontChoice } from './src/native.js';
import { runNativePlanningTests } from './native.test.js';

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
        id: 'node-nav-border',
        type: 'frame',
        box: { x: 0, y: 0, w: 1200, h: 64 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(15, 23, 42, 1)' }],
          strokes: [{ color: 'rgba(255, 255, 255, 0.1)', width: 1, style: 'solid', side: 'bottom' }],
          opacity: 1,
          radius: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
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
    payload.svg.includes('x="70" y="92.6"'),
    'Text baseline y should be placed inside the text box (70 + 32/2 + 20*0.33 = 92.6)'
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

  // 7. Assert group hierarchy wrapping with semantic naming from descendant text
  assert.ok(
    payload.svg.includes('<g id="Container · Figma Card Title &amp; Subti (node-card)">'),
    'Parent group element missing or semantic group id mismatch'
  );

  // 8. Several captures share one paste: a row per page, its sizes side by side
  const mobile: Capture = { ...sampleCapture, frame: { ...sampleCapture.frame, width: 390, height: 900 } };
  const pricing: Capture = { ...sampleCapture, url: 'https://test.figma-destination.local/pricing' };
  const multi = modelToFigma([sampleCapture, mobile, pricing]).svg;
  assert.ok(multi.startsWith('<svg width="1710" height="1820"'), 'Combined frame size wrong');
  assert.ok(multi.includes('transform="translate(1320 0)"'), 'Second size not beside the first');
  assert.ok(multi.includes('transform="translate(0 1020)"'), 'Second page not on its own row');
  assert.ok(multi.includes('id="/pricing @ 1200"'), 'Capture group not labelled');
  const withDs = modelToFigma(sampleCapture, { includeDesignSystem: true }).svg;
  assert.ok(withDs.includes('id="Design System"'), 'Design System frame missing when includeDesignSystem is true');
  assert.ok(withDs.includes('COLOR TOKENS') && withDs.includes('TYPOGRAPHY SCALE'), 'Design System sections missing');

  assert.ok(payload.svg.includes('<line x1="0" y1="63.5" x2="1200" y2="63.5"'), 'Single-side border-bottom missing as crisp line');
  assert.ok(payload.svg.includes('d="M 16 0 H 1184 A 16 16 0 0 1 1200 16 V 64 A 0 0 0 0 1 1200 64 H 0 A 0 0 0 0 1 0 64 V 16 A 16 16 0 0 1 16 0 Z"'), 'Asymmetric corner radius missing as exact path');
  const glass = modelToFigma({
    ...sampleCapture,
    nodes: [{
      id: 'glass-nav',
      type: 'frame',
      box: { x: 0, y: 0, w: 1200, h: 64 },
      style: {
        fills: [{ type: 'solid', color: 'rgba(255,255,255,0.08)' }],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        shadows: [],
        backdropFilter: 'blur(12px) saturate(1.4)',
      },
    }],
  }).svg;
  assert.ok(glass.includes('filter="url(#fx-glass-nav)"'), 'Backdrop blur glass missing filter reference');
  assert.ok(glass.includes('in="BackgroundImage" stdDeviation="12"'), 'Backdrop blur amount missing from filter def');
  const roundedLine = modelToFigma({
    ...sampleCapture,
    nodes: [{
      id: 'node-pill-line',
      type: 'frame',
      box: { x: 10, y: 10, w: 200, h: 40 },
      style: {
        fills: [{ type: 'solid', color: 'rgba(15, 23, 42, 1)' }],
        strokes: [{ color: 'rgba(255,255,255,0.2)', width: 2, style: 'solid', side: 'top' }],
        radius: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 },
        shadows: [],
      },
    }],
  }).svg;
  assert.ok(roundedLine.includes('<line x1="30" y1="11" x2="190" y2="11"'), 'Per-edge line must inset by corner radii on rounded pill');
  const clipped = modelToFigma({
    ...sampleCapture,
    nodes: [{
      id: 'node-clipped-circle',
      type: 'frame',
      box: { x: 0, y: 0, w: 100, h: 100 },
      style: {
        fills: [{ type: 'solid', color: 'rgba(255, 0, 0, 1)' }],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        shadows: [],
        clipPath: 'circle(50% at 50% 50%)',
      },
    }],
  }).svg;
  assert.ok(clipped.includes('<clipPath id="clip-node-clipped-circle">') && clipped.includes('r="50"'), 'circle() clipPath with at-position must emit centered circle');
  console.log('packages/destinations/figma tests passed: 8/8 assertions verified');
}

function runFigmaFontResolutionTests() {
  const available = [
    { family: 'Inter', style: 'Regular' },
    { family: 'Inter', style: 'Bold' },
    { family: 'Tinos', style: 'Regular' },
    { family: 'Georgia', style: 'Regular' },
  ];
  // 1. Exact
  const exact = resolveFigmaFontChoice(available, 'Inter', 700, false);
  assert.strictEqual(exact.reason, 'exact');
  assert.strictEqual(exact.font.style, 'Bold');
  // 2. Nearest weight within same family
  const nearest = resolveFigmaFontChoice(available, 'Inter', 600, false);
  assert.strictEqual(nearest.reason, 'nearest-weight');
  assert.strictEqual(nearest.font.family, 'Inter');
  // 3. Capture fallbackStack
  const fb = resolveFigmaFontChoice(available, 'CustomSerif', 400, false, [
    { family: 'CustomSerif', weight: '400', style: 'normal', embedded: false, fallbackStack: 'CustomSerif, Georgia, serif' },
  ]);
  assert.strictEqual(fb.reason, 'fallback-stack');
  assert.strictEqual(fb.font.family, 'Georgia');
  // 4. Metric-compatible Google font table
  const metric = resolveFigmaFontChoice(available, 'Times New Roman', 400, false);
  assert.strictEqual(metric.reason, 'metric-table');
  assert.strictEqual(metric.font.family, 'Tinos');
  // 5. Formatted summary
  const summary = formatFontSubstitutionSummary(new Map([['Times New Roman', 'Tinos'], ['CustomSerif', 'Georgia']]));
  assert.strictEqual(summary, '2 fonts substituted: Times New Roman → Tinos, CustomSerif → Georgia');
  console.log('packages/destinations/figma font resolution tests passed');
}

function runFigmaUpgradeTests() {
  const baseCapture = emptyCapture({
    url: 'https://test.figma-destination.local',
    version: '0.1.0',
    frame: {
      width: 1200,
      height: 800,
      baseURI: 'https://test.figma-destination.local/',
    },
    nodes: [],
  });

  // Upgrade 1: Single-child unstyled pass-through frame wrappers are flattened
  const divSoupCapture: Capture = {
    ...baseCapture,
    nodes: [
      {
        id: 'outer-div-soup',
        type: 'frame',
        box: { x: 40, y: 40, w: 300, h: 80 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'inner-div-soup',
        parentId: 'outer-div-soup',
        type: 'frame',
        box: { x: 40, y: 40, w: 300, h: 80 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'leaf-label',
        parentId: 'inner-div-soup',
        type: 'text',
        box: { x: 50, y: 50, w: 200, h: 24 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Flattened Leaf Label',
          fontFamily: 'Inter, sans-serif',
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(255, 255, 255, 1)',
        },
      },
      // Non-text wrapper with 2 children should fall back to group-${node.id}
      {
        id: 'shapes-only-group',
        type: 'frame',
        box: { x: 400, y: 40, w: 200, h: 100 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'shape-a',
        parentId: 'shapes-only-group',
        type: 'rect',
        box: { x: 400, y: 40, w: 80, h: 80 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 0, 0, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'shape-b',
        parentId: 'shapes-only-group',
        type: 'rect',
        box: { x: 500, y: 40, w: 80, h: 80 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(0, 255, 0, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
    ],
  };

  const flattenedSvg = modelToFigma(divSoupCapture).svg;
  assert.ok(
    !flattenedSvg.includes('outer-div-soup') && !flattenedSvg.includes('inner-div-soup'),
    'Single-child unstyled pass-through frame wrappers must be flattened without emitting <g> wrappers'
  );
  assert.ok(
    flattenedSvg.includes('<text id="leaf-label"') && flattenedSvg.includes('Flattened Leaf Label'),
    'Leaf node inside flattened wrappers must still be emitted'
  );
  assert.ok(
    flattenedSvg.includes('<g id="group-shapes-only-group">'),
    'Container without text descendants must fall back to group-${node.id}'
  );

  // Upgrade 3: CSS blur(Npx) with N >= 12 converts to native SVG radialGradient + ellipse
  const glowCapture: Capture = {
    ...baseCapture,
    nodes: [
      {
        id: 'hero-glow',
        type: 'rect',
        box: { x: 100, y: 50, w: 400, h: 200 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(99, 102, 241, 0.45)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 999, topRight: 999, bottomRight: 999, bottomLeft: 999 },
          shadows: [],
          filter: 'blur(24px)',
        },
      },
      {
        id: 'opaque-glow',
        type: 'rect',
        box: { x: 600, y: 100, w: 200, h: 200 },
        style: {
          fills: [{ type: 'solid', color: 'rgb(56, 189, 248)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          filter: 'blur(32px)',
        },
      },
      {
        id: 'small-blur',
        type: 'rect',
        box: { x: 20, y: 20, w: 80, h: 80 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 0.5)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
          filter: 'blur(8px)',
        },
      },
    ],
  };

  const glowSvg = modelToFigma(glowCapture).svg;
  assert.ok(
    glowSvg.includes('<radialGradient id="glow-hero-glow" cx="50%" cy="50%" r="50%">'),
    'Ambient glow node must emit radialGradient def'
  );
  assert.ok(
    glowSvg.includes('stop-color="rgb(99, 102, 241)" stop-opacity="0.45"') &&
      glowSvg.includes('stop-color="rgb(99, 102, 241)" stop-opacity="0"'),
    'Ambient glow radialGradient must preserve alpha at 0% and fade to stop-opacity="0" at 100%'
  );
  assert.ok(
    glowSvg.includes('stop-color="rgb(56, 189, 248)" stop-opacity="0.65"') &&
      glowSvg.includes('stop-color="rgb(56, 189, 248)" stop-opacity="0"'),
    'Opaque ambient glow must use stop-opacity="0.65" at 0%'
  );
  assert.ok(
    glowSvg.includes('<ellipse id="hero-glow" cx="300" cy="150" rx="260" ry="130" fill="url(#glow-hero-glow)" />'),
    'Ambient glow node must render as native <ellipse> with radialGradient fill'
  );
  assert.ok(
    !glowSvg.includes('filter="url(#fx-hero-glow)"') && !glowSvg.includes('id="fx-hero-glow"'),
    'Ambient glow node must not reference or emit fx- Gaussian blur filter'
  );
  assert.ok(
    glowSvg.includes('filter="url(#fx-small-blur)"'),
    'Small blur (< 12px) must still use fx- filter'
  );

  // Upgrade 5: Design System / Brand Kit Frame with Hex Codes, Gradient Swatches, and clean font-family
  const dsCapture: Capture = {
    ...baseCapture,
    frame: {
      ...baseCapture.frame,
      background: 'rgb(15, 23, 42)',
    },
    nodes: [
      {
        id: 'ds-alpha-card',
        type: 'rect',
        box: { x: 40, y: 40, w: 300, h: 120 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(56, 189, 248, 0.8)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
          shadows: [],
        },
      },
      {
        id: 'ds-grad-banner',
        type: 'rect',
        box: { x: 40, y: 200, w: 400, h: 100 },
        style: {
          fills: [
            {
              type: 'gradient',
              gradientType: 'linear',
              angle: 90,
              stops: [
                { color: 'rgb(99, 102, 241)', position: 0 },
                { color: 'rgba(56, 189, 248, 0.8)', position: 1 },
              ],
            },
          ],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
          shadows: [],
        },
      },
      {
        id: 'ds-grad-banner-dup',
        type: 'rect',
        box: { x: 40, y: 320, w: 400, h: 100 },
        style: {
          fills: [
            {
              type: 'gradient',
              gradientType: 'linear',
              angle: 90,
              stops: [
                { color: 'rgb(99, 102, 241)', position: 0 },
                { color: 'rgba(56, 189, 248, 0.8)', position: 1 },
              ],
            },
          ],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
          shadows: [],
        },
      },
      {
        id: 'ds-heading-text',
        type: 'text',
        box: { x: 60, y: 60, w: 260, h: 40 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Brand Kit Specimen',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 32,
          letterSpacing: 0,
          align: 'left',
          color: 'rgb(248, 250, 252)',
        },
      },
    ],
  };

  const dsSvg = modelToFigma(dsCapture, { includeDesignSystem: true }).svg;
  assert.ok(
    dsSvg.includes('#0F172A') && dsSvg.includes('#38BDF8 · 80%'),
    'Design System swatch cards must display uppercase #HEX labels with alpha percentage when alpha < 1'
  );
  assert.ok(
    dsSvg.includes('<linearGradient id="ds-grad-0" x1="0%" y1="0%" x2="100%" y2="0%">') &&
      dsSvg.includes('fill="url(#ds-grad-0)"'),
    'Design System must emit ds-grad- linearGradient defs and gradient pill swatches'
  );
  assert.ok(
    !dsSvg.includes('ds-grad-1'),
    'Duplicate gradients must be deduplicated in Design System frame'
  );
  assert.ok(
    dsSvg.includes('GRADIENTS') && dsSvg.includes('#6366F1 → #38BDF8 · 80%'),
    'Design System GRADIENTS section must display stop hex labels (#START → #END)'
  );
  assert.ok(
    dsSvg.includes('font-family="Inter" font-size="24" font-weight="700" fill="#f8fafc">Brand Kit Specimen</text>'),
    'Design System typography specimen must resolve font-family using cleanSvgFontFamily'
  );

  // Beast Accuracy Upgrades: feDropShadow from shadows, inset top highlight, border+ring overlay, rounded image clipPath, styled tspan runs
  const beastCapture: Capture = {
    ...baseCapture,
    assets: {
      'avatar-1': {
        kind: 'image',
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    },
    nodes: [
      {
        id: 'shadow-glass-card',
        type: 'rect',
        box: { x: 40, y: 40, w: 300, h: 160 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(15, 23, 42, 0.8)' }],
          strokes: [{ color: 'rgba(255, 255, 255, 0.1)', width: 1, style: 'solid' }],
          opacity: 1,
          radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
          shadows: [
            { x: 0, y: 12, blur: 24, spread: 0, color: 'rgba(0, 0, 0, 0.45)', inset: false },
            { x: 0, y: 1, blur: 0, spread: 0, color: 'rgba(255, 255, 255, 0.25)', inset: true },
            { x: 0, y: 0, blur: 0, spread: 2, color: 'rgba(59, 130, 246, 0.5)', inset: false },
          ],
        },
      },
      {
        id: 'rounded-avatar',
        type: 'image',
        box: { x: 60, y: 60, w: 48, h: 48 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 24, topRight: 24, bottomRight: 24, bottomLeft: 24 },
          shadows: [],
          clip: false,
        },
        assetRef: 'avatar-1',
      },
      {
        id: 'rich-tspan-text',
        type: 'text',
        box: { x: 60, y: 120, w: 240, h: 28 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Ship Fast',
          fontFamily: 'Inter, sans-serif',
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgb(255, 255, 255)',
          runs: [
            { text: 'Ship ', fontWeight: 400 },
            { text: 'Fast', fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, italic: true, underline: true, color: 'rgb(56, 189, 248)' },
          ],
        },
      },
    ],
  };

  const beastSvg = modelToFigma(beastCapture).svg;
  assert.ok(
    beastSvg.includes('<filter id="fx-shadow-glass-card"') &&
      beastSvg.includes('<feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="rgb(0, 0, 0)" flood-opacity="0.45" />'),
    'Box shadows must emit <feDropShadow> inside <filter id="fx-..."> in <defs>'
  );
  assert.ok(
    beastSvg.includes('<line id="shadow-glass-card-inset-top" x1="52" y1="40.5" x2="328" y2="40.5" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1" />'),
    'Top specular inset shadow must emit crisp top highlight <line>'
  );
  assert.ok(
    beastSvg.includes('<rect id="shadow-glass-card-ring" x="38" y="38" width="304" height="164" fill="none" rx="14" ry="14" stroke="rgba(59, 130, 246, 0.5)" stroke-width="2" />'),
    'Border + spread ring shadow must emit outer ring <rect> expanded by spread'
  );
  assert.ok(
    beastSvg.includes('<clipPath id="clip-rounded-avatar">') &&
      beastSvg.includes('<rect x="60" y="60" width="48" height="48" rx="24" ry="24" />') &&
      beastSvg.includes('clip-path="url(#clip-rounded-avatar)"'),
    'Rounded <image> node must emit and reference <clipPath> even when style.clip is false'
  );
  assert.ok(
    beastSvg.includes('font-family="Georgia" font-size="20" font-weight="700" font-style="italic" text-decoration="underline" fill="rgb(56, 189, 248)">Fast</tspan>'),
    'Rich <tspan> runs must emit font-family, font-size, font-style="italic", and text-decoration="underline"'
  );

  // Round 2 upgrades: <pattern> gradient grid tiling, VectorPath.fillGradient, and exact r.y dy offsets
  const round2Capture: Capture = {
    ...beastCapture,
    nodes: [
      {
        id: 'grid-pattern-box',
        type: 'rect',
        box: { x: 0, y: 0, w: 400, h: 300 },
        style: {
          fills: [
            {
              type: 'gradient',
              gradientType: 'linear',
              angle: 90,
              backgroundSize: '24px 24px',
              backgroundRepeat: 'repeat',
              stops: [
                { color: 'rgba(255, 255, 255, 0.1)', position: 0 },
                { color: 'rgba(255, 255, 255, 0)', position: 0.05 },
              ],
            },
          ],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'logo-grad-vec',
        type: 'vector',
        box: { x: 20, y: 20, w: 48, h: 48 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        vectorViewBox: { width: 24, height: 24 },
        vectorPaths: [
          {
            d: 'M 0 0 L 24 0 L 24 24 Z',
            fillGradient: {
              type: 'gradient',
              gradientType: 'linear',
              angle: 135,
              stops: [
                { color: 'rgb(99, 102, 241)', position: 0 },
                { color: 'rgb(236, 72, 153)', position: 1 },
              ],
            },
          },
        ],
      },
      {
        id: 'multiline-dy-text',
        type: 'text',
        box: { x: 40, y: 100, w: 300, h: 80 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'First line Second line',
          fontFamily: 'Inter, sans-serif',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgb(255, 255, 255)',
          runs: [
            { text: 'First line', x: 40, y: 100 },
            { text: 'Second line', x: 40, y: 128.5 },
          ],
        },
      },
    ],
  };

  const round2Svg = modelToFigma(round2Capture).svg;
  assert.ok(
    round2Svg.includes('<linearGradient id="grad-grid-pattern-box"') &&
      round2Svg.includes('<pattern id="pat-grid-pattern-box-0" width="24" height="24" patternUnits="userSpaceOnUse">') &&
      round2Svg.includes('<rect x="0" y="0" width="24" height="24" fill="url(#grad-grid-pattern-box)" />') &&
      round2Svg.includes('fill="url(#pat-grid-pattern-box-0)"'),
    'Repeating gradient with backgroundSize 24px 24px must emit <pattern> and reference url(#pat-...)'
  );
  assert.ok(
    round2Svg.includes('<linearGradient id="vgrad-logo-grad-vec-0"') &&
      round2Svg.includes('<path d="M 0 0 L 24 0 L 24 24 Z" fill="url(#vgrad-logo-grad-vec-0)" />'),
    'VectorPath.fillGradient must emit vgrad-<id>-<idx> in <defs> and reference it on <path>'
  );
  assert.ok(
    round2Svg.includes('<tspan x="40" dy="28.5">Second line</tspan>'),
    'Multi-line <tspan> with measured r.y must use exact dy delta (28.5) instead of fallback lineHeight (24)'
  );

  // Zero-size gradient backgrounds (e.g. CSS hover-underline `0px 1px`) must never paint a solid box
  const zeroGradCap = emptyCapture({
    url: 'https://test.figma-destination.local',
    version: '0.2.3',
    frame: { width: 400, height: 100, baseURI: 'https://test.figma-destination.local/' },
    nodes: [
      {
        id: 'link-hover-underline',
        type: 'rect',
        box: { x: 10, y: 10, w: 200, h: 32 },
        style: {
          fills: [
            {
              type: 'gradient',
              gradientType: 'linear',
              angle: 180,
              stops: [
                { color: 'rgb(0, 0, 0)', position: 0 },
                { color: 'rgb(0, 0, 0)', position: 1 },
              ],
              backgroundSize: '0px 1px',
              backgroundPosition: '0px 100%',
              backgroundRepeat: 'no-repeat',
            },
          ],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
    ],
  });
  const zeroGradSvg = modelToFigma(zeroGradCap).svg;
  assert.ok(
    !zeroGradSvg.includes('url(#grad-link-hover-underline)') && !zeroGradSvg.includes('fill="rgb(0, 0, 0)"'),
    'Expected 0px 1px gradient underline to not paint a black fill or gradient'
  );

  // External .svg <img> assets must be inlined as nested <svg> vectors for Figma
  const eyeSvgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 157 120"><circle cx="78" cy="60" r="30" fill="#18181b"/></svg>', 'utf8').toString('base64');
  const svgImgCap = emptyCapture({
    url: 'https://test.figma-destination.local',
    version: '0.2.3',
    frame: { width: 400, height: 300, baseURI: 'https://test.figma-destination.local/' },
    nodes: [
      {
        id: 'eye-img',
        type: 'image',
        box: { x: 40, y: 50, w: 157, h: 120 },
        assetRef: 'svg-eye',
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
    ],
    assets: {
      'svg-eye': { kind: 'image', mimeType: 'image/svg+xml', base64: eyeSvgB64 },
    },
  });
  const svgImgOut = modelToFigma(svgImgCap).svg;
  assert.ok(
    svgImgOut.includes('<svg id="eye-img" x="40" y="50" width="157" height="120" viewBox="0 0 157 120"') &&
      svgImgOut.includes('<circle cx="78" cy="60" r="30" fill="#18181b"/>') &&
      !svgImgOut.includes('data:image/svg+xml'),
    'External SVG image assets must be inlined as nested <svg> vector nodes'
  );

  // Large wide display text with custom non-system fonts applies slight negative tracking so Inter fallback stays inside box.w
  const customWideTextCap = emptyCapture({
    url: 'https://test.figma-destination.local',
    version: '0.2.3',
    frame: { width: 1440, height: 400, baseURI: 'https://test.figma-destination.local/' },
    nodes: [
      {
        id: 'wide-display',
        type: 'text',
        box: { x: 40, y: 40, w: 1360, h: 120 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Our web agency has made a name for itself',
          fontFamily: 'Steradian-Rg, sans-serif',
          fontSize: 50,
          fontWeight: 400,
          lineHeight: 60,
          letterSpacing: 0,
          align: 'left',
          color: 'rgb(0, 0, 0)',
        },
      },
    ],
  });
  const customWideSvg = modelToFigma(customWideTextCap).svg;
  assert.ok(customWideSvg.includes('letter-spacing="-1.5"'), 'Expected custom wide display font to emit -1.5 letter-spacing compensation');

  console.log('packages/destinations/figma upgrade tests passed');
}

runFigmaDestinationTests();
runNativePlanningTests();
runFigmaFontResolutionTests();
runFigmaUpgradeTests();
