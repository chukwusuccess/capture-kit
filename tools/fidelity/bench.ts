import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CaptureTimings } from '../../packages/model/src/index.js';
import { runFidelity, type FidelityReport, type Hotspot } from './src/index.js';

interface SiteSpec {
  id: string;
  url: string;
  why: string;
  localDir?: string;
}

interface RunSample {
  ok: true;
  wallMs: number;
  report: FidelityReport;
}

interface RunFailure {
  ok: false;
  status: 'timeout' | 'error';
  message: string;
}

interface BenchEntry {
  id: string;
  url: string;
  why: string;
  width: number;
  status: 'ok' | 'timeout' | 'error';
  runs: number;
  wallMs?: number;
  score?: number;
  strictScore?: number;
  widthDelta?: number;
  heightDelta?: number;
  nodeCount?: number;
  stages?: CaptureTimings['stages'];
  counts?: CaptureTimings['counts'];
  jsonMB?: number;
  slowestStage?: { stage: string; ms: number };
  hotspots?: Hotspot[];
  files?: Pick<FidelityReport['files'], 'original' | 'rendered' | 'mask'>;
  diagnostics?: FidelityReport['diagnostics'];
  error?: string;
}

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WIDTHS = [1440, 390] as const;
const RUNS = Number(process.env.BENCH_RUNS || 3);
const TIMEOUT_MS = 120_000;

function resolveSiteUrl(url: string): string {
  if (/^https?:|^file:/.test(url)) return url;
  return pathToFileURL(resolve(ROOT, url)).href;
}

function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function ensurePreviewServer(sites: SiteSpec[]): Promise<ChildProcess | null> {
  const own = sites.find((s) => s.localDir && /^http:\/\/127\.0\.0\.1:4173/.test(s.url));
  if (!own?.localDir || (await isReachable(own.url))) return null;
  const cwd = expandHome(own.localDir);
  if (!existsSync(cwd)) return null;
  const proc = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1', '--strictPort'], {
    cwd,
    stdio: 'ignore',
    detached: false,
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isReachable(own.url)) return proc;
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill('SIGTERM');
  return null;
}

function slowestStageOf(stages?: CaptureTimings['stages']): { stage: string; ms: number } | undefined {
  if (!stages) return undefined;
  const entries = Object.entries(stages).filter(([k]) => k !== 'total');
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  return top ? { stage: top[0], ms: top[1] } : undefined;
}

async function runOne(url: string, width: number, outDir: string): Promise<RunSample | RunFailure> {
  const t0 = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const report = await Promise.race([
      runFidelity({
        url,
        width,
        height: width === 390 ? 844 : 900,
        mobile: width === 390,
        outDir,
        timeoutMs: TIMEOUT_MS,
        serializeOptions: { scrollStitch: false, collectTimings: true },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Benchmark run timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
      }),
    ]);
    return { ok: true, wallMs: Math.round(performance.now() - t0), report };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /timeout|timed out/i.test(message) ? 'timeout' : 'error';
    return { ok: false, status, message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatMarkdown(date: string, entries: BenchEntry[]): string {
  const lines: string[] = [
    `# Baseline Benchmark — ${date}`,
    '',
    '| site | width | total s | slowest stage | fidelity % | JSON MB |',
    '|---|---:|---:|---|---:|---:|',
  ];
  for (const e of entries) {
    if (e.status !== 'ok') {
      lines.push(`| ${e.id} | ${e.width} | ${e.status} | — | — | — |`);
      continue;
    }
    const totalS = ((e.stages?.total ?? e.wallMs ?? 0) / 1000).toFixed(2);
    const slowest = e.slowestStage ? `${e.slowestStage.stage} (${(e.slowestStage.ms / 1000).toFixed(2)}s)` : '—';
    const fidelity = e.score !== undefined ? `${e.score.toFixed(2)}%` : '—';
    const jsonMB = e.jsonMB !== undefined ? e.jsonMB.toFixed(2) : '—';
    lines.push(`| ${e.id} | ${e.width} | ${totalS} | ${slowest} | ${fidelity} | ${jsonMB} |`);
  }
  lines.push('', '## Site details & hotspots', '');
  for (const e of entries) {
    lines.push(`### ${e.id} (${e.width}px) — ${e.url}`);
    if (e.status !== 'ok') {
      lines.push(`- Status: \`${e.status}\` — ${e.error ?? 'unknown error'}`, '');
      continue;
    }
    lines.push(`- Score: ${e.score}% (strict ${e.strictScore}%), nodes: ${e.nodeCount}, size delta: w=${e.widthDelta} h=${e.heightDelta}`);
    if (e.stages) {
      const s = e.stages;
      lines.push(`- Stages (ms): total=${s.total}, scroll=${s.scroll}, waitImages=${s.waitImages}, walk=${s.walk}, freezeTransforms=${s.freezeTransforms}, nodes=${s.nodes}, text=${s.text}, assets=${s.assets}, fonts=${s.fonts}`);
    }
    if (e.counts) {
      const c = e.counts;
      lines.push(`- Counts: walked=${c.elementsWalked}, emitted=${c.nodesEmitted}, textChars=${c.textCharsMeasured}, transformed=${c.transformedElements}, assets=${c.assetsFetched} ok / ${c.assetsFailed} fail / ${c.assetsTimedOut} timeout (${(c.assetBytes / 1048576).toFixed(2)} MB)`);
    }
    const top3 = (e.hotspots ?? []).slice(0, 3);
    lines.push(top3.length
      ? `- Top hotspots: ${top3.map((h) => `${h.cell} ${h.mismatchPct}%`).join(', ')}`
      : '- Top hotspots: none');
    if (e.files) {
      lines.push(`- Artifacts: \`${e.files.original}\` | \`${e.files.rendered}\` | \`${e.files.mask}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const sites = JSON.parse(readFileSync(join(ROOT, 'tools/fidelity/sites.json'), 'utf8')) as SiteSpec[];
  const filter = process.argv.find((a) => a.startsWith('--site='))?.slice(7);
  const selected = filter ? sites.filter((s) => s.id === filter) : sites;
  const preview = await ensurePreviewServer(selected);
  const entries: BenchEntry[] = [];

  try {
    for (const site of selected) {
      const url = resolveSiteUrl(site.url);
      for (const width of WIDTHS) {
        console.log(`\n[bench] ${site.id} @ ${width}px (${url})`);
        const successes: RunSample[] = [];
        const failures: RunFailure[] = [];
        for (let r = 1; r <= RUNS; r++) {
          const outDir = join(ROOT, 'tools/fidelity/out/bench', date, `${site.id}-${width}`, `run-${r}`);
          mkdirSync(outDir, { recursive: true });
          const res = await runOne(url, width, outDir);
          if (res.ok) {
            successes.push(res);
            const totalMs = res.report.timings?.stages.total ?? res.wallMs;
            console.log(`  run ${r}/${RUNS}: ok (${(totalMs / 1000).toFixed(2)}s, score=${res.report.score}%)`);
          } else {
            failures.push(res);
            console.log(`  run ${r}/${RUNS}: ${res.status} (${res.message})`);
          }
        }
        if (successes.length === 0) {
          const hasTimeout = failures.some((f) => f.status === 'timeout');
          entries.push({
            id: site.id,
            url: site.url,
            why: site.why,
            width,
            status: hasTimeout ? 'timeout' : 'error',
            runs: RUNS,
            error: failures.map((f) => f.message).join(' | '),
          });
          continue;
        }
        successes.sort((a, b) => (a.report.timings?.stages.total ?? a.wallMs) - (b.report.timings?.stages.total ?? b.wallMs));
        const median = successes[Math.floor(successes.length / 2)];
        const rep = median.report;
        const jsonBytes = rep.timings?.counts.jsonBytes ?? 0;
        entries.push({
          id: site.id,
          url: site.url,
          why: site.why,
          width,
          status: 'ok',
          runs: RUNS,
          wallMs: median.wallMs,
          score: rep.score,
          strictScore: rep.strictScore,
          widthDelta: rep.widthDelta,
          heightDelta: rep.heightDelta,
          nodeCount: rep.nodeCount,
          stages: rep.timings?.stages,
          counts: rep.timings?.counts,
          jsonMB: Math.round((jsonBytes / 1048576) * 1000) / 1000,
          slowestStage: slowestStageOf(rep.timings?.stages),
          hotspots: rep.hotspots.slice(0, 3),
          files: { original: rep.files.original, rendered: rep.files.rendered, mask: rep.files.mask },
          diagnostics: rep.diagnostics,
        });
      }
    }
  } finally {
    preview?.kill('SIGTERM');
  }

  const baseDir = join(ROOT, 'tools/fidelity/baseline', date);
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, 'report.json'), JSON.stringify({ date, runsPerCase: RUNS, entries }, null, 2));
  writeFileSync(join(baseDir, 'report.md'), formatMarkdown(date, entries));
  console.log(`\n[bench] Wrote ${join(baseDir, 'report.json')} and report.md`);
}

main().catch((err) => {
  console.error('[bench] fatal:', err);
  process.exitCode = 1;
});
