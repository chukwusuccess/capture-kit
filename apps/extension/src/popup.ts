import type { Capture } from '@capture-kit/model';
import { copyToFigmaClipboard } from '@capture-kit/destination-figma';
import { modelToSketch } from '@capture-kit/destination-sketch';
import { modelToSvg } from '@capture-kit/destination-svg';
import { modelToHtml } from '@capture-kit/destination-html';

interface CaptureMessageResponse {
  success: boolean;
  capture?: Capture;
  captures?: Capture[];
  urls?: string[];
  count?: number;
  error?: string;
}

interface ProgressMessage {
  type: 'progress';
  done: number;
  total: number;
  url: string;
}

let latestCapture: Capture | null = null;
let siteUrls: string[] = [];
let discoverySeq = 0;

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const captureBtn = $('#capture-btn') as HTMLButtonElement | null;
const captureTitle = $('#capture-title') as HTMLSpanElement | null;
const captureSub = $('#capture-sub') as HTMLSpanElement | null;
const pickBtn = $('#pick-btn') as HTMLButtonElement | null;
const figmaBtn = $('#figma-btn') as HTMLButtonElement | null;
const statusEl = $('#status') as HTMLElement | null;
const statusText = $('#status-text') as HTMLSpanElement | null;
const tabHost = $('#tab-host') as HTMLSpanElement | null;
const tabSize = $('#tab-size') as HTMLSpanElement | null;
const vpBrowser = $('#vp-browser') as HTMLInputElement | null;
const vpBrowserW = $('#vp-browser-w') as HTMLSpanElement | null;
const vpPanel = $('#viewports-panel') as HTMLElement | null;
const optScrollStitch = $('#opt-scroll-stitch') as HTMLInputElement | null;
const pageCount = $('#page-count') as HTMLSpanElement | null;
const scopeNote = $('#scope-note') as HTMLElement | null;
const pageList = $('#page-list') as HTMLUListElement | null;

const vpRows = Array.from(document.querySelectorAll('.vp-row').values()).slice(
  1
) as HTMLElement[];
const vpChecks = vpRows.map((row) => row.querySelector('.vp-check') as HTMLInputElement);
const vpWidths = vpRows.map((row) => row.querySelector('.vp-w') as HTMLInputElement);
const formatRadios = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="format"]')
);
const scopeRadios = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="scope"]')
);

function getFormat(): string {
  return formatRadios.find((r) => r.checked)?.value ?? 'figma';
}

function getScope(): 'page' | 'site' {
  return scopeRadios.find((r) => r.checked)?.value === 'site' ? 'site' : 'page';
}

function selectedWidths(): number[] {
  return vpChecks
    .map((check, i) => (check.checked ? Number(vpWidths[i].value) : 0))
    .filter((w) => Number.isFinite(w) && w > 0);
}

function setStatus(text: string, kind: 'idle' | 'busy' | 'ok' | 'error' = 'idle'): void {
  statusEl?.classList.remove('busy', 'ok', 'error');
  if (kind !== 'idle') statusEl?.classList.add(kind);
  if (statusText) statusText.textContent = text;
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '/' : u.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function renderPageList(): void {
  if (!pageList) return;
  const site = getScope() === 'site';
  pageList.hidden = !site || siteUrls.length === 0;
  if (pageList.hidden) return;

  const shown = siteUrls.slice(0, 6);
  const rest = siteUrls.length - shown.length;
  pageList.innerHTML = '';
  for (const url of shown) {
    const li = document.createElement('li');
    li.innerHTML =
      '<svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true"><path d="M1 1.5A.5.5 0 0 1 1.5 1h4L9 4.5v6a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9Z" stroke="currentColor" stroke-width="1"/><path d="M5.5 1v3.5H9" stroke="currentColor" stroke-width="1"/></svg>';
    const span = document.createElement('span');
    span.textContent = pagePath(url);
    span.title = url;
    li.appendChild(span);
    pageList.appendChild(li);
  }
  if (rest > 0) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = `+ ${rest} more page${rest === 1 ? '' : 's'}`;
    pageList.appendChild(li);
  }
}

function updateCaptureUI(): void {
  if (!captureSub || !captureTitle) return;
  const site = getScope() === 'site';

  vpPanel?.classList.toggle('off', site);
  captureTitle.textContent = site ? 'Capture site' : 'Capture page';
  renderPageList();

  if (site) {
    if (siteUrls.length > 0) {
      captureSub.textContent = `${siteUrls.length} pages via sitemap / links`;
      if (captureBtn) captureBtn.disabled = false;
    } else {
      captureSub.textContent = 'Finding pages…';
      if (captureBtn) captureBtn.disabled = true;
    }
    return;
  }

  const widths = selectedWidths();
  const browserOn = vpBrowser?.checked ?? false;
  if (!browserOn && widths.length === 0) {
    captureSub.textContent = 'Select at least one viewport';
    if (captureBtn) captureBtn.disabled = true;
    return;
  }
  if (captureBtn) captureBtn.disabled = false;

  if (browserOn && widths.length === 0) {
    captureSub.textContent = 'Full page at current viewport';
  } else {
    const all =
      browserOn && vpBrowserW?.textContent && vpBrowserW.textContent !== '—'
        ? [vpBrowserW.textContent, ...widths.map(String)]
        : widths.map(String);
    captureSub.textContent = `${all.length} viewports · ${all.join(', ')} px`;
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fileLabel(capture: Capture, suffix: string): string {
  let host = '';
  try {
    host = new URL(capture.url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  } catch {
    host = 'page';
  }
  return `${host}${suffix}`;
}

function pageSuffix(capture: Capture): string {
  try {
    const path = new URL(capture.url).pathname.replace(/\/+$/, '');
    const slug = path.split('/').filter(Boolean).join('-') || 'home';
    return `-${slug.replace(/[^a-z0-9-]/gi, '-').slice(0, 40)}`;
  } catch {
    return '';
  }
}

// ---- settings persistence ----

function saveSettings(): void {
  if (!chrome.storage?.local) return;
  chrome.storage.local.set({
    scrollStitch: optScrollStitch?.checked ?? false,
    format: getFormat(),
    scope: getScope(),
    vpBrowser: vpBrowser?.checked ?? false,
    vpWidths: vpWidths.map((w) => Number(w.value)),
  });
}

async function loadSettings(): Promise<void> {
  if (!chrome.storage?.local) return;
  const data = await chrome.storage.local.get([
    'scrollStitch',
    'format',
    'scope',
    'vpBrowser',
    'vpWidths',
  ]);
  if (typeof data.scrollStitch === 'boolean' && optScrollStitch) {
    optScrollStitch.checked = data.scrollStitch;
  }
  if (typeof data.format === 'string') {
    const radio = formatRadios.find((r) => r.value === data.format);
    if (radio) radio.checked = true;
  }
  if (data.scope === 'site') {
    const radio = scopeRadios.find((r) => r.value === 'site');
    if (radio) radio.checked = true;
  }
  if (typeof data.vpBrowser === 'boolean' && vpBrowser) {
    vpBrowser.checked = data.vpBrowser;
  }
  if (Array.isArray(data.vpWidths)) {
    const stored = data.vpWidths as unknown[];
    vpWidths.forEach((input, i) => {
      const value = stored[i];
      if (typeof value === 'number' && value > 0) input.value = String(value);
    });
  }
  updateCaptureUI();
}

// ---- active tab info ----

async function loadTabInfo(): Promise<void> {
  if (!chrome.tabs?.query) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (tabHost && tab.url) {
    try {
      tabHost.textContent = new URL(tab.url).hostname || 'current tab';
      tabHost.title = tab.url;
    } catch {
      /* keep default */
    }
  }
  if (tabSize && typeof tab.width === 'number') {
    tabSize.textContent = `${tab.width} px viewport`;
    if (vpBrowserW) vpBrowserW.textContent = String(tab.width);
  }
  updateCaptureUI();
}

// ---- site discovery ----

async function discoverSite(): Promise<void> {
  const seq = ++discoverySeq;
  if (scopeNote) {
    scopeNote.hidden = false;
    scopeNote.textContent = 'Finding pages via sitemap.xml, then internal links…';
  }
  try {
    const response = (await chrome.runtime.sendMessage({
      action: 'discover-site',
    })) as CaptureMessageResponse | undefined;
    if (seq !== discoverySeq) return;
    siteUrls = response?.success ? response.urls ?? [] : [];
    if (pageCount) {
      pageCount.hidden = siteUrls.length === 0;
      pageCount.textContent = String(siteUrls.length);
    }
    if (scopeNote) {
      scopeNote.textContent =
        siteUrls.length > 0
          ? `Found ${siteUrls.length} pages (max 20 per capture).`
          : 'No pages found — no sitemap and no internal links.';
    }
  } catch {
    if (seq !== discoverySeq) return;
    siteUrls = [];
    if (pageCount) pageCount.hidden = true;
    if (scopeNote) scopeNote.textContent = 'Could not scan this site.';
  }
  updateCaptureUI();
}

// ---- live progress from background ----

chrome.runtime?.onMessage?.addListener((message: unknown) => {
  const progress = message as ProgressMessage;
  if (progress?.type === 'progress') {
    const page = (() => {
      try {
        const u = new URL(progress.url);
        return u.pathname === '/' ? u.hostname : u.pathname;
      } catch {
        return progress.url;
      }
    })();
    setStatus(`Capturing ${progress.done + 1}/${progress.total} — ${page}`, 'busy');
  }
});

// ---- export ----

async function exportToSelectedFormat(capture: Capture, suffix: string): Promise<void> {
  const format = getFormat();
  const label = fileLabel(capture, suffix);

  if (format === 'figma') {
    await copyToFigmaClipboard(capture);
    setStatus('Copied — press ⌘V in Figma', 'ok');
    return;
  }

  if (format === 'sketch') {
    const blob = await modelToSketch(capture);
    triggerDownload(blob, `${label}.sketch`);
    setStatus(`Downloaded ${label}.sketch`, 'ok');
    return;
  }

  if (format === 'svg') {
    const blob = new Blob([modelToSvg(capture)], { type: 'image/svg+xml' });
    triggerDownload(blob, `${label}.svg`);
    setStatus(`Downloaded ${label}.svg`, 'ok');
    return;
  }

  if (format === 'html') {
    const blob = new Blob([modelToHtml(capture)], { type: 'text/html' });
    triggerDownload(blob, `${label}.html`);
    setStatus(`Downloaded ${label}.html`, 'ok');
    return;
  }

  const blob = new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${label}.json`);
  setStatus(`Downloaded ${label}.json · ${capture.nodes.length} nodes`, 'ok');
}

async function handleCaptures(captures: Capture[], mode: 'page' | 'site' | 'breakpoints'): Promise<void> {
  const last = captures[captures.length - 1];
  latestCapture = last ?? null;
  if (figmaBtn) figmaBtn.disabled = !latestCapture;

  if (captures.length === 0) {
    setStatus('Nothing captured', 'error');
    return;
  }

  // Figma clipboard holds one payload: put every capture in it, side by side.
  if (getFormat() === 'figma' && captures.length > 1) {
    await copyToFigmaClipboard(captures);
    const what = mode === 'site' ? `${captures.length} pages` : `${captures.length} viewports`;
    setStatus(`Copied ${what} — press ⌘V in Figma`, 'ok');
    return;
  }

  for (const capture of captures) {
    const suffix =
      mode === 'site'
        ? pageSuffix(capture)
        : mode === 'breakpoints' && captures.length > 1
          ? `-${capture.frame.width}`
          : '';
    await exportToSelectedFormat(capture, suffix);
  }

  if (captures.length > 1) {
    const what =
      mode === 'breakpoints'
        ? `${captures.map((c) => c.frame.width).join(', ')}px`
        : `${captures.length} pages`;
    setStatus(`Exported ${what}`, 'ok');
  }
}

async function handleResponse(
  response: CaptureMessageResponse | undefined,
  mode: 'page' | 'site' | 'breakpoints'
): Promise<void> {
  if (response && response.success) {
    if (response.captures?.length) {
      await handleCaptures(response.captures, mode);
    } else if (response.capture) {
      await handleCaptures([response.capture], mode);
    } else {
      setStatus('Nothing captured', 'error');
    }
  } else {
    setStatus(response?.error ?? 'Operation failed', 'error');
  }
}

// ---- actions ----

captureBtn?.addEventListener('click', async () => {
  if (!captureBtn) return;
  captureBtn.disabled = true;
  const site = getScope() === 'site';
  const widths = selectedWidths();

  try {
    const scrollStitch = optScrollStitch?.checked ?? false;

    if (site) {
      setStatus('Starting site capture…', 'busy');
      const response = (await chrome.runtime.sendMessage({
        action: 'capture-site',
        scrollStitch,
      })) as CaptureMessageResponse | undefined;
      await handleResponse(response, 'site');
    } else if (widths.length > 0) {
      setStatus(
        `Capturing ${widths.length + (vpBrowser?.checked ? 1 : 0)} viewports — window will resize…`,
        'busy'
      );
      const response = (await chrome.runtime.sendMessage({
        action: 'capture-breakpoints',
        scrollStitch,
        widths,
      })) as CaptureMessageResponse | undefined;
      await handleResponse(response, 'breakpoints');
    } else {
      setStatus('Capturing full page…', 'busy');
      const response = (await chrome.runtime.sendMessage({
        action: 'capture',
        scrollStitch,
      })) as CaptureMessageResponse | undefined;
      await handleResponse(response, 'page');
    }
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    updateCaptureUI();
  }
});

pickBtn?.addEventListener('click', async () => {
  if (!pickBtn) return;
  pickBtn.disabled = true;
  setStatus('Click an element on the page — Esc to cancel', 'busy');

  try {
    const response = (await chrome.runtime.sendMessage({
      action: 'pick',
    })) as CaptureMessageResponse | undefined;
    await handleResponse(response, 'page');
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    pickBtn.disabled = false;
  }
});

figmaBtn?.addEventListener('click', async () => {
  if (!latestCapture) return;
  setStatus('Copying to clipboard…', 'busy');

  try {
    await copyToFigmaClipboard(latestCapture);
    setStatus('Copied — press ⌘V in Figma', 'ok');
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
});

// ---- wiring ----

[...vpChecks, ...vpWidths, ...(vpBrowser ? [vpBrowser] : [])].forEach((el) =>
  el.addEventListener('change', () => {
    updateCaptureUI();
    saveSettings();
  })
);
formatRadios.forEach((r) => r.addEventListener('change', saveSettings));
scopeRadios.forEach((r) =>
  r.addEventListener('change', () => {
    saveSettings();
    updateCaptureUI();
    if (getScope() === 'site' && siteUrls.length === 0) void discoverSite();
  })
);
optScrollStitch?.addEventListener('change', saveSettings);

void loadSettings();
void loadTabInfo();
if (getScope() === 'site') void discoverSite();
