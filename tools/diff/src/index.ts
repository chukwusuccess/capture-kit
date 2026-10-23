import type { Capture, Node } from '../../../packages/model/src/index.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffMetrics {
  totalActualNodes: number;
  totalExpectedNodes: number;
  matchedNodes: number;
  missingNodeIds: string[];
  extraNodeIds: string[];
  boxIoUAverage: number;
  colorMatchRate: number;
  accuracyScore: number;
  passed: boolean;
}

export interface DiffOptions {
  iouThreshold?: number;
  minAccuracyScore?: number;
}

export interface DiffReport {
  metrics: DiffMetrics;
  discrepancies: string[];
  summary: string;
}

export function computeBoxIoU(a: Box, b: Box): number {
  const xA = Math.max(a.x, b.x);
  const yA = Math.max(a.y, b.y);
  const xB = Math.min(a.x + a.w, b.x + b.w);
  const yB = Math.min(a.y + a.h, b.y + b.h);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const aArea = a.w * a.h;
  const bArea = b.w * b.h;
  const unionArea = aArea + bArea - interArea;

  if (unionArea <= 0) return 1;
  return interArea / unionArea;
}

export function compareCaptureAccuracy(
  actual: Capture,
  expected: Capture,
  opts?: DiffOptions
): DiffReport {
  const iouThreshold = opts?.iouThreshold ?? 0.85;
  const minAccuracyScore = opts?.minAccuracyScore ?? 80;

  const actualMap = new Map<string, Node>();
  const expectedMap = new Map<string, Node>();

  for (const n of actual.nodes) actualMap.set(n.id, n);
  for (const n of expected.nodes) expectedMap.set(n.id, n);

  const discrepancies: string[] = [];
  const missingNodeIds: string[] = [];
  const extraNodeIds: string[] = [];

  let totalIoU = 0;
  let colorMatches = 0;
  let evaluatedPairs = 0;

  // Check expected nodes
  for (const [id, expNode] of expectedMap.entries()) {
    const actNode = actualMap.get(id);
    if (!actNode) {
      missingNodeIds.push(id);
      discrepancies.push(`Missing expected node: ${id} (${expNode.type})`);
      continue;
    }

    evaluatedPairs++;

    // Compare bounding box IoU
    const iou = computeBoxIoU(actNode.box, expNode.box);
    totalIoU += iou;
    if (iou < iouThreshold) {
      discrepancies.push(
        `Node ${id} box divergence: IoU ${iou.toFixed(2)} < threshold ${iouThreshold}`
      );
    }

    // Compare color fills
    const actColor = actNode.style.fills?.[0]?.color;
    const expColor = expNode.style.fills?.[0]?.color;
    if (actColor === expColor) {
      colorMatches++;
    } else if (actColor && expColor) {
      discrepancies.push(
        `Node ${id} fill color mismatch: actual ${actColor} vs expected ${expColor}`
      );
    }

    // Compare text content if applicable
    if (expNode.type === 'text') {
      if (actNode.text?.content !== expNode.text?.content) {
        discrepancies.push(
          `Node ${id} text mismatch: actual "${actNode.text?.content}" vs expected "${expNode.text?.content}"`
        );
      }
    }
  }

  // Check for extraneous nodes in actual capture
  for (const [id, actNode] of actualMap.entries()) {
    if (!expectedMap.has(id)) {
      extraNodeIds.push(id);
      discrepancies.push(`Unexpected extra node in actual capture: ${id} (${actNode.type})`);
    }
  }

  const matchedNodes = evaluatedPairs;
  const maxTotal = Math.max(actual.nodes.length, expected.nodes.length);
  const countFactor = maxTotal > 0 ? (matchedNodes / maxTotal) : 1;
  const boxIoUAverage = evaluatedPairs > 0 ? totalIoU / evaluatedPairs : 0;
  const colorMatchRate = evaluatedPairs > 0 ? colorMatches / evaluatedPairs : 0;

  const accuracyScore = Math.round(
    countFactor * 40 + boxIoUAverage * 40 + colorMatchRate * 20
  );

  const passed = accuracyScore >= minAccuracyScore && missingNodeIds.length === 0;

  const summary = [
    `Accuracy Score: ${accuracyScore}% (${passed ? 'PASSED' : 'FAILED'})`,
    `Nodes: ${matchedNodes} matched / ${expected.nodes.length} expected (${missingNodeIds.length} missing, ${extraNodeIds.length} extra)`,
    `Geometry: Average Box IoU ${(boxIoUAverage * 100).toFixed(1)}%`,
    `Color Fidelity: ${(colorMatchRate * 100).toFixed(1)}%`,
    `Discrepancies found: ${discrepancies.length}`,
  ].join('\n');

  return {
    metrics: {
      totalActualNodes: actual.nodes.length,
      totalExpectedNodes: expected.nodes.length,
      matchedNodes,
      missingNodeIds,
      extraNodeIds,
      boxIoUAverage,
      colorMatchRate,
      accuracyScore,
      passed,
    },
    discrepancies,
    summary,
  };
}
