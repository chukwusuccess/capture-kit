import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFidelity } from './src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end fidelity gate: serialize the fixture with the shipped extension
 * bundle, render it, pixel-diff against the original. The fixture exercises
 * transforms, filters, backdrop-filter, gradients, pseudo-elements, ellipsis,
 * clip-path, blend modes and text transforms — every feature Phase 1 added.
 *
 * Score budget: headless font rasterization differs by a hair between the two
 * screenshots, so the gate sits at 90% tolerance. Track regressions, chase 100.
 */
async function main(): Promise<void> {
  const report = await runFidelity({
    url: pathToFileURL(join(HERE, 'fixture.html')).href,
    width: 1000,
    tolerance: 32,
  });

  console.log(report);

  assert.ok(
    report.score >= 90,
    `fidelity score ${report.score}% below 90% floor (see ${report.files.mask})`
  );
  assert.ok(report.widthDelta === 0, `width delta ${report.widthDelta}px`);
  assert.ok(report.heightDelta <= 1, `height delta ${report.heightDelta}px`);
  assert.ok(report.nodeCount > 20, `suspiciously few nodes: ${report.nodeCount}`);
  // Worst region must not be catastrophically broken either.
  if (report.hotspots.length > 0) {
    assert.ok(
      report.hotspots[0].mismatchPct < 60,
      `worst region ${report.hotspots[0].cell} is ${report.hotspots[0].mismatchPct}% mismatched`
    );
  }

  console.log(
    `tools/fidelity tests passed: ${report.score}% fidelity, ${report.nodeCount} nodes, ${report.totalPixels.toLocaleString()} px compared`
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
