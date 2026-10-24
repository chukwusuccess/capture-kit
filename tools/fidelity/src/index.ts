/**
 * Fidelity harness: screenshot the original page, serialize it with the real
 * extension bundle, render the HTML export, screenshot that, then pixel-diff
 * both in Chrome's canvas (no Node-side image deps).
 *
 * Driven over raw CDP — Node's global WebSocket, zero npm dependencies.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptureSchema } from '../../../packages/model/src/index.js';
import { modelToHtml } from '../../../packages/destinations/html/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_JS = join(HERE, '../../../apps/extension/dist/content.js');

export interface FidelityOptions {
  url: string;
  width?: number;
  /** Per-channel delta (0-255) below which pixels count as matching. */
  tolerance?: number;
  outDir?: string;
  timeoutMs?: number;
}

export interface Hotspot {
  cell: string;
  mismatchPct: number;
}

export interface FidelityReport {
  /** % of pixels within tolerance — the headline score. */
  score: number;
  /** % of pixels byte-identical (antialiasing noise included). */
  strictScore: number;
  mismatchedPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  widthDelta: number;
  heightDelta: number;
  nodeCount: number;
  hotspots: Hotspot[];
  files: { original: string; rendered: string; mask: string; html: string };
}

interface CdpMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.rej(new Error(msg.error.message));
      else p.res(msg.result ?? {});
    };
  }

  static connect(url: string, timeoutMs: number): Promise<Cdp> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => rej(new Error('CDP connect timeout')), timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        res(new Cdp(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        rej(new Error(`CDP connect failed: ${url}`));
      };
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<T> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: res as (v: unknown) => void, rej });
      setTimeout(() => {
        if (this.pending.delete(id)) rej(new Error(`CDP timeout: ${method}`));
      }, 30_000);
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return 'google-chrome';
}

async function launchChrome(timeoutMs: number): Promise<{ port: number; proc: ChildProcess }> {
  const port = 9300 + Math.floor(Math.random() * 600);
  const userDataDir = mkdtempSync(join(tmpdir(), 'capture-fidelity-'));
  const proc = spawn(
    chromePath(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  proc.on('exit', () => rmSync(userDataDir, { recursive: true, force: true }));

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode})`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('Chrome DevTools did not come up in time');
    await new Promise((r) => setTimeout(r, 150));
  }
  return { port, proc };
}

async function evaluate<T>(
  cdp: Cdp,
  session: string,
  expression: string,
  awaitPromise = false
): Promise<T> {
  const r = await cdp.send<{ result: { value?: T }; exceptionDetails?: { text: string } }>(
    'Runtime.evaluate',
    { expression, awaitPromise, returnByValue: true },
    session
  );
  if (r.exceptionDetails) {
    throw new Error(`Page evaluate failed: ${r.exceptionDetails.text}`);
  }
  return r.result?.value as T;
}

async function waitForPage(cdp: Cdp, session: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const state = await evaluate<string>(cdp, session, 'document.readyState');
    if (state === 'complete') break;
    if (Date.now() > deadline) throw new Error('Page load timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
  // Fonts must be settled or text scores are noise.
  await evaluate<number>(cdp, session, 'document.fonts.ready.then(() => 1)', true);
}

async function screenshot(cdp: Cdp, session: string): Promise<string> {
  const r = await cdp.send<{ data: string }>(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    session
  );
  return r.data;
}

interface DiffResult {
  score: number;
  strict: number;
  mismatched: number;
  total: number;
  width: number;
  height: number;
  widthDelta: number;
  heightDelta: number;
  hotspots: Hotspot[];
  mask: string;
}

// Runs inside Chrome: draws both screenshots on white canvases at common size,
// compares per-pixel, returns scores + a red-overlay diff mask.
const DIFF_FN = `async (aB64, bB64, tolerance) => {
  const load = (b64) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image decode failed'));
    img.src = 'data:image/png;base64,' + b64;
  });
  const [a, b] = await Promise.all([load(aB64), load(bB64)]);
  const w = Math.max(a.naturalWidth, b.naturalWidth);
  const h = Math.max(a.naturalHeight, b.naturalHeight);
  const draw = (img) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const da = draw(a);
  const db = draw(b);
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mctx = mask.getContext('2d');
  const out = mctx.createImageData(w, h);
  let mismatched = 0;
  let strict = 0;
  const cellsX = 8, cellsY = 8;
  const cellHits = new Array(cellsX * cellsY).fill(0);
  const cellTotals = new Array(cellsX * cellsY).fill(0);
  const cw = Math.ceil(w / cellsX);
  const ch = Math.ceil(h / cellsY);
  for (let p = 0; p < da.length; p += 4) {
    const delta = Math.max(
      Math.abs(da[p] - db[p]),
      Math.abs(da[p + 1] - db[p + 1]),
      Math.abs(da[p + 2] - db[p + 2])
    );
    const px = (p / 4) % w;
    const py = Math.floor((p / 4) / w);
    const cell = Math.min(cellsY - 1, Math.floor(py / ch)) * cellsX +
      Math.min(cellsX - 1, Math.floor(px / cw));
    cellTotals[cell]++;
    if (delta > 0) strict++;
    if (delta > tolerance) {
      mismatched++;
      cellHits[cell]++;
      out.data[p] = 255; out.data[p + 1] = 0; out.data[p + 2] = 0; out.data[p + 3] = 255;
    } else {
      const g = (da[p] + da[p + 1] + da[p + 2]) / 3;
      out.data[p] = out.data[p + 1] = out.data[p + 2] = g * 0.4;
      out.data[p + 3] = 255;
    }
  }
  mctx.putImageData(out, 0, 0);
  const total = w * h;
  const hotspots = cellHits
    .map((hits, i) => ({
      cell: 'r' + Math.floor(i / cellsX) + 'c' + (i % cellsX),
      mismatchPct: cellTotals[i] ? Math.round((hits / cellTotals[i]) * 1000) / 10 : 0,
    }))
    .filter((s) => s.mismatchPct > 0)
    .sort((x, y) => y.mismatchPct - x.mismatchPct)
    .slice(0, 6);
  return {
    score: Math.round((1 - mismatched / total) * 10000) / 100,
    strict: Math.round((1 - strict / total) * 10000) / 100,
    mismatched,
    total,
    width: w,
    height: h,
    widthDelta: Math.abs(a.naturalWidth - b.naturalWidth),
    heightDelta: Math.abs(a.naturalHeight - b.naturalHeight),
    hotspots,
    mask: mask.toDataURL('image/png').split(',')[1],
  };
}`;

export async function runFidelity(opts: FidelityOptions): Promise<FidelityReport> {
  const width = opts.width ?? 1000;
  const tolerance = opts.tolerance ?? 32;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const outDir = opts.outDir ?? join(HERE, 'out');
  mkdirSync(outDir, { recursive: true });

  const contentJs = readFileSync(CONTENT_JS, 'utf8');
  let chrome: ChildProcess | null = null;
  let cdp: Cdp | null = null;

  try {
    const launched = await launchChrome(timeoutMs);
    chrome = launched.proc;
    const version = await fetch(`http://127.0.0.1:${launched.port}/json/version`);
    const { webSocketDebuggerUrl } = (await version.json()) as { webSocketDebuggerUrl: string };
    cdp = await Cdp.connect(webSocketDebuggerUrl, timeoutMs);

    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const s = sessionId;

    await cdp.send('Page.enable', {}, s);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    }, s);
    await cdp.send('Page.navigate', { url: opts.url }, s);
    await waitForPage(cdp, s);
    const shotOriginal = await screenshot(cdp, s);

    // Serialize with the real extension bundle — the shipped artifact.
    await cdp.send('Runtime.evaluate', { expression: contentJs }, s);
    const captureJson = await evaluate<unknown>(
      cdp,
      s,
      'window.__captureKitSerialize({ scrollStitch: false }).then(c => JSON.stringify(c))',
      true
    );
    const capture = CaptureSchema.parse(JSON.parse(String(captureJson)));

    // Render exactly what the HTML destination ships, on a neutral page shell.
    const canvas = modelToHtml(capture, { standalone: false, title: 'fidelity render' });
    const renderHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}body{background:#ffffff;width:${capture.frame.width}px}</style></head><body>${canvas}</body></html>`;
    const renderPath = join(outDir, 'render.html');
    writeFileSync(renderPath, renderHtml);

    await cdp.send('Page.navigate', { url: `file://${renderPath}` }, s);
    await waitForPage(cdp, s);
    const shotRendered = await screenshot(cdp, s);

    // Pixel diff in-page: both PNGs as data URLs on a blank document.
    await cdp.send('Page.navigate', { url: 'about:blank' }, s);
    const diff = await evaluate<DiffResult>(
      cdp,
      s,
      `(${DIFF_FN})(${JSON.stringify(shotOriginal)}, ${JSON.stringify(shotRendered)}, ${tolerance})`,
      true
    );

    const originalPath = join(outDir, 'original.png');
    const renderedPath = join(outDir, 'rendered.png');
    const maskPath = join(outDir, 'diff-mask.png');
    writeFileSync(originalPath, Buffer.from(shotOriginal, 'base64'));
    writeFileSync(renderedPath, Buffer.from(shotRendered, 'base64'));
    writeFileSync(maskPath, Buffer.from(diff.mask, 'base64'));

    const report: FidelityReport = {
      score: diff.score,
      strictScore: diff.strict,
      mismatchedPixels: diff.mismatched,
      totalPixels: diff.total,
      width: diff.width,
      height: diff.height,
      widthDelta: diff.widthDelta,
      heightDelta: diff.heightDelta,
      nodeCount: capture.nodes.length,
      hotspots: diff.hotspots,
      files: { original: originalPath, rendered: renderedPath, mask: maskPath, html: renderPath },
    };
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    return report;
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill('SIGKILL');
    }
  }
}
