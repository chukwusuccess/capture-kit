import assert from 'node:assert';
import { type Capture, emptyCapture } from '../../packages/model/src/index.js';
import { compareCaptureAccuracy, computeBoxIoU } from './src/index.js';

function runDiffHarnessTests() {
  // 1. Box IoU calculation
  const boxA = { x: 0, y: 0, w: 100, h: 100 };
  const boxB = { x: 50, y: 0, w: 100, h: 100 };
  // Overlap: 50 * 100 = 5000; Union: 10000 + 10000 - 5000 = 15000 -> IoU = 5000 / 15000 = 0.333
  const iou = computeBoxIoU(boxA, boxB);
  assert.ok(Math.abs(iou - (1 / 3)) < 0.01, 'IoU calculation error');

  // Identical boxes
  assert.strictEqual(computeBoxIoU(boxA, boxA), 1, 'Self IoU should be 1');

  // Disjoint boxes
  const boxC = { x: 200, y: 200, w: 50, h: 50 };
  assert.strictEqual(computeBoxIoU(boxA, boxC), 0, 'Disjoint IoU should be 0');

  // 2. Identical capture comparison
  const baseCapture: Capture = emptyCapture({
    url: 'https://test.diff.local',
    version: '0.1.1',
    frame: { width: 1200, height: 800, baseURI: 'https://test.diff.local/' },
    nodes: [
      {
        id: 'node-header',
        type: 'frame',
        box: { x: 0, y: 0, w: 1200, h: 80 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'node-logo',
        parentId: 'node-header',
        type: 'text',
        box: { x: 24, y: 24, w: 120, h: 32 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Brand Logo',
          fontFamily: 'Inter',
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(0, 0, 0, 1)',
        },
      },
    ],
  });

  const identicalReport = compareCaptureAccuracy(baseCapture, baseCapture);
  assert.strictEqual(identicalReport.metrics.passed, true);
  assert.strictEqual(identicalReport.metrics.accuracyScore, 100);
  assert.strictEqual(identicalReport.metrics.missingNodeIds.length, 0);
  assert.strictEqual(identicalReport.metrics.extraNodeIds.length, 0);
  assert.strictEqual(identicalReport.discrepancies.length, 0);

  // 3. Divergent capture comparison (shifted box, mismatched text)
  const divergentCapture: Capture = {
    ...baseCapture,
    nodes: [
      {
        id: 'node-header',
        type: 'frame',
        box: { x: 0, y: 0, w: 1200, h: 80 },
        style: {
          fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 1)' }],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
      },
      {
        id: 'node-logo',
        parentId: 'node-header',
        type: 'text',
        // Shifted x and reduced w
        box: { x: 60, y: 24, w: 80, h: 32 },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: 'Different Logo Text',
          fontFamily: 'Inter',
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 24,
          letterSpacing: 0,
          align: 'left',
          color: 'rgba(0, 0, 0, 1)',
        },
      },
    ],
  };

  const divergentReport = compareCaptureAccuracy(divergentCapture, baseCapture);
  assert.ok(divergentReport.discrepancies.length > 0, 'Expected discrepancies for divergent capture');
  assert.ok(
    divergentReport.discrepancies.some((d) => d.includes('text mismatch')),
    'Expected text mismatch discrepancy'
  );
  assert.ok(
    divergentReport.discrepancies.some((d) => d.includes('box divergence')),
    'Expected box divergence discrepancy'
  );

  // 4. Missing node in capture
  const missingNodeCapture: Capture = {
    ...baseCapture,
    nodes: [baseCapture.nodes[0]], // missing 'node-logo'
  };

  const missingReport = compareCaptureAccuracy(missingNodeCapture, baseCapture);
  assert.strictEqual(missingReport.metrics.passed, false);
  assert.strictEqual(missingReport.metrics.missingNodeIds.length, 1);
  assert.strictEqual(missingReport.metrics.missingNodeIds[0], 'node-logo');

  console.log('tools/diff accuracy harness tests passed: 4/4 scenarios verified');
}

runDiffHarnessTests();
