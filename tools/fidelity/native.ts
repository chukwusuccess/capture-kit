/**
 * Native importer fidelity harness for Sketch and Figma.
 *
 * Exercises HTML + Sketch (.sketch -> sketchtool 1x artboard PNG -> pixel diff)
 * and Figma headless native plan verification across suite fixtures + own@1440/390.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capture, Node } from '../../packages/model/src/index.js';
import { modelToSketch } from '../../packages/destinations/sketch/src/index.js';
import {
  parseNativeCaptures,
  planNativeCapture,
  type NativeNodePlan,
} from '../../packages/destinations/figma/src/native.js';
import { diffPngBuffers, runFidelity } from './src/index.js';
import { fidelityCases, type FidelityCase } from './src/suite.js';
import { startFixtureServers, type FixtureServers } from './src/fixture-server.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const METRIC_COMPAT_FONTS: Record<string, string> = {
  'helvetica': 'Inter',
  'helvetica neue': 'Inter',
  'arial': 'Inter',
  'sf pro': 'Inter',
  'sf pro text': 'Inter',
  'sf pro display': 'Inter',
  '-apple-system': 'Inter',
  'blinkmacsystemfont': 'Inter',
  'system-ui': 'Inter',
  'times': 'Tinos',
  'times new roman': 'Tinos',
  'georgia': 'Libre Baskerville',
  'courier': 'Roboto Mono',
  'courier new': 'Roboto Mono',
  'menlo': 'JetBrains Mono',
  'monaco': 'JetBrains Mono',
  'consolas': 'JetBrains Mono',
};

const SUPPORTED_FIGMA_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

function findSketchtool(): string | null {
  const candidates = [
    process.env.SKETCHTOOL_PATH,
    '/Applications/Sketch Beta.app/Contents/Resources/sketchtool/bin/sketchtool',
    '/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool',
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function ensureOwnPreview(): Promise<{ url: string; proc: ChildProcess | null } | null> {
  const ownUrl = 'http://127.0.0.1:4173/';
  if (await isReachable(ownUrl)) return { url: ownUrl, proc: null };
  const dir = join(homedir(), 'orca/workspaces/Sales Canvas/sales-canvas-site');
  if (!existsSync(dir)) return null;
  const proc = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1', '--strictPort'], {
    cwd: dir,
    stdio: 'ignore',
    detached: false,
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isReachable(ownUrl)) return { url: ownUrl, proc };
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill('SIGTERM');
  return null;
}

function checkFigmaPlan(capture: Capture): {
  planValid: boolean;
  nodeCount: number;
  unmappedNodes: string[];
  textNodes: number;
  fontSubstitutions: string[];
  unsupportedImages: string[];
  note: string;
} {
  const [validated] = parseNativeCaptures([capture]);
  const plan = planNativeCapture(validated);
  const unmappedNodes: string[] = [];
  let textNodes = 0;
  const fontSubSet = new Set<string>();
  const unsupportedImages: string[] = [];

  const visit = (nodePlan: NativeNodePlan): void => {
    const src: Node = nodePlan.source;
    const mappedType =
      src.type === 'frame' || nodePlan.children.length > 0 || src.type === 'vector'
        ? 'FRAME'
        : src.type === 'text'
          ? 'TEXT'
          : src.type === 'image' || src.type === 'rect'
            ? 'RECTANGLE'
            : null;
    if (!mappedType) unmappedNodes.push(src.id);
    if (src.type === 'text' && src.text) {
      textNodes++;
      const families = src.text.fontFamily
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      const primary = families[0] || 'system-ui';
      const embedded = capture.fonts.some(
        (f) => f.family.toLowerCase() === primary.toLowerCase() && f.embedded !== false
      );
      if (!embedded) {
        const sub =
          families.slice(1).find((f) => METRIC_COMPAT_FONTS[f.toLowerCase()] || !/^(sans-serif|serif|monospace)$/i.test(f)) ||
          METRIC_COMPAT_FONTS[primary.toLowerCase()] ||
          'Inter';
        if (sub.toLowerCase() !== primary.toLowerCase()) {
          fontSubSet.add(`${primary} -> ${sub}`);
        }
      }
    }
    if (src.assetRef) {
      const asset = capture.assets[src.assetRef];
      if (asset && !SUPPORTED_FIGMA_IMAGE_MIMES.has(asset.mimeType.toLowerCase())) {
        unsupportedImages.push(`${src.id}:${asset.mimeType}`);
      }
    }
    for (const child of nodePlan.children) visit(child);
  };

  for (const root of plan.roots) visit(root);
  const planValid = unmappedNodes.length === 0 && unsupportedImages.length === 0;
  return {
    planValid,
    nodeCount: validated.nodes.length,
    unmappedNodes,
    textNodes,
    fontSubstitutions: [...fontSubSet],
    unsupportedImages,
    note: 'Figma desktop app has no headless CLI importer; verified via headless native plan check only.',
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const onlyArg = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)?.split(',');
  const outDir = resolve(outArg ?? join(ROOT, 'tools/fidelity/native-out'));
  mkdirSync(outDir, { recursive: true });

  const sketchtool = findSketchtool();
  let servers: FixtureServers | null = null;
  let ownServer: { url: string; proc: ChildProcess | null } | null = null;

  const cases: FidelityCase[] = [...fidelityCases];
  ownServer = await ensureOwnPreview();
  if (ownServer) {
    cases.push(
      { name: 'own-desktop', options: { url: ownServer.url, width: 1440, height: 900, mobile: false } },
      { name: 'own-mobile', options: { url: ownServer.url, width: 390, height: 844, mobile: true } }
    );
  }
  const selectedCases = onlyArg ? cases.filter((c) => onlyArg.includes(c.name)) : cases;

  const results: Array<Record<string, unknown>> = [];
  let sketchVerifiedAny = false;
  let hasFailures = false;

  try {
    servers = await startFixtureServers(join(ROOT, 'tools/fidelity/fixtures'));
    for (const fixture of selectedCases) {
      const caseOut = join(outDir, fixture.name);
      mkdirSync(caseOut, { recursive: true });
      const resolvedUrl = servers && fixture.options.url.endsWith('/images.html')
        ? `${servers.primaryBaseUrl}/images.html?xorigin=${encodeURIComponent(servers.crossOriginBaseUrl)}`
        : fixture.options.url;

      console.log(`\n[native] ${fixture.name} (${resolvedUrl})`);
      try {
        const htmlReport = await runFidelity({ ...fixture.options, url: resolvedUrl, outDir: caseOut });
        const capture: Capture = JSON.parse(readFileSync(htmlReport.files.capture, 'utf8'));
        const originalPng = readFileSync(htmlReport.files.original);

        // 1) Sketch: generate .sketch, export artboard via sketchtool, pixel-diff
        let sketchResult: Record<string, unknown> = { status: 'skipped', reason: 'sketchtool not found' };
        if (sketchtool) {
          const sketchPath = join(caseOut, 'capture.sketch');
          const sketchExportDir = join(caseOut, 'sketch-export');
          mkdirSync(sketchExportDir, { recursive: true });
          const blob = await modelToSketch(capture);
          writeFileSync(sketchPath, Buffer.from(await blob.arrayBuffer()));
          execFileSync(sketchtool, ['export', 'artboards', sketchPath, `--output=${sketchExportDir}`, '--formats=png', '--scales=1.0'], {
            stdio: 'pipe',
          });
          const exportedPngs = readdirSync(sketchExportDir).filter((f) => f.endsWith('.png'));
          if (exportedPngs.length === 0) {
            throw new Error(`sketchtool exported 0 PNGs for ${fixture.name}`);
          }
          const sketchPngPath = join(sketchExportDir, exportedPngs[0]);
          const sketchDiff = await diffPngBuffers(originalPng, readFileSync(sketchPngPath), fixture.options.tolerance ?? 32);
          const sketchMaskPath = join(caseOut, 'sketch-diff-mask.png');
          writeFileSync(sketchMaskPath, Buffer.from(sketchDiff.mask, 'base64'));
          sketchVerifiedAny = true;
          const deltaVsHtml = Math.round((sketchDiff.score - htmlReport.score) * 100) / 100;
          sketchResult = {
            status: 'ok',
            score: sketchDiff.score,
            strictScore: sketchDiff.strict,
            mismatchedPixels: sketchDiff.mismatched,
            totalPixels: sketchDiff.total,
            widthDelta: sketchDiff.widthDelta,
            heightDelta: sketchDiff.heightDelta,
            deltaVsHtml,
            png: sketchPngPath,
            mask: sketchMaskPath,
            sketchFile: sketchPath,
          };
          console.log(`  HTML: ${htmlReport.score}% | Sketch: ${sketchDiff.score}% (delta ${deltaVsHtml >= 0 ? '+' : ''}${deltaVsHtml} pts)`);
        }

        // 2) Figma: headless plan check
        const figmaResult = checkFigmaPlan(capture);
        if (!figmaResult.planValid) hasFailures = true;
        console.log(
          `  Figma plan: ${figmaResult.planValid ? 'ok' : 'FAILED'} (${figmaResult.nodeCount} nodes, unmapped=${figmaResult.unmappedNodes.length}, fontSubs=${figmaResult.fontSubstitutions.length})`
        );

        results.push({
          name: fixture.name,
          status: 'ok',
          html: {
            score: htmlReport.score,
            strictScore: htmlReport.strictScore,
            width: htmlReport.sourceSize.width,
            height: htmlReport.sourceSize.height,
          },
          sketch: sketchResult,
          figma: figmaResult,
        });
      } catch (err) {
        hasFailures = true;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${message}`);
        results.push({ name: fixture.name, status: 'error', error: message });
      }
    }
  } finally {
    await servers?.close();
    ownServer?.proc?.kill('SIGTERM');
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    nativeImportersVerified: {
      html: true,
      sketch: sketchVerifiedAny,
      figma: false,
    },
    figmaNote: 'Figma desktop app has no headless CLI importer; verified via headless native plan check only.',
    cases: results,
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nSummary written to ${join(outDir, 'summary.json')}`);
  if (hasFailures) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
