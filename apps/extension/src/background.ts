import { CaptureSchema, type Capture } from '@capture-kit/model';

interface CaptureResponse {
  success: boolean;
  accepted?: boolean;
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
  const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (lastFocused?.id && lastFocused?.url && !lastFocused.url.startsWith('chrome-extension://')) {
    return lastFocused.id;
  }

  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current?.id && current?.url && !current.url.startsWith('chrome-extension://')) {
    return current.id;
  }

  const all = await chrome.tabs.query({ active: true });
  const candidate = all.find((t) => t.id && t.url && !t.url.startsWith('chrome-extension://'));
  if (candidate?.id) return candidate.id;

  throw new Error('No active web tab found');
}

// ponytail: hard cap — the popup must stay open for the whole crawl
const MAX_SITE_PAGES = 50;

// Stream to the popup instead of replying on the message channel: a whole
// run's captures in one sendResponse exceeds Chrome's message size limit,
// and holding the channel open across a multi-minute crawl lets the
// service worker get terminated mid-run (both silently dropped the reply).
function sendToPopup(message: unknown): void {
  void chrome.runtime.sendMessage(message).catch(() => {
    /* popup closed */
  });
}

function reportProgress(done: number, total: number, url: string): void {
  sendToPopup({ type: 'progress', done, total, url });
}
async function deliverCaptureToPopup(capture: Capture, index: number): Promise<void> {
  const key = `run-capture:${Date.now()}:${index}`;
  try {
    await chrome.storage.local.set({ [key]: capture });
    sendToPopup({ type: 'capture-ready', key });
  } catch {
    sendToPopup({ type: 'capture', capture });
  }
}



function extractSitemapLocs(xmlText: string): string[] {
  const locs: string[] = [];
  const matches = xmlText.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi);
  for (const m of matches) {
    if (m[1]) locs.push(m[1].trim());
  }
  return locs;
}

async function discoverSiteUrls(
  tabId: number,
  passedOrigin = '',
  passedUrl = ''
): Promise<string[]> {
  let origin = passedOrigin;
  let tabUrl = passedUrl;
  if (!origin || !tabUrl) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    tabUrl = tabUrl || tab?.url || '';
    try {
      origin = origin || new URL(tabUrl).origin;
    } catch {
      // ignore
    }
  }
  let onPageUrls: string[] = [];
  try {
    const [execResult] = await chrome.scripting.executeScript<string[]>({
      target: { tabId },
      func: () => {
        const docOrigin = location.origin;
        const out = new Set<string>();

        const normalize = (raw: string | null | undefined): string | null => {
          if (!raw) return null;
          const trimmed = raw.trim();
          if (
            trimmed.startsWith('#') ||
            trimmed.startsWith('javascript:') ||
            trimmed.startsWith('mailto:') ||
            trimmed.startsWith('tel:') ||
            trimmed.startsWith('data:')
          ) {
            return null;
          }
          try {
            const u = new URL(trimmed, location.href);
            if (u.origin !== docOrigin) return null;
            u.hash = '';
            const path = u.pathname.replace(/\/+$/, '') || '/';
            const normalized = u.origin + path + (u.search || '');
            if (
              /\.(xml|pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|gz|tar|woff2?|ttf|css|js|json)$/i.test(
                normalized
              )
            ) {
              return null;
            }
            return normalized;
          } catch {
            return null;
          }
        };

        for (const a of document.querySelectorAll('a[href], area[href]')) {
          const href = a.getAttribute('href') || (a as HTMLAnchorElement).href;
          const url = normalize(href);
          if (url) out.add(url);
        }

        for (const link of document.querySelectorAll(
          'link[rel="canonical"], link[rel="alternate"]'
        )) {
          const href = link.getAttribute('href');
          const url = normalize(href);
          if (url) out.add(url);
        }

        const current = normalize(location.href);
        if (current) out.add(current);

        return [...out];
      },
    });

    onPageUrls = execResult?.result ?? [];
  } catch {
    // in-page script fallback
  }

  if (!origin && onPageUrls.length > 0) {
    try {
      origin = new URL(onPageUrls[0]).origin;
    } catch {
      // ignore
    }
  }

  if (!origin) return onPageUrls;

  const allUrls = new Set<string>(onPageUrls);
  if (tabUrl) {
    const cleanCurrent = tabUrl.replace(/#.*$/, '');
    allUrls.add(cleanCurrent);
  }

  // Fast sitemap probe with 1.2s timeout
  try {
    const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml'];
    await Promise.all(
      sitemapPaths.map(async (path) => {
        try {
          const res = await fetch(`${origin}${path}`, {
            credentials: 'include',
            signal: AbortSignal.timeout(1200),
          });
          if (!res.ok) return;
          const text = await res.text();
          if (!text.includes('<loc')) return;

          const locs = extractSitemapLocs(text);
          for (const locUrl of locs) {
            if (locUrl.startsWith(origin)) {
              const clean =
                locUrl.replace(/#.*$/, '').replace(/\/+$/, '') || `${origin}/`;
              if (!/\.(xml|pdf|jpe?g|png|gif|webp|svg|zip)$/i.test(clean)) {
                allUrls.add(clean);
              }
            }
          }
        } catch {
          // ignore
        }
      })
    );
  } catch {
    // ignore
  }
  return [...allUrls].sort((a, b) => a.localeCompare(b));
}

function waitForTabReady(tabId: number, maxWaitMs = 5000): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  let settled = false;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    chrome.tabs.onUpdated.removeListener(onUpdate);
    clearInterval(pollTimer);
    clearTimeout(timeoutTimer);
    resolve();
  };

  const onUpdate = (id: number, info: { status?: string }): void => {
    if (id === tabId && info.status === 'complete') finish();
  };

  chrome.tabs.onUpdated.addListener(onUpdate);
  const timeoutTimer = setTimeout(finish, maxWaitMs);

  const pollTimer = setInterval(async () => {
    try {
      const [res] = await chrome.scripting.executeScript<{ ready: boolean }>({
        target: { tabId },
        func: () => ({
          ready:
            document.readyState === 'interactive' ||
            document.readyState === 'complete',
        }),
      });
      if (res?.result?.ready) {
        finish();
      }
    } catch {
      // not ready yet
    }
  }, 350);

  return promise;
}

// Keep only http(s) URLs on the active tab's origin — the popup sends these.
function sameOriginUrls(raw: unknown, origin: string): string[] {
  if (!Array.isArray(raw)) return [];
  const originClean = origin.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
  return raw.filter((u): u is string => {
    try {
      if (typeof u !== 'string') return false;
      const uOrigin = new URL(u).origin.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
      return uOrigin === originClean;
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
  await injectSerializer(tabId);
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
        const settle = (): void => void setTimeout(resolve, 80);
        const fallback = setTimeout(settle, 180);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(fallback);
            settle();
          })
        );
      }),
  });
}

async function captureWithThemes(tabId: number, scrollStitch: boolean, dualTheme: boolean): Promise<Capture[]> {
  const primary = await runSerializer(tabId, scrollStitch);
  if (!dualTheme) return [primary];
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.documentElement;
        const isDark = root.classList.contains('dark') || root.dataset.theme === 'dark' || getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.slice(0, 3).every((v) => Number(v) < 60);
        root.dataset.ckPrevClass = root.className;
        root.dataset.ckPrevTheme = root.dataset.theme ?? '';
        root.dataset.ckPrevScheme = root.style.colorScheme;
        if (isDark) {
          root.classList.remove('dark');
          root.classList.add('light');
          root.dataset.theme = 'light';
          root.style.colorScheme = 'light';
        } else {
          root.classList.remove('light');
          root.classList.add('dark');
          root.dataset.theme = 'dark';
          root.style.colorScheme = 'dark';
        }
      },
    });
    await waitForLayout(tabId);
    const alt = await runSerializer(tabId, scrollStitch);
    return [primary, alt];
  } catch {
    return [primary];
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.documentElement;
        if (root.dataset.ckPrevClass !== undefined) root.className = root.dataset.ckPrevClass;
        if (root.dataset.ckPrevTheme) root.dataset.theme = root.dataset.ckPrevTheme;
        else delete root.dataset.theme;
        root.style.colorScheme = root.dataset.ckPrevScheme ?? '';
        delete root.dataset.ckPrevClass;
        delete root.dataset.ckPrevTheme;
        delete root.dataset.ckPrevScheme;
      },
    }).catch(() => undefined);
  }
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
  try {
    await chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' });
    await chrome.tabs.setZoom(tabId, 1);
    await waitForLayout(tabId);
    const { frame } = await measure(tabId);
    try {
      await chrome.windows.update(windowId, { width: Math.max(1, width + frame) });
    } catch {
      // OS window clamped to screen resolution; zoom fallback below scales viewport
    }
    await waitForLayout(tabId);
    const { inner } = await measure(tabId);
    if (inner > 0 && Math.abs(inner - width) > 1) {
      await chrome.tabs.setZoom(tabId, inner / width);
      await waitForLayout(tabId);
    }
  } catch {
    // fallback
  }
}

async function loadInTab(tabId: number, targetUrl: string, maxWaitMs = 12000): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  let settled = false;
  const targetClean = targetUrl.replace(/#.*$/, '').replace(/\/+$/, '');

  const finish = (): void => {
    if (settled) return;
    settled = true;
    chrome.tabs.onUpdated.removeListener(onUpdate);
    clearTimeout(timeoutTimer);
    clearInterval(pollTimer);
    resolve();
  };

  const onUpdate = (_id: number, info: { status?: string }, tab?: { url?: string }): void => {
    if (_id !== tabId) return;
    if (info.status === 'complete') {
      const cur = (tab?.url || '').replace(/#.*$/, '').replace(/\/+$/, '');
      if (cur && (cur === targetClean || cur.startsWith(targetClean))) {
        finish();
      }
    }
  };

  chrome.tabs.onUpdated.addListener(onUpdate);
  const timeoutTimer = setTimeout(finish, maxWaitMs);

  await chrome.tabs.update(tabId, { url: targetUrl });

  const pollTimer = setInterval(async () => {
    try {
      const [res] = await chrome.scripting.executeScript<{ ready: boolean; href: string }>({
        target: { tabId },
        func: () => ({
          ready:
            document.readyState === 'interactive' ||
            document.readyState === 'complete',
          href: location.href,
        }),
      });
      const currentLoc = (res?.result?.href || '').replace(/#.*$/, '').replace(/\/+$/, '');
      if (
        res?.result?.ready &&
        currentLoc &&
        currentLoc !== 'about:blank' &&
        (currentLoc === targetClean || currentLoc.startsWith(targetClean))
      ) {
        finish();
      }
    } catch {
      // navigation pending
    }
  }, 250);

  await promise;
  await new Promise((r) => setTimeout(r, 250));
}

function samePage(a: string, b: string): boolean {
  const strip = (u: string): string => u.replace(/#.*$/, '').replace(/\/+$/, '');
  return strip(a) === strip(b);
}
let cancelRunRequested = false;

async function handleCaptureRun(
  rawUrls: unknown,
  rawWidths: unknown,
  scrollStitch: boolean,
  passedTabId?: number,
  passedOrigin?: string,
  dualTheme = false
): Promise<{ count: number; skipped: string[] }> {
  let targetOrigin = passedOrigin || '';
  let activeTabUrl = '';
  let activeTabWidth = 1280;

  if (passedTabId) {
    const tab = await chrome.tabs.get(passedTabId).catch(() => null);
    if (tab?.url) {
      activeTabUrl = tab.url;
      try {
        targetOrigin = targetOrigin || new URL(tab.url).origin;
      } catch {
        // ignore
      }
    }
    if (typeof tab?.width === 'number') activeTabWidth = tab.width;
  }

  if (!targetOrigin) {
    const activeId = await getActiveTabId();
    const active = await chrome.tabs.get(activeId);
    if (!active.url) throw new Error('Cannot read the current tab');
    activeTabUrl = active.url;
    targetOrigin = new URL(active.url).origin;
    if (typeof active.width === 'number') activeTabWidth = active.width;
  }

  const urls = sameOriginUrls(rawUrls, targetOrigin).slice(0, MAX_SITE_PAGES);
  if (urls.length === 0) throw new Error('No pages selected');
  const widths = Array.isArray(rawWidths)
    ? [...new Set(rawWidths.filter((w): w is number => Number.isInteger(w) && w >= 240 && w <= 7680))]
    : [];
  const sizes = (widths.length ? widths : [activeTabWidth]).slice(0, MAX_SIZES);

  // Just this tab at its own width: capture in place, keeping its live state.
  if (urls.length === 1 && activeTabUrl && samePage(urls[0], activeTabUrl) && sizes.length === 1 && sizes[0] === activeTabWidth) {
    const activeId = passedTabId ?? (await getActiveTabId());
    const caps = await captureWithThemes(activeId, scrollStitch, dualTheme);
    for (const [idx, c] of caps.entries()) await deliverCaptureToPopup(c, idx);
    return { count: caps.length, skipped: [] };
  }
  // Everything else runs in one unfocused window, so the user's window never resizes.
  const win = await chrome.windows.create({
    url: 'about:blank',
    focused: false,
    type: 'popup',
    width: 1280,
    height: 900,
  });
  let tabId = win.tabs?.[0]?.id;
  if (typeof tabId !== 'number' && typeof win.id === 'number') {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    tabId = tabs[0]?.id;
  }
  if (typeof win.id !== 'number' || typeof tabId !== 'number') {
    throw new Error('Could not open a capture window');
  }

  const skipped: string[] = [];
  const total = urls.length * sizes.length;
  let count = 0;
  cancelRunRequested = false;
  try {
    for (const [i, url] of urls.entries()) {
      if (cancelRunRequested) {
        skipped.push('Run cancelled by user');
        break;
      }
      try {
        await loadInTab(tabId, url);
        if (cancelRunRequested) {
          skipped.push('Run cancelled by user');
          break;
        }
        await injectSerializer(tabId);
        for (const [j, width] of sizes.entries()) {
          if (cancelRunRequested) break;
          reportProgress(i * sizes.length + j, total, url);
          await fitViewport(win.id, tabId, width);
          const caps = await captureWithThemes(tabId, scrollStitch, dualTheme);
          for (const cap of caps) {
            await deliverCaptureToPopup(cap, count);
            count += 1;
          }
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
  if (count === 0) throw new Error(`Captured 0 pages — ${skipped[0] ?? 'the site may block scripts'}`);
  return { count, skipped };
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

      if (action === 'capture-run') {
        const scrollStitch = 'scrollStitch' in message && Boolean(message.scrollStitch);
        const dualTheme = 'dualTheme' in message && Boolean(message.dualTheme);
        const urls = 'urls' in message ? message.urls : undefined;
        const widths = 'widths' in message ? message.widths : undefined;
        const tabId = 'tabId' in message && typeof message.tabId === 'number' ? message.tabId : undefined;
        const origin = 'origin' in message && typeof message.origin === 'string' ? message.origin : undefined;
        sendResponse({ success: true, accepted: true });
        handleCaptureRun(urls, widths, scrollStitch, tabId, origin, dualTheme).then(
          ({ count, skipped }) => sendToPopup({ type: 'run-done', count, skipped }),
          (error: unknown) =>
            sendToPopup({
              type: 'run-error',
              error: error instanceof Error ? error.message : String(error),
            })
        );
        return false;
      }

      if (action === 'discover-site') {
        const getTab =
          'tabId' in message && typeof message.tabId === 'number' && message.tabId > 0
            ? Promise.resolve(message.tabId)
            : getActiveTabId();
        const origin =
          'origin' in message && typeof message.origin === 'string'
            ? message.origin
            : '';
        const pageUrl =
          'url' in message && typeof message.url === 'string'
            ? message.url
            : '';

        getTab
          .then((tabId) => discoverSiteUrls(tabId, origin, pageUrl))
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

      if (action === 'cancel-run') {
        cancelRunRequested = true;
        sendResponse({ success: true });
        return true;
      }
      if (action === 'fetch-asset' && 'url' in message && typeof message.url === 'string') {
        const assetUrl = message.url;
        fetch(assetUrl, { signal: AbortSignal.timeout(6000) })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            sendResponse({ success: true, mimeType: blob.type || 'image/png', base64: btoa(binary) });
          })
          .catch(fail);
        return true;
      }
    }
    return false;
  }
);
