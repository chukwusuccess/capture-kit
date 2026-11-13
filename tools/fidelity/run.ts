/**
 * CLI: score a page's capture→render fidelity.
 *
 *   pnpm fidelity              # local fixture
 *   pnpm fidelity https://x.com
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFidelity, type FidelityReport } from './src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function print(r: FidelityReport): void {
  console.log('');
  console.log(`  Fidelity score: ${r.score}% (tolerance) · ${r.strictScore}% byte-identical`);
  console.log(`  Pixels: ${r.mismatchedPixels.toLocaleString()} mismatched of ${r.totalPixels.toLocaleString()}`);
  console.log(`  Size: ${r.width}×${r.height} (Δ w=${r.widthDelta} h=${r.heightDelta}) · ${r.nodeCount} nodes`);
  if (r.hotspots.length > 0) {
    console.log('  Worst regions:');
    for (const h of r.hotspots) console.log(`    ${h.cell}: ${h.mismatchPct}% mismatched`);
  }
  console.log(`  Artifacts: ${r.files.mask}`);
  console.log('');
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const url = arg
    ? arg
    : pathToFileURL(join(HERE, 'fixture.html')).href;
  const widthArg = process.argv.find((a) => a.startsWith('--width='));
  const width = widthArg ? Number(widthArg.split('=')[1]) : 1000;
  const minArg = process.argv.find((a) => a.startsWith('--min='));
  const min = minArg ? Number(minArg.split('=')[1]) : 0;

  console.log(`fidelity: scoring ${url}`);
  const report = await runFidelity({ url, width });
  print(report);

  if (min > 0 && report.score < min) {
    console.error(`FAIL: score ${report.score}% < required ${min}%`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('fidelity failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
