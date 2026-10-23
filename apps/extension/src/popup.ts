import type { Capture } from '@capture-kit/model';
import { copyToFigmaClipboard } from '@capture-kit/destination-figma';
import { modelToSketch } from '@capture-kit/destination-sketch';
import { modelToSvg } from '@capture-kit/destination-svg';
import { modelToHtml } from '@capture-kit/destination-html';
import { groupPages, pagePath } from './pages';

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
let browserWidth = 0;
let siteOrigin = '';
const selected = new Set<string>();
const collapsed = new Set<string>();

// Mirrors MAX_SITE_PAGES in background.ts — the popup must stay open per run.
const MAX_SITE_PAGES = 50;

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
const picker = $('#picker') as HTMLElement | null;
const pageGroups = $('#page-groups') as HTMLElement | null;
const pageSearch = $('#page-search') as HTMLInputElement | null;
const pickerFoot = $('#picker-foot') as HTMLElement | null;
const tools = $('#tools') as HTMLElement | null;

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

// ---- page picker ----

const CHEVRON =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="m2.5 3.75 2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function visibleUrls(urls: string[]): string[] {
  const q = pageSearch?.value.trim().toLowerCase() ?? '';
  return q ? urls.filter((u) => pagePath(u).toLowerCase().includes(q)) : urls;
}

function pickedUrls(): string[] {
  return siteUrls.filter((u) => selected.has(u));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPicker(): void {
  if (!picker || !pageGroups) return;
  picker.hidden = getScope() !== 'site' || siteUrls.length === 0;
  if (picker.hidden) return;

  pageGroups.replaceChildren();
  const groups = groupPages(siteUrls)
    .map((g) => ({ ...g, urls: visibleUrls(g.urls) }))
    .filter((g) => g.urls.length > 0);

  if (groups.length === 0) {
    pageGroups.append(el('p', 'empty', 'No pages match'));
  }

  for (const group of groups) {
    const section = el('section', 'grp');
    section.dataset.key = group.key;

    const head = el('div', 'grp-head');
    const pick = el('label', 'grp-pick');
    const box = el('input', 'cb');
    box.type = 'checkbox';
    box.dataset.group = group.key;
    pick.append(box, el('span', 'grp-name', group.label));
    const count = el('span', 'grp-count');
    const toggle = el('button', 'grp-toggle');
    toggle.type = 'button';
    toggle.innerHTML = CHEVRON;
    toggle.setAttribute('aria-label', `Toggle ${group.label}`);
    head.append(pick, count, toggle);

    const list = el('ul', 'grp-list');
    for (const url of group.urls) {
      const li = el('li');
      const row = el('label', 'pg');
      row.title = url;
      const cb = el('input', 'cb');
      cb.type = 'checkbox';
      cb.dataset.url = url;
      const path = pagePath(url);
      const cut = path.lastIndexOf('/', path.length - 2) + 1;
      const label = el('span', 'pg-path');
      label.append(el('span', 'dim', path.slice(0, cut)), path.slice(cut));
      row.append(cb, label);
      li.append(row);
      list.append(li);
    }
    section.append(head, list);
    pageGroups.append(section);
  }
  syncPicker();
}

// Update checkbox/count state in place so keyboard focus survives.
function syncPicker(): void {
  if (!pageGroups) return;
  for (const section of pageGroups.querySelectorAll<HTMLElement>('.grp')) {
    const boxes = [...section.querySelectorAll<HTMLInputElement>('.cb[data-url]')];
    const on = boxes.filter((b) => {
      b.checked = selected.has(b.dataset.url ?? '');
      return b.checked;
    }).length;
    const groupBox = section.querySelector<HTMLInputElement>('.cb[data-group]');
    if (groupBox) {
      groupBox.checked = on > 0 && on === boxes.length;
      groupBox.indeterminate = on > 0 && on < boxes.length;
    }
    const count = section.querySelector('.grp-count');
    if (count) count.textContent = `${on}/${boxes.length}`;
    const open = !collapsed.has(section.dataset.key ?? '');
    section.querySelector('.grp-toggle')?.setAttribute('aria-expanded', String(open));
    const list = section.querySelector<HTMLElement>('.grp-list');
    if (list) list.hidden = !open;
  }

  const n = pickedUrls().length;
  if (pickerFoot) {
    const over = n > MAX_SITE_PAGES;
    pickerFoot.classList.toggle('over', over);
    pickerFoot.replaceChildren(
      el('span', '', `${n} of ${siteUrls.length} selected`),
      el('span', '', over ? `Max ${MAX_SITE_PAGES} per run` : 'At current width')
    );
  }
  updateCaptureUI();
}

function setSelected(urls: string[], on: boolean): void {
  for (const url of urls) {
    if (on) selected.add(url);
    else selected.delete(url);
  }
  syncPicker();
  saveSelection();
}

function saveSelection(): void {
  if (!chrome.storage?.local || !siteOrigin) return;
  chrome.storage.local.set({ [`pages:${siteOrigin}`]: pickedUrls() });
}

async function restoreSelection(): Promise<void> {
  selected.clear();
  const key = `pages:${siteOrigin}`;
  const data = chrome.storage?.local && siteOrigin ? await chrome.storage.local.get([key]) : {};
  const saved = Array.isArray(data[key]) ? (data[key] as unknown[]) : null;
  if (saved) {
    for (const url of saved) if (typeof url === 'string' && siteUrls.includes(url)) selected.add(url);
    if (selected.size > 0) return;
  }
  // Default: everything when it fits in one run, else just the main pages.
  const pick = siteUrls.length <= MAX_SITE_PAGES ? siteUrls : groupPages(siteUrls)[0]?.urls ?? [];
  for (const url of pick.slice(0, MAX_SITE_PAGES)) selected.add(url);
}

function updateCaptureUI(): void {
  if (!captureSub || !captureTitle) return;
  const site = getScope() === 'site';

  if (vpPanel) vpPanel.hidden = site;
  if (tools) tools.hidden = site;
  if (scopeNote && !site) scopeNote.hidden = true;
  if (picker && !site) picker.hidden = true;

  if (site) {
    const n = pickedUrls().length;
    captureTitle.textContent = n === 1 ? 'Capture 1 page' : `Capture ${n} pages`;
    if (siteUrls.length === 0) {
      captureTitle.textContent = 'Capture site';
      captureSub.textContent = discoverySeq > 0 ? 'No pages to capture' : 'Finding pages…';
    } else if (n === 0) {
      captureSub.textContent = 'Select at least one page';
    } else if (n > MAX_SITE_PAGES) {
      captureSub.textContent = `Deselect ${n - MAX_SITE_PAGES} — max ${MAX_SITE_PAGES} per run`;
    } else {
      captureSub.textContent = 'Opens each in a background tab · keep this open';
    }
    if (captureBtn) captureBtn.disabled = n === 0 || n > MAX_SITE_PAGES;
    return;
  }
  captureTitle.textContent = 'Capture page';

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
      siteOrigin = new URL(tab.url).origin;
      tabHost.textContent = new URL(tab.url).hostname || 'current tab';
      tabHost.title = tab.url;
    } catch {
      /* keep default */
    }
  }
  if (tabSize && typeof tab.width === 'number') {
    tabSize.textContent = `${tab.width} px viewport`;
    browserWidth = tab.width;
    if (vpBrowserW) vpBrowserW.textContent = String(tab.width);
  }
  updateCaptureUI();
}

// ---- site discovery ----

async function discoverSite(): Promise<void> {
  const seq = ++discoverySeq;
  siteUrls = [];
  renderPicker();
  if (scopeNote) {
    scopeNote.hidden = false;
    scopeNote.textContent = 'Finding pages via sitemap.xml, then internal links…';
  }
  updateCaptureUI();
  try {
    const response = (await chrome.runtime.sendMessage({
      action: 'discover-site',
    })) as CaptureMessageResponse | undefined;
    if (seq !== discoverySeq) return;
    siteUrls = response?.success ? response.urls ?? [] : [];
    await restoreSelection();
    if (seq !== discoverySeq) return;
    if (scopeNote) {
      scopeNote.hidden = siteUrls.length > 0;
      scopeNote.textContent = response?.success
        ? 'No pages found — no sitemap and no internal links.'
        : response?.error ?? 'Could not scan this site.';
    }
  } catch {
    if (seq !== discoverySeq) return;
    siteUrls = [];
    if (scopeNote) scopeNote.textContent = 'Could not scan this site.';
  }
  if (pageCount) {
    pageCount.hidden = siteUrls.length === 0;
    pageCount.textContent = String(siteUrls.length);
  }
  renderPicker();
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
        urls: pickedUrls(),
      })) as CaptureMessageResponse | undefined;
      await handleResponse(response, 'site');
    } else if (widths.length > 0) {
      setStatus(
        `Capturing ${widths.length + (vpBrowser?.checked ? 1 : 0)} viewports — window will resize…`,
        'busy'
      );
      // "Browser" means the tab's current width; capture it alongside the presets.
      const all = vpBrowser?.checked && browserWidth > 0 ? [browserWidth, ...widths] : widths;
      const response = (await chrome.runtime.sendMessage({
        action: 'capture-breakpoints',
        scrollStitch,
        widths: [...new Set(all)],
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
    else renderPicker();
  })
);

pageGroups?.addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement;
  if (box.dataset.url) setSelected([box.dataset.url], box.checked);
  if (box.dataset.group !== undefined) {
    const section = box.closest('.grp');
    const urls = [...(section?.querySelectorAll<HTMLInputElement>('.cb[data-url]') ?? [])].map(
      (b) => b.dataset.url ?? ''
    );
    setSelected(urls, box.checked);
  }
});
pageGroups?.addEventListener('click', (event) => {
  const toggle = (event.target as HTMLElement).closest('.grp-toggle');
  const key = toggle?.closest<HTMLElement>('.grp')?.dataset.key;
  if (key === undefined) return;
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  syncPicker();
});
pageSearch?.addEventListener('input', renderPicker);
$('#sel-all')?.addEventListener('click', () => setSelected(visibleUrls(siteUrls), true));
$('#sel-none')?.addEventListener('click', () => setSelected(visibleUrls(siteUrls), false));
optScrollStitch?.addEventListener('change', saveSettings);

// Settings decide the scope and the tab gives the origin; both before discovery.
void Promise.all([loadSettings(), loadTabInfo()]).then(() => {
  if (getScope() === 'site') void discoverSite();
});
