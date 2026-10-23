import { CaptureSchema, type Capture } from '@capture-kit/model';

interface CaptureResponse {
  success: boolean;
  capture?: Capture;
  captures?: Capture[];
  urls?: string[];
  count?: number;
  skipped?: string[];
  error?: string;
}

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: { scrollStitch?: boolean }) => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
}

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || typeof tab.windowId !== 'number') {
    throw new Error('No active tab found');
  }
  return tab.id;
}

// ponytail: hard cap — the popup must stay open for the whole crawl
const MAX_SITE_PAGES = 50;

function reportProgress(done: number, total: number, url: string): void {
  void chrome.runtime.sendMessage({ type: 'progress', done, total, url }).catch(() => {
    /* popup closed */
  });
}

async function discoverSiteUrls(tabId: number): Promise<string[]> {
  const [execResult] = await chrome.scripting.executeScript<string[]>({
    target: { tabId },
    func: async () => {
      const origin = location.origin;
      const normalize = (raw: string): string | null => {
        try {
          const u = new URL(raw, location.href);
          if (u.origin !== origin) return null;
          u.hash = '';
          return u.origin + u.pathname + u.search;
        } catch {
          return null;
        }
      };
      const out = new Set<string>();

      const readSitemap = async (path: string): Promise<Document | null> => {
        try {
          const res = await fetch(path, { credentials: 'include' });
          if (!res.ok) return null;
          return new DOMParser().parseFromString(await res.text(), 'application/xml');
        } catch {
          return null;
        }
      };
      const locs = (doc: Document): string[] =>
        [...doc.querySelectorAll('loc')].map((l) => l.textContent?.trim() ?? '');

      const root = await readSitemap('/sitemap.xml');
      if (root) {
        // Sitemap index (WordPress/Yoast etc.): follow one level of child sitemaps.
        const children = root.querySelector('sitemapindex')
          ? await Promise.all(locs(root).slice(0, 10).map(readSitemap))
          : [root];
        for (const doc of children) {
          if (!doc) continue;
          for (const loc of locs(doc)) {
            const url = normalize(loc);
            if (url && !/\.(xml|pdf|jpe?g|png|gif|webp|svg|zip)$/i.test(url)) out.add(url);
          }
        }
      }

      if (out.size === 0) {
        for (const a of document.querySelectorAll('a[href]')) {
          const url = normalize(a.getAttribute('href') ?? '');
          if (url) out.add(url);
        }
      }

      return [...out];
    },
  });

  return execResult?.result ?? [];
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdate);
      resolve();
    };
    const onUpdate = (id: number, info: { status?: string }): void => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdate);
    setTimeout(finish, 20_000); // some pages never report complete
  });
}

// Keep only http(s) URLs on the active tab's origin — the popup sends these.
function sameOriginUrls(raw: unknown, origin: string): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => {
    try {
      return typeof u === 'string' && new URL(u).origin === origin;
    } catch {
      return false;
    }
  });
}

async function injectSerializer(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function runSerializer(tabId: number, scrollStitch: boolean): Promise<Capture> {
  const [execResult] = await chrome.scripting.executeScript<unknown>({
    target: { tabId },
    args: [scrollStitch],
    func: async (...args: unknown[]) => {
      const stitch = Boolean(args[0]);
      const customWindow = window as unknown as WindowWithCaptureKit;
      if (!customWindow.__captureKitSerialize) {
        throw new Error('Capture-kit serializer is not available on page');
      }
      return await customWindow.__captureKitSerialize({ scrollStitch: stitch });
    },
  });

  if (!execResult || execResult.result === undefined) {
    throw new Error('Serializer returned empty execution result');
  }

  return CaptureSchema.parse(execResult.result);
}

async function waitForLayout(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () =>
      new Promise<void>((resolve) => {
        // rAF never fires in hidden tabs; the timeout stops the crawl hanging there.
        const settle = (): void => void setTimeout(resolve, 250);
        const fallback = setTimeout(settle, 400);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(fallback);
            settle();
          })
        );
      }),
  });
}

async function handleFullCapture(scrollStitch = false): Promise<Capture> {
  const tabId = await getActiveTabId();
  await injectSerializer(tabId);
  return runSerializer(tabId, scrollStitch);
}

async function handlePickCapture(): Promise<Capture> {
  const tabId = await getActiveTabId();

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  const [execResult] = await chrome.scripting.executeScript<unknown>({
    target: { tabId },
    func: async () => {
      const customWindow = window as unknown as WindowWithCaptureKit;
      if (!customWindow.__captureKitPickElement) {
        throw new Error('Capture-kit element picker is not available on page');
      }
      return await customWindow.__captureKitPickElement();
    },
  });

  if (!execResult || execResult.result === undefined) {
    throw new Error('Element picker returned empty execution result');
  }

  return CaptureSchema.parse(execResult.result);
}

// Max sizes per run; pages × sizes is what the popup has to wait for.
const MAX_SIZES = 6;

async function measure(tabId: number): Promise<{ inner: number; frame: number }> {
  const [res] = await chrome.scripting.executeScript<{ inner: number; frame: number }>({
    target: { tabId },
    func: () => ({ inner: window.innerWidth, frame: window.outerWidth - window.innerWidth }),
  });
  return res?.result ?? { inner: 0, frame: 0 };
}

// Size the capture window so the page's CSS viewport is exactly `width`.
async function fitViewport(windowId: number, tabId: number, width: number): Promise<void> {
  await chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' });
  await chrome.tabs.setZoom(tabId, 1);
  await waitForLayout(tabId);
  const { frame } = await measure(tabId);
  await chrome.windows.update(windowId, { width: Math.max(1, width + frame) });
  await waitForLayout(tabId);
  const { inner } = await measure(tabId);
  if (Math.abs(inner - width) > 1) {
    // The OS clamps narrow windows (~500px); zoom in so the CSS viewport still lands on `width`.
    await chrome.tabs.setZoom(tabId, inner / width);
    await waitForLayout(tabId);
  }
}

async function loadInTab(tabId: number, url: string): Promise<void> {
  const loaded = waitForTabComplete(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
}

function samePage(a: string, b: string): boolean {
  const strip = (u: string): string => u.replace(/#.*$/, '').replace(/\/+$/, '');
  return strip(a) === strip(b);
}

async function handleCaptureRun(
  rawUrls: unknown,
  rawWidths: unknown,
  scrollStitch: boolean
): Promise<{ captures: Capture[]; skipped: string[] }> {
  const activeId = await getActiveTabId();
  const active = await chrome.tabs.get(activeId);
  if (!active.url) throw new Error('Cannot read the current tab');
  const urls = sameOriginUrls(rawUrls, new URL(active.url).origin).slice(0, MAX_SITE_PAGES);
  if (urls.length === 0) throw new Error('No pages selected');
  const widths = Array.isArray(rawWidths)
    ? [...new Set(rawWidths.filter((w): w is number => Number.isInteger(w) && w >= 240 && w <= 7680))]
    : [];
  const sizes = (widths.length ? widths : [active.width ?? 1280]).slice(0, MAX_SIZES);

  // Just this tab at its own width: capture in place, keeping its live state.
  if (urls.length === 1 && samePage(urls[0], active.url) && sizes.length === 1 && sizes[0] === active.width) {
    return { captures: [await handleFullCapture(scrollStitch)], skipped: [] };
  }

  // Everything else runs in one unfocused window, so the user's window never resizes.
  const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'popup', width: 1280, height: 900 });
  const tabId = win.tabs?.[0]?.id;
  if (typeof win.id !== 'number' || typeof tabId !== 'number') throw new Error('Could not open a capture window');

  const captures: Capture[] = [];
  const skipped: string[] = [];
  const total = urls.length * sizes.length;
  try {
    for (const [i, url] of urls.entries()) {
      try {
        await loadInTab(tabId, url);
        await injectSerializer(tabId);
        for (const [j, width] of sizes.entries()) {
          reportProgress(i * sizes.length + j, total, url);
          await fitViewport(win.id, tabId, width);
          captures.push(await runSerializer(tabId, scrollStitch));
        }
      } catch (err: unknown) {
        // Keep going — one broken page shouldn't kill the whole run.
        skipped.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await chrome.windows.remove(win.id).catch(() => undefined);
  }

  reportProgress(total, total, '');
  if (captures.length === 0) throw new Error(`Captured 0 pages — ${skipped[0] ?? 'the site may block scripts'}`);
  return { captures, skipped };
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: CaptureResponse) => void
  ) => {
    if (message && typeof message === 'object' && 'action' in message) {
      const action = message.action;
      const fail = (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        sendResponse({ success: false, error: msg });
      };

      if (action === 'capture') {
        const scrollStitch = 'scrollStitch' in message && Boolean(message.scrollStitch);
        handleFullCapture(scrollStitch).then(
          (capture) => sendResponse({ success: true, capture }),
          fail
        );
        return true;
      }

      if (action === 'capture-run') {
        const scrollStitch = 'scrollStitch' in message && Boolean(message.scrollStitch);
        const urls = 'urls' in message ? message.urls : undefined;
        const widths = 'widths' in message ? message.widths : undefined;
        handleCaptureRun(urls, widths, scrollStitch).then(
          ({ captures, skipped }) => sendResponse({ success: true, captures, skipped }),
          fail
        );
        return true;
      }

      if (action === 'discover-site') {
        getActiveTabId()
          .then((tabId) => discoverSiteUrls(tabId))
          .then(
            (urls) => sendResponse({ success: true, urls, count: urls.length }),
            fail
          );
        return true;
      }

      if (action === 'pick') {
        handlePickCapture().then(
          (capture) => sendResponse({ success: true, capture }),
          fail
        );
        return true;
      }
    }
    return false;
  }
);
