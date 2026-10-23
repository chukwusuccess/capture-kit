import { CaptureSchema, type Capture } from '@capture-kit/model';

interface CaptureResponse {
  success: boolean;
  capture?: Capture;
  captures?: Capture[];
  urls?: string[];
  count?: number;
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

// ponytail: hard cap — add a page-limit input only if users actually hit 20
const MAX_SITE_PAGES = 20;

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

async function handleSiteCapture(scrollStitch: boolean): Promise<Capture[]> {
  const tabId = await getActiveTabId();
  const urls = (await discoverSiteUrls(tabId)).slice(0, MAX_SITE_PAGES);
  if (urls.length === 0) {
    throw new Error('No pages found — no sitemap and no internal links');
  }

  const captures: Capture[] = [];
  for (let i = 0; i < urls.length; i++) {
    reportProgress(i, urls.length, urls[i]);
    const created = await chrome.tabs.create({ url: urls[i], active: false });
    if (typeof created.id !== 'number') continue;
    try {
      await waitForTabComplete(created.id);
      await injectSerializer(created.id);
      await waitForLayout(created.id);
      captures.push(await runSerializer(created.id, scrollStitch));
    } catch (err: unknown) {
      // Keep going — one broken page shouldn't kill the whole crawl.
      console.warn(`capture-kit: skipped ${urls[i]}`, err);
    } finally {
      await chrome.tabs.remove(created.id);
    }
  }

  reportProgress(urls.length, urls.length, '');
  if (captures.length === 0) {
    throw new Error('Captured 0 pages — pages may block scripts');
  }
  return captures;
}

async function getActiveWindowId(): Promise<number> {
  const tabId = await getActiveTabId();
  const tab = await chrome.tabs.get(tabId);
  if (typeof tab.windowId !== 'number') {
    throw new Error('Active tab has no window');
  }
  return tab.windowId;
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
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250)));
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

async function handleBreakpointCapture(
  widths: number[],
  scrollStitch: boolean
): Promise<Capture[]> {
  const tabId = await getActiveTabId();
  const windowId = await getActiveWindowId();
  const win = await chrome.windows.get(windowId);
  const originalState = win.state;

  // Maximization hides the frame; go normal so width is controllable.
  if (originalState === 'maximized' || originalState === 'fullscreen') {
    await chrome.windows.update(windowId, { state: 'normal' });
  }

  await injectSerializer(tabId);

  // chrome.windows width is the outer frame; measure how much the frame eats
  // so the page viewport lands on the requested width.
  const [deltaResult] = await chrome.scripting.executeScript<number>({
    target: { tabId },
    func: () => window.outerWidth - window.innerWidth,
  });
  const frameDelta = deltaResult?.result ?? 0;

  const current = await chrome.windows.get(windowId);
  const captures: Capture[] = [];

  try {
    for (const width of widths) {
      await chrome.windows.update(windowId, {
        width: width + frameDelta,
        height: current.height ?? 800,
      });
      await waitForLayout(tabId);
      captures.push(await runSerializer(tabId, scrollStitch));
    }
  } finally {
    await chrome.windows.update(windowId, {
      width: current.width,
      height: current.height,
      state: originalState === 'maximized' || originalState === 'fullscreen' ? originalState : undefined,
    });
  }

  return captures;
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

      if (action === 'capture-breakpoints') {
        const scrollStitch = 'scrollStitch' in message && Boolean(message.scrollStitch);
        const widths =
          'widths' in message && Array.isArray(message.widths) && message.widths.length > 0
            ? message.widths.filter((w: unknown): w is number => typeof w === 'number' && w > 0)
            : [360, 768, 1280];
        handleBreakpointCapture(widths, scrollStitch).then(
          (captures) => sendResponse({ success: true, captures }),
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

      if (action === 'capture-site') {
        const scrollStitch = 'scrollStitch' in message && Boolean(message.scrollStitch);
        handleSiteCapture(scrollStitch).then(
          (captures) => sendResponse({ success: true, captures }),
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
