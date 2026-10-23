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
  skipped?: string[];
  error?: string;
}

interface ProgressMessage {
  type: 'progress';
  done: number;
  total: number;
  url: string;
}

// Mirror the caps in background.ts — the popup has to stay open for the run.
const MAX_PAGES = 50;
const MAX_SIZES = 6;
// Sections bigger than this start collapsed unless they hold the current page.
const OPEN_GROUP_LIMIT = 6;

let siteUrls: string[] = [];
let siteOrigin = '';
let currentUrl = '';
let currentTabId = 0;
let browserWidth = 0;
let discovered = false;
let latestCaptures: Capture[] = [];
const selected = new Set<string>();
const collapsed = new Set<string>();

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const captureBtn = $<HTMLButtonElement>('#capture-btn');
const captureTitle = $('#capture-title');
const captureSub = $('#capture-sub');
const pickBtn = $<HTMLButtonElement>('#pick-btn');
const figmaBtn = $<HTMLButtonElement>('#figma-btn');
const statusEl = $('#status');
const statusText = $('#status-text');
const siteLine = $('#site-line');
const currentW = $('#current-w');
const sizesTally = $('#sizes-tally');
const optScrollStitch = $<HTMLInputElement>('#opt-scroll-stitch');
const pageGroups = $('#page-groups');
const pageSearch = $<HTMLInputElement>('#page-search');
const sizeButtons = [...document.querySelectorAll<HTMLButtonElement>('.size')];
const formatRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="format"]')];

function getFormat(): string {
  return formatRadios.find((r) => r.checked)?.value ?? 'figma';
}

function setStatus(text: string, kind: 'idle' | 'busy' | 'ok' | 'error' = 'idle'): void {
  statusEl?.classList.remove('busy', 'ok', 'error');
  if (kind !== 'idle') statusEl?.classList.add(kind);
  if (statusText) {
    statusText.textContent = text;
    statusText.title = text;
  }
}

function samePage(a: string, b: string): boolean {
  const strip = (u: string): string => u.replace(/#.*$/, '').replace(/\/+$/, '');
  return strip(a) === strip(b);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---- sizes ----

function pickedSizes(): string[] {
  return sizeButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.size ?? '');
}

function pickedWidths(): number[] {
  const widths = pickedSizes().map((id) => (id === 'current' ? browserWidth : Number(id)));
  return [...new Set(widths.filter((w) => w > 0))];
}

// ---- pages ----

const CHEVRON =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="m2.5 3.75 2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function visibleUrls(urls: string[]): string[] {
  const q = pageSearch?.value.trim().toLowerCase() ?? '';
  return q ? urls.filter((u) => pagePath(u).toLowerCase().includes(q)) : urls;
}

function pickedUrls(): string[] {
  return siteUrls.filter((u) => selected.has(u));
}

function note(text: string, spinning = false): HTMLElement {
  const p = el('p', 'note');
  if (spinning) p.append(el('span', 'spin'));
  p.append(text);
  return p;
}

function renderPages(): void {
  if (!pageGroups) return;
  pageGroups.replaceChildren();
  if (!discovered && siteUrls.length === 0) {
    pageGroups.append(note('Finding pages on this site…', true));
    return;
  }

  const groups = groupPages(siteUrls)
    .map((g) => ({ ...g, urls: visibleUrls(g.urls) }))
    .filter((g) => g.urls.length > 0);
  if (groups.length === 0) {
    pageGroups.append(note(siteUrls.length ? 'No pages match that filter' : 'No pages found on this site'));
  }

  for (const group of groups) {
    const section = el('div', 'grp');
    section.dataset.key = group.key;

    const head = el('div', 'grp-head');
    const toggle = el('button', 'grp-toggle');
    toggle.type = 'button';
    toggle.innerHTML = CHEVRON;
    toggle.setAttribute('aria-label', `Show or hide ${group.label}`);
    const pick = el('label', 'grp-pick');
    const box = el('input', 'cb');
    box.type = 'checkbox';
    box.dataset.group = group.key;
    pick.append(box, el('span', 'grp-name', group.label));
    head.append(toggle, pick, el('span', 'grp-count'));

    const list = el('ul', 'grp-list');
    for (const url of group.urls) {
      const row = el('label', 'pg');
      row.title = url;
      const cb = el('input', 'cb');
      cb.type = 'checkbox';
      cb.dataset.url = url;
      const path = pagePath(url);
      const cut = path === '/' ? 0 : path.lastIndexOf('/', path.length - 2) + 1;
      const label = el('span', 'pg-path');
      label.append(el('span', 'dim', path.slice(0, cut)), path.slice(cut));
      row.append(cb, label);
      if (samePage(url, currentUrl)) row.append(el('span', 'here', 'This page'));
      const li = el('li');
      li.append(row);
      list.append(li);
    }
    section.append(head, list);
    pageGroups.append(section);
  }
  syncUI();
}

// Update checkbox/count state in place so keyboard focus survives.
function syncUI(): void {
  for (const section of pageGroups?.querySelectorAll<HTMLElement>('.grp') ?? []) {
    const boxes = [...section.querySelectorAll<HTMLInputElement>('.cb[data-url]')];
    const on = boxes.filter((b) => (b.checked = selected.has(b.dataset.url ?? ''))).length;
    const groupBox = section.querySelector<HTMLInputElement>('.cb[data-group]');
    if (groupBox) {
      groupBox.checked = on > 0 && on === boxes.length;
      groupBox.indeterminate = on > 0 && on < boxes.length;
    }
    const count = section.querySelector('.grp-count');
    if (count) count.textContent = on ? `${on}/${boxes.length}` : String(boxes.length);
    // A filter always shows matches, even inside collapsed sections.
    const open = Boolean(pageSearch?.value.trim()) || !collapsed.has(section.dataset.key ?? '');
    section.querySelector('.grp-toggle')?.setAttribute('aria-expanded', String(open));
    const list = section.querySelector<HTMLElement>('.grp-list');
    if (list) list.hidden = !open;
  }

  for (const b of sizeButtons) {
    if (b.dataset.size === 'current' && currentW) currentW.textContent = browserWidth ? String(browserWidth) : '—';
  }
  const widths = pickedWidths();
  if (sizesTally) sizesTally.textContent = widths.length ? `${widths.join(', ')} px` : 'None selected';

  updateCaptureButton();
}

function updateCaptureButton(): void {
  if (!captureBtn || !captureTitle || !captureSub) return;
  const pages = pickedUrls().length;
  const sizes = pickedWidths().length;
  const frames = pages * sizes;

  captureTitle.textContent =
    sizes > 1 ? `Capture ${plural(pages, 'page')} × ${sizes} sizes` : `Capture ${plural(pages, 'page')}`;
  let sub = '';
  if (!discovered && siteUrls.length === 0) sub = 'Finding pages…';
  else if (pages === 0) sub = 'Tick at least one page';
  else if (sizes === 0) sub = 'Pick at least one size';
  else if (pages > MAX_PAGES) sub = `Untick ${pages - MAX_PAGES} — up to ${MAX_PAGES} pages per run`;
  else if (sizes > MAX_SIZES) sub = `Up to ${MAX_SIZES} sizes per run`;
  else if (getFormat() === 'figma') sub = `${plural(frames, 'frame')}, copied for Figma`;
  else sub = `${plural(frames, 'file')} downloaded as ${getFormat().toUpperCase()}`;

  captureSub.textContent = sub;
  captureBtn.disabled = frames === 0 || pages > MAX_PAGES || sizes > MAX_SIZES;
}

function setSelected(urls: string[], on: boolean): void {
  for (const url of urls) {
    if (on) selected.add(url);
    else selected.delete(url);
  }
  syncUI();
  saveSelection();
}

// ---- persistence ----

function saveSelection(): void {
  if (!chrome.storage?.local || !siteOrigin) return;
  chrome.storage.local.set({ [`pages:${siteOrigin}`]: pickedUrls() });
}

function saveSettings(): void {
  if (!chrome.storage?.local) return;
  chrome.storage.local.set({
    scrollStitch: optScrollStitch?.checked ?? false,
    format: getFormat(),
    sizes: pickedSizes(),
  });
}

async function loadSettings(): Promise<void> {
  if (!chrome.storage?.local) return;
  const data = await chrome.storage.local.get(['scrollStitch', 'format', 'sizes']);
  if (typeof data.scrollStitch === 'boolean' && optScrollStitch) optScrollStitch.checked = data.scrollStitch;
  const radio = formatRadios.find((r) => r.value === data.format);
  if (radio) radio.checked = true;
  if (Array.isArray(data.sizes) && data.sizes.length > 0) {
    for (const b of sizeButtons) b.setAttribute('aria-pressed', String(data.sizes.includes(b.dataset.size)));
  }
}

async function queryActiveTab(): Promise<{ id?: number; url?: string; width?: number } | undefined> {
  if (!chrome.tabs?.query) return undefined;
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current?.id && current?.url && /^https?:/.test(current.url)) {
    return current;
  }
  const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (lastFocused?.id && lastFocused?.url && /^https?:/.test(lastFocused.url)) {
    return lastFocused;
  }
  const all = await chrome.tabs.query({ active: true });
  return all.find((t) => t.id && t.url && /^https?:/.test(t.url)) || current || lastFocused;
}

async function loadTabInfo(): Promise<void> {
  const tab = await queryActiveTab();
  if (!tab?.url) {
    if (siteLine) siteLine.textContent = 'Open a website to capture it';
    return;
  }
  try {
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('not a web page');
    currentTabId = tab.id ?? 0;
    siteOrigin = u.origin;
    currentUrl = u.origin + u.pathname + u.search;
    if (siteLine) siteLine.textContent = u.hostname;
  } catch {
    if (siteLine) siteLine.textContent = 'Open a website to capture it';
  }
  if (typeof tab.width === 'number') browserWidth = tab.width;
}

// Current page always appears, even if the sitemap leaves it out.
function withCurrent(urls: string[]): string[] {
  if (!currentUrl || urls.some((u) => samePage(u, currentUrl))) return urls;
  return [currentUrl, ...urls];
}

async function restoreSelection(): Promise<void> {
  selected.clear();
  const key = `pages:${siteOrigin}`;
  const data = chrome.storage?.local ? await chrome.storage.local.get([key]) : {};
  const saved = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
  for (const url of saved) if (typeof url === 'string' && siteUrls.includes(url)) selected.add(url);
  if (selected.size === 0) {
    const here = siteUrls.find((u) => samePage(u, currentUrl));
    if (here) selected.add(here);
  }
}

function collapseBigGroups(): void {
  collapsed.clear();
  for (const g of groupPages(siteUrls)) {
    const hasCurrent = g.urls.some((u) => samePage(u, currentUrl));
    if (g.key && g.urls.length > OPEN_GROUP_LIMIT && !hasCurrent) collapsed.add(g.key);
  }
}

// ---- discovery: cached list first, then a fresh scan ----

async function discoverSite(): Promise<void> {
  if (!siteOrigin) {
    discovered = true;
    renderPages();
    return;
  }
  const cacheKey = `site:${siteOrigin}`;
  const cached = chrome.storage?.local ? await chrome.storage.local.get([cacheKey]) : {};
  if (Array.isArray(cached[cacheKey]) && cached[cacheKey].length > 0) {
    siteUrls = withCurrent(cached[cacheKey] as string[]);
    await restoreSelection();
    collapseBigGroups();
    renderPages();
  }

  try {
    const response = (await chrome.runtime.sendMessage({
      action: 'discover-site',
      tabId: currentTabId,
      origin: siteOrigin,
      url: currentUrl,
    })) as CaptureMessageResponse | undefined;
    if (response?.success) {
      const fresh = response.urls ?? [];
      chrome.storage?.local?.set({ [cacheKey]: fresh });
      const hadList = siteUrls.length > 0;
      siteUrls = withCurrent(fresh);
      if (!hadList) {
        await restoreSelection();
        collapseBigGroups();
      }
    } else if (siteUrls.length === 0) {
      setStatus(response?.error ?? 'Could not scan this site', 'error');
    }
  } catch (err: unknown) {
    if (siteUrls.length === 0) setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
  if (siteUrls.length === 0) siteUrls = withCurrent([]);
  if (selected.size === 0 && siteUrls.length > 0) await restoreSelection();
  discovered = true;
  for (const url of [...selected]) if (!siteUrls.includes(url)) selected.delete(url);
  if (siteLine && siteOrigin) {
    siteLine.textContent = `${plural(siteUrls.length, 'page')} on ${new URL(siteOrigin).hostname}`;
  }
  renderPages();
  pageGroups?.querySelector('.here')?.scrollIntoView({ block: 'center' });
}

// ---- export ----

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

function fileName(capture: Capture, withWidth: boolean): string {
  try {
    const u = new URL(capture.url);
    const slug = u.pathname.split('/').filter(Boolean).join('-').replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
    const host = u.hostname.replace(/[^a-z0-9.-]/gi, '-');
    return `${host}-${slug || 'home'}${withWidth ? `-${capture.frame.width}` : ''}`;
  } catch {
    return `capture${withWidth ? `-${capture.frame.width}` : ''}`;
  }
}

async function exportCaptures(captures: Capture[]): Promise<string> {
  const format = getFormat();
  if (format === 'figma') {
    await copyToFigmaClipboard(captures);
    return `Copied ${plural(captures.length, 'frame')} — paste into Figma with ⌘V`;
  }
  const withWidth = new Set(captures.map((c) => c.frame.width)).size > 1;
  for (const capture of captures) {
    const name = fileName(capture, withWidth);
    if (format === 'sketch') triggerDownload(await modelToSketch(capture), `${name}.sketch`);
    else if (format === 'svg') triggerDownload(new Blob([modelToSvg(capture)], { type: 'image/svg+xml' }), `${name}.svg`);
    else if (format === 'html') triggerDownload(new Blob([modelToHtml(capture)], { type: 'text/html' }), `${name}.html`);
    else triggerDownload(new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }), `${name}.json`);
  }
  return `Downloaded ${plural(captures.length, format.toUpperCase() + ' file')}`;
}

async function finish(response: CaptureMessageResponse | undefined): Promise<void> {
  const captures = response?.captures ?? (response?.capture ? [response.capture] : []);
  if (!response?.success || captures.length === 0) {
    setStatus(response?.error ?? 'Nothing was captured', 'error');
    return;
  }
  latestCaptures = captures;
  const done = await exportCaptures(captures);
  const skipped = response.skipped?.length ?? 0;
  setStatus(skipped ? `${done} · ${skipped} skipped` : done, 'ok');
  if (statusText && skipped) statusText.title = response.skipped?.join('\n') ?? '';
  if (figmaBtn) figmaBtn.hidden = getFormat() !== 'figma';
}

// ---- actions ----

chrome.runtime?.onMessage?.addListener((message: unknown) => {
  const p = message as ProgressMessage;
  if (p?.type === 'progress' && p.url) {
    setStatus(`Capturing ${p.done + 1} of ${p.total} — ${pagePath(p.url)}`, 'busy');
  }
});

captureBtn?.addEventListener('click', async () => {
  if (!captureBtn) return;
  captureBtn.disabled = true;
  if (figmaBtn) figmaBtn.hidden = true;
  const urls = pickedUrls();
  const widths = pickedWidths();
  setStatus(
    urls.length * widths.length > 1 ? 'Opening a capture window — keep this popup open' : 'Capturing…',
    'busy'
  );
  try {
    const response = (await chrome.runtime.sendMessage({
      action: 'capture-run',
      urls,
      widths,
      scrollStitch: optScrollStitch?.checked ?? false,
    })) as CaptureMessageResponse | undefined;
    await finish(response);
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    updateCaptureButton();
  }
});

pickBtn?.addEventListener('click', async () => {
  if (!pickBtn) return;
  pickBtn.disabled = true;
  setStatus('Click an element on the page — Esc cancels', 'busy');
  try {
    await finish((await chrome.runtime.sendMessage({ action: 'pick' })) as CaptureMessageResponse | undefined);
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    pickBtn.disabled = false;
  }
});

figmaBtn?.addEventListener('click', async () => {
  if (latestCaptures.length === 0) return;
  try {
    await copyToFigmaClipboard(latestCaptures);
    setStatus(`Copied ${plural(latestCaptures.length, 'frame')} again`, 'ok');
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
});

// ---- wiring ----

pageGroups?.addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement;
  if (box.dataset.url) setSelected([box.dataset.url], box.checked);
  if (box.dataset.group !== undefined) {
    const boxes = box.closest('.grp')?.querySelectorAll<HTMLInputElement>('.cb[data-url]') ?? [];
    setSelected([...boxes].map((b) => b.dataset.url ?? ''), box.checked);
  }
});
pageGroups?.addEventListener('click', (event) => {
  const key = (event.target as HTMLElement).closest('.grp-toggle')?.closest<HTMLElement>('.grp')?.dataset.key;
  if (key === undefined) return;
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  syncUI();
});
pageSearch?.addEventListener('input', renderPages);
$('#sel-all')?.addEventListener('click', () => setSelected(visibleUrls(siteUrls), true));
$('#sel-none')?.addEventListener('click', () => setSelected(visibleUrls(siteUrls), false));

for (const b of sizeButtons) {
  b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    syncUI();
    saveSettings();
  });
}
formatRadios.forEach((r) =>
  r.addEventListener('change', () => {
    saveSettings();
    updateCaptureButton();
  })
);
optScrollStitch?.addEventListener('change', saveSettings);

void Promise.all([loadSettings(), loadTabInfo()]).then(() => {
  syncUI();
  return discoverSite();
});
