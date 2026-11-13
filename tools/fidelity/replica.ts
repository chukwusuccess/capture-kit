// Pixel-fidelity check: each page vs its replica, compared pixel by pixel.
//
//   pnpm build && pnpm fidelity:replica                 # built-in fixture, must hit 99%
//   pnpm fidelity:replica https://stripe.com ...        # real sites, reported only
//
// Needs Chromium or Chrome for Testing (branded Chrome ignores --load-extension):
// CHROME=/path/to/binary, else the newest one Playwright has downloaded.
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');
const EXT = join(ROOT, 'apps/extension/dist');
const OUT = join(import.meta.dirname, 'out');
const FIXTURE = join(import.meta.dirname, 'fixture');
const WIDTHS = [1440, 768, 390];
const PASS = 0.99;
// A pixel counts as different past this per-channel delta (absorbs antialiasing).
const TOLERANCE = 40;

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

const TYPES: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };

// The fixture is served twice so cross.css is genuinely cross-origin.
function serve(xorigin = ''): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const file = join(FIXTURE, (req.url ?? '/').split('?')[0].replace(/\/$/, '/index.html'));
    if (!file.startsWith(FIXTURE) || !existsSync(file)) return void res.writeHead(404).end();
    let body: string | Buffer = readFileSync(file);
    if (file.endsWith('.html')) body = body.toString().replaceAll('{{XORIGIN}}', xorigin);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      ok({ server, origin: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` });
    })
  );
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
}

async function replicaOf(ctx: BrowserContext, page: Page): Promise<string> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  return sw.evaluate(async (url: string) => {
    const c = (globalThis as unknown as { chrome: any }).chrome;
    const tab = (await c.tabs.query({})).find((t: { url?: string }) => t.url === url);
    if (!tab?.id) throw new Error(`No tab for ${url}`);
    await c.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const [r] = await c.scripting.executeScript({
      target: { tabId: tab.id },
      func: () =>
        (window as unknown as { __captureKitReplica: () => Promise<string> })
          .__captureKitReplica()
          .catch((e: Error) => ({ error: e.stack ?? String(e) })),
    });
    if (typeof r?.result !== 'string') throw new Error(r?.result?.error ?? 'replica returned nothing');
    return r.result as string;
  }, page.url());
}

interface Diff {
  match: number;
  heights: [number, number];
  png: string;
}

// Compared in the browser: canvas does the PNG decoding, no image deps needed.
// Rows only one screenshot has count as different, so height drift costs score.
function compare(page: Page, a: Buffer, b: Buffer): Promise<Diff> {
  return page.evaluate(
    async ([a, b, tolerance]) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${src}`;
        await img.decode();
        return img;
      };
      const [A, B] = await Promise.all([load(a), load(b)]);
      const w = Math.max(A.width, B.width);
      const h = Math.max(A.height, B.height);
      const pixels = (img: HTMLImageElement) => {
        const c = new OffscreenCanvas(w, h).getContext('2d')!;
        c.drawImage(img, 0, 0);
        return c.getImageData(0, 0, w, h).data;
      };
      const pa = pixels(A);
      const pb = pixels(B);
      const out = new ImageData(w, h);
      let diff = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2]),
          Math.abs(pa[i + 3] - pb[i + 3])
        );
        if (d > tolerance) {
          diff++;
          out.data.set([255, 0, 0, 255], i);
        } else {
          const g = 255 - (255 - (pa[i] + pa[i + 1] + pa[i + 2]) / 3) * 0.25;
          out.data.set([g, g, g, 255], i);
        }
      }
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d')!.putImageData(out, 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { match: 1 - diff / (w * h), heights: [A.height, B.height] as [number, number], png: btoa(bin) };
    },
    [a.toString('base64'), b.toString('base64'), TOLERANCE] as const
  );
}

const slug = (url: string) => url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '').slice(0, 60);
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

async function main(): Promise<void> {
  if (!existsSync(join(EXT, 'content.js'))) throw new Error('Build first: pnpm build');
  mkdirSync(OUT, { recursive: true });
  const cross = await serve();
  const main = await serve(cross.origin);
  const urls = process.argv.slice(2);
  const fixture = urls.length === 0;
  if (fixture) urls.push(`${main.origin}/`);

  const ctx = await chromium.launchPersistentContext('', {
    executablePath: findChrome(),
    headless: false,
    reducedMotion: 'reduce',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const scratch = await ctx.newPage();
  let failed = false;
  console.log(['page', 'width', 'match', 'noise', 'heights', 'size'].join('\t'));
  try {
    for (const url of urls) {
      for (const width of WIDTHS) {
        const name = `${slug(url)}-${width}`;
        const page = await ctx.newPage();
        const copy = await ctx.newPage();
        try {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
          await settle(page);
          const original = await page.screenshot({ fullPage: true });
          const html = await replicaOf(ctx, page);
          // Same page shot again: what the page changes on its own (carousels, video).
          const noise = await compare(scratch, original, await page.screenshot({ fullPage: true }));
          const file = join(OUT, `${name}.html`);
          writeFileSync(file, html);
          await copy.setViewportSize({ width, height: 900 });
          await copy.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 45_000 });
          await settle(copy);
          const diff = await compare(scratch, original, await copy.screenshot({ fullPage: true }));
          writeFileSync(join(OUT, `${name}-diff.png`), Buffer.from(diff.png, 'base64'));
          const kb = `${Math.round(Buffer.byteLength(html) / 1024)} KB`;
          console.log([slug(url), width, pct(diff.match), pct(1 - noise.match), diff.heights.join('/'), kb].join('\t'));
          if (fixture && diff.match < PASS) failed = true;
        } catch (err) {
          failed ||= fixture;
          console.log([slug(url), width, 'error', String(err).split('\n')[0]].join('\t'));
        } finally {
          await page.close();
          await copy.close();
        }
      }
    }
  } finally {
    await ctx.close();
    main.server.close();
    cross.server.close();
  }
  console.log(`\nDiff images (red = mismatch): ${OUT}`);
  if (failed) {
    console.error(`FAIL: fixture below ${pct(PASS)}`);
    process.exit(1);
  }
}

await main();
