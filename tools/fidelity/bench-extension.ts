import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

interface CaptureTimingLog {
  phase: 'capture';
  url: string;
  width: number;
  format: string;
  loadMs: number;
  fitViewportMs: number;
  injectMs: number;
  serializeMs: number;
  replicaMs: number;
  storageWriteMs: number;
}

interface ExportTimingLog {
  phase: 'export';
  format: string;
  captures: number;
  storageReadMs: number;
  exportMs: number;
}

interface SessionResult {
  site: string;
  url: string;
  format: 'figma' | 'html';
  wallMs: number;
  jobs: CaptureTimingLog[];
  exportTiming?: ExportTimingLog;
  status: 'ok' | 'error';
  error?: string;
}

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXT = join(ROOT, 'apps/extension/dist');
const OWN_DIR = join(homedir(), 'orca/workspaces/Sales Canvas/sales-canvas-site');

function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse() : [];
  for (const d of dirs) {
    for (const bin of [
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
    ]) {
      if (existsSync(join(cache, d, bin))) return join(cache, d, bin);
    }
  }
  throw new Error('No Chromium found: set CHROME=/path/to/chromium');
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function ensureOwnPreview(): Promise<ChildProcess | null> {
  const url = 'http://127.0.0.1:4173/';
  if ((await isReachable(url)) || !existsSync(OWN_DIR)) return null;
  const proc = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1', '--strictPort'], {
    cwd: OWN_DIR,
    stdio: 'ignore',
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return proc;
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill('SIGTERM');
  return null;
}

async function runSession(
  ctx: BrowserContext,
  popup: Page,
  swLogs: CaptureTimingLog[],
  popupLogs: ExportTimingLog[],
  site: string,
  url: string,
  format: 'figma' | 'html'
): Promise<SessionResult> {
  const page = await ctx.newPage();
  const startLogIdx = swLogs.length;
  const startExportIdx = popupLogs.length;
  const t0 = performance.now();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    const tabId = await popup.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const match = tabs.find((t) => t.url === targetUrl || t.url?.startsWith(targetUrl));
      return match?.id;
    }, url);
    if (!tabId) throw new Error(`Could not find tab for ${url}`);

    const session = await popup.evaluate(async ({ tabId, url, format }) => {
      const res = await chrome.runtime.sendMessage({
        action: 'capture-run',
        tabId,
        urls: [url],
        widths: [1440, 390],
        format,
        scrollStitch: false,
        dualTheme: false,
        includeDesignSystem: false,
      }) as { success: boolean; session?: { id: string; status: string }; error?: string };
      if (!res?.success || !res.session) throw new Error(res?.error || 'capture-run failed');
      return res.session;
    }, { tabId, url, format });

    const deadline = Date.now() + 120_000;
    let finalStatus = session.status;
    while (Date.now() < deadline) {
      const list = await popup.evaluate(async () => {
        const res = await chrome.runtime.sendMessage({ action: 'list-sessions' }) as { sessions?: Array<{ id: string; status: string; error?: string }> };
        return res.sessions ?? [];
      });
      const current = list.find((s) => s.id === session.id);
      if (current && ['completed', 'failed', 'interrupted', 'cancelled'].includes(current.status)) {
        finalStatus = current.status;
        if (current.status !== 'completed') throw new Error(current.error || `Session ended with ${current.status}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (finalStatus !== 'completed') throw new Error(`Session timed out (${finalStatus})`);

    // Trigger export via the popup UI's Export button so storageReadMs + exportMs are measured.
    await popup.reload({ waitUntil: 'domcontentloaded' });
    await popup.waitForSelector(`.session-action[data-session-id="${session.id}"][data-action="export"]`, { timeout: 10_000 });
    await popup.click(`.session-action[data-session-id="${session.id}"][data-action="export"]`);
    await new Promise((r) => setTimeout(r, 1500));

    const wallMs = Math.round(performance.now() - t0);
    return {
      site,
      url,
      format,
      wallMs,
      jobs: swLogs.slice(startLogIdx),
      exportTiming: popupLogs.slice(startExportIdx)[0],
      status: 'ok',
    };
  } catch (err) {
    return {
      site,
      url,
      format,
      wallMs: Math.round(performance.now() - t0),
      jobs: swLogs.slice(startLogIdx),
      exportTiming: popupLogs.slice(startExportIdx)[0],
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(EXT, 'content.js'))) throw new Error('Build first: pnpm build');
  const preview = await ensureOwnPreview();
  const ctx = await chromium.launchPersistentContext('', {
    executablePath: findChrome(),
    headless: false,
    reducedMotion: 'reduce',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const swLogs: CaptureTimingLog[] = [];
  const popupLogs: ExportTimingLog[] = [];

  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    sw.on('console', (msg) => {
      const txt = msg.text();
      if (!txt.startsWith('[capture-kit] timings ')) return;
      try {
        const parsed = JSON.parse(txt.slice('[capture-kit] timings '.length)) as CaptureTimingLog;
        if (parsed.phase === 'capture') swLogs.push(parsed);
      } catch { /* ignore */ }
    });

    const popup = await ctx.newPage();
    popup.on('console', (msg) => {
      const txt = msg.text();
      if (!txt.startsWith('[capture-kit] timings ')) return;
      try {
        const parsed = JSON.parse(txt.slice('[capture-kit] timings '.length)) as ExportTimingLog;
        if (parsed.phase === 'export') popupLogs.push(parsed);
      } catch { /* ignore */ }
    });
    await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });

    const targets = [
      { site: 'own', url: 'http://127.0.0.1:4173/' },
      { site: 'stripe', url: 'https://stripe.com' },
    ];
    const formats: Array<'figma' | 'html'> = ['figma', 'html'];
    const results: SessionResult[] = [];

    for (const target of targets) {
      for (const format of formats) {
        console.log(`\n[bench:ext] ${target.site} (${format})...`);
        const res = await runSession(ctx, popup, swLogs, popupLogs, target.site, target.url, format);
        results.push(res);
        console.log(`  status=${res.status} wall=${(res.wallMs / 1000).toFixed(2)}s jobs=${res.jobs.length}${res.error ? ` err=${res.error}` : ''}`);
        for (const j of res.jobs) {
          console.log(`    w=${j.width} load=${j.loadMs}ms fit=${j.fitViewportMs}ms inject=${j.injectMs}ms serialize=${j.serializeMs}ms replica=${j.replicaMs}ms write=${j.storageWriteMs}ms`);
        }
        if (res.exportTiming) {
          console.log(`    export: read=${res.exportTiming.storageReadMs}ms export=${res.exportTiming.exportMs}ms`);
        }
      }
    }

    const outDir = join(ROOT, 'tools/fidelity/out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'bench-extension.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  } finally {
    await ctx.close().catch(() => undefined);
    preview?.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('[bench:ext] fatal:', err);
  process.exitCode = 1;
});
