import { CaptureSchema, type Capture } from '@capture-kit/model';
import { copyToFigmaClipboard } from '@capture-kit/destination-figma';
import { modelToSketch } from '@capture-kit/destination-sketch';
import { modelToSvg } from '@capture-kit/destination-svg';
import { modelToHtml } from '@capture-kit/destination-html';
import { modelToMarkdown } from '@capture-kit/destination-markdown';
import { modelToReact } from '@capture-kit/destination-react';
import JSZip from 'jszip';
import { isSessionActive, sessionResultKey, SESSION_INDEX_KEY, type CaptureSession } from './sessions';
import { groupPages, pagePath } from './pages';

interface CaptureMessageResponse {
  success: boolean;
  accepted?: boolean;
  session?: CaptureSession;
  sessions?: CaptureSession[];
  urls?: string[];
  error?: string;
}

interface SessionNotification {
  type: 'session-updated' | 'run-done' | 'run-error';
  sessionId?: string;
  error?: string;
}

// Mirror background caps so the popup selection matches worker validation.
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
let runBusy = false;
let knownSessions: CaptureSession[] = [];
let activeSessionId: string | undefined;
let requestedSessionId: string | undefined;
let progressSessionId: string | undefined;
let diagnosticsVersion = '';
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
const optDesignSystem = $<HTMLInputElement>('#opt-design-system');
const optDualTheme = $<HTMLInputElement>('#opt-dual-theme');
const nativeHelp = $('#native-help');
const progressWrap = $('#progress-wrap');
const progressFill = $('#progress-fill');
const progressPct = $('#progress-pct');
const cancelBtn = $<HTMLButtonElement>('#cancel-btn');
const sessionsList = $('#sessions-list');
const sessionsEmpty = $('#sessions-empty');
const sessionFeedback = $('#session-feedback');
const captureDiagnostics = $<HTMLDetailsElement>('#capture-diagnostics');
const diagnosticsList = $('#diagnostics-list');
const pageGroups = $('#page-groups');
const pageSearch = $<HTMLInputElement>('#page-search');
const selectAllPages = $<HTMLButtonElement>('#sel-all');
const selectNoPages = $<HTMLButtonElement>('#sel-none');
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

const pageKey = (u: string): string => u.replace(/#.*$/, '').replace(/\/+$/, '');

function samePage(a: string, b: string): boolean {
  return pageKey(a) === pageKey(b);
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

function updateFormatHelp(): void {
  if (nativeHelp) nativeHelp.hidden = getFormat() !== 'figma-native';
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
  else if (sizes > MAX_SIZES) sub = `Up to ${MAX_SIZES} sizes per run`;
  else if (getFormat() === 'figma-native') sub = `${plural(frames, 'capture')} downloaded for the Figma plugin`;
  else if (getFormat() === 'figma') sub = `${plural(frames, 'frame')}, copied for Figma`;
  else if (getFormat() === 'react') sub = `${plural(frames, 'component')}, copied as React TSX`;
  else if (getFormat() === 'md') sub = `${plural(frames, 'spec')}, copied as Markdown for AI`;
  else sub = `${plural(frames, 'file')} downloaded as ${getFormat().toUpperCase()}`;

  captureSub.textContent = sub;
  captureBtn.disabled = runBusy || frames === 0 || pages > MAX_PAGES || sizes > MAX_SIZES;
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
    designSystem: optDesignSystem?.checked ?? false,
    dualTheme: optDualTheme?.checked ?? false,
    format: getFormat(),
    sizes: pickedSizes(),
  });
}

async function loadSettings(): Promise<void> {
  if (!chrome.storage?.local) return;
  const data = await chrome.storage.local.get(['scrollStitch', 'designSystem', 'dualTheme', 'format', 'sizes']);
  if (typeof data.scrollStitch === 'boolean' && optScrollStitch) optScrollStitch.checked = data.scrollStitch;
  if (typeof data.designSystem === 'boolean' && optDesignSystem) optDesignSystem.checked = data.designSystem;
  if (typeof data.dualTheme === 'boolean' && optDualTheme) optDualTheme.checked = data.dualTheme;
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
// Dedupes /x vs /x/ (DOM links and sitemaps disagree) and keeps the current page listed.
function withCurrent(urls: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const u of currentUrl ? [currentUrl, ...urls] : urls) if (!byKey.has(pageKey(u))) byKey.set(pageKey(u), u);
  return [...byKey.values()];
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

async function extractOnPageLinks(tabId: number): Promise<string[]> {
  if (!chrome.scripting?.executeScript || !tabId) return [];
  try {
    const [res] = await chrome.scripting.executeScript<string[]>({
      target: { tabId },
      func: () => {
        const origin = location.origin;
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
            if (u.origin !== origin) return null;
            u.hash = '';
            const path = u.pathname.replace(/\/+$/, '') || '/';
            const norm = u.origin + path + (u.search || '');
            if (
              /\.(xml|pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|gz|tar|woff2?|ttf|css|js|json)$/i.test(
                norm
              )
            ) {
              return null;
            }
            return norm;
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
    return res?.result ?? [];
  } catch {
    return [];
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

  // 1. Immediately extract on-page links directly from active tab DOM
  if (currentTabId) {
    const immediateLinks = await extractOnPageLinks(currentTabId);
    if (immediateLinks.length > 0) {
      siteUrls = withCurrent(immediateLinks);
      await restoreSelection();
      collapseBigGroups();
      if (siteLine && siteOrigin) {
        siteLine.textContent = `${plural(siteUrls.length, 'page')} on ${new URL(siteOrigin).hostname}`;
      }
      renderPages();
    }
  }

  // 2. Query background service worker for sitemap entries
  try {
    const response = (await chrome.runtime.sendMessage({
      action: 'discover-site',
      tabId: currentTabId,
      origin: siteOrigin,
      url: currentUrl,
    })) as CaptureMessageResponse | undefined;

    if (response?.success && response.urls && response.urls.length > 0) {
      const merged = [...new Set([...siteUrls, ...response.urls])];
      chrome.storage?.local?.set({ [cacheKey]: merged });
      siteUrls = withCurrent(merged);
      await restoreSelection();
      collapseBigGroups();
    }
  } catch {
    // Background fallback
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

async function exportCaptures(
  captures: Capture[],
  format = getFormat(),
  includeDesignSystem = optDesignSystem?.checked ?? false
): Promise<string> {
  if (captures.length === 0) throw new Error('No saved captures are available to export');
  if (format === 'figma') {
    await copyToFigmaClipboard(captures, { includeDesignSystem });
    return `Copied ${plural(captures.length, 'frame')}${includeDesignSystem ? ' + Design System' : ''} — paste into Figma`;
  }
  let host = 'site';
  try {
    host = new URL(captures[0].url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  } catch {
    // The capture file name falls back to a generic site label.
  }
  if (format === 'figma-native') {
    const baseName = captures.length === 1 ? fileName(captures[0], false) : `${host}-captures`;
    const payload: Capture | Capture[] = captures.length === 1 ? captures[0] : captures;
    triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${baseName}.capture.json`);
    return `Downloaded ${baseName}.capture.json for the Capture Kit Figma plugin`;
  }
  if (format === 'react' && captures.length === 1) {
    await navigator.clipboard.writeText(modelToReact(captures[0]));
    return 'Copied React component';
  }
  if (format === 'md' && captures.length === 1) {
    await navigator.clipboard.writeText(modelToMarkdown(captures[0]));
    return 'Copied Markdown component spec';
  }
  const withWidth = new Set(captures.map((capture) => capture.frame.width)).size > 1;

  if (captures.length > 1) {
    const zip = new JSZip();
    const fileLinks: Array<{ name: string; file: string }> = [];
    for (const capture of captures) {
      const name = fileName(capture, withWidth);
      if (format === 'sketch') {
        const buffer = await (await modelToSketch(capture)).arrayBuffer();
        zip.file(`${name}.sketch`, buffer);
        fileLinks.push({ name, file: `${name}.sketch` });
      } else if (format === 'svg') {
        zip.file(`${name}.svg`, modelToSvg(capture));
        fileLinks.push({ name, file: `${name}.svg` });
      } else if (format === 'html') {
        zip.file(`${name}.html`, modelToHtml(capture));
        fileLinks.push({ name, file: `${name}.html` });
      } else if (format === 'react') {
        zip.file(`${name}.tsx`, modelToReact(capture));
        fileLinks.push({ name, file: `${name}.tsx` });
      } else if (format === 'md') {
        zip.file(`${name}.md`, modelToMarkdown(capture));
        fileLinks.push({ name, file: `${name}.md` });
      } else {
        zip.file(`${name}.json`, JSON.stringify(capture, null, 2));
        fileLinks.push({ name, file: `${name}.json` });
      }
    }
    const indexHtml = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Captured Pages</title>',
      '<style>body{font-family:system-ui,sans-serif;padding:24px;max-width:800px;margin:auto;}ul{line-height:2;}a{color:#0d99ff;text-decoration:none;}a:hover{text-decoration:underline;}</style>',
      '</head><body>',
      `<h1>${host} captures (${captures.length} files)</h1>`,
      '<ul>',
      ...fileLinks.map((link) => `  <li><a href="${link.file}">${link.name}</a></li>`),
      '</ul></body></html>',
    ].join('\n');
    zip.file('index.html', indexHtml);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(zipBlob, `${host}-captures.zip`);
    return `Downloaded ${captures.length} files bundled in ${host}-captures.zip`;
  }

  const capture = captures[0];
  const name = fileName(capture, withWidth);
  if (format === 'sketch') triggerDownload(await modelToSketch(capture), `${name}.sketch`);
  else if (format === 'svg') triggerDownload(new Blob([modelToSvg(capture)], { type: 'image/svg+xml' }), `${name}.svg`);
  else if (format === 'html') triggerDownload(new Blob([modelToHtml(capture)], { type: 'text/html' }), `${name}.html`);
  else if (format === 'react') triggerDownload(new Blob([modelToReact(capture)], { type: 'text/typescript' }), `${name}.tsx`);
  else if (format === 'md') triggerDownload(new Blob([modelToMarkdown(capture)], { type: 'text/markdown' }), `${name}.md`);
  else triggerDownload(new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }), `${name}.json`);
  return `Downloaded ${name}.${format === 'react' ? 'tsx' : format}`;
}

async function readSessionCaptures(session: CaptureSession): Promise<Capture[]> {
  const jobs = session.jobs.filter((job) => job.status === 'completed');
  if (jobs.length === 0) throw new Error('This session has no completed captures yet');
  const keys = jobs.map((job) => sessionResultKey(session.id, job.id));
  const stored = await chrome.storage.local.get(keys);
  const captures: Capture[] = [];
  for (const job of jobs) {
    const result = stored[sessionResultKey(session.id, job.id)] as { captures?: unknown } | undefined;
    if (!result || !Array.isArray(result.captures) || result.captures.length === 0) {
      throw new Error('A saved capture is missing. No export was produced; resume this session to recover the job.');
    }
    for (const raw of result.captures) captures.push(CaptureSchema.parse(raw));
  }
  if (captures.length === 0) throw new Error('This session has no saved capture data');
  return captures;
}

function renderDiagnostics(diagnostics: Array<{ code: string; message: string; severity: 'warning' | 'info' }>): void {
  diagnosticsList?.replaceChildren();
  for (const diagnostic of diagnostics) {
    const item = el('li', undefined, diagnostic.message);
    item.title = diagnostic.code;
    item.dataset.severity = diagnostic.severity;
    diagnosticsList?.append(item);
  }
  if (captureDiagnostics) {
    captureDiagnostics.hidden = diagnostics.length === 0;
    captureDiagnostics.open = diagnostics.some((diagnostic) => diagnostic.severity === 'warning');
  }
}

async function loadSessionDiagnostics(session: CaptureSession): Promise<void> {
  const version = `${session.id}:${session.updatedAt}`;
  diagnosticsVersion = version;
  const jobs = session.jobs.filter((job) => job.status === 'completed');
  try {
    const keys = jobs.map((job) => sessionResultKey(session.id, job.id));
    const stored = keys.length ? await chrome.storage.local.get(keys) : {};
    if (diagnosticsVersion !== version) return;
    const diagnostics: Array<{ code: string; message: string; severity: 'warning' | 'info' }> = [];
    for (const job of jobs) {
      const result = stored[sessionResultKey(session.id, job.id)] as { captures?: unknown } | undefined;
      if (!Array.isArray(result?.captures)) continue;
      for (const capture of result.captures) {
        if (!capture || typeof capture !== 'object' || !('diagnostics' in capture) || !Array.isArray(capture.diagnostics)) continue;
        for (const item of capture.diagnostics) {
          if (!item || typeof item !== 'object' || !('message' in item) || typeof item.message !== 'string') continue;
          diagnostics.push({
            code: 'code' in item && typeof item.code === 'string' ? item.code : 'capture_note',
            message: item.message,
            severity: 'severity' in item && item.severity === 'warning' ? 'warning' : 'info',
          });
        }
      }
    }
    renderDiagnostics(diagnostics);
  } catch (error) {
    if (diagnosticsVersion !== version) return;
    renderDiagnostics([]);
    setSessionFeedback(`Could not read capture notes: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setSessionFeedback(text: string): void {
  if (sessionFeedback) sessionFeedback.textContent = text;
}

function sessionActionButton(session: CaptureSession, action: string, label: string, disabled = false): HTMLButtonElement {
  const button = el('button', 'session-action', label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.sessionId = session.id;
  button.disabled = disabled;
  return button;
}

function renderSessions(records: CaptureSession[]): void {
  knownSessions = records;
  sessionsList?.replaceChildren();
  if (sessionsEmpty) sessionsEmpty.hidden = records.length > 0;
  const active = records.find(isSessionActive);
  activeSessionId = active?.id;
  runBusy = Boolean(active);
  const progressSession = active ?? records.find((session) => session.id === progressSessionId)
    ?? records.find((session) => session.id === requestedSessionId) ?? records[0];
  progressSessionId = progressSession?.id;
  if (progressSession) {
    const completed = progressSession.jobs.filter((job) => job.status === 'completed').length;
    const total = progressSession.jobs.length;
    const percent = total ? Math.round(completed * 100 / total) : 0;
    if (progressWrap) progressWrap.hidden = false;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressPct) progressPct.textContent = `${completed}/${total} (${percent}%)`;
    if (cancelBtn) cancelBtn.hidden = !active;
    if (active) {
      const currentJob = active.jobs.find((job) => job.status === 'running');
      setStatus(currentJob ? `Capturing ${pagePath(currentJob.url)} at ${currentJob.width}px - ${completed} of ${total} jobs saved` : `Capture run active: ${completed} of ${total} jobs saved`, 'busy');
    } else {
      const status = progressSession.status === 'completed' ? 'complete'
        : progressSession.status === 'interrupted' ? 'interrupted'
          : progressSession.status === 'cancelled' ? 'cancelled'
            : progressSession.status === 'failed' ? 'failed' : progressSession.status;
      setStatus(`Most recent capture run ${status}: ${completed} of ${total} jobs saved`, progressSession.status === 'failed' ? 'error' : 'idle');
    }
  } else {
    if (progressWrap) progressWrap.hidden = true;
    if (cancelBtn) cancelBtn.hidden = true;
  }

  for (const session of records) {
    const completed = session.jobs.filter((job) => job.status === 'completed').length;
    const pending = session.jobs.length - completed;
    const row = el('div', 'session-row');
    row.dataset.sessionId = session.id;
    const info = el('div', 'session-info');
    let hostname = session.origin;
    try {
      hostname = new URL(session.origin).hostname;
    } catch {
      // The stored origin remains visible if it cannot be parsed.
    }
    const title = el('strong', undefined, hostname);
    const date = new Date(session.createdAt).toLocaleString();
    const pageCount = new Set(session.jobs.map((job) => job.url)).size;
    const widths = [...new Set(session.jobs.map((job) => job.width))].join(', ');
    const theme = session.dualTheme ? 'dual theme' : 'single theme';
    const summary = el('p', undefined, `${session.status} - ${completed}/${session.jobs.length} jobs saved - ${pageCount} pages at ${widths}px - ${theme} - ${session.format} - ${date}`);
    info.append(title, summary);
    if (session.error) info.append(el('p', undefined, `Warning: ${session.error}`));
    const actions = el('div', 'session-actions');
    if (completed > 0) {
      actions.append(
        sessionActionButton(session, 'export', 'Export'),
        sessionActionButton(session, 'export-current', 'Export current format')
      );
    }
    if (!isSessionActive(session) && pending > 0) actions.append(sessionActionButton(session, 'resume', 'Resume', Boolean(active)));
    if (!isSessionActive(session)) actions.append(sessionActionButton(session, 'delete', 'Discard'));
    row.append(info, actions);
    sessionsList?.append(row);
  }

  const completedSessions = records.filter((session) => !isSessionActive(session) && session.jobs.some((job) => job.status === 'completed'));
  const diagnosticsSession = completedSessions.find((session) => session.id === progressSessionId) ?? completedSessions[0];
  if (diagnosticsSession) {
    const version = `${diagnosticsSession.id}:${diagnosticsSession.updatedAt}`;
    if (version !== diagnosticsVersion) void loadSessionDiagnostics(diagnosticsSession);
  } else {
    diagnosticsVersion = '';
    renderDiagnostics([]);
  }
  updateCaptureButton();
  if (pickBtn) pickBtn.disabled = runBusy;

}

async function refreshSessions(): Promise<CaptureSession[]> {
  const response = await chrome.runtime.sendMessage({ action: 'list-sessions' }) as CaptureMessageResponse | undefined;
  if (!response?.success) throw new Error(response?.error ?? 'Could not read saved capture sessions');
  const records = response.sessions ?? [];
  renderSessions(records);
  return records;
}

async function finishSessionRun(sessionId: string | undefined): Promise<void> {
  const records = await refreshSessions();
  if (!sessionId) return;
  const session = records.find((item) => item.id === sessionId);
  if (!session) return;
  if (requestedSessionId !== session.id) return;
  requestedSessionId = undefined;
  if (session.status !== 'completed') {
    const warning = session.error ?? (session.status === 'cancelled' ? 'Capture cancelled. Completed results remain saved.' : 'Capture run stopped before all jobs completed.');
    setSessionFeedback(warning);
    setStatus(warning, session.status === 'failed' ? 'error' : 'idle');
    return;
  }
  try {
    const captures = await readSessionCaptures(session);
    latestCaptures = captures;
    const output = await exportCaptures(captures, session.format, session.includeDesignSystem);
    if (figmaBtn) figmaBtn.hidden = session.format !== 'figma';
    setStatus(output, 'ok');
    setSessionFeedback(`Saved results exported using ${session.format}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSessionFeedback(message);
    setStatus(message, 'error');
  }
}

async function startSession(action: 'capture-run' | 'pick-run', payload: Record<string, unknown>): Promise<void> {
  if (runBusy) return;
  runBusy = true;
  let accepted = false;
  updateCaptureButton();
  if (figmaBtn) figmaBtn.hidden = true;
  setStatus(action === 'pick-run' ? 'Choose an element on the page' : 'Saving capture run', 'busy');
  try {
    const response = await chrome.runtime.sendMessage({ action, ...payload }) as CaptureMessageResponse | undefined;
    if (!response?.success || !response.session) throw new Error(response?.error ?? 'Could not start the capture run');
    requestedSessionId = response.session.id;
    progressSessionId = response.session.id;
    setSessionFeedback('Capture run saved. Its progress and results are available after reopening this popup.');
    await refreshSessions();
  } catch (error) {
    if (!accepted) runBusy = false;
    const message = error instanceof Error ? error.message : String(error);
    setSessionFeedback(message);
    setStatus(message, 'error');
  } finally {
    updateCaptureButton();
  }
}

async function handleSessionAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.session-action');
  const action = button?.dataset.action;
  const sessionId = button?.dataset.sessionId;
  const session = knownSessions.find((item) => item.id === sessionId);
  if (!button || !action || !sessionId || !session) return;
  button.disabled = true;
  try {
    if (action === 'export' || action === 'export-current') {
      const captures = await readSessionCaptures(session);
      latestCaptures = captures;
      const format = action === 'export' ? session.format : getFormat();
      const includeDesignSystem = action === 'export' ? session.includeDesignSystem : optDesignSystem?.checked ?? false;
      const output = await exportCaptures(captures, format, includeDesignSystem);
      if (figmaBtn) figmaBtn.hidden = format !== 'figma';
      setSessionFeedback(`${output}${action === 'export-current' ? ' (current format)' : ' (saved format)'}`);
      setStatus(output, 'ok');
      void loadSessionDiagnostics(session);
      return;
    }
    if (action === 'resume') {
      requestedSessionId = sessionId;
      const response = await chrome.runtime.sendMessage({ action: 'resume-session', sessionId }) as CaptureMessageResponse | undefined;
      if (!response?.success || !response.session) {
        if (requestedSessionId === sessionId) requestedSessionId = undefined;
        throw new Error(response?.error ?? 'Could not resume this session');
      }
      progressSessionId = sessionId;
      setSessionFeedback('Resuming saved run. Completed jobs will be skipped.');
      setSessionFeedback('Resuming saved run. Completed jobs will be skipped.');
      await refreshSessions();
      return;
    }
    if (action === 'delete') {
      const response = await chrome.runtime.sendMessage({ action: 'discard-session', sessionId }) as CaptureMessageResponse | undefined;
      if (!response?.success) throw new Error(response?.error ?? 'Could not discard this session');
      setSessionFeedback('Saved session and its captures were discarded.');
      await refreshSessions();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSessionFeedback(message);
    setStatus(message, 'error');
  } finally {
    button.disabled = false;
  }
}

// ---- actions ----

chrome.runtime?.onMessage?.addListener((message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const notification = message as SessionNotification;
  if (notification.type === 'session-updated') {
    void refreshSessions().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      setSessionFeedback(text);
      setStatus(text, 'error');
    });
  } else if (notification.type === 'run-done') {
    void finishSessionRun(notification.sessionId).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      setSessionFeedback(text);
      setStatus(text, 'error');
    });
  } else if (notification.type === 'run-error') {
    void refreshSessions().catch(() => undefined).finally(() => {
      const text = notification.error ?? 'Capture run was interrupted';
      setSessionFeedback(text);
      setStatus(text, 'error');
    });
  }
});

sessionsList?.addEventListener('click', (event) => {
  void handleSessionAction(event);
});

cancelBtn?.addEventListener('click', async () => {
  setStatus('Cancelling capture run', 'busy');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'cancel-run' }) as CaptureMessageResponse | undefined;
    if (!response?.success) throw new Error(response?.error ?? 'Could not cancel the capture run');
    setSessionFeedback('Cancellation requested. Completed jobs remain saved.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSessionFeedback(message);
    setStatus(message, 'error');
  }
});

captureBtn?.addEventListener('click', () => {
  const urls = pickedUrls();
  const widths = pickedWidths().map(Number);
  void startSession('capture-run', {
    urls,
    widths,
    scrollStitch: optScrollStitch?.checked ?? false,
    dualTheme: optDualTheme?.checked ?? false,
    format: getFormat(),
    includeDesignSystem: optDesignSystem?.checked ?? false,
    tabId: currentTabId,
  });
});

pickBtn?.addEventListener('click', () => {
  if (pickBtn) pickBtn.disabled = true;
  void startSession('pick-run', {
    tabId: currentTabId,
    format: getFormat(),
    includeDesignSystem: optDesignSystem?.checked ?? false,
    scrollStitch: optScrollStitch?.checked ?? false,
    dualTheme: optDualTheme?.checked ?? false,
  }).finally(() => {
    if (pickBtn) pickBtn.disabled = runBusy;
  });
});

figmaBtn?.addEventListener('click', async () => {
  if (latestCaptures.length === 0) return;
  try {
    const includeDesignSystem = optDesignSystem?.checked ?? false;
    await copyToFigmaClipboard(latestCaptures, { includeDesignSystem });
    setStatus(`Copied ${plural(latestCaptures.length, 'frame')} again`, 'ok');
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
});


// ---- wiring ----

pageSearch?.addEventListener('input', renderPages);
selectAllPages?.addEventListener('click', () => setSelected(visibleUrls(siteUrls), true));
selectNoPages?.addEventListener('click', () => setSelected(visibleUrls(siteUrls), false));

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
formatRadios.forEach((r) =>
  r.addEventListener('change', () => {
    saveSettings();
    updateCaptureButton();
    updateFormatHelp();
  })
);
sizeButtons.forEach((button) => button.addEventListener('click', () => {
  button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  syncUI();
  saveSettings();
}));

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && SESSION_INDEX_KEY in changes) {
    void refreshSessions().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      setSessionFeedback(text);
      setStatus(text, 'error');
    });
  }
});

optScrollStitch?.addEventListener('change', saveSettings);
optDesignSystem?.addEventListener('change', saveSettings);
optDualTheme?.addEventListener('change', saveSettings);

void refreshSessions().catch((error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  setSessionFeedback(text);
  setStatus(text, 'error');
});

void Promise.all([loadSettings(), loadTabInfo()]).then(() => {
  updateFormatHelp();
  syncUI();
  return discoverSite();
});
