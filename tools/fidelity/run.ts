/** HTML-only capture/render fidelity. See --help for scope and explicit gates. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runFidelity, type FidelityReport } from './src/index.js';
import { fileURLToPath } from 'node:url';
import { parseFidelityArgs } from './src/cli.js';
import { defaultSuiteOutDir, fidelityCases, suiteFailures, type FidelityCaseResult } from './src/suite.js';

function print(r: FidelityReport): void {
  console.log(`  Score: ${r.score}% within tolerance; ${r.strictScore}% byte-identical`);
  console.log(`  Pixels: ${r.mismatchedPixels.toLocaleString()} mismatched of ${r.totalPixels.toLocaleString()}`);
  console.log(`  Non-white pixels: ${r.nonWhiteScore}% within tolerance (${r.nonWhitePixels.toLocaleString()} pixels; not a semantic-content metric)`);
  console.log(`  Source: ${r.sourceSize.width}x${r.sourceSize.height}; HTML: ${r.renderedSize.width}x${r.renderedSize.height}; size delta w=${r.widthDelta} h=${r.heightDelta}`);
  if (r.hotspots.length > 0) {
    console.log('  Worst regions (8x8 grid; inspect the source and mask, not just the whole-page score):');
    for (const h of r.hotspots) {
      console.log(`    ${h.cell} [${h.x},${h.y} ${h.width}x${h.height}]: ${h.mismatchPct}% mismatched (${h.mismatchedPixels} pixels)`);
    }
  } else {
    console.log('  Worst regions: no pixels exceeded the requested tolerance');
  }
  for (const diagnostic of r.diagnostics) {
    console.log(`  ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}${diagnostic.nodeId ? ` [${diagnostic.nodeId}]` : ''}`);
  }
  console.log(`  Source: ${r.files.original}`);
  console.log(`  Mask: ${r.files.mask}`);
  console.log(`  Capture: ${r.files.capture}`);
}

async function main(): Promise<void> {
  const options = parseFidelityArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  pnpm fidelity [URL] [--width=1000] [--height=800] [--mobile] [--scroll-stitch]
  pnpm fidelity:suite [--min=PERCENT] [--out=DIRECTORY]
  pnpm fidelity --suite [--min=PERCENT] [--tolerance=32] [--timeout=45000]

No URL runs the preserved original fixture. Suite runs that fixture plus growing-lazy,
wrapped-typography, nested-scroll, svg-heavy and responsive at desktop and mobile widths.
Each case uses the built extension serializer and real HTML exporter through Chrome CDP.
Build the extension before running. CHROME_PATH may select the Chrome executable.

--min is an explicit per-case whole-page pixel score gate (0..100), not an average.
Without --min this is measurement only; no unmeasured difficult-case baseline is implied.
Any case error or missing result fails even with --min=0. Size deltas, capture warnings,
non-white pixel score and worst-region bounds stay visible. White background can inflate
whole-page scores; inspect original.png, rendered.png and diff-mask.png before setting gates.
Outputs include per-case capture.json, render.html, PNGs, report.json and suite summary.json.

Destination limit: HTML raster fidelity only. This does NOT verify native Sketch/Figma
imports, editability, Auto Layout, vector retention, or clipboard behavior. A high score
is not evidence of native importer fidelity. Unsupported rendering remains visible.
`);
    return;
  }
  console.log('Destination: HTML only; native Sketch/Figma importers are NOT exercised.');
  console.log(options.minimum === undefined
    ? 'Measurement only: no minimum requested. Capture/case errors still fail.'
    : `Requested minimum: ${options.minimum}% for EVERY case (no averaging).`);
  const common = { tolerance: options.tolerance, timeoutMs: options.timeoutMs };
  const cases = options.suite ? fidelityCases : [{
    name: 'page',
    options: {
      url: options.url ?? new URL('./fixture.html', import.meta.url).href,
      width: options.width,
      height: options.height,
      mobile: options.mobile,
      serializeOptions: { scrollStitch: options.scrollStitch ?? false },
    },
  }];
  const outDir = resolve(options.outDir ?? (options.suite ? defaultSuiteOutDir : fileURLToPath(new URL('./src/out/', import.meta.url))));
  mkdirSync(outDir, { recursive: true });
  const results: FidelityCaseResult[] = [];
  for (const fixture of cases) {
    const caseOut = options.suite ? join(outDir, fixture.name) : outDir;
    mkdirSync(caseOut, { recursive: true });
    console.log(`\n${fixture.name}: ${fixture.options.width ?? 1000}x${fixture.options.height ?? 800} ${fixture.options.mobile ? 'mobile' : 'desktop'} ${fixture.options.url}`);
    try {
      const report = await runFidelity({ ...fixture.options, ...common, outDir: caseOut });
      results.push({ name: fixture.name, status: 'measured', report });
      print(report);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      results.push({ name: fixture.name, status: 'error', error: message, artifacts: caseOut });
      writeFileSync(join(caseOut, 'error.json'), JSON.stringify({ case: fixture.name, error: message }, null, 2));
      console.error(`  ERROR: ${message}\n  Partial artifacts: ${caseOut}`);
    }
  }
  const failures = suiteFailures(cases.map((fixture) => fixture.name), results, options.minimum);
  const summaryPath = join(outDir, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify({
    destination: 'html',
    nativeImportersVerified: false,
    gate: { minimum: options.minimum ?? null, tolerance: options.tolerance ?? 32 },
    requestedCases: cases.map((fixture) => fixture.name),
    results,
    failures,
  }, null, 2));
  console.log(`\nMeasured ${results.filter((result) => result.status === 'measured').length}/${cases.length} cases. Summary: ${summaryPath}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(options.minimum === undefined ? 'Measurements complete; no quality gate was requested.' : 'All requested per-case minimum gates passed.');
  }
}

main().catch((error: unknown) => {
  console.error('fidelity failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
