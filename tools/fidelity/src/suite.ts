import { fileURLToPath } from 'node:url';
import type { FidelityOptions, FidelityReport } from './index.js';

export interface FidelityCase {
  name: string;
  options: FidelityOptions;
}

const fixtures = [
  ['growing-lazy', 'Lazy fixture complete: batch 3'],
  ['wrapped-typography', 'Typography fixture complete'],
  ['nested-scroll', 'Nested scroll fixture complete'],
  ['svg-heavy', 'SVG fixture complete'],
  ['responsive', 'Responsive fixture complete'],
] as const;

/** No remote resources, clocks, random content, or implicit viewport selection. */
export const fidelityCases: FidelityCase[] = [
  {
    name: 'original-desktop',
    options: { url: new URL('../fixture.html', import.meta.url).href, width: 1000, height: 800 },
  },
  ...fixtures.flatMap(([name, marker]) => [
    { name: 'desktop', width: 1280, height: 800, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ].map((viewport): FidelityCase => ({
    name: `${name}-${viewport.name}`,
    options: {
      url: new URL(`../fixtures/${name}.html`, import.meta.url).href,
      width: viewport.width,
      height: viewport.height,
      mobile: viewport.mobile,
      requiredText: [marker],
      serializeOptions: {
        scrollStitch: name === 'growing-lazy',
        scrollOptions: { delayMs: 60, maxPasses: 40, maxDurationMs: 12000, maxHeight: 12000, stablePasses: 2 },
        imageOptions: { timeoutMs: 1500, totalTimeoutMs: 5000 },
        fontTimeoutMs: 2000,
      },
    },
  }))),
];

export type FidelityCaseResult =
  | { name: string; status: 'measured'; report: FidelityReport }
  | { name: string; status: 'error'; error: string; artifacts: string };

/** Errors, missing/duplicate results and nonfinite scores can never pass a gate. */
export function suiteFailures(expected: readonly string[], results: readonly FidelityCaseResult[], minimum?: number): string[] {
  const failures: string[] = [];
  if (expected.length === 0) failures.push('No cases were requested');
  if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0 || minimum > 100)) {
    failures.push('Minimum score must be a finite percentage from 0 to 100');
  }
  const expectedNames = new Set(expected);
  if (expectedNames.size !== expected.length) failures.push('Duplicate requested case names');
  for (const name of expected) {
    const matching = results.filter((result) => result.name === name);
    if (matching.length !== 1) {
      failures.push(`${name}: expected one result, received ${matching.length}`);
      continue;
    }
    const result = matching[0];
    if (result.status === 'error') {
      failures.push(`${name}: ${result.error}`);
    } else if (!Number.isFinite(result.report.score) || result.report.totalPixels <= 0) {
      failures.push(`${name}: invalid pixel measurement`);
    } else if (minimum !== undefined && result.report.score < minimum) {
      failures.push(`${name}: score ${result.report.score}% < requested ${minimum}%`);
    }
  }
  for (const result of results) {
    if (!expectedNames.has(result.name)) failures.push(`Unexpected case result: ${result.name}`);
  }
  return failures;
}

export const defaultSuiteOutDir = fileURLToPath(new URL('../out/suite/', import.meta.url));
