import { CaptureSchema, type Capture } from '@capture-kit/model';
import { CaptureSessionStore, type CaptureSession, type SessionInput } from './sessions';

interface CaptureResponse {
  success: boolean;
  accepted?: boolean;
  session?: CaptureSession;
  sessions?: CaptureSession[];
  urls?: string[];
  count?: number;
  error?: string;
  mimeType?: string;
  base64?: string;
}

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: { scrollStitch?: boolean }) => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
  __captureKitCancelPick?: () => void;
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

// Captures and job checkpoints are durable; popup delivery only announces changes.
const MAX_SITE_PAGES = 50;
const sessionStore = new CaptureSessionStore(chrome.storage.local);
const sessionsReady = sessionStore.initialize();
void sessionsReady.catch(() => undefined);
function sendToPopup(message: unknown): void {
  void chrome.runtime.sendMessage(message).catch(() => {
    /* popup closed */
  });
}

function announceSession(sessionId: string): void {
  sendToPopup({ type: 'session-updated', sessionId });
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
  } catch (error) {
    primary.diagnostics ??= [];
    primary.diagnostics.push({
      code: 'alternate_theme_failed',
      severity: 'warning',
      message: `Only the original theme was captured. Alternate theme failed: ${error instanceof Error ? error.message : String(error)}`,
    });
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

async function handlePickCapture(tabId: number): Promise<Capture> {

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
interface ActiveRun { id: string; cancelled: boolean; pickerTabId?: number }
let activeRun: ActiveRun | undefined;

async function prepareSession(message: Record<string, unknown>, pick = false): Promise<SessionInput> {
  const tabId = typeof message.tabId === 'number' && message.tabId > 0 ? message.tabId : await getActiveTabId();
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a website to capture it');
  const origin = new URL(tab.url).origin;
  const viewport = await measure(tabId);
  const currentWidth = viewport.inner || tab.width || 1280;
  const urls = pick ? [tab.url] : [...new Set(sameOriginUrls(message.urls, origin))];
  if (urls.length === 0) throw new Error('No pages selected');
  if (urls.length > MAX_SITE_PAGES) throw new Error(`Select no more than ${MAX_SITE_PAGES} pages per run`);
  const widths = pick ? [currentWidth] : Array.isArray(message.widths)
    ? [...new Set(message.widths.filter((width): width is number => Number.isInteger(width) && width >= 240 && width <= 7680))]
    : [];
  if (!widths.length) widths.push(currentWidth);
  if (widths.length > MAX_SIZES) throw new Error(`Select no more than ${MAX_SIZES} viewport widths`);
  return {
    origin, tabId, urls, widths,
    mode: pick ? 'pick' : urls.length === 1 && samePage(urls[0], tab.url) && widths.length === 1 && widths[0] === currentWidth ? 'live' : 'window',
    scrollStitch: Boolean(message.scrollStitch), dualTheme: Boolean(message.dualTheme),
    format: typeof message.format === 'string' ? message.format : 'figma',
    includeDesignSystem: Boolean(message.includeDesignSystem),
  };
}

async function createAndLaunchSession(message: Record<string, unknown>, pick = false): Promise<CaptureSession> {
  const session = await sessionStore.create(await prepareSession(message, pick));
  launchSession(session);
  return session;
}

function launchSession(session: CaptureSession): void {
  const control: ActiveRun = { id: session.id, cancelled: false };
  activeRun = control;
  announceSession(session.id);
  void executeSession(session, control).finally(() => {
    if (activeRun === control) activeRun = undefined;
  });
}

async function executeSession(session: CaptureSession, control: ActiveRun): Promise<void> {
  let captureWindowId: number | undefined;
  let captureTabId: number | undefined;
  let loadedUrl = '';
  try {
    for (const job of session.jobs) {
      if (job.status === 'completed') continue;
      if (control.cancelled) break;
      await sessionStore.startJob(session.id, job.id);
      announceSession(session.id);
      let captures: Capture[];
      try {
        if (session.mode === 'pick') {
          const tab = await chrome.tabs.get(session.tabId);
          if (!tab.url || !samePage(tab.url, job.url)) throw new Error('The original page is no longer open. Reopen it before resuming element selection.');
          control.pickerTabId = session.tabId;
          captures = [await handlePickCapture(session.tabId)];
          control.pickerTabId = undefined;
        } else {
          // Keep the live page only when it is still the intended page at the
          // saved viewport. A resumed session must not depend on its source tab.
          let liveTabId: number | undefined;
          let liveStateUnavailable = false;
          if (session.mode === 'live') {
            try {
              const tab = await chrome.tabs.get(session.tabId);
              if (tab.url && samePage(tab.url, job.url)) {
                const viewport = await measure(session.tabId);
                if (viewport.inner === job.width) liveTabId = session.tabId;
                else liveStateUnavailable = true;
              } else {
                liveStateUnavailable = true;
              }
            } catch {
              liveStateUnavailable = true;
            }
          }
          if (liveTabId !== undefined) {
            captures = await captureWithThemes(liveTabId, session.scrollStitch, session.dualTheme);
          } else {
            if (captureWindowId === undefined) {
              const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'popup', width: 1280, height: 900 });
              captureWindowId = win.id;
              captureTabId = win.tabs?.[0]?.id;
              if (captureTabId === undefined && captureWindowId !== undefined) {
                captureTabId = (await chrome.tabs.query({ windowId: captureWindowId }))[0]?.id;
              }
              if (captureWindowId === undefined || captureTabId === undefined) throw new Error('Could not open a capture window');
            }
            if (captureTabId === undefined) throw new Error('Capture tab is unavailable');
            if (loadedUrl !== job.url) {
              await loadInTab(captureTabId, job.url);
              loadedUrl = job.url;
            }
            if (control.cancelled) break;
            await fitViewport(captureWindowId, captureTabId, job.width);
            captures = await captureWithThemes(captureTabId, session.scrollStitch, session.dualTheme);
            if (liveStateUnavailable) {
              for (const capture of captures) {
                capture.diagnostics ??= [];
                capture.diagnostics.push({
                  code: 'live_state_unavailable',
                  severity: 'warning',
                  message: 'The original live page state was unavailable when this session resumed. This result was recaptured in an isolated window from the saved URL and viewport.',
                });
              }
            }
          }
        }
      } catch (error) {
        control.pickerTabId = undefined;
        if (control.cancelled) break;
        await sessionStore.failJob(session.id, job.id, error instanceof Error ? error.message : String(error));
        announceSession(session.id);
        continue;
      }
      // Persistence failures stop the run. Never substitute an ephemeral message
      // for a saved result, and never mark a job complete before this resolves.
      await sessionStore.completeJob(session.id, job.id, captures);
      announceSession(session.id);
    }
    const finished = await sessionStore.finish(session.id);
    sendToPopup({ type: 'run-done', sessionId: finished.id });
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    try {
      await sessionStore.interrupt(session.id, message);
    } catch (persistError) {
      message += `; could not persist interruption: ${persistError instanceof Error ? persistError.message : String(persistError)}`;
    }
    sendToPopup({ type: 'run-error', sessionId: session.id, error: message });
  } finally {
    if (captureWindowId !== undefined) await chrome.windows.remove(captureWindowId).catch(() => undefined);
  }
}

async function cancelActiveRun(): Promise<void> {
  const control = activeRun;
  if (!control) throw new Error('No capture run is active');
  control.cancelled = true;
  let checkpointFailed = false;
  let checkpointError: unknown;
  try {
    await sessionStore.requestCancel(control.id);
  } catch (error) {
    checkpointFailed = true;
    checkpointError = error;
  }
  if (control.pickerTabId !== undefined) {
    await chrome.scripting.executeScript({
      target: { tabId: control.pickerTabId },
      func: () => (window as unknown as WindowWithCaptureKit).__captureKitCancelPick?.(),
    }).catch(() => undefined);
  }
  announceSession(control.id);
  if (checkpointFailed) throw checkpointError;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: CaptureResponse) => void) => {
  if (!message || typeof message !== 'object' || !('action' in message)) return false;
  const request = message as Record<string, unknown>;
  const action = request.action;
  const fail = (error: unknown) => {
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  };

  if (action === 'capture-run' || action === 'pick-run') {
    createAndLaunchSession(request, action === 'pick-run').then(
      (session) => sendResponse({ success: true, accepted: true, session }),
      fail
    );
    return true;
  }

  if (action === 'list-sessions') {
    sessionStore.list().then(
      (sessions) => sendResponse({ success: true, sessions }),
      fail
    );
    return true;
  }

  if (action === 'resume-session' && typeof request.sessionId === 'string') {
    sessionStore.resume(request.sessionId).then(
      (session) => {
        launchSession(session);
        sendResponse({ success: true, accepted: true, session });
      },
      fail
    );
    return true;
  }

  if (action === 'discard-session' && typeof request.sessionId === 'string') {
    sessionStore.discard(request.sessionId).then(
      () => sendResponse({ success: true }),
      fail
    );
    return true;
  }

  if (action === 'discover-site') {
    const getTab = typeof request.tabId === 'number' && request.tabId > 0
      ? Promise.resolve(request.tabId)
      : getActiveTabId();
    const origin = typeof request.origin === 'string' ? request.origin : '';
    const pageUrl = typeof request.url === 'string' ? request.url : '';
    getTab.then((tabId) => discoverSiteUrls(tabId, origin, pageUrl)).then(
      (urls) => sendResponse({ success: true, urls, count: urls.length }),
      fail
    );
    return true;
  }

  if (action === 'cancel-run') {
    cancelActiveRun().then(
      () => sendResponse({ success: true }),
      fail
    );
    return true;
  }

  if (action === 'fetch-asset' && typeof request.url === 'string') {
    fetch(request.url, { signal: AbortSignal.timeout(6000) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size > 8 * 1024 * 1024) throw new Error('Asset over 8 MB cap');
        const buffer = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        sendResponse({ success: true, mimeType: blob.type || 'image/png', base64: btoa(binary) });
      })
      .catch(fail);
    return true;
  }
  return false;
});
