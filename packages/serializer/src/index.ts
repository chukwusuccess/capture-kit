import {
  type Asset,
  type Capture,
  type CaptureDiagnostic,
  type CaptureTimings,
  type CornerRadius,
  type Fill,
  type Font,
  type Layout,
  type Node,
  type Stroke,
  type TextProps,
  emptyCapture,
} from '@capture-kit/model';

export interface ScrollStitchOptions {
  step?: number;
  delayMs?: number;
  /** Defaults: 100 passes, 15 seconds, 100000px, and two stable bottom passes. */
  maxPasses?: number;
  maxDurationMs?: number;
  maxHeight?: number;
  stablePasses?: number;
}

export interface ImageReadinessOptions {
  /** Per-image deadline, default 2500ms. */
  timeoutMs?: number;
  /** Shared deadline per discovery pass, default 5000ms. */
  totalTimeoutMs?: number;
  /** Stop waiting once no tracked image progresses for this long, default 300ms. */
  idleMs?: number;
  /** Maximum pending browser decodes, default 8. */
  concurrency?: number;
  /** Optional explicit cap; all discovered images are considered by default. */
  maxImages?: number;
}

export interface SerializeOptions {
  baseURI?: string;
  scrollStitch?: boolean;
  scrollOptions?: ScrollStitchOptions;
  imageOptions?: ImageReadinessOptions;
  /** FontFaceSet readiness deadline, default 2500ms. */
  fontTimeoutMs?: number;
  /** Asset operation deadline and total font embedding budget, default 2500ms. */
  assetTimeoutMs?: number;
  /** Overall deadline shared across image readiness, font readiness/embedding, and asset fetches, default 4000ms. */
  readinessBudgetMs?: number;
  /** Concurrent image asset fetches, default 8. */
  assetConcurrency?: number;
  /** Optional stage timing callback (stage name, elapsed ms). */
  onTiming?: (stage: string, ms: number) => void;
  /** Populate capture.timings even when onTiming is not provided. */
  collectTimings?: boolean;
  /** Fast interactive clipboard mode: skips font WOFF2 embedding and raster screenshot fallback. */
  fastMode?: boolean;
}

interface TimingContext {
  totalStart: number;
  scrollMs: number;
  waitImagesMs: number;
  prepareMs: number;
  wantTimings: boolean;
  onTiming?: (stage: string, ms: number) => void;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function finalizeTimings(
  capture: Capture,
  ctx: TimingContext,
  stages: Omit<CaptureTimings['stages'], 'scroll' | 'waitImages' | 'prepare' | 'total'>,
  counts: Omit<CaptureTimings['counts'], 'jsonBytes'>
): void {
  const fullStages: CaptureTimings['stages'] = {
    scroll: roundMs(ctx.scrollMs),
    waitImages: roundMs(ctx.waitImagesMs),
    prepare: roundMs(ctx.prepareMs),
    ...stages,
    total: roundMs(nowMs() - ctx.totalStart),
  };
  if (ctx.onTiming) {
    for (const [stage, ms] of Object.entries(fullStages)) ctx.onTiming(stage, ms);
  }
  const timings: CaptureTimings = { stages: fullStages, counts: { ...counts, jsonBytes: 0 } };
  capture.timings = timings;
  const json = JSON.stringify(capture);
  timings.counts.jsonBytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

class CaptureTimeout extends Error {}

function withTimeout<T>(pending: PromiseLike<T>, timeoutMs: number): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new CaptureTimeout('Timed out')), timeoutMs);
  Promise.resolve(pending).then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error: unknown) => { clearTimeout(timer); reject(error); }
  );
  return promise;
}

function boundedNumber(value: number | undefined, fallback: number, minimum = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

type ReportDiagnostic = (diagnostic: CaptureDiagnostic) => void;

function warning(report: ReportDiagnostic, code: string, message: string, nodeId?: string): void {
  report({ code, message, severity: 'warning', ...(nodeId ? { nodeId } : {}) });
}

interface ImageReadinessState {
  sources: Map<HTMLImageElement, string>;
  considered: number;
  pending: number;
  report: ReportDiagnostic;
}
interface FontReadinessState {
  ready: Promise<FontFaceSet> | null;
  waited: boolean;
}


async function waitForImageElements(
  root: Document | Element,
  opts: ImageReadinessOptions | undefined,
  state: ImageReadinessState,
  visibleOnly = false,
  outerDeadline = Infinity
): Promise<number> {
  const timeoutMs = boundedNumber(opts?.timeoutMs, 2500);
  const deadline = Math.min(Date.now() + boundedNumber(opts?.totalTimeoutMs, 5000), outerDeadline);
  const idleMs = boundedNumber(opts?.idleMs, 800);
  const concurrency = Math.floor(boundedNumber(opts?.concurrency, 8, 1));
  const maxImages = opts?.maxImages === undefined ? Infinity : Math.floor(boundedNumber(opts.maxImages, Infinity));
  const images: HTMLImageElement[] = [];
  if ('tagName' in root && root.tagName.toLowerCase() === 'img') images.push(root as HTMLImageElement);
  if (typeof root.querySelectorAll === 'function') images.push(...Array.from(root.querySelectorAll<HTMLImageElement>('img')));
  const doc = 'tagName' in root ? root.ownerDocument : root;
  const view = doc.defaultView;
  const viewportHeight = view?.innerHeight ?? 800;

  const skippedReasons = new Map<string, number>();
  const recordSkip = (reason: string) => {
    skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
  };

  const candidates: HTMLImageElement[] = [];
  for (const img of images) {
    const source = resolveHighestDpiSrc(img);
    if (!source) {
      recordSkip('no-source');
      continue;
    }
    if (state.sources.get(img) === source) continue;
    const cs = view?.getComputedStyle?.(img);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
      recordSkip('hidden');
      continue;
    }
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      recordSkip('zero-size');
      continue;
    }
    if (visibleOnly) {
      if (rect.bottom < 0 || rect.top > viewportHeight) continue;
    }
    candidates.push(img);
  }

  if (skippedReasons.size > 0) {
    const totalSkipped = Array.from(skippedReasons.values()).reduce((a, b) => a + b, 0);
    const summary = Array.from(skippedReasons.entries()).map(([r, n]) => `${n} ${r}`).join(', ');
    state.report({
      code: 'image_skipped',
      severity: 'info',
      message: `Skipped ${totalSkipped} image${totalSkipped === 1 ? '' : 's'} (${summary}).`,
    });
  }

  let next = 0;
  let decoded = 0;
  let idleTriggered = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const idleWaiters = new Set<() => void>();

  const clearIdleTimer = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const armIdleTimer = () => {
    clearIdleTimer();
    if (idleMs <= 0 || !Number.isFinite(idleMs)) return;
    idleTimer = setTimeout(() => {
      idleTriggered = true;
      for (const wake of idleWaiters) wake();
      idleWaiters.clear();
    }, idleMs);
  };
  const raceIdle = <T>(pending: Promise<T>): Promise<T> => {
    if (idleMs <= 0 || !Number.isFinite(idleMs)) return pending;
    return new Promise<T>((resolve, reject) => {
      const onIdle = () => reject(new CaptureTimeout('Image readiness idle'));
      if (idleTriggered) { onIdle(); return; }
      idleWaiters.add(onIdle);
      pending.then(
        (v) => { idleWaiters.delete(onIdle); resolve(v); },
        (e) => { idleWaiters.delete(onIdle); reject(e); }
      );
    });
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      while (next < candidates.length && state.considered < maxImages && state.pending < concurrency && Date.now() < deadline && !idleTriggered) {
        const img = candidates[next++];
        const source = resolveHighestDpiSrc(img);
        state.sources.set(img, source);
        state.considered++;
        try {
          if (img.complete) {
            if (img.naturalWidth <= 0) throw new Error('Image has no decoded pixels');
          } else if (typeof img.decode === 'function') {
            armIdleTimer();
            const decoding = img.decode();
            state.pending++;
            const pending = decoding.finally(() => { state.pending--; });
            await raceIdle(withTimeout(pending, Math.min(timeoutMs, Math.max(0, deadline - Date.now()))));
          } else {
            armIdleTimer();
            const { promise, resolve, reject } = Promise.withResolvers<void>();
            const finish = (error?: Error) => {
              clearTimeout(timer);
              img.removeEventListener('load', loaded);
              img.removeEventListener('error', failed);
              error ? reject(error) : resolve();
            };
            const loaded = () => finish(img.naturalWidth > 0 ? undefined : new Error('Image has no decoded pixels'));
            const failed = () => finish(new Error('Image loading failed'));
            const timer = setTimeout(() => finish(new CaptureTimeout('Timed out')), Math.min(timeoutMs, Math.max(0, deadline - Date.now())));
            img.addEventListener('load', loaded);
            img.addEventListener('error', failed);
            if (img.complete) loaded();
            await raceIdle(promise);
          }
          decoded++;
          armIdleTimer();
          state.sources.set(img, resolveHighestDpiSrc(img));
        } catch (error) {
          warning(state.report, error instanceof CaptureTimeout ? 'image_timeout' : 'image_failed',
            `${error instanceof CaptureTimeout ? 'Image readiness timed out' : 'Image could not be decoded'}: ${source}`);
          // Decode cannot be cancelled. Do not start another image in this slot
          // while a timed-out browser decode may still be pending.
          if (error instanceof CaptureTimeout) return;
          armIdleTimer();
        }
      }
    }));
  } finally {
    clearIdleTimer();
    idleWaiters.clear();
  }
  if (next < candidates.length) {
    warning(state.report, 'image_budget_exhausted',
      `${candidates.length - next} images were not checked because the image ${state.considered >= maxImages ? 'count' : state.pending >= concurrency ? 'decode concurrency' : 'time'} budget was exhausted.`);
  }
  return decoded;
}

function pageHeight(win: Window & typeof globalThis): number {
  return Math.max(
    win.document?.documentElement?.scrollHeight ?? 0,
    win.document?.documentElement?.clientHeight ?? 0,
    win.document?.body?.scrollHeight ?? 0,
    win.innerHeight || 800
  );
}

async function scrollPage(
  win: Window & typeof globalThis,
  opts: ScrollStitchOptions | undefined,
  waitForPass: (deadline: number) => Promise<unknown>,
  report: ReportDiagnostic
): Promise<void> {
  if (typeof win.scrollTo !== 'function') {
    warning(report, 'scroll_failed', 'Page scrolling is unavailable; lazy content may be incomplete.');
    return;
  }
  const originalX = win.scrollX ?? 0;
  const originalY = win.scrollY ?? 0;
  const viewportHeight = win.innerHeight || 800;
  const step = boundedNumber(opts?.step, Math.max(300, Math.round(viewportHeight * 0.8)), 1);
  const delayMs = boundedNumber(opts?.delayMs, 50);
  const maxPasses = Math.floor(boundedNumber(opts?.maxPasses, 100));
  const maxHeight = boundedNumber(opts?.maxHeight, 100000, viewportHeight);
  const stablePasses = Math.floor(boundedNumber(opts?.stablePasses, 2, 1));
  const deadline = Date.now() + boundedNumber(opts?.maxDurationMs, 15000);
  let currentY = 0;
  let stable = 0;
  let previousHeight = pageHeight(win);
  try {
    for (let pass = 0; pass < maxPasses; pass++) {
      if (Date.now() >= deadline) {
        warning(report, 'scroll_time_budget_exhausted', 'Page readiness stopped at the scrolling time budget; lazy content may be incomplete.');
        return;
      }
      win.scrollTo(originalX, currentY);
      if (delayMs > 0) await delay(Math.min(delayMs, Math.max(0, deadline - Date.now())));
      await waitForPass(deadline);
      if (Date.now() >= deadline) {
        warning(report, 'scroll_time_budget_exhausted', 'Page readiness stopped at the scrolling time budget; lazy content may be incomplete.');
        return;
      }
      const height = pageHeight(win);
      const bottom = Math.max(0, height - viewportHeight);
      if (height > maxHeight) {
        warning(report, 'scroll_height_budget_exhausted', `Page readiness stopped at the ${maxHeight}px height budget; lazy content may be incomplete.`);
        return;
      }
      stable = currentY >= bottom && height === previousHeight ? stable + 1 : 0;
      if (stable >= stablePasses) return;
      previousHeight = height;
      currentY = Math.min(currentY + step, bottom);
    }
    warning(report, 'scroll_pass_budget_exhausted', `Page readiness stopped after ${maxPasses} scroll passes; lazy content may be incomplete.`);
  } finally {
    win.scrollTo(originalX, originalY);
  }
}

export async function triggerPageScroll(
  win: Window & typeof globalThis,
  opts?: ScrollStitchOptions,
  onDiagnostic: ReportDiagnostic = () => {}
): Promise<void> {
  const state: ImageReadinessState = { sources: new Map(), considered: 0, pending: 0, report: onDiagnostic };
  await scrollPage(win, opts, (deadline) => win.document
    ? waitForImageElements(win.document, undefined, state, true, deadline)
    : Promise.resolve(), state.report);

}

/** Wait for every discovered image, within bounded concurrency and time. */
export async function waitForImages(
  doc: Document,
  opts?: ImageReadinessOptions,
  onDiagnostic: ReportDiagnostic = () => {}
): Promise<number> {
  return waitForImageElements(doc, opts, { sources: new Map(), considered: 0, pending: 0, report: onDiagnostic });
}

async function waitForFonts(
  doc: Document,
  timeoutMs: number | undefined,
  report: ReportDiagnostic,
  state: FontReadinessState
): Promise<void> {
  if (!doc.fonts) return;
  try {
    const ready = doc.fonts.ready;
    if (ready && state.ready !== ready) {
      state.ready = ready;
      state.waited = false;
    }
    if (ready && !state.waited) {
      state.waited = true;
      await withTimeout(ready, boundedNumber(timeoutMs, 2500));
    }
    if (typeof doc.fonts.forEach === 'function') {
      doc.fonts.forEach((font) => {
        if (font.status === 'error') warning(report, 'font_failed', `Font failed to load: ${font.family}`);
      });
    }
  } catch (error) {
    warning(report, error instanceof CaptureTimeout ? 'fonts_timeout' : 'font_failed',
      error instanceof CaptureTimeout ? 'Font readiness timed out; text may use fallback metrics.' : 'Font readiness failed; text may use fallback metrics.');
  }
}

// Returns whether any image may still load (promoted here or not yet complete),
// i.e. whether the page height can still shift under us.
function eagerLoadImages(root: Document | Element, doc: Document): boolean {
  let mayShift = false;
  const origin = doc.defaultView?.location?.origin;
  const images: HTMLImageElement[] = [];
  if ('tagName' in root && root.tagName.toLowerCase() === 'img') images.push(root as HTMLImageElement);
  if (typeof root.querySelectorAll === 'function') images.push(...Array.from(root.querySelectorAll<HTMLImageElement>('img')));
  for (const img of images) {
    const existingSrcset = img.getAttribute?.('srcset');
    if (!existingSrcset) {
      const lazySrcset = img.getAttribute?.('data-srcset') || img.getAttribute?.('data-lazy-srcset');
      if (lazySrcset) {
        try { img.setAttribute?.('srcset', lazySrcset); mayShift = true; } catch { /* ignore */ }
      }
    }
    const existingSrc = img.getAttribute?.('src') || '';
    const isPlaceholder = !existingSrc || isLazyPlaceholderUri(existingSrc);
    if (isPlaceholder) {
      const lazySrc = img.getAttribute?.('data-src') || img.getAttribute?.('data-lazy-src');
      if (lazySrc) {
        try { img.setAttribute?.('src', lazySrc); mayShift = true; } catch { /* ignore */ }
      }
    }
    const loadingAttr = img.getAttribute?.('loading') ?? (img as HTMLImageElement).loading;
    if (loadingAttr === 'lazy') {
      const candidateSrc = resolveHighestDpiSrc(img);
      let sameOrigin = !origin || !candidateSrc || candidateSrc.startsWith('data:') || candidateSrc.startsWith('blob:');
      if (!sameOrigin && candidateSrc) {
        try {
          sameOrigin = new URL(candidateSrc, doc.baseURI || 'http://localhost/').origin === origin;
        } catch {
          sameOrigin = true;
        }
      }
      if (sameOrigin) {
        try { (img as HTMLImageElement).loading = 'eager'; } catch { /* ignore */ }
        try { img.setAttribute?.('loading', 'eager'); } catch { /* ignore */ }
        mayShift = true;
      }
    }
    if (img.complete === false) mayShift = true;
  }
  return mayShift;
}

async function waitForStableScrollHeight(
  doc: Document,
  idleMs: number,
  deadline: number,
  initialHeight: number,
  initialStableSince: number
): Promise<void> {
  if (idleMs <= 0 || !Number.isFinite(idleMs) || typeof doc.documentElement?.scrollHeight !== 'number') return;
  const getHeight = () => Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
  let lastHeight = initialHeight;
  let stableSince = initialStableSince;
  const current0 = getHeight();
  if (current0 !== lastHeight) {
    lastHeight = current0;
    stableSince = Date.now();
  }
  const stepMs = Math.min(50, idleMs);
  while (Date.now() < deadline) {
    const remainingIdle = idleMs - (Date.now() - stableSince);
    if (remainingIdle <= 0) return;
    const waitMs = Math.min(stepMs, remainingIdle, Math.max(1, deadline - Date.now()));
    if (waitMs <= 0) return;
    await new Promise((r) => setTimeout(r, waitMs));
    const current = getHeight();
    if (current !== lastHeight) {
      lastHeight = current;
      stableSince = Date.now();
    }
  }
}

async function prepareCapture(
  root: Document | Element,
  doc: Document,
  opts: SerializeOptions | undefined,
  scroll: boolean,
  readinessDeadline = Date.now() + boundedNumber(opts?.readinessBudgetMs, 4000)
): Promise<{ diagnostics: CaptureDiagnostic[]; scrollMs: number; waitImagesMs: number; prepareMs: number; fontDeadline: number }> {
  const prepareStart = nowMs();
  const diagnostics: CaptureDiagnostic[] = [];
  const seen = new Set<string>();
  const report: ReportDiagnostic = (diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.nodeId ?? ''}|${diagnostic.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(diagnostic);
    }
  };
  const layoutMayShift = eagerLoadImages(root, doc);
  const state: ImageReadinessState = { sources: new Map(), considered: 0, pending: 0, report };
  const fontState: FontReadinessState = { ready: null, waited: false };
  const fontDeadline = Math.min(readinessDeadline, Date.now() + boundedNumber(opts?.fontTimeoutMs, 2500));
  let scrollMs = 0;
  if (scroll && doc.defaultView) {
    const scrollStart = nowMs();
    try {
      await scrollPage(doc.defaultView, opts?.scrollOptions, (deadline) => {
        const capped = Math.min(deadline, readinessDeadline);
        return Promise.all([
          waitForImageElements(root, opts?.imageOptions, state, true, capped),
          waitForFonts(doc, Math.min(Math.max(0, fontDeadline - Date.now()), Math.max(0, capped - Date.now())), report, fontState),
        ]);
      }, report);
    } catch (error) {
      warning(report, 'scroll_failed', `Page scrolling failed; lazy content may be incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
    scrollMs = nowMs() - scrollStart;
  }
  const waitImagesStart = nowMs();
  let waitImagesMs = 0;
  const idleMs = boundedNumber(opts?.imageOptions?.idleMs, 800);
  const hasScrollHeight = typeof doc.documentElement?.scrollHeight === 'number';
  const getHeight = () => Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
  let trackedHeight = hasScrollHeight ? getHeight() : 0;
  let stableSince = Date.now();
  const heightPoll = hasScrollHeight && idleMs > 0
    ? setInterval(() => {
        const h = getHeight();
        if (h !== trackedHeight) {
          trackedHeight = h;
          stableSince = Date.now();
        }
      }, Math.min(50, idleMs))
    : undefined;
  try {
    await Promise.all([
      waitForImageElements(root, opts?.imageOptions, state, false, readinessDeadline).finally(() => {
        waitImagesMs = nowMs() - waitImagesStart;
      }),
      waitForFonts(doc, Math.max(0, fontDeadline - Date.now()), report, fontState),
    ]);
    // ponytail: nothing loading → height can't shift from images; skip the idleMs floor.
    if (layoutMayShift) {
      const settleIdleMs = state.pending === 0 ? Math.min(idleMs, 50) : idleMs;
      await waitForStableScrollHeight(doc, settleIdleMs, readinessDeadline, trackedHeight, stableSince);
    }
  } finally {
    if (heightPoll !== undefined) clearInterval(heightPoll);
  }
  return { diagnostics, scrollMs, waitImagesMs, prepareMs: nowMs() - prepareStart, fontDeadline };
}

async function fetchAssetBlob(url: string, timeoutMs: number): Promise<Blob> {
  const controller = new AbortController();
  try {
    return await withTimeout((async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    })(), timeoutMs);
  } finally {
    controller.abort();
  }
}
export interface ElementPickerOptions {
  onSelect: (el: Element) => void;
  onMultiSelect?: (elements: Element[]) => void | Promise<void>;
  onCancel?: () => void;
  highlightColor?: string;
}

const IGNORED_TAGS: Record<string, true> = {
  script: true,
  style: true,
  noscript: true,
  template: true,
  head: true,
  meta: true,
  link: true,
  title: true,
};

const cssColorCanvasCache = new WeakMap<Document, CanvasRenderingContext2D | null>();

function formatRgba(r: number, g: number, b: number, a: number): string {
  const rr = Math.max(0, Math.min(255, Math.round(r)));
  const gg = Math.max(0, Math.min(255, Math.round(g)));
  const bb = Math.max(0, Math.min(255, Math.round(b)));
  const aa = Math.max(0, Math.min(1, Math.round(a * 1000) / 1000));
  return `rgba(${rr}, ${gg}, ${bb}, ${aa})`;
}

function parseCssAlpha(token?: string): number {
  if (!token) return 1;
  const t = token.trim().toLowerCase();
  if (!t || t === 'none') return t === 'none' ? 0 : 1;
  const val = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  if (Number.isNaN(val)) return 1;
  return Math.max(0, Math.min(1, val));
}

function parseCssHueDeg(token: string): number {
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  const ang = parseCssAngle(t);
  if (ang !== undefined) return ang;
  const n = parseFloat(t);
  return Number.isNaN(n) ? 0 : n;
}

function linearToSrgbChannel(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function srgbToLinearChannel(c: number): number {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  return abs <= 0.04045
    ? c / 12.92
    : sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}

function oklabToRgba(L: number, a: number, b: number, alpha: number): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return formatRgba(
    linearToSrgbChannel(lr) * 255,
    linearToSrgbChannel(lg) * 255,
    linearToSrgbChannel(lb) * 255,
    alpha
  );
}

function resolveColorViaCanvas(color: string, doc: Document): string | null {
  try {
    let ctx = cssColorCanvasCache.get(doc);
    if (ctx === undefined) {
      if (typeof doc.createElement !== 'function') {
        cssColorCanvasCache.set(doc, null);
        return null;
      }
      const canvas = doc.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
      cssColorCanvasCache.set(doc, ctx ?? null);
    }
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return formatRgba(data[0], data[1], data[2], data[3] / 255);
  } catch {
    return null;
  }
}

export function normalizeCssColor(color: string, doc?: Document): string {
  if (!color) return color;
  const trimmed = color.trim();
  if (!trimmed) return color;
  const lower = trimmed.toLowerCase();

  if (lower === 'none' || lower === 'transparent' || lower === 'currentcolor') {
    return trimmed;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return trimmed;
  }

  // rgb(...) / rgba(...): keep comma-separated as-is; normalize space-separated `rgb(r g b / a)`
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const inner = rgbMatch[1].trim();
    if (inner.includes(',')) return trimmed;
    const [rgbPart, alphaPart] = inner.split('/').map((s) => s.trim());
    const chans = rgbPart.split(/\s+/).filter(Boolean);
    if (chans.length >= 3) {
      const parseRgbChan = (tok: string): number => {
        if (tok.toLowerCase() === 'none') return 0;
        return tok.endsWith('%') ? (parseFloat(tok) / 100) * 255 : parseFloat(tok);
      };
      return formatRgba(
        parseRgbChan(chans[0]),
        parseRgbChan(chans[1]),
        parseRgbChan(chans[2]),
        parseCssAlpha(alphaPart)
      );
    }
    return trimmed;
  }

  // oklab(L a b [/ alpha])
  const oklabMatch = trimmed.match(/^oklab\(([^)]+)\)$/i);
  if (oklabMatch) {
    const [chanPart, alphaPart] = oklabMatch[1].split('/').map((s) => s.trim());
    const chans = chanPart.split(/\s+/).filter(Boolean);
    if (chans.length >= 3) {
      const parseL = (t: string): number => (t.toLowerCase() === 'none' ? 0 : t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
      const parseAB = (t: string): number => (t.toLowerCase() === 'none' ? 0 : t.endsWith('%') ? (parseFloat(t) / 100) * 0.4 : parseFloat(t));
      const L = parseL(chans[0]);
      const a = parseAB(chans[1]);
      const b = parseAB(chans[2]);
      if (!Number.isNaN(L) && !Number.isNaN(a) && !Number.isNaN(b)) {
        return oklabToRgba(L, a, b, parseCssAlpha(alphaPart));
      }
    }
  }

  // oklch(L C H [/ alpha])
  const oklchMatch = trimmed.match(/^oklch\(([^)]+)\)$/i);
  if (oklchMatch) {
    const [chanPart, alphaPart] = oklchMatch[1].split('/').map((s) => s.trim());
    const chans = chanPart.split(/\s+/).filter(Boolean);
    if (chans.length >= 3) {
      const parseL = (t: string): number => (t.toLowerCase() === 'none' ? 0 : t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
      const parseC = (t: string): number => (t.toLowerCase() === 'none' ? 0 : t.endsWith('%') ? (parseFloat(t) / 100) * 0.4 : parseFloat(t));
      const L = parseL(chans[0]);
      const C = parseC(chans[1]);
      const H = parseCssHueDeg(chans[2]);
      if (!Number.isNaN(L) && !Number.isNaN(C) && !Number.isNaN(H)) {
        const hRad = (H * Math.PI) / 180;
        return oklabToRgba(L, C * Math.cos(hRad), C * Math.sin(hRad), parseCssAlpha(alphaPart));
      }
    }
  }

  // hsl(...) / hsla(...)
  const hslMatch = trimmed.match(/^hsla?\(([^)]+)\)$/i);
  if (hslMatch) {
    const inner = hslMatch[1].trim();
    let hStr: string | undefined;
    let sStr: string | undefined;
    let lStr: string | undefined;
    let alphaPart: string | undefined;
    if (inner.includes(',')) {
      const parts = inner.split(',').map((s) => s.trim());
      [hStr, sStr, lStr, alphaPart] = parts;
    } else {
      const [hslPart, aPart] = inner.split('/').map((s) => s.trim());
      const parts = hslPart.split(/\s+/).filter(Boolean);
      [hStr, sStr, lStr] = parts;
      alphaPart = aPart;
    }
    if (hStr && sStr && lStr) {
      const h = ((parseCssHueDeg(hStr) % 360) + 360) % 360;
      const s = Math.max(0, Math.min(1, (sStr.toLowerCase() === 'none' ? 0 : parseFloat(sStr)) / 100));
      const l = Math.max(0, Math.min(1, (lStr.toLowerCase() === 'none' ? 0 : parseFloat(lStr)) / 100));
      if (!Number.isNaN(h) && !Number.isNaN(s) && !Number.isNaN(l)) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const hp = h / 60;
        const x = c * (1 - Math.abs((hp % 2) - 1));
        let r1 = 0;
        let g1 = 0;
        let b1 = 0;
        if (hp >= 0 && hp < 1) { r1 = c; g1 = x; }
        else if (hp < 2) { r1 = x; g1 = c; }
        else if (hp < 3) { g1 = c; b1 = x; }
        else if (hp < 4) { g1 = x; b1 = c; }
        else if (hp < 5) { r1 = x; b1 = c; }
        else { r1 = c; b1 = x; }
        const m = l - c / 2;
        return formatRgba((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255, parseCssAlpha(alphaPart));
      }
    }
  }

  // color(display-p3 r g b [/ alpha])
  const p3Match = trimmed.match(/^color\(\s*display-p3\s+([^)]+)\)$/i);
  if (p3Match) {
    const [chanPart, alphaPart] = p3Match[1].split('/').map((s) => s.trim());
    const chans = chanPart.split(/\s+/).filter(Boolean);
    if (chans.length >= 3) {
      const parseChan = (t: string): number => (t.toLowerCase() === 'none' ? 0 : t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
      const r = srgbToLinearChannel(parseChan(chans[0]));
      const g = srgbToLinearChannel(parseChan(chans[1]));
      const b = srgbToLinearChannel(parseChan(chans[2]));
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        const X = 0.4865709486482162 * r + 0.26566769316909306 * g + 0.1982172852343625 * b;
        const Y = 0.2289745640697488 * r + 0.6917385218365064 * g + 0.079286914093745 * b;
        const Z = 0.04511338185890264 * g + 1.043944368900976 * b;
        const lr = 3.2409699419045213 * X - 1.5373831775700935 * Y - 0.4986107602930033 * Z;
        const lg = -0.9692436362808798 * X + 1.8759675015077206 * Y + 0.0415550574071756 * Z;
        const lb = 0.0556300796969936 * X - 0.2039769588889766 * Y + 1.0569715142428786 * Z;
        return formatRgba(
          linearToSrgbChannel(lr) * 255,
          linearToSrgbChannel(lg) * 255,
          linearToSrgbChannel(lb) * 255,
          parseCssAlpha(alphaPart)
        );
      }
    }
  }

  // Fallback for color-mix(...), lch(...), lab(...), or other color(...) via 1x1 canvas
  if (/^(?:color-mix|lch|lab|color)\(/i.test(trimmed) && doc) {
    const resolved = resolveColorViaCanvas(trimmed, doc);
    if (resolved) return resolved;
  }

  return trimmed;
}

function extractBalancedColorFunc(input: string, startIndex = 0): { color: string; endIndex: number } | null {
  const slice = input.slice(startIndex);
  const m = slice.match(/^(rgba?|hsla?|oklch|oklab|lch|lab|color-mix|color)\(/i);
  if (!m) return null;
  let depth = 0;
  for (let i = startIndex + m[1].length; i < input.length; i++) {
    if (input[i] === '(') depth++;
    else if (input[i] === ')') {
      depth--;
      if (depth === 0) {
        return { color: input.slice(startIndex, i + 1), endIndex: i + 1 };
      }
    }
  }
  return null;
}

export function parseBoxShadow(shadowStr: string, doc?: Document) {
  if (!shadowStr || shadowStr === 'none') return [];
  const parts = splitTopLevelCommas(shadowStr);
  const shadows = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === 'none') continue;

    const inset = /\binset\b/i.test(trimmed);
    const withoutInset = trimmed.replace(/\binset\b/gi, '').trim();

    let color = 'rgba(0, 0, 0, 0.2)';
    let rest = withoutInset;

    const funcIdx = withoutInset.search(/(?:rgba?|hsla?|oklch|oklab|lch|lab|color-mix|color)\(/i);
    const balanced = funcIdx >= 0 ? extractBalancedColorFunc(withoutInset, funcIdx) : null;
    if (balanced) {
      color = normalizeCssColor(balanced.color, doc);
      rest = (withoutInset.slice(0, funcIdx) + withoutInset.slice(balanced.endIndex)).trim();
    } else {
      const hexMatch = withoutInset.match(/#[0-9a-fA-F]{3,8}\b/i);
      if (hexMatch) {
        color = normalizeCssColor(hexMatch[0], doc);
        rest = withoutInset.replace(hexMatch[0], '').trim();
      } else {
        const tokens = withoutInset.split(/\s+/).filter(Boolean);
        const lengthTokens: string[] = [];
        for (const tok of tokens) {
          if (/^[a-zA-Z]+$/.test(tok)) {
            color = normalizeCssColor(tok, doc);
          } else {
            lengthTokens.push(tok);
          }
        }
        rest = lengthTokens.join(' ');
      }
    }

    const lengths = rest
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => parseFloat(s) || 0);

    const [x = 0, y = 0, blur = 0, spread] = lengths;
    shadows.push({
      x,
      y,
      blur: Math.max(0, blur),
      ...(spread !== undefined ? { spread } : {}),
      color,
      ...(inset ? { inset: true } : {}),
    });
  }

  return shadows;
}

function parseTextAlign(alignStr: string): TextProps['align'] {
  const norm = alignStr.toLowerCase();
  if (norm === 'center') return 'center';
  if (norm === 'right') return 'right';
  if (norm === 'justify') return 'justify';
  return 'left';
}

// Text fidelity: italic/decoration/case/shadow/overflow as rendered.
function extractTextFidelity(computed: CSSStyleDeclaration): Pick<
  TextProps,
  'italic' | 'decoration' | 'textTransform' | 'textShadow' | 'overflow' | 'wordSpacing' | 'textStroke' | 'writingMode' | 'direction'
> {
  const out: Pick<TextProps, 'italic' | 'decoration' | 'textTransform' | 'textShadow' | 'overflow' | 'wordSpacing' | 'textStroke' | 'writingMode' | 'direction'> = {};
  if (computed.fontStyle === 'italic' || computed.fontStyle === 'oblique') out.italic = true;
  const deco = [computed.textDecorationLine, computed.textDecorationStyle]
    .filter((v) => v && v !== 'none' && v !== 'solid')
    .join(' ');
  const decoColor = computed.textDecorationColor;
  if (computed.textDecorationLine && computed.textDecorationLine !== 'none') {
    out.decoration = deco || computed.textDecorationLine;
    // Decoration color only when it deviates from text color.
    if (decoColor && decoColor !== computed.color) {
      out.decoration = `${out.decoration} ${decoColor}`;
    }
    // Thickness survives only if explicitly non-default (e.g. 2px underline).
    const decoThickness = (computed as CSSStyleDeclaration & { textDecorationThickness?: string })
      .textDecorationThickness;
    if (
      decoThickness &&
      decoThickness !== 'auto' &&
      decoThickness !== '1px' &&
      decoThickness !== 'from-font'
    ) {
      out.decoration = `${out.decoration} ${decoThickness}`;
    }
  }
  const tt = computed.textTransform;
  if (tt && tt !== 'none') out.textTransform = tt;
  const ts = computed.textShadow?.trim();
  if (ts && ts !== 'none') out.textShadow = ts;
  const overflow = computed.textOverflow?.trim();
  if (overflow === 'ellipsis') out.overflow = 'ellipsis';
  const ws = computed.wordSpacing?.trim();
  if (ws && ws !== '0px' && ws !== 'normal') out.wordSpacing = ws;
  const strokeW = (computed as CSSStyleDeclaration & { webkitTextStrokeWidth?: string; textStrokeWidth?: string }).webkitTextStrokeWidth ?? (computed as CSSStyleDeclaration & { textStrokeWidth?: string }).textStrokeWidth;
  const strokeC = (computed as CSSStyleDeclaration & { webkitTextStrokeColor?: string; textStrokeColor?: string }).webkitTextStrokeColor ?? (computed as CSSStyleDeclaration & { textStrokeColor?: string }).textStrokeColor;
  if (strokeW && parseFloat(strokeW) > 0) out.textStroke = `${strokeW} ${strokeC || computed.color}`;
  const wm = computed.writingMode?.trim();
  if (wm && wm !== 'horizontal-tb') out.writingMode = wm;
  const dir = computed.direction?.trim();
  if (dir && dir === 'rtl') out.direction = dir;
  return out;
}

function extractCssUrl(bgImage: string): string | null {
  if (!bgImage || bgImage === 'none') return null;
  const match = bgImage.match(/url\(\s*['"]?(.*?)['"]?\s*\)/);
  return match && match[1] ? match[1] : null;
}

// data: URIs come in two flavors — `;base64,...` and URL-encoded (common for
// inline SVG: `data:image/svg+xml,%3Csvg...`). Normalize both to base64.
function dataUriToAsset(uri: string): { mimeType: string; base64: string } | null {
  const comma = uri.indexOf(',');
  if (!uri.startsWith('data:') || comma === -1) return null;
  const meta = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  const parts = meta.split(';').map((p) => p.trim()).filter(Boolean);
  const mimeType = parts[0] && !parts[0].includes('=') ? parts[0] : 'text/plain';
  const isBase64 = parts.some((p) => p.toLowerCase() === 'base64');
  if (isBase64) return { mimeType, base64: body };
  try {
    const decoded = decodeURIComponent(body);
    return { mimeType, base64: btoa(unescape(encodeURIComponent(decoded))) };
  } catch {
    return null;
  }
}
function getRuntimeSendMessage(
  defaultView: (Window & typeof globalThis) | null | undefined
): ((msg: unknown) => Promise<unknown>) | null {
  const candidates: unknown[] = [
    defaultView && 'chrome' in defaultView ? defaultView.chrome : undefined,
    typeof globalThis !== 'undefined' && 'chrome' in globalThis ? (globalThis as { chrome?: unknown }).chrome : undefined,
  ];
  for (const rawChrome of candidates) {
    const runtime = rawChrome && typeof rawChrome === 'object' && 'runtime' in rawChrome ? rawChrome.runtime : undefined;
    if (runtime && typeof runtime === 'object' && 'sendMessage' in runtime && typeof (runtime as { sendMessage?: unknown }).sendMessage === 'function') {
      const rt = runtime as { sendMessage: (m: unknown) => unknown };
      return (msg: unknown) => Promise.resolve(rt.sendMessage(msg));
    }
  }
  return null;
}

function isLazyPlaceholderUri(uri: string | null | undefined): boolean {
  return Boolean(uri && /^data:image\/(gif|svg\+xml)/i.test(uri.trim()));
}

function pickBestSrcsetCandidate(srcset: string | null | undefined): string {
  if (!srcset) return '';
  const candidates = srcset.split(',').map((s) => s.trim().split(/\s+/));
  let bestUrl = '';
  let bestDensity = 0;
  for (const [candUrl, descriptor] of candidates) {
    if (!candUrl || isLazyPlaceholderUri(candUrl)) continue;
    let density = 1;
    if (descriptor?.endsWith('x')) {
      density = parseFloat(descriptor) || 1;
    } else if (descriptor?.endsWith('w')) {
      density = (parseFloat(descriptor) || 800) / 400;
    }
    if (density > bestDensity) {
      bestDensity = density;
      bestUrl = candUrl;
    }
  }
  return bestUrl;
}

function resolveHighestDpiSrc(img: HTMLImageElement): string {
  const currentSrc = img.currentSrc || '';
  if (currentSrc && !isLazyPlaceholderUri(currentSrc)) return currentSrc;

  const srcsetUrl = pickBestSrcsetCandidate(img.getAttribute?.('srcset'));
  if (srcsetUrl) return srcsetUrl;

  const lazySrcsetUrl = pickBestSrcsetCandidate(
    img.getAttribute?.('data-srcset') || img.getAttribute?.('data-lazy-srcset')
  );
  if (lazySrcsetUrl) return lazySrcsetUrl;

  const srcAttr = img.getAttribute?.('src') || '';
  const domSrc = img.src || '';
  if (!srcAttr || isLazyPlaceholderUri(srcAttr)) {
    const lazySrc = img.getAttribute?.('data-src') || img.getAttribute?.('data-lazy-src') || '';
    if (lazySrc && !isLazyPlaceholderUri(lazySrc)) return lazySrc;
  }

  if (domSrc && !isLazyPlaceholderUri(domSrc)) return domSrc;
  if (srcAttr && !isLazyPlaceholderUri(srcAttr)) return srcAttr;

  return currentSrc || domSrc || srcAttr || '';
}
// Deterministic subpixel boxes: 1341.333px renders identically to 1341.33px
// at any real zoom, but long float tails make exports non-repeatable.
const round2 = (n: number): number => Math.round(n * 100) / 100;

function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = input.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function parseCssAngle(token: string): number | undefined {
  const t = token.trim().toLowerCase();
  if (t.endsWith('deg')) return parseFloat(t);
  if (t.endsWith('turn')) return (parseFloat(t) || 0) * 360;
  if (t.endsWith('rad')) return ((parseFloat(t) || 0) * 180) / Math.PI;
  if (t.endsWith('grad')) return (parseFloat(t) || 0) * 0.9;
  return undefined;
}

function parseAtPosition(preamble: string): { cx?: number; cy?: number } {
  const atMatch = preamble.match(/\bat\s+([^\s,]+)(?:\s+([^\s,]+))?/i);
  if (!atMatch) return {};
  const parseAxis = (tok: string | undefined): number => {
    if (!tok || tok === 'center') return 0.5;
    if (tok === 'left' || tok === 'top') return 0;
    if (tok === 'right' || tok === 'bottom') return 1;
    if (tok.endsWith('%')) return Math.max(0, Math.min(1, (parseFloat(tok) || 50) / 100));
    return 0.5;
  };
  return { cx: parseAxis(atMatch[1]), cy: parseAxis(atMatch[2] ?? atMatch[1]) };
}

function parseGradientStops(rawStops: string[], isConic = false, doc?: Document): Array<{ color: string; position: number; positionPx?: number }> {
  const parsed: Array<{ color: string; position?: number; positionPx?: number }> = [];
  const colorRe = /^(#[0-9a-fA-F]+|[a-zA-Z]+)(.*)$/i;
  const parsePos = (tok: string): { position?: number; positionPx?: number } | undefined => {
    const t = tok.trim().toLowerCase();
    if (t.endsWith('%')) return { position: Math.max(0, Math.min(1, parseFloat(t) / 100)) };
    if (t.endsWith('px')) {
      const px = parseFloat(t);
      if (!Number.isNaN(px)) return { position: Math.max(0, Math.min(1, px / 200)), positionPx: px };
    }
    if (isConic) {
      const ang = parseCssAngle(t);
      if (ang !== undefined) return { position: Math.max(0, Math.min(1, ang / 360)) };
    }
    if (t === '0') return { position: 0 };
    return undefined;
  };

  for (const raw of rawStops) {
    const s = raw.trim();
    if (!s) continue;
    // Pure color-stop hint (no color): e.g. "40%"
    if (/^[\d.]+(?:%|px|deg|turn|rad|grad)?$/i.test(s)) continue;
    let rawColor: string | undefined;
    let rest = '';
    const balanced = extractBalancedColorFunc(s, 0);
    if (balanced) {
      rawColor = balanced.color;
      rest = s.slice(balanced.endIndex).trim();
    } else {
      const m = s.match(colorRe);
      if (!m) continue;
      rawColor = m[1];
      rest = m[2].trim();
    }
    const color = normalizeCssColor(rawColor, doc);
    if (!rest) {
      parsed.push({ color });
      continue;
    }
    const posTokens = rest.split(/\s+/).map(parsePos).filter((p): p is { position?: number; positionPx?: number } => p !== undefined);
    if (posTokens.length === 0) {
      parsed.push({ color });
    } else {
      for (const p of posTokens) parsed.push({ color, ...p });
    }
  }

  if (parsed.length === 0) return [];
  if (parsed[0].position === undefined) parsed[0].position = 0;
  if (parsed.length > 1 && parsed[parsed.length - 1].position === undefined) parsed[parsed.length - 1].position = 1;
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].position !== undefined) continue;
    let nextIdx = i + 1;
    while (nextIdx < parsed.length && parsed[nextIdx].position === undefined) nextIdx++;
    const prevPos = parsed[i - 1].position ?? 0;
    const nextPos = parsed[nextIdx]?.position ?? 1;
    const span = nextIdx - (i - 1);
    parsed[i].position = prevPos + ((nextPos - prevPos) * 1) / span;
  }
  return parsed.map((p) => ({
    color: p.color,
    position: Math.max(0, Math.min(1, p.position ?? 0)),
    ...(p.positionPx !== undefined ? { positionPx: p.positionPx } : {}),
  }));
}

function parseCssGradients(bgImage: string, bgSize?: string, bgPosition?: string, bgRepeat?: string, doc?: Document): Fill[] {
  if (!bgImage || bgImage === 'none') return [];
  const fills: Fill[] = [];
  const layers = splitTopLevelCommas(bgImage);
  const sizes = bgSize && bgSize !== 'auto' ? splitTopLevelCommas(bgSize) : [];
  const positions = bgPosition && bgPosition !== '0% 0%' ? splitTopLevelCommas(bgPosition) : [];
  const repeats = bgRepeat && bgRepeat !== 'repeat' ? splitTopLevelCommas(bgRepeat) : [];

  for (let idx = 0; idx < layers.length; idx++) {
    const layer = layers[idx];
    const gm = layer.match(/^(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/i);
    if (!gm) continue;
    const repeating = Boolean(gm[1]);
    const kind = gm[2].toLowerCase() as 'linear' | 'radial' | 'conic';
    const parts = splitTopLevelCommas(gm[3]);
    if (parts.length < 1) continue;

    const layerMeta: Partial<Fill> = {
      ...(repeating ? { repeating: true } : {}),
      ...(sizes.length > 0 ? { backgroundSize: sizes[idx % sizes.length] } : {}),
      ...(positions.length > 0 ? { backgroundPosition: positions[idx % positions.length] } : {}),
      ...(repeats.length > 0 ? { backgroundRepeat: repeats[idx % repeats.length] } : {}),
    };

    if (kind === 'linear') {
      let angle = 180;
      let stopStartIndex = 0;
      const first = parts[0].toLowerCase();
      const parsedAng = parseCssAngle(first);
      if (parsedAng !== undefined) {
        angle = parsedAng;
        stopStartIndex = 1;
      } else if (first.startsWith('to ')) {
        stopStartIndex = 1;
        if (first.includes('right') && first.includes('top')) angle = 45;
        else if (first.includes('right') && first.includes('bottom')) angle = 135;
        else if (first.includes('left') && first.includes('bottom')) angle = 225;
        else if (first.includes('left') && first.includes('top')) angle = 315;
        else if (first.includes('right')) angle = 90;
        else if (first.includes('left')) angle = 270;
        else if (first.includes('top')) angle = 0;
        else if (first.includes('bottom')) angle = 180;
      }
      const stops = parseGradientStops(parts.slice(stopStartIndex), false, doc);
      if (stops.length >= 2) {
        fills.push({ type: 'gradient', gradientType: 'linear', angle, stops, opacity: 1, ...layerMeta });
      }
    } else if (kind === 'radial') {
      let stopStartIndex = 0;
      let radialShape: 'circle' | 'ellipse' | undefined;
      let radialSize: string | undefined;
      let cx: number | undefined;
      let cy: number | undefined;
      const first = parts[0].toLowerCase();
      if (
        first.includes('circle') ||
        first.includes('ellipse') ||
        first.includes('closest') ||
        first.includes('farthest') ||
        first.includes('at ') ||
        /^\d/.test(first)
      ) {
        stopStartIndex = 1;
        if (first.includes('circle')) radialShape = 'circle';
        else if (first.includes('ellipse')) radialShape = 'ellipse';
        const pos = parseAtPosition(first);
        cx = pos.cx;
        cy = pos.cy;
        const beforeAt = first.split(/\bat\b/i)[0].replace(/\b(circle|ellipse)\b/gi, '').trim();
        if (beforeAt) radialSize = beforeAt;
      }
      const stops = parseGradientStops(parts.slice(stopStartIndex), false, doc);
      if (stops.length >= 2) {
        fills.push({
          type: 'gradient',
          gradientType: 'radial',
          stops,
          opacity: 1,
          ...(radialShape ? { radialShape } : {}),
          ...(radialSize ? { radialSize } : {}),
          ...(cx !== undefined ? { cx } : {}),
          ...(cy !== undefined ? { cy } : {}),
          ...layerMeta,
        });
      }
    } else if (kind === 'conic') {
      let stopStartIndex = 0;
      let angle: number | undefined;
      let cx: number | undefined;
      let cy: number | undefined;
      const first = parts[0].toLowerCase();
      if (first.includes('from ') || first.includes('at ')) {
        stopStartIndex = 1;
        const fromMatch = first.match(/\bfrom\s+([^\s,]+)/i);
        if (fromMatch) angle = parseCssAngle(fromMatch[1]);
        const pos = parseAtPosition(first);
        cx = pos.cx;
        cy = pos.cy;
      }
      const stops = parseGradientStops(parts.slice(stopStartIndex), true, doc);
      if (stops.length >= 2) {
        fills.push({
          type: 'gradient',
          gradientType: 'conic',
          stops,
          opacity: 1,
          ...(angle !== undefined ? { angle } : {}),
          ...(cx !== undefined ? { cx } : {}),
          ...(cy !== undefined ? { cy } : {}),
          ...layerMeta,
        });
      }
    }
  }

  return fills;
}
// Pixel-fidelity fields: capture only non-default values so the model stays
 // small and pre-fidelity consumers (that ignore these keys) still work.
 interface FidelityStyle {
   transform?: string;
   transformOrigin?: string;
   filter?: string;
   backdropFilter?: string;
   mixBlendMode?: string;
   backgroundSize?: string;
   backgroundPosition?: string;
   backgroundRepeat?: string;
   backgroundClip?: string;
   maskImage?: string;
   interactiveClasses?: string[];
   hoverStyle?: Record<string, string>;
 }
 function extractFidelityStyle(computed: CSSStyleDeclaration, el?: Element): FidelityStyle {
   const out: FidelityStyle = {};
   const transform = computed.transform?.trim();
   if (transform && transform !== 'none') out.transform = transform;
   const origin = computed.transformOrigin?.trim();
   if (origin && origin !== '50% 50%') out.transformOrigin = origin;
   const filter = computed.filter?.trim();
   if (filter && filter !== 'none') out.filter = filter;
   const backdrop = computed.backdropFilter?.trim() || (computed as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter?.trim();
   if (backdrop && backdrop !== 'none') out.backdropFilter = backdrop;
   const blend = computed.mixBlendMode?.trim();
   if (blend && blend !== 'normal') out.mixBlendMode = blend;
   const bgSize = computed.backgroundSize?.trim();
   if (bgSize && bgSize !== 'auto') out.backgroundSize = bgSize;
   const bgPos = computed.backgroundPosition?.trim();
   if (bgPos && bgPos !== '0% 0%') out.backgroundPosition = bgPos;
   const bgRepeat = computed.backgroundRepeat?.trim();
   if (bgRepeat && bgRepeat !== 'repeat') out.backgroundRepeat = bgRepeat;
   const bgClip =
     computed.backgroundClip?.trim() ||
     (computed as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip?.trim() ||
     (typeof computed.getPropertyValue === 'function' ? computed.getPropertyValue('-webkit-background-clip')?.trim() : '');
   if (bgClip && bgClip !== 'border-box') out.backgroundClip = bgClip;
   // Radial/linear fade masks on glow washes: without this the divider paints
   // as a solid pill in every renderer.
   const mask = computed.maskImage?.trim() || (computed as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage?.trim();
   if (mask && mask !== 'none') out.maskImage = mask;
   if (el && typeof el.getAttribute === 'function') {
     const rawCls = el.getAttribute('class') || '';
     const interactive = rawCls
       .split(/\s+/)
       .filter((t) => /^(?:hover:|focus:|focus-visible:|active:|group-hover:|group$|transition|duration-|ease-|cursor-pointer$)/.test(t));
     if (computed.cursor === 'pointer' && !interactive.includes('cursor-pointer')) interactive.push('cursor-pointer');
     const td = (computed as CSSStyleDeclaration & { transitionDuration?: string }).transitionDuration;
     if (td && td !== '0s' && td !== '0ms' && !interactive.some((c) => c.startsWith('transition'))) interactive.push('transition-all');
     if (interactive.length > 0) out.interactiveClasses = [...new Set(interactive)];
   }
   return out;
 }
// transform:none, saved) right before measurement so every box we capture is
// pure layout space; then each node emits ONE composed matrix — its own plus
// every ancestor's — rebased so the renderer can keep transform-origin 0,0.

interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface FrozenTransform {
  transform: string;
  translate: string;
  rotate: string;
  scale: string;
  origin: string;
  prev: Array<{ prop: string; value: string; priority: string }>;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function parseTransformMatrix(value: string | undefined): Affine | null {
  if (!value || value === 'none') return null;
  const m3 = value.match(/matrix3d\(([^)]+)\)/);
  if (m3 && m3[1]) {
    const v = m3[1].split(',').map((s) => parseFloat(s.trim()));
    if (v.length === 16 && !v.some((n) => Number.isNaN(n))) {
      const identity3d =
        Math.abs(v[2]) < 1e-6 && Math.abs(v[3]) < 1e-6 &&
        Math.abs(v[6]) < 1e-6 && Math.abs(v[7]) < 1e-6 &&
        Math.abs(v[8]) < 1e-6 && Math.abs(v[9]) < 1e-6 &&
        Math.abs(v[10] - 1) < 1e-6 && Math.abs(v[11]) < 1e-6 &&
        Math.abs(v[15] - 1) < 1e-6;
      if (identity3d) return { a: v[0], b: v[1], c: v[4], d: v[5], e: v[12], f: v[13] };
      // Real 3D (perspective tilt, rotateX/Y): project to its 2D affine part
      // (orthographic approximation — drops the perspective divide). Folding
      // this per node keeps tilted subtrees tilted together in every 2D
      // destination; the alternative (raw matrix3d) is dropped by SVG/Figma
      // importers and leaves children flat while the parent tilts.
      return { a: v[0], b: v[1], c: v[4], d: v[5], e: v[12], f: v[13] };
    }
    return null;
  }
  const m = value.match(/matrix\(([^)]+)\)/);
  if (!m || !m[1]) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null;
  return { a: parts[0], b: parts[1], c: parts[2], d: parts[3], e: parts[4], f: parts[5] };
}

function affineCompose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

// transform about a point: translate(o) ∘ m ∘ translate(-o)
function affineAbout(m: Affine, ox: number, oy: number): Affine {
  return {
    a: m.a,
    b: m.b,
    c: m.c,
    d: m.d,
    e: m.e + ox - (m.a * ox + m.c * oy),
    f: m.f + oy - (m.b * ox + m.d * oy),
  };
}

function affineToCss(m: Affine): string {
  // 6 decimals: at a 250px lever arm even 3-decimal rounding (0.0436 → 0.044)
  // drifts the far end ~0.1px — visible as red tail glyphs in the harness.
  const r = (n: number): string => (Math.round(n * 1e6) / 1e6).toString();
  return `matrix(${r(m.a)}, ${r(m.b)}, ${r(m.c)}, ${r(m.d)}, ${r(m.e)}, ${r(m.f)})`;
}

function resolveOrigin(value: string | undefined, w: number, h: number): { x: number; y: number } {
  const out = { x: w / 2, y: h / 2 };
  if (!value) return out;
  const tokens = value.split(/\s+/);
  const axis = (tok: string | undefined, base: number): number => {
    if (!tok) return base;
    if (tok.endsWith('%')) return ((parseFloat(tok) || 0) / 100) * base;
    if (tok === 'left' || tok === 'top') return 0;
    if (tok === 'right' || tok === 'bottom') return base;
    if (tok === 'center') return base / 2;
    const px = parseFloat(tok);
    return Number.isNaN(px) ? base : px;
  };
  out.x = axis(tokens[0], w);
  out.y = axis(tokens[1] ?? tokens[0], h);
  return out;
}

function isIdentity(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

// Rebase a composed doc→doc matrix onto the node's stored doc-space box so
// CSS transform-origin can stay 0,0.
function emitMatrix(m: Affine, boxDocX: number, boxDocY: number): string {
  const tx = m.a * boxDocX + m.c * boxDocY + m.e - boxDocX;
  const ty = m.b * boxDocX + m.d * boxDocY + m.f - boxDocY;
  return affineToCss({ a: m.a, b: m.b, c: m.c, d: m.d, e: tx, f: ty });
}

// Freeze one element's transform (both the shorthand and the individual
// translate/rotate/scale properties, which Chrome supports and Tailwind v4
// emits) so measurement sees layout space. Returns the saved state for
// restoration, or null when there was nothing to freeze.
function freezeTransform(el: Element, defaultView: Window & typeof globalThis): FrozenTransform | null {
  const style = (el as Element & { style?: CSSStyleDeclaration }).style;
  if (!style || typeof style.setProperty !== 'function') return null;
  let cs: CSSStyleDeclaration;
  try {
    cs = defaultView.getComputedStyle(el);
  } catch {
    return null;
  }
  const individual = cs as CSSStyleDeclaration & {
    translate?: string;
    rotate?: string;
    scale?: string;
  };
  const values = {
    transform: cs.transform ?? 'none',
    translate: individual.translate ?? 'none',
    rotate: individual.rotate ?? 'none',
    scale: individual.scale ?? 'none',
  };
  const active =
    (values.transform && values.transform !== 'none') ||
    (values.translate && values.translate !== 'none' && values.translate !== '0px') ||
    (values.rotate && values.rotate !== 'none' && values.rotate !== '0deg') ||
    (values.scale && values.scale !== 'none' && values.scale !== '1');
  if (!active) return null;
  if (values.transform !== 'none' && !parseTransformMatrix(values.transform)) {
    return null;
  }

  const origin = cs.transformOrigin ?? '50% 50%';
  const props = ['transform', 'translate', 'rotate', 'scale'];
  const prev = props.map((prop) => ({
    prop,
    value: style.getPropertyValue(prop),
    priority: style.getPropertyPriority(prop),
  }));
  for (const prop of props) {
    // translate(0px) for the shorthand, not `none`: a transformed element is
    // the containing block for abs/fixed descendants, and switching to `none`
    // would relocate them mid-measurement. translate(0px) is a visual
    // identity but keeps the containing block intact.
    style.setProperty(prop, prop === 'transform' ? 'translate(0px)' : 'none', 'important');
  }
  return { ...values, origin, prev };
}

function thawTransform(el: Element, frozen: FrozenTransform): void {
  const style = (el as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  for (const p of frozen.prev) {
    if (p.value) style.setProperty(p.prop, p.value, p.priority);
    else style.removeProperty(p.prop);
  }
}

// Build a single affine from an element's saved transform state. Per spec the
// individual properties compose as translate ∘ rotate ∘ scale ∘ transform.
// Returns null when a real 3D transform makes it inexpressible in 2D.
function affineFromFrozen(
  f: FrozenTransform,
  boxW = 0,
  boxH = 0
): Affine | null {
  const base = parseTransformMatrix(f.transform);
  if (f.transform !== 'none' && !base) return null;
  let m: Affine = base ?? IDENTITY;

  const applyScale = (raw: string): boolean => {
    if (!raw || raw === 'none' || raw === '1') return true;
    const nums = raw.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.some((n) => Number.isNaN(n))) return false;
    m = affineCompose({ a: nums[0] ?? 1, b: 0, c: 0, d: nums[1] ?? nums[0] ?? 1, e: 0, f: 0 }, m);
    return true;
  };
  const applyRotate = (raw: string): boolean => {
    if (!raw || raw === 'none' || raw === '0deg') return true;
    const deg = parseFloat(raw);
    if (Number.isNaN(deg)) return false;
    const rad = (deg * Math.PI) / 180;
    m = affineCompose({ a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: 0, f: 0 }, m);
    return true;
  };
  const applyTranslate = (raw: string): boolean => {
    if (!raw || raw === 'none' || raw === '0px') return true;
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const resolveTok = (tok: string | undefined, baseDim: number): number => {
      if (!tok) return 0;
      if (tok.endsWith('%')) return ((parseFloat(tok) || 0) / 100) * baseDim;
      return parseFloat(tok) || 0;
    };
    const tx = resolveTok(tokens[0], boxW);
    const ty = resolveTok(tokens[1], boxH);
    m = affineCompose({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, m);
    return true;
  };
  if (!applyScale(f.scale) || !applyRotate(f.rotate) || !applyTranslate(f.translate)) return null;
  return m;
}

// Raw CSS fallback for a node whose own transform cannot be folded (real 3D):
// reconstruct the equivalent transform function list for the renderer.
function rawTransformCss(f: FrozenTransform): string | null {
  const wrap = (v: string, fn: string, unitless = false): string | null => {
    if (!v || v === 'none') return null;
    if (v.includes('(')) return v;
    if (fn === 'translate' && v === '0px') return null;
    if (fn === 'rotate' && v === '0deg') return null;
    if (fn === 'scale' && v === '1') return null;
    void unitless;
    return `${fn}(${v})`;
  };
  const parts = [
    wrap(f.translate, 'translate'),
    wrap(f.rotate, 'rotate'),
    wrap(f.scale, 'scale'),
    f.transform && f.transform !== 'none' ? f.transform : null,
  ].filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(' ') : null;
}

interface MeasureState {
  transformed: Set<Element>;
  frozen: Map<Element, FrozenTransform>;
  boxes: Map<Element, { x: number; y: number; w: number; h: number }>;
}

// Fold `start`'s own transform (when present) with every transformed
// ancestor's, inner→outer. Boxes were captured in layout space (transforms
// frozen) and are in document coordinates; the preorder walk guarantees
// ancestors were already measured before descendants ask for them.
function chainMatrix(
  start: Element,
  state: MeasureState,
  scrollX: number,
  scrollY: number
): { matrix: Affine | null; failed: boolean } {
  if (state.transformed.size === 0) return { matrix: null, failed: false };
  let composed: Affine | null = null;
  let failed = false;

  const fold = (node: Element): boolean => {
    if (!state.transformed.has(node)) return true;
    const f = state.frozen.get(node);
    if (!f) return true;
    // Measure on demand — layout space while transforms are frozen.
    let b = state.boxes.get(node);
    if (!b) {
      const r = node.getBoundingClientRect();
      b = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      state.boxes.set(node, b);
    }
    const m = affineFromFrozen(f, b.w, b.h);
    if (!m) {
      failed = true;
      return false;
    }
    const origin = resolveOrigin(f.origin, b.w, b.h);
    const about = affineAbout(m, b.x + origin.x, b.y + origin.y);
    composed = composed ? affineCompose(about, composed) : about;
    return true;
  };

  let node: Element | null = start;
  let guard = 0;
  while (node && guard++ < 200) {
    if (!fold(node)) break;
    const next: Element | null = node.parentElement;
    if (next) {
      node = next;
    } else {
      const rootNode = node.getRootNode?.() as ShadowRoot | null;
      node = rootNode && rootNode.host ? rootNode.host : null;
    }
  }
  return { matrix: composed, failed };
}

function hasTransformedAncestor(el: Element, transformed: Set<Element>): boolean {
  if (transformed.size === 0) return false;
  let node: Element | null = el.parentElement;
  let guard = 0;
  while (node && guard++ < 200) {
    if (transformed.has(node)) return true;
    const next: Element | null = node.parentElement;
    if (next) {
      node = next;
    } else {
      const rootNode = node.getRootNode?.() as ShadowRoot | null;
      node = rootNode && rootNode.host ? rootNode.host : null;
    }
  }
  return false;
}

type ChainFn = (e: Element) => { matrix: Affine | null; failed: boolean };

// Fold the host element's chain onto a derived node (text child or pseudo):
// the node's own transform is innermost, the host chain wraps it. Nodes with
// an inexpressible 3D own-transform keep their raw form untouched.
function foldNodeChain(
  node: {
    box: { x: number; y: number; w: number; h: number };
    style: { transform?: string; transformOrigin?: string } & Record<string, unknown>;
  },
  host: Element,
  frameOrigin: { originX: number; originY: number },
  chainFor: ChainFn
): void {
  const { matrix } = chainFor(host);
  if (!matrix || isIdentity(matrix)) return;
  const docX = node.box.x + frameOrigin.originX;
  const docY = node.box.y + frameOrigin.originY;
  const ownRaw = node.style.transform;
  let composed = matrix;
  if (ownRaw && ownRaw !== 'none') {
    const own = parseTransformMatrix(ownRaw);
    if (!own) return; // 3D own-transform — keep raw, skip folding
    const origin = resolveOrigin(node.style.transformOrigin, node.box.w, node.box.h);
    composed = affineCompose(matrix, affineAbout(own, docX + origin.x, docY + origin.y));
  }
  node.style.transform = emitMatrix(composed, docX, docY);
  node.style.transformOrigin = '0 0';
}

function parseLayout(computed: CSSStyleDeclaration): Layout | undefined {
  const display = computed.display;
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';

  if (!isFlex && !isGrid) return undefined;

  const mode = isGrid
    ? 'grid'
    : computed.flexDirection === 'column' || computed.flexDirection === 'column-reverse'
    ? 'vertical'
    : 'horizontal';

  const gap = parseFloat(computed.gap) || parseFloat(computed.rowGap) || 0;
  const paddingTop = parseFloat(computed.paddingTop) || 0;
  const paddingRight = parseFloat(computed.paddingRight) || 0;
  const paddingBottom = parseFloat(computed.paddingBottom) || 0;
  const paddingLeft = parseFloat(computed.paddingLeft) || 0;
  const wrap = computed.flexWrap === 'wrap';

  let justifyContent: Layout['justifyContent'];
  const jc = computed.justifyContent.toLowerCase();
  if (jc.includes('space-between') || jc.includes('between')) justifyContent = 'between';
  else if (jc.includes('space-around') || jc.includes('around')) justifyContent = 'around';
  else if (jc.includes('space-evenly') || jc.includes('evenly')) justifyContent = 'evenly';
  else if (jc.includes('center')) justifyContent = 'center';
  else if (jc.includes('flex-end') || jc.includes('end')) justifyContent = 'end';
  else if (jc.includes('flex-start') || jc.includes('start')) justifyContent = 'start';

  let alignItems: Layout['alignItems'];
  const ai = computed.alignItems.toLowerCase();
  if (ai.includes('center')) alignItems = 'center';
  else if (ai.includes('flex-end') || ai.includes('end')) alignItems = 'end';
  else if (ai.includes('stretch')) alignItems = 'stretch';
  else if (ai.includes('baseline')) alignItems = 'baseline';
  else if (ai.includes('flex-start') || ai.includes('start')) alignItems = 'start';

  return {
    mode,
    gap: gap > 0 ? gap : undefined,
    paddingTop: paddingTop > 0 ? paddingTop : undefined,
    paddingRight: paddingRight > 0 ? paddingRight : undefined,
    paddingBottom: paddingBottom > 0 ? paddingBottom : undefined,
    paddingLeft: paddingLeft > 0 ? paddingLeft : undefined,
    justifyContent,
    alignItems,
    wrap: wrap ? true : undefined,
  };
}

const SVG_SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const SVG_SHAPE_SELECTOR = 'path, rect, circle, ellipse, polygon, polyline, line';

function findAttrWithin(el: Element, attr: string, stopAt: Element): string | undefined {
  let cur: Element | null = el;
  while (cur) {
    const val = typeof cur.getAttribute === 'function' ? cur.getAttribute(attr) : null;
    if (val) return val;
    if (cur === stopAt) break;
    cur = cur.parentElement;
  }
  return undefined;
}

function applyOpacityToColor(color: string, opacity: number): string {
  const op = Math.max(0, Math.min(1, opacity));
  if (op >= 1) return color;
  const rgbaMatch = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbaMatch) {
    const existingAlpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    return formatRgba(parseFloat(rgbaMatch[1]), parseFloat(rgbaMatch[2]), parseFloat(rgbaMatch[3]), existingAlpha * op);
  }
  const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const r = hex.length === 3 ? parseInt(hex[0] + hex[0], 16) : parseInt(hex.slice(0, 2), 16);
    const g = hex.length === 3 ? parseInt(hex[1] + hex[1], 16) : parseInt(hex.slice(2, 4), 16);
    const b = hex.length === 3 ? parseInt(hex[2] + hex[2], 16) : parseInt(hex.slice(4, 6), 16);
    return formatRgba(r, g, b, op);
  }
  return color;
}

function parseSvgGradient(gradEl: Element, doc?: Document): Fill | undefined {
  const parseSvgCoord = (val: string | null | undefined, fallback: number): number => {
    if (!val) return fallback;
    const t = val.trim();
    if (!t) return fallback;
    const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    return Number.isNaN(n) ? fallback : n;
  };

  let stopEls: Element[] =
    typeof gradEl.querySelectorAll === 'function' ? Array.from(gradEl.querySelectorAll('stop')) : [];
  if (stopEls.length === 0 && gradEl.children) {
    stopEls = Array.from(gradEl.children).filter((c) => c.tagName?.toLowerCase() === 'stop');
  }

  const stops: Array<{ color: string; position: number }> = [];
  for (let idx = 0; idx < stopEls.length; idx++) {
    const stopEl = stopEls[idx];
    const styleAttr = stopEl.getAttribute?.('style') || '';
    let stopColor =
      stopEl.getAttribute?.('stop-color') ||
      styleAttr.match(/stop-color\s*:\s*([^;]+)/i)?.[1]?.trim() ||
      '';
    if (!stopColor) continue;
    stopColor = normalizeCssColor(stopColor, doc);
    const opStr =
      stopEl.getAttribute?.('stop-opacity') ||
      styleAttr.match(/stop-opacity\s*:\s*([^;]+)/i)?.[1]?.trim();
    if (opStr) {
      const op = parseFloat(opStr);
      if (!Number.isNaN(op)) stopColor = applyOpacityToColor(stopColor, op);
    }
    const defaultPos = stopEls.length > 1 ? idx / (stopEls.length - 1) : 0;
    const position = Math.max(0, Math.min(1, parseSvgCoord(stopEl.getAttribute?.('offset'), defaultPos)));
    stops.push({ color: stopColor, position });
  }
  if (stops.length === 0) return undefined;

  const gradTag = gradEl.tagName?.toLowerCase() ?? '';
  if (gradTag === 'radialgradient') {
    const cx = Math.max(0, Math.min(1, parseSvgCoord(gradEl.getAttribute?.('cx'), 0.5)));
    const cy = Math.max(0, Math.min(1, parseSvgCoord(gradEl.getAttribute?.('cy'), 0.5)));
    return { type: 'gradient', gradientType: 'radial', cx, cy, stops, opacity: 1 };
  }

  const x1 = parseSvgCoord(gradEl.getAttribute?.('x1'), 0);
  const y1 = parseSvgCoord(gradEl.getAttribute?.('y1'), 0);
  const x2 = parseSvgCoord(gradEl.getAttribute?.('x2'), 1);
  const y2 = parseSvgCoord(gradEl.getAttribute?.('y2'), 0);
  const dx = x2 - x1;
  const dy = y2 - y1;
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  angle = Math.round(angle * 100) / 100;
  return { type: 'gradient', gradientType: 'linear', angle, stops, opacity: 1 };
}

export function extractSvgPaths(
  svgEl: Element,
  opts?: { inheritFrom?: Element[]; fallbackColor?: string; allowDefsAncestor?: boolean }
): Array<{ d: string; fill?: string; fillGradient?: Fill; stroke?: string; strokeWidth?: number }> {
  const paths: Array<{ d: string; fill?: string; fillGradient?: Fill; stroke?: string; strokeWidth?: number }> = [];
  const tagSelf = svgEl.tagName?.toLowerCase() ?? '';
  const candidates: Element[] = SVG_SHAPE_TAGS.has(tagSelf)
    ? [svgEl]
    : typeof svgEl.querySelectorAll === 'function'
      ? Array.from(svgEl.querySelectorAll(SVG_SHAPE_SELECTOR))
      : [];

  let cachedColor: string | undefined | null = opts?.fallbackColor !== undefined ? opts.fallbackColor : null;
  const resolveColor = (): string | undefined => {
    if (cachedColor !== null) return cachedColor;
    try {
      const host = tagSelf === 'symbol' ? svgEl.closest?.('svg') ?? svgEl : svgEl;
      const view = svgEl.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
      const cs = view?.getComputedStyle?.(host as Element);
      cachedColor = cs?.color || undefined;
    } catch {
      cachedColor = undefined;
    }
    return cachedColor;
  };

  for (const child of candidates) {
    const excludedAnc = typeof child.closest === 'function'
      ? child.closest('defs, clipPath, mask, pattern, marker')
      : null;
    if (excludedAnc) {
      const isDefs = excludedAnc.tagName?.toLowerCase() === 'defs';
      const insideRoot = typeof svgEl.contains === 'function' && svgEl.contains(excludedAnc) && excludedAnc !== svgEl;
      if (!isDefs || !opts?.allowDefsAncestor || insideRoot) {
        continue;
      }
    }
    const tag = child.tagName.toLowerCase();
    let d = '';

    if (tag === 'path') {
      d = child.getAttribute('d') || '';
    } else if (tag === 'rect') {
      const rx = parseFloat(child.getAttribute('x') || '0');
      const ry = parseFloat(child.getAttribute('y') || '0');
      const rw = parseFloat(child.getAttribute('width') || '0');
      const rh = parseFloat(child.getAttribute('height') || '0');
      if (rw > 0 && rh > 0) d = `M ${rx} ${ry} H ${rx + rw} V ${ry + rh} H ${rx} Z`;
    } else if (tag === 'circle') {
      const cx = parseFloat(child.getAttribute('cx') || '0');
      const cy = parseFloat(child.getAttribute('cy') || '0');
      const r = parseFloat(child.getAttribute('r') || '0');
      if (r > 0) d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
    } else if (tag === 'ellipse') {
      const ex = parseFloat(child.getAttribute('cx') || '0');
      const ey = parseFloat(child.getAttribute('cy') || '0');
      const rx = parseFloat(child.getAttribute('rx') || '0');
      const ry = parseFloat(child.getAttribute('ry') || '0');
      if (rx > 0 && ry > 0) d = `M ${ex - rx} ${ey} A ${rx} ${ry} 0 1 0 ${ex + rx} ${ey} A ${rx} ${ry} 0 1 0 ${ex - rx} ${ey} Z`;
    } else if (tag === 'line') {
      const x1 = parseFloat(child.getAttribute('x1') || '0');
      const y1 = parseFloat(child.getAttribute('y1') || '0');
      const x2 = parseFloat(child.getAttribute('x2') || '0');
      const y2 = parseFloat(child.getAttribute('y2') || '0');
      if (x1 !== x2 || y1 !== y2) d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else if (tag === 'polygon' || tag === 'polyline') {
      const points = child.getAttribute('points');
      if (points) {
        const coords = points.trim().split(/[\s,]+/);
        if (coords.length >= 4) {
          const z = tag === 'polygon' ? ' Z' : '';
          d = `M ${coords[0]} ${coords[1]} ` + coords.slice(2).reduce((acc, val, idx) => (idx % 2 === 0 ? `${acc} L ${val}` : `${acc} ${val}`), '') + z;
        }
      }
    }

    if (d) {
      let fill =
        findAttrWithin(child, 'fill', svgEl) ??
        (!opts?.allowDefsAncestor && typeof child.closest === 'function'
          ? child.closest('[fill]')?.getAttribute('fill') ?? undefined
          : undefined) ??
        opts?.inheritFrom?.map((h) => h.getAttribute?.('fill')).find(Boolean) ??
        undefined;
      let stroke =
        findAttrWithin(child, 'stroke', svgEl) ??
        (!opts?.allowDefsAncestor && typeof child.closest === 'function'
          ? child.closest('[stroke]')?.getAttribute('stroke') ?? undefined
          : undefined) ??
        opts?.inheritFrom?.map((h) => h.getAttribute?.('stroke')).find(Boolean) ??
        undefined;
      let fillGradient: Fill | undefined;
      if (fill && fill.startsWith('url(')) {
        const gId = fill.match(/#([^)\s"']+)/)?.[1];
        const gradEl = gId
          ? (svgEl.ownerDocument?.getElementById?.(gId) ?? svgEl.querySelector?.(`#${gId}`) ?? null)
          : null;
        if (gradEl) {
          fillGradient = parseSvgGradient(gradEl, svgEl.ownerDocument ?? undefined);
          fill = fillGradient?.stops?.[0]?.color;
        } else {
          fill = undefined;
        }
      }
      if (!fill || fill === 'currentColor' || fill === 'inherit') {
        const color = resolveColor();
        if (color) fill = color;
      }
      if (fill) fill = normalizeCssColor(fill, svgEl.ownerDocument ?? undefined);
      if (stroke === 'currentColor' || stroke === 'inherit') {
        const color = resolveColor();
        if (color) stroke = color;
      }
      if (stroke) stroke = normalizeCssColor(stroke, svgEl.ownerDocument ?? undefined);
      const sw =
        findAttrWithin(child, 'stroke-width', svgEl) ??
        opts?.inheritFrom?.map((h) => h.getAttribute?.('stroke-width')).find(Boolean);
      const strokeWidth = sw ? parseFloat(sw) : undefined;
      paths.push({ d, fill, ...(fillGradient ? { fillGradient } : {}), stroke, strokeWidth });
    }
  }

  return paths;
}



export async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(''));
}

function parseCornerRadius(computed: CSSStyleDeclaration): CornerRadius {
  return {
    topLeft: Math.max(0, parseFloat(computed.borderTopLeftRadius) || 0),
    topRight: Math.max(0, parseFloat(computed.borderTopRightRadius) || 0),
    bottomRight: Math.max(0, parseFloat(computed.borderBottomRightRadius) || 0),
    bottomLeft: Math.max(0, parseFloat(computed.borderBottomLeftRadius) || 0),
  };
}

function parseStrokes(computed: CSSStyleDeclaration, doc?: Document): Stroke[] {
  const strokes: Stroke[] = [];
  const edgeDefs: Array<{ side: 'top' | 'right' | 'bottom' | 'left'; width: string; style: string; color: string }> = [
    { side: 'top', width: computed.borderTopWidth, style: computed.borderTopStyle, color: computed.borderTopColor },
    { side: 'right', width: computed.borderRightWidth, style: computed.borderRightStyle, color: computed.borderRightColor },
    { side: 'bottom', width: computed.borderBottomWidth, style: computed.borderBottomStyle, color: computed.borderBottomColor },
    { side: 'left', width: computed.borderLeftWidth, style: computed.borderLeftStyle, color: computed.borderLeftColor },
  ];
  const validEdges = edgeDefs
    .map((e) => {
      const w = Math.max(0, parseFloat(e.width) || 0);
      const c = normalizeCssColor(e.color, doc);
      const ok = w > 0 && e.style && e.style !== 'none' && c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)';
      const st: 'solid' | 'dashed' | 'dotted' = e.style === 'dashed' || e.style === 'dotted' ? e.style : 'solid';
      return ok ? { side: e.side, width: w, style: st, color: c } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (validEdges.length === 4 && validEdges.every((e) => e.width === validEdges[0].width && e.color === validEdges[0].color && e.style === validEdges[0].style)) {
    strokes.push({ color: validEdges[0].color, width: validEdges[0].width, style: validEdges[0].style, side: 'all' });
  } else if (validEdges.length > 0) {
    for (const e of validEdges) strokes.push({ color: e.color, width: e.width, style: e.style, side: e.side });
  }
  if (strokes.length === 0) {
    const ow = Math.max(0, parseFloat(computed.outlineWidth) || 0);
    const os = computed.outlineStyle;
    const oc = normalizeCssColor(computed.outlineColor, doc);
    if (ow > 0 && os && os !== 'none' && os !== 'auto' && oc && oc !== 'transparent' && oc !== 'rgba(0, 0, 0, 0)') {
      const ost: 'solid' | 'dashed' | 'dotted' = os === 'dashed' || os === 'dotted' ? os : 'solid';
      strokes.push({ color: oc, width: ow, style: ost, side: 'all', offset: parseFloat(computed.outlineOffset) || 0 });
    }
  }
  return strokes;
}
function extractPseudoElement(
  el: Element,
  pseudo: '::before' | '::after',
  parentBox: { x: number; y: number; w: number; h: number },
  defaultView: Window & typeof globalThis,
  parentId: string,
  nextNodeId: () => string,
  hostChain: Affine | null = null,
  frameOrigin = { originX: 0, originY: 0 }
): Node[] | null {
  try {
    const computed = defaultView.getComputedStyle(el, pseudo);
    if (!computed || computed.display === 'none' || computed.visibility === 'hidden') {
      return null;
    }

    const contentRaw = computed.content;
    if (!contentRaw || contentRaw === 'none' || contentRaw === 'normal') {
      return null;
    }

    const cleanContent = contentRaw.replace(/^["']|["']$/g, '').trim();

    const doc = el.ownerDocument ?? undefined;
    const bg = normalizeCssColor(computed.backgroundColor, doc);
    const hasBg = Boolean(bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)');
    const gradients = parseCssGradients(
      computed.backgroundImage,
      computed.backgroundSize,
      computed.backgroundPosition,
      computed.backgroundRepeat,
      doc
    );
    const strokes = parseStrokes(computed, doc);
    const radius = parseCornerRadius(computed);
    const shadows = parseBoxShadow(computed.boxShadow, doc);
    const opacity = Math.max(0, Math.min(1, parseFloat(computed.opacity) || 1));
    const fidelity = extractFidelityStyle(computed);

    // getComputedStyle on a pseudo reports the CONTENT box for `width`, and
    // `*` does not match pseudos — so box-sizing is typically content-box.
    // Convert to the painted border box via padding + border either way.
    const num = (v: string | undefined): number => Math.max(0, parseFloat(v ?? "") || 0);
    const padL = num(computed.paddingLeft);
    const padT = num(computed.paddingTop);
    const padR = num(computed.paddingRight);
    const padB = num(computed.paddingBottom);
    const bdL = num(computed.borderLeftWidth);
    const bdT = num(computed.borderTopWidth);
    const bdR = num(computed.borderRightWidth);
    const bdB = num(computed.borderBottomWidth);
    const contentW = num(computed.width) || Math.max(1, parentBox.w);
    const contentH = num(computed.height) || Math.max(1, parentBox.h);
    const widthUnderBox = computed.boxSizing === 'border-box';
    // content-box: border box = content + padding + border; border-box: already included.
    const borderW = widthUnderBox ? contentW : contentW + padL + padR + bdL + bdR;
    const borderH = widthUnderBox ? contentH : contentH + padT + padB + bdT + bdB;

    const fills: Fill[] = [
      ...(hasBg ? [{ type: 'solid' as const, color: bg, opacity: 1 }] : []),
      ...gradients,
    ];
    const isVisibleShape = (fills.length > 0 || strokes.length > 0) && borderW > 0 && borderH > 0;
    if (!cleanContent && !isVisibleShape) {
      return null;
    }

    // Parent metrics: abs pseudos position against the containing block's
    // PADDING box (border box + border); static ones start at the content box.
    const pc = defaultView.getComputedStyle(el);
    const pBdL = num(pc.borderLeftWidth);
    const pBdT = num(pc.borderTopWidth);
    const pBdB = num(pc.borderBottomWidth);
    const pPadL = num(pc.paddingLeft);
    const pPadT = num(pc.paddingTop);
    const pPadB = num(pc.paddingBottom);
    const pContentW = Math.max(1, parentBox.w - pBdL - num(pc.borderRightWidth) - pPadL - num(pc.paddingRight));

    const topVal = parseFloat(computed.top);
    const bottomVal = parseFloat(computed.bottom);
    const leftVal = parseFloat(computed.left);
    const rightVal = parseFloat(computed.right);
    const isAbsolute = computed.position === 'absolute' || computed.position === 'fixed';

    let x: number;
    let y: number;
    if (isAbsolute) {
      // Used values come back as px for positioned pseudos; `auto` needs the
      // opposite inset (right/bottom) resolved against the containing block.
      x = Number.isNaN(leftVal)
        ? parentBox.x + pBdL + pContentW - (Number.isNaN(rightVal) ? 0 : rightVal) - borderW
        : parentBox.x + pBdL + leftVal;
      y = Number.isNaN(topVal)
        ? (Number.isNaN(bottomVal) ? parentBox.y + pBdT : parentBox.y + parentBox.h - pBdB - bottomVal - borderH)
        : parentBox.y + pBdT + topVal;
    } else {
      x = parentBox.x + pBdL + pPadL;
      y =
        pseudo === '::after'
          ? parentBox.y + pBdT + pPadT + (parentBox.h - pBdT - pBdB - pPadT - pPadB) - borderH
          : parentBox.y + pBdT + pPadT;
    }

    const box = { x, y, w: borderW, h: borderH };
    // Text sits inside the padding; compose host chain with the pseudo's own
    // transform once, rebase per node box (renderer is a flat canvas).
    const textBox = {
      x: x + bdL + padL,
      y: y + bdT + padT,
      w: Math.max(1, contentW),
      h: Math.max(1, contentH),
    };
    const own = parseTransformMatrix(fidelity.transform);
    const docX = x + frameOrigin.originX;
    const docY = y + frameOrigin.originY;
    let composed: Affine | null = null;
    if (own && hostChain) {
      const origin = resolveOrigin(fidelity.transformOrigin, borderW, borderH);
      composed = affineCompose(hostChain, affineAbout(own, docX + origin.x, docY + origin.y));
    } else if (hostChain) {
      composed = hostChain;
    } else if (own) {
      const origin = resolveOrigin(fidelity.transformOrigin, borderW, borderH);
      composed = affineAbout(own, docX + origin.x, docY + origin.y);
    }
    const applyFold = (
      nodeStyle: { transform?: string; transformOrigin?: string },
      b: { x: number; y: number }
    ): void => {
      if (composed && !isIdentity(composed)) {
        nodeStyle.transform = emitMatrix(composed, b.x + frameOrigin.originX, b.y + frameOrigin.originY);
        nodeStyle.transformOrigin = '0 0';
      }
    };

    const out: Node[] = [];
    let pillId = parentId;

    if (isVisibleShape) {
      const pillStyle = { fills, strokes, opacity, radius, shadows, clip: false, ...fidelity };
      applyFold(pillStyle, box);
      pillId = nextNodeId();
      out.push({ id: pillId, parentId, type: 'rect', box, style: pillStyle });
    }

    if (cleanContent.length > 0) {
      const fontSize = parseFloat(computed.fontSize) || 14;
      const lineHeightValue = parseFloat(computed.lineHeight);
      // 'normal' is legal in TextProps — pass it through; faking fontSize*1.2
      // shifts the baseline ~1px vs Chrome's real normal metric.
      const lineHeight: number | string = Number.isNaN(lineHeightValue) ? 'normal' : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue) ? 0 : letterSpacingValue;
      const textStyle = {
        fills: [],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        shadows: [],
        clip: false,
      } as { fills: never[]; strokes: never[]; opacity: number; radius: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }; shadows: never[]; clip: boolean; transform?: string; transformOrigin?: string };
      applyFold(textStyle, textBox);
      out.push({
        id: nextNodeId(),
        parentId: pillId,
        type: 'text',
        box: textBox,
        style: textStyle,
        text: {
          content: cleanContent,
          fontFamily: computed.fontFamily || 'system-ui, sans-serif',
          fontSize,
          fontWeight: computed.fontWeight || 400,
          lineHeight,
          letterSpacing,
          align: parseTextAlign(computed.textAlign),
          color: normalizeCssColor(computed.color || 'rgba(0, 0, 0, 1)', doc),
          ...extractTextFidelity(computed),
        },
      });
    }

    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
interface MeasuredTextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function measureWrappedLines(
  doc: Document,
  textNode: globalThis.Node,
  fullStr: string,
  fontSize: number,
  scrollX: number,
  scrollY: number,
  originX: number,
  originY: number,
  preserveWs = false
): { lines: MeasuredTextLine[]; measuredCalls: number } {
  const range = doc.createRange();
  const leadTrim = preserveWs ? 0 : fullStr.length - fullStr.trimStart().length;
  const trailTrim = preserveWs ? fullStr.length : fullStr.trimEnd().length;
  if (leadTrim > 0 || trailTrim < fullStr.length) {
    if (leadTrim >= trailTrim) return { lines: [], measuredCalls: 0 };
    range.setStart(textNode, leadTrim);
    range.setEnd(textNode, trailTrim);
  } else {
    range.selectNodeContents(textNode);
  }
  const rawRects = range.getClientRects?.();
  if (!rawRects || rawRects.length <= 1) return { lines: [], measuredCalls: 0 };

  const lineRects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  for (let i = 0; i < rawRects.length; i++) {
    const r = rawRects[i];
    if (r.width === 0 && r.height === 0) continue;
    const prev = lineRects[lineRects.length - 1];
    if (prev && Math.abs(r.top - prev.top) <= fontSize * 0.4) {
      prev.left = Math.min(prev.left, r.left);
      prev.top = Math.min(prev.top, r.top);
      prev.right = Math.max(prev.right, r.right);
      prev.bottom = Math.max(prev.bottom, r.bottom);
    } else {
      lineRects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  if (lineRects.length <= 1) return { lines: [], measuredCalls: 0 };

  const probe = doc.createRange();
  let measuredCalls = 0;
  const hasClientRects = typeof probe.getClientRects === 'function';
  const spillsPastLine = (start: number, end: number, lineTop: number): boolean => {
    probe.setStart(textNode, start);
    probe.setEnd(textNode, end);
    measuredCalls++;
    if (hasClientRects) {
      const rects = probe.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if ((r.width > 0 || r.height > 0) && r.top - lineTop > fontSize * 0.4) return true;
      }
      return false;
    }
    const r = probe.getBoundingClientRect();
    return (r.width > 0 || r.height > 0) && r.top - lineTop > fontSize * 0.4;
  };

  const lines: MeasuredTextLine[] = [];
  let start = leadTrim;
  const maxEnd = trailTrim;
  for (let li = 0; li < lineRects.length; li++) {
    const lr = lineRects[li];
    let end = maxEnd;
    if (li < lineRects.length - 1 && start < maxEnd) {
      let lo = start + 1;
      let hi = maxEnd;
      let best = start;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (spillsPastLine(start, mid, lr.top)) {
          hi = mid - 1;
        } else {
          best = mid;
          lo = mid + 1;
        }
      }
      end = best;
    }
    const rawSlice = fullStr.slice(start, end);
    const text = preserveWs ? rawSlice.replace(/[\r\n]+/g, '') : rawSlice.trim();
    if (text) {
      lines.push({
        text,
        x: lr.left + scrollX - originX,
        y: lr.top + scrollY - originY,
        w: lr.right - lr.left + 2,
        h: lr.bottom - lr.top,
      });
    }
    start = end;
  }
  return { lines, measuredCalls };
}

function normalizeFontFamily(raw: string): string {
  return raw.replace(/^["']|["']$/g, '').trim().toLowerCase();
}

function normalizeFontWeight(raw: string | number | undefined): string {
  const s = String(raw ?? '400').trim().toLowerCase();
  if (s === 'normal') return '400';
  if (s === 'bold') return '700';
  return s || '400';
}

/**
 * Return true when an embedded font face matches the requested family, style, and numeric weight (or range).
 */
export function doesFontFaceCover(
  face: Font,
  family: string,
  weight: string | number | undefined,
  style: string | undefined
): boolean {
  const isEmbedded = face.embedded === true || (Boolean(face.assetRef) && face.embedded !== false);
  if (!isEmbedded) return false;
  const primaryFamily = (family || '').split(',')[0] ?? '';
  if (normalizeFontFamily(face.family) !== normalizeFontFamily(primaryFamily)) return false;
  const faceStyle = (face.style || 'normal').trim().toLowerCase();
  const targetStyle = (style || 'normal').trim().toLowerCase();
  if (faceStyle !== targetStyle) return false;
  const targetWeight = parseFloat(normalizeFontWeight(weight));
  if (!Number.isFinite(targetWeight)) return false;
  const rawRange = normalizeFontWeight(face.weight);
  const parts = rawRange.split(/\s+/).map((p) => parseFloat(p)).filter(Number.isFinite);
  if (parts.length >= 2) {
    const minW = Math.min(parts[0], parts[1]);
    const maxW = Math.max(parts[0], parts[1]);
    return targetWeight >= minW && targetWeight <= maxW;
  }
  if (parts.length === 1) return parts[0] === targetWeight;
  return false;
}

/**
 * Check unembedded/declared font faces against text nodes and emit one `font_missing` diagnostic per missing family,
 * recording `embedded: false` and `fallbackStack` on unembedded entries.
 */
export function reconcileMissingFonts(
  nodes: Node[],
  fonts: Font[],
  report: ReportDiagnostic
): void {
  const knownFamilies = new Set<string>();
  for (const f of fonts) {
    knownFamilies.add(normalizeFontFamily(f.family));
  }
  if (knownFamilies.size === 0) return;

  const missingByFamily = new Map<string, { family: string; weight: string; style: string; fallback: string; nodeId: string }>();
  for (const n of nodes) {
    if (!n.text) continue;
    const parts = n.text.fontFamily.split(',').map((p) => p.replace(/['"]/g, '').trim()).filter(Boolean);
    const primary = parts[0];
    if (!primary) continue;
    const normPrimary = normalizeFontFamily(primary);
    if (!knownFamilies.has(normPrimary)) continue;
    const targetWeight = normalizeFontWeight(n.text.fontWeight);
    const targetStyle = n.text.italic ? 'italic' : 'normal';
    const covered = fonts.some((f) => doesFontFaceCover(f, primary, targetWeight, targetStyle));
    if (covered) continue;
    if (!missingByFamily.has(normPrimary)) {
      missingByFamily.set(normPrimary, {
        family: primary,
        weight: targetWeight,
        style: targetStyle,
        fallback: n.text.fontFamily || parts.join(', ') || 'system-ui',
        nodeId: n.id,
      });
    }
  }

  for (const f of fonts) {
    if (f.embedded === true || (f.assetRef && f.embedded !== false)) continue;
    f.embedded = false;
    const miss = missingByFamily.get(normalizeFontFamily(f.family));
    if (miss && !f.fallbackStack) {
      f.fallbackStack = miss.fallback;
    }
  }

  for (const [normFam, miss] of missingByFamily.entries()) {
    const hasUnembeddedEntry = fonts.some(
      (f) =>
        normalizeFontFamily(f.family) === normFam &&
        normalizeFontWeight(f.weight) === miss.weight &&
        (f.style || 'normal').trim().toLowerCase() === miss.style &&
        f.embedded === false
    );
    if (!hasUnembeddedEntry) {
      fonts.push({
        family: miss.family,
        weight: miss.weight,
        style: miss.style,
        embedded: false,
        fallbackStack: miss.fallback,
      });
    }
    warning(
      report,
      'font_missing',
      `Font face ${miss.family} (${miss.weight} ${miss.style}) could not be embedded; fallback: ${miss.fallback}`,
      miss.nodeId
    );
  }
}

async function extractWebFonts(
  doc: Document,
  baseURI: string,
  assets: Record<string, Asset>,
  nextAssetId: () => string,
  report: ReportDiagnostic,
  deadline: number,
  usedFamilies?: Set<string>,
  usedFaces?: Set<string>,
  concurrency = 8
): Promise<Font[]> {
  const fonts: Font[] = [];
  const seenFamilies = new Set<string>();
  const loadedFaces = new Set<string>();
  const loadedFamilies = new Set<string>();
  const defaultView = doc.defaultView ?? window;

  // 1. Inspect doc.fonts (FontFaceSet API)
  if (doc.fonts && typeof doc.fonts.forEach === 'function') {
    try {
      doc.fonts.forEach((fontFace: FontFace) => {
        const family = fontFace.family.replace(/^["']|["']$/g, '').trim();
        if (!family) return;
        const isLoaded = fontFace.status === undefined || fontFace.status === 'loaded';
        if (isLoaded) {
          const normFam = normalizeFontFamily(family);
          const normWeight = normalizeFontWeight(fontFace.weight);
          const normStyle = (fontFace.style || 'normal').trim().toLowerCase();
          loadedFamilies.add(normFam);
          loadedFaces.add(`${normFam}|${normWeight}|${normStyle}`);
        }
        if (!seenFamilies.has(family)) {
          seenFamilies.add(family);
          fonts.push({
            family,
            weight: fontFace.weight || '400',
            style: fontFace.style || 'normal',
          });
        }
      });
    } catch {
      warning(report, 'asset_unavailable', 'Loaded font metadata could not be inspected.');
    }
  }

  // 2. Inspect CSSStyleSheets for @font-face rules, embedding only loaded & used faces in parallel.
  const pendingFetches: Array<{
    family: string;
    weight: string;
    fontStyle: string;
    stretch?: string;
    unicodeRange?: string;
    fontUrl: string;
    resolvedHref: string;
    fontIdentity: string;
  }> = [];
  const urlToAssetKey = new Map<string, string>();

  try {
    const styleSheets = doc.styleSheets;
    if (styleSheets) {
      for (let i = 0; i < styleSheets.length; i++) {
        const sheet = styleSheets[i];
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          warning(report, 'asset_unavailable', 'A stylesheet could not be inspected for embedded font assets.');
          continue;
        }
        if (!rules) continue;

        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j];
          if (rule.type !== 5) continue;
          const fontRule = rule as CSSFontFaceRule;
          const style = fontRule.style;
          if (!style) continue;

          const family = (style.fontFamily || '').replace(/^["']|["']$/g, '').trim();
          if (!family) continue;

          const weight = style.fontWeight || '400';
          const fontStyle = style.fontStyle || 'normal';
          const rawStretch = style.fontStretch || (typeof style.getPropertyValue === 'function' ? style.getPropertyValue('font-stretch') : '');
          const stretch = rawStretch && rawStretch !== 'normal' ? rawStretch.trim() : undefined;
          const rawUnicodeRange = typeof style.getPropertyValue === 'function' ? style.getPropertyValue('unicode-range') : '';
          const unicodeRange = rawUnicodeRange && rawUnicodeRange.toUpperCase() !== 'U+0-10FFFF' ? rawUnicodeRange.trim() : undefined;
          const normFam = normalizeFontFamily(family);
          const normWeight = normalizeFontWeight(weight);
          const normStyle = fontStyle.trim().toLowerCase();
          const faceKey = `${normFam}|${normWeight}|${normStyle}`;

          if (usedFamilies && usedFamilies.size > 0 && !usedFamilies.has(normFam)) continue;
          if (loadedFaces.size > 0) {
            const isRangeWeight = normWeight.includes(' ');
            const isLoaded = isRangeWeight ? loadedFamilies.has(normFam) : loadedFaces.has(faceKey);
            if (!isLoaded) continue;
            if (usedFaces && usedFaces.size > 0 && !isRangeWeight && !usedFaces.has(faceKey)) continue;
          }

          const fontIdentity = `${family}|${weight}|${fontStyle}|${unicodeRange ?? ''}`;
          if (seenFamilies.has(fontIdentity)) continue;

          const srcDeclaration = typeof style.getPropertyValue === 'function' ? style.getPropertyValue('src') : '';
          const match = srcDeclaration.match(/url\(\s*['"]?(.*?)['"]?\s*\)/);
          if (!match || !match[1]) {
            seenFamilies.add(fontIdentity);
            fonts.push({ family, weight, style: fontStyle, ...(stretch ? { stretch } : {}), ...(unicodeRange ? { unicodeRange } : {}), embedded: false });
            continue;
          }

          const fontUrl = match[1];
          if (fontUrl.startsWith('data:')) {
            const existingKey = urlToAssetKey.get(fontUrl);
            if (existingKey) {
              seenFamilies.add(fontIdentity);
              fonts.push({ family, weight, style: fontStyle, ...(stretch ? { stretch } : {}), ...(unicodeRange ? { unicodeRange } : {}), assetRef: existingKey, embedded: true });
            } else {
              const dataMatch = fontUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (dataMatch) {
                const assetKey = nextAssetId();
                assets[assetKey] = { kind: 'font', mimeType: dataMatch[1], base64: dataMatch[2] };
                urlToAssetKey.set(fontUrl, assetKey);
                seenFamilies.add(fontIdentity);
                fonts.push({ family, weight, style: fontStyle, ...(stretch ? { stretch } : {}), ...(unicodeRange ? { unicodeRange } : {}), assetRef: assetKey, embedded: true });
              } else {
                warning(report, 'asset_failed', `Font data could not be read: ${family}`);
                seenFamilies.add(fontIdentity);
                fonts.push({ family, weight, style: fontStyle, ...(stretch ? { stretch } : {}), ...(unicodeRange ? { unicodeRange } : {}), embedded: false });
              }
            }
            continue;
          }

          try {
            const resolved = new URL(fontUrl, baseURI);
            const isSameOrigin = resolved.origin === defaultView.location?.origin;
            const rawChrome: unknown = defaultView && 'chrome' in defaultView ? defaultView.chrome : undefined;
            const runtime = rawChrome && typeof rawChrome === 'object' && 'runtime' in rawChrome ? rawChrome.runtime : undefined;
            const hasRuntime = Boolean(runtime && typeof runtime === 'object' && 'sendMessage' in runtime && typeof runtime.sendMessage === 'function');
            if (isSameOrigin || resolved.protocol === 'blob:' || hasRuntime) {
              seenFamilies.add(fontIdentity);
              pendingFetches.push({ family, weight, fontStyle, stretch, unicodeRange, fontUrl, resolvedHref: resolved.href, fontIdentity });
            } else {
              warning(report, 'asset_unavailable', `Cross-origin font bytes were not embedded: ${resolved.href}`);
              seenFamilies.add(fontIdentity);
              fonts.push({ family, weight, style: fontStyle, ...(stretch ? { stretch } : {}), ...(unicodeRange ? { unicodeRange } : {}), embedded: false });
            }
          } catch {
            warning(report, 'asset_failed', `Font asset could not be embedded: ${family} (${fontUrl})`);
            seenFamilies.add(fontIdentity);
            fonts.push({ family, weight, style: fontStyle, ...(stretch ? { stretch } : {}), ...(unicodeRange ? { unicodeRange } : {}), embedded: false });
          }
        }
      }
    }
  } catch {
    warning(report, 'asset_unavailable', 'Stylesheets could not be inspected for font assets.');
  }

  // Dedupe URLs and fetch in bounded parallel batches under the shared deadline.
  const uniqueUrls = Array.from(new Set(pendingFetches.map((f) => f.resolvedHref)));
  let nextUrlIdx = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), uniqueUrls.length) }, async () => {
    while (nextUrlIdx < uniqueUrls.length) {
      const href = uniqueUrls[nextUrlIdx++];
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new CaptureTimeout('Font asset budget exhausted');
        const blob = await fetchAssetBlob(href, remaining);
        const rem2 = deadline - Date.now();
        if (rem2 <= 0) throw new CaptureTimeout('Font asset budget exhausted');
        const buffer = await withTimeout(blob.arrayBuffer(), rem2);
        const base64 = await arrayBufferToBase64(buffer);
        const assetKey = nextAssetId();
        assets[assetKey] = { kind: 'font', mimeType: blob.type || 'font/woff2', base64 };
        urlToAssetKey.set(href, assetKey);
      } catch (error) {
        let fetchedViaBridge = false;
        const rawChrome: unknown = defaultView && 'chrome' in defaultView ? defaultView.chrome : undefined;
        const runtime = rawChrome && typeof rawChrome === 'object' && 'runtime' in rawChrome ? rawChrome.runtime : undefined;
        if (runtime && typeof runtime === 'object' && 'sendMessage' in runtime && typeof runtime.sendMessage === 'function') {
          try {
            const rem = Math.max(250, deadline - Date.now());
            const bg = (await withTimeout(
              Promise.resolve((runtime.sendMessage as (m: unknown) => Promise<unknown>)({ action: 'fetch-asset', url: href })),
              rem
            )) as { success?: boolean; mimeType?: string; base64?: string } | undefined;
            if (bg?.success && bg.base64) {
              const assetKey = nextAssetId();
              assets[assetKey] = { kind: 'font', mimeType: bg.mimeType || 'font/woff2', base64: bg.base64 };
              urlToAssetKey.set(href, assetKey);
              fetchedViaBridge = true;
            }
          } catch {
            // fall through to warning
          }
        }
        if (!fetchedViaBridge) {
          const sample = pendingFetches.find((f) => f.resolvedHref === href);
          warning(report, error instanceof CaptureTimeout ? 'asset_timeout' : 'asset_failed',
            `Font asset could not be embedded: ${sample?.family ?? href} (${sample?.fontUrl ?? href})`);
        }
      }
    }
  }));

  for (const item of pendingFetches) {
    const assetRef = urlToAssetKey.get(item.resolvedHref);
    fonts.push({
      family: item.family,
      weight: item.weight,
      style: item.fontStyle,
      ...(item.stretch ? { stretch: item.stretch } : {}),
      ...(item.unicodeRange ? { unicodeRange: item.unicodeRange } : {}),
      ...(assetRef ? { assetRef, embedded: true } : { embedded: false }),
    });
  }

  return fonts;
}


export interface TranscodeStats {
  toJpeg: number;
  toPng: number;
  downscaled: number;
}

function hasBitmapAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  const totalPixels = width * height;
  const step = totalPixels <= 1_000_000 ? 1 : Math.max(1, Math.ceil(totalPixels / 250_000));
  for (let i = 0; i < totalPixels; i += step) {
    if (data[i * 4 + 3] < 255) return true;
  }
  return false;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Transcode rasters that vector importers reject (webp/avif/bmp) and downscale
 * oversized rasters for Figma/Sketch destinations. Opaque rasters encode as
 * JPEG (0.9); images with alpha encode as PNG. Returns null when the original
 * bytes should be kept as-is.
 */
export async function transcodeForDestinations(
  blob: Blob,
  report: ReportDiagnostic,
  nodeId: string,
  timeoutMs: number,
  options?: { maxWidth?: number; stats?: TranscodeStats }
): Promise<Blob | null> {
  const t = (blob.type || '').toLowerCase();
  if (t === 'image/svg+xml' || t === 'image/gif') return null;
  const needsFormatTranscode = t !== 'image/png' && t !== 'image/jpeg';
  const maxW = Math.max(1, Math.min(4096, Math.round(options?.maxWidth ?? 4096)));
  if (!needsFormatTranscode && blob.size <= 100_000 && maxW >= 4096) return null;

  let bitmap: ImageBitmap | undefined;
  let expired = false;
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      if (!needsFormatTranscode) return null;
      throw new Error('Image conversion is unavailable');
    }
    const decoded = await withTimeout(createImageBitmap(blob).then((value) => {
      if (expired) value.close();
      return value;
    }), timeoutMs);
    bitmap = decoded;

    const oversized = decoded.width > maxW;
    if (!needsFormatTranscode && !oversized) return null;

    const scale = oversized ? maxW / decoded.width : 1;
    const targetW = Math.max(1, Math.round(decoded.width * scale));
    const targetH = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable');
    ctx.drawImage(decoded, 0, 0, targetW, targetH);

    const alpha = t === 'image/jpeg' ? false : hasBitmapAlpha(ctx, targetW, targetH);
    const outMime = alpha ? 'image/png' : 'image/jpeg';
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, outMime, alpha ? undefined : 0.9);
    const out = await withTimeout(promise, timeoutMs);
    if (!out) throw new Error('Canvas returned no image bytes');
    if (options?.stats) {
      if (alpha) options.stats.toPng++;
      else options.stats.toJpeg++;
      if (oversized) options.stats.downscaled++;
    }
    return out;
  } catch (error) {
    expired = true;
    if (!needsFormatTranscode) return null;
    warning(report, error instanceof CaptureTimeout ? 'asset_timeout' : 'asset_unavailable',
      `Image could not be transcoded; original ${t || 'unknown-format'} bytes were retained.`, nodeId);
    return null;
  } finally {
    bitmap?.close();
  }
}

async function serializeSubtree(
  root: Element,
  doc: Document,
  frameRect: { originX: number; originY: number; width: number; height: number },
  opts?: SerializeOptions,
  diagnostics: CaptureDiagnostic[] = [],
  timingCtx?: TimingContext,
  fontDeadline?: number,
  readinessDeadline = Date.now() + boundedNumber(opts?.readinessBudgetMs, 4000)
): Promise<Capture> {
  const report: ReportDiagnostic = (diagnostic) => diagnostics.push(diagnostic);
  const assetTimeoutMs = boundedNumber(opts?.assetTimeoutMs, 2500);
  const defaultView = doc.defaultView ?? window;
  const scrollX = defaultView.scrollX ?? 0;
  const scrollY = defaultView.scrollY ?? 0;

  const baseURI = opts?.baseURI || doc.baseURI || defaultView.location?.href || 'about:blank';

  let rootBackground: string | undefined;
  try {
    for (const rootEl of [doc.documentElement, doc.body]) {
      if (!rootEl) continue;
      const rootBg = normalizeCssColor(defaultView.getComputedStyle(rootEl).backgroundColor, doc);
      if (rootBg && rootBg !== 'transparent' && rootBg !== 'rgba(0, 0, 0, 0)') {
        rootBackground = rootBg;
        break;
      }
    }
  } catch {
    // ignore
  }

  const capture = emptyCapture({
    url: defaultView.location?.href || baseURI,
    version: '0.2.2',
    frame: {
      width: Math.max(1, Math.round(frameRect.width)),
      height: Math.max(1, Math.round(frameRect.height)),
      baseURI,
      ...(rootBackground ? { background: rootBackground } : {}),
    },
  });

  const nodes: Node[] = [];
  const assets: Record<string, Asset> = {};
  let nextNodeId = 1;
  let nextAssetId = 1;

  const elementToIdMap = new Map<Element, string>();
  const urlToAssetKeyCache = new Map<string, string>();
  const dpr = Math.max(1, defaultView.devicePixelRatio || 1);
  const maxWidthForBox = (boxW: number): number =>
    Math.min(4096, Math.max(1, Math.round(boxW * 2 * dpr)));
  const transcodeStats: TranscodeStats = { toJpeg: 0, toPng: 0, downscaled: 0 };
  const pendingAssetFetches: Array<{ url: string; assetKey: string; nodeId: string; maxWidth?: number }> = [];
  let fetchBridgeMs = 0;
  const assetConcurrency = Math.floor(boundedNumber(opts?.assetConcurrency, 8, 1));
  let nextFetch = 0;
  let activeAssetWorkers = 0;
  let assetsFetched = 0;
  let assetsFailed = 0;
  let assetsTimedOut = 0;
  let assetBytes = 0;
  let assetsStart = 0;
  let assetsEnd = 0;
  const sendRuntimeMessage = getRuntimeSendMessage(defaultView);
  const hasRuntimeBridge = sendRuntimeMessage !== null;

  const activeAssetPromises: Promise<void>[] = [];
  const runAssetWorker = async () => {
    try {
      while (nextFetch < pendingAssetFetches.length) {
        const { url, assetKey, nodeId, maxWidth } = pendingAssetFetches[nextFetch++];
        const budgetMs = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
        let failure: unknown;
        try {
          if (budgetMs <= 0) throw new CaptureTimeout('Readiness budget exhausted');
          const blob = await fetchAssetBlob(url, budgetMs);
          const rem1 = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
          const transcoded = await transcodeForDestinations(blob, report, nodeId, rem1, { maxWidth, stats: transcodeStats });
          const finalBlob = transcoded ?? blob;
          const rem2 = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
          const buffer = await withTimeout(finalBlob.arrayBuffer(), rem2);
          const base64 = await arrayBufferToBase64(buffer);
          assets[assetKey] = { kind: 'image', mimeType: finalBlob.type || 'image/png', base64 };
          assetsFetched++;
          assetBytes += buffer.byteLength;
        } catch (error) {
          failure = error;
          if (sendRuntimeMessage) {
            try {
              const remBg = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
              if (remBg <= 0) throw new CaptureTimeout('Readiness budget exhausted');
              const fbStart = nowMs();
              const bg = (await withTimeout(sendRuntimeMessage({ action: 'fetch-asset', url, maxWidth }), remBg)) as { success?: boolean; mimeType?: string; base64?: string } | undefined;
              fetchBridgeMs += nowMs() - fbStart;
              if (bg?.success && bg.base64) {
                let mimeType = bg.mimeType || 'image/png';
                let base64 = bg.base64;
                const rawBytes = base64ToUint8Array(base64);
                let byteLen = rawBytes.byteLength;
                const bgBlob = new Blob([rawBytes.slice().buffer], { type: mimeType });
                const remT = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
                const transcoded = await transcodeForDestinations(bgBlob, report, nodeId, remT, { maxWidth, stats: transcodeStats });
                if (transcoded) {
                  const tBuf = await withTimeout(transcoded.arrayBuffer(), Math.max(250, readinessDeadline - Date.now()));
                  base64 = await arrayBufferToBase64(tBuf);
                  mimeType = transcoded.type || mimeType;
                  byteLen = tBuf.byteLength;
                }
                assets[assetKey] = { kind: 'image', mimeType, base64 };
                assetsFetched++;
                assetBytes += byteLen;
              }
            } catch (bridgeError) {
              failure = bridgeError;
            }
          }
        }
        if (!assets[assetKey]) {
          if (failure instanceof CaptureTimeout) assetsTimedOut++;
          else assetsFailed++;
          warning(report, failure instanceof CaptureTimeout ? 'asset_timeout' : 'asset_failed',
            `Image asset could not be embedded: ${url}${failure instanceof Error ? ` (${failure.message})` : ''}`, nodeId);
        }
      }
    } finally {
      activeAssetWorkers--;
      assetsEnd = nowMs();
    }
  };

  const pendingRectCaptures: Array<{
    box: { x: number; y: number; w: number; h: number };
    assetKey: string;
    nodeId: string;
    reason: string;
  }> = [];
  let skippedRasterCount = 0;
  const docScrollW = Math.max(frameRect.width, doc.documentElement?.scrollWidth ?? 0, doc.body?.scrollWidth ?? 0);
  const docScrollH = Math.max(frameRect.height, doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
  const enqueueRectCapture = (item: {
    box: { x: number; y: number; w: number; h: number };
    assetKey: string;
    nodeId: string;
    reason: string;
    invisible?: boolean;
  }) => {
    const { box, invisible } = item;
    if (
      invisible ||
      !(box.w > 0 && box.h > 0) ||
      box.x + box.w <= 0 ||
      box.y + box.h <= 0 ||
      box.x >= docScrollW ||
      box.y >= docScrollH
    ) {
      skippedRasterCount++;
      return;
    }
    pendingRectCaptures.push({ box: item.box, assetKey: item.assetKey, nodeId: item.nodeId, reason: item.reason });
  };
  const pendingSvgImageInlines: Array<{
    assetKey: string;
    urls: Array<{ raw: string; resolved: string }>;
    nodeId: string;
  }> = [];

  const enqueueAssetFetch = (item: { url: string; assetKey: string; nodeId: string; maxWidth?: number }) => {
    if (!assetsStart) assetsStart = nowMs();
    pendingAssetFetches.push(item);
    if (activeAssetWorkers < assetConcurrency) {
      activeAssetWorkers++;
      activeAssetPromises.push(runAssetWorker());
    }
  };
  const hiddenAncestors = new Set<Element>();

  const elements: Element[] = [];
  const showElementFilter = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1;

  // Walk light DOM first; the loop then grows as shadow subtrees are appended,
  // so nested shadow roots are picked up by the same pass.
  const getEffectiveZIndex = (el: Element): number => {
    try {
      const cs = defaultView.getComputedStyle(el);
      if (!cs) return 0;
      const z = parseInt(cs.zIndex, 10);
      return Number.isNaN(z) ? 0 : z;
    } catch {
      return 0;
    }
  };

  const walkInto = (currRoot: Element | ShadowRoot): void => {
    const visit = (el: Element): void => {
      const tag = el.tagName.toLowerCase();
      if (IGNORED_TAGS[tag]) return;
      elements.push(el);
      if (tag === 'svg') return;

      const children = Array.from(el.children);
      if (children.length > 1) {
        const withZ = children.map((c, idx) => ({ c, idx, z: getEffectiveZIndex(c) }));
        withZ.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.idx - b.idx));
        for (const item of withZ) visit(item.c);
      } else if (children.length === 1) {
        visit(children[0]);
      }
    };

    if ('tagName' in currRoot) {
      visit(currRoot as Element);
    } else {
      const children = Array.from(currRoot.children);
      for (const child of children) visit(child);
    }
  };
  const walkStart = nowMs();
  walkInto(root);
  for (let i = 0; i < elements.length; i++) {
    const sr = (elements[i] as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) walkInto(sr);
  }
  const walkMs = nowMs() - walkStart;

  // Freeze every active transform so all measurement below (element rects,
  // range rects, pseudo boxes) happens in pure layout space. Frozen values
  // are folded back per node as one composed matrix after the walk.
  const measure: MeasureState = {
    transformed: new Set(),
    frozen: new Map(),
    boxes: new Map(),
  };
  const freezeStart = nowMs();
  for (const el of elements) {
    const frozen = freezeTransform(el, defaultView);
    if (frozen) {
      measure.transformed.add(el);
      measure.frozen.set(el, frozen);
    }
  }
  const freezeTransformsMs = nowMs() - freezeStart;
  const chainCache = new Map<Element, { matrix: Affine | null; failed: boolean }>();
  const chainFor = (e: Element): { matrix: Affine | null; failed: boolean } => {
    if (measure.transformed.size === 0) return { matrix: null, failed: false };
    let cached = chainCache.get(e);
    if (!cached) {
      cached = chainMatrix(e, measure, scrollX, scrollY);
      chainCache.set(e, cached);
    }
    return cached;
  };
  // Compose the chain onto a node's stored box → style fragment. When the
  // chain contains a real 3D transform we cannot fold, fall back to the raw
  // CSS transform of the node itself (descendants of 3D containers render at
  // layout position — 2D emit cannot express the ancestor; ponytail: revisit
  // with DOMMatrix if a real target needs it).
  const chainStyle = (
    e: Element,
    docX: number,
    docY: number
  ): { transform?: string; transformOrigin?: string } => {
    if (measure.transformed.size === 0) return {};
    const { matrix, failed } = chainFor(e);
    if (matrix && !isIdentity(matrix)) {
      return { transform: emitMatrix(matrix, docX, docY), transformOrigin: '0 0' };
    }
    if (failed) {
      const f = measure.frozen.get(e);
      const raw = f ? rawTransformCss(f) : null;
      return raw ? { transform: raw } : {};
    }
    return {};
  };

  let textMs = 0;
  let textCharsMeasured = 0;
  const bgClipTextFillsMap = new Map<Element, Fill[]>();
  const resolveInheritedBgClipFills = (el: Element): Fill[] | undefined => {
    let cur: Element | null = el;
    while (cur) {
      const f = bgClipTextFillsMap.get(cur);
      if (f && f.length > 0) return f;
      cur = cur.parentElement;
    }
    return undefined;
  };
  const isTransparentCssColor = (c: string | undefined): boolean => {
    if (!c) return true;
    const norm = c.trim().toLowerCase();
    return norm === 'transparent' || norm === 'rgba(0, 0, 0, 0)' || norm === 'rgba(0,0,0,0)';
  };
  const resolveEffectiveTextColor = (computed: CSSStyleDeclaration, bgClipFills?: Fill[]): string => {
    const wtfc =
      (computed as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor?.trim() ||
      (typeof computed.getPropertyValue === 'function' ? computed.getPropertyValue('-webkit-text-fill-color')?.trim() : '');
    if (bgClipFills && bgClipFills.length > 0) {
      const primaryStop = bgClipFills[0]?.stops?.[0]?.color || bgClipFills[0]?.color;
      if (primaryStop && (isTransparentCssColor(wtfc) || isTransparentCssColor(computed.color))) {
        return normalizeCssColor(primaryStop, doc);
      }
    }
    if (wtfc && !isTransparentCssColor(wtfc) && wtfc.toLowerCase() !== 'currentcolor') {
      return normalizeCssColor(wtfc, doc);
    }
    if (computed.color && !isTransparentCssColor(computed.color)) {
      return normalizeCssColor(computed.color, doc);
    }
    if (bgClipFills && bgClipFills.length > 0) {
      const primaryStop = bgClipFills[0]?.stops?.[0]?.color || bgClipFills[0]?.color;
      if (primaryStop) return normalizeCssColor(primaryStop, doc);
    }
    return normalizeCssColor(computed.color || 'rgba(0, 0, 0, 1)', doc);
  };
  const nodesStart = nowMs();
  try {
  for (const el of elements) {
    if (el.parentElement && hiddenAncestors.has(el.parentElement)) {
      hiddenAncestors.add(el);
      continue;
    }

    const computed = defaultView.getComputedStyle(el);
    if (
      !computed ||
      computed.display === 'none' ||
      computed.visibility === 'hidden' ||
      parseFloat(computed.opacity) <= 0.001
    ) {
      hiddenAncestors.add(el);
      continue;
    }

    const rect = el.getBoundingClientRect();
    const docX = rect.left + scrollX;
    const docY = rect.top + scrollY;
    // Subpixel-precise boxes: rounding to integers shifted text a full pixel
    // off the original whenever a flex/line position was fractional (the
    // fidelity harness caught this as whole-text mismatches).
    const x = docX - frameRect.originX;
    const y = docY - frameRect.originY;
    const w = rect.width;
    const h = rect.height;
    measure.boxes.set(el, { x: docX, y: docY, w: rect.width, h: rect.height });

    if (w <= 0 && h <= 0) {
      continue;
    }

    const isSrOnly =
      w <= 2 &&
      h <= 2 &&
      (computed.overflow === 'hidden' ||
        computed.clip !== 'auto' ||
        (computed.clipPath && computed.clipPath !== 'none'));
    if (isSrOnly) {
      hiddenAncestors.add(el);
      continue;
    }

    const nodeId = `node-${nextNodeId++}`;
    elementToIdMap.set(el, nodeId);
    const rawLabel = (
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      (el.children.length <= 2 ? el.textContent : '') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 28);
    const tagLabelMap: Record<string, string> = {
      nav: 'Nav',
      header: 'Header',
      footer: 'Footer',
      main: 'Main',
      section: 'Section',
      article: 'Article',
      aside: 'Aside',
      button: 'Button',
      a: 'Link',
      input: 'Input',
      select: 'Select',
      textarea: 'Textarea',
      form: 'Form',
      ul: 'List',
      ol: 'List',
      li: 'Item',
      h1: 'H1',
      h2: 'H2',
      h3: 'H3',
      h4: 'H4',
      img: 'Image',
      svg: 'Icon',
    };
    const baseTagLabel = tagLabelMap[el.tagName.toLowerCase()] || (el.id ? `#${el.id.slice(0, 20)}` : '');
    const semanticName = baseTagLabel && rawLabel ? `${baseTagLabel} · ${rawLabel}` : baseTagLabel || (rawLabel ? `Frame · ${rawLabel}` : undefined);

    // Parent ID from nearest mapped ancestor. parentElement chains stop at
    // shadow boundaries, so hop through ShadowRoot.host when exhausted.
    let parentId: string | undefined;
    let parent: Element | null = el.parentElement;
    let rootNode: globalThis.Node | null = el.getRootNode ? el.getRootNode() : null;
    while (!parentId) {
      while (parent) {
        if (elementToIdMap.has(parent)) {
          parentId = elementToIdMap.get(parent);
          break;
        }
        parent = parent.parentElement;
      }
      if (parentId) break;
      const shadowRoot = rootNode as ShadowRoot | null;
      if (shadowRoot && typeof shadowRoot.host === 'object') {
        parent = shadowRoot.host;
        rootNode = typeof parent.getRootNode === 'function' ? parent.getRootNode() : null;
        continue;
      }
      break;
    }

    const fills: Fill[] = [];
    const bg = normalizeCssColor(computed.backgroundColor, doc);
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      fills.push({
        type: 'solid',
        color: bg,
        opacity: 1,
      });
    }

    // CSS background-image resolution
    const bgImageUrl = extractCssUrl(computed.backgroundImage);
    if (bgImageUrl) {
      if (bgImageUrl.startsWith('data:')) {
        const parsed = dataUriToAsset(bgImageUrl);
        if (parsed) {
          const assetKey = `asset-${nextAssetId++}`;
          assets[assetKey] = {
            kind: 'image',
            mimeType: parsed.mimeType,
            base64: parsed.base64,
          };
          fills.push({
            type: 'image',
            assetRef: assetKey,
            opacity: 1,
          });
        } else warning(report, 'asset_failed', 'Background image data could not be read.', nodeId);
      } else {
        try {
          const resolvedUrl = new URL(bgImageUrl, baseURI);
          const isSameOrigin = resolvedUrl.origin === defaultView.location?.origin;
          if (isSameOrigin || resolvedUrl.protocol === 'blob:' || hasRuntimeBridge) {
            const cachedKey = urlToAssetKeyCache.get(resolvedUrl.href);
            if (cachedKey) {
              fills.push({ type: 'image', assetRef: cachedKey, opacity: 1 });
            } else {
              const assetKey = `asset-${nextAssetId++}`;
              urlToAssetKeyCache.set(resolvedUrl.href, assetKey);
              enqueueAssetFetch({ url: resolvedUrl.href, assetKey, nodeId, maxWidth: maxWidthForBox(w) });
              fills.push({ type: 'image', assetRef: assetKey, opacity: 1 });
            }
          } else {
            warning(report, 'asset_unavailable', `Cross-origin background image bytes were not embedded: ${resolvedUrl.href}`, nodeId);
          }
        } catch {
          warning(report, 'asset_failed', `Background image URL could not be resolved: ${bgImageUrl}`, nodeId);
        }
      }
    }
    // CSS gradient resolution
    const gradients = parseCssGradients(
      computed.backgroundImage,
      computed.backgroundSize,
      computed.backgroundPosition,
      computed.backgroundRepeat,
      doc
    );
    fills.push(...gradients);


    const strokes = parseStrokes(computed, doc);
    const opacity = Math.max(0, Math.min(1, parseFloat(computed.opacity) || 1));
    const radius = parseCornerRadius(computed);
    const shadows = parseBoxShadow(computed.boxShadow, doc);
    const overflows =
      el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    const isClipped =
      computed.overflow === 'hidden' ||
      computed.overflow === 'clip' ||
      computed.overflowX === 'hidden' ||
      computed.overflowY === 'hidden' ||
      ((computed.overflow === 'scroll' || computed.overflow === 'auto' ||
        computed.overflowX === 'scroll' || computed.overflowX === 'auto' ||
        computed.overflowY === 'scroll' || computed.overflowY === 'auto') && overflows);
    const clipPath =
      computed.clipPath && computed.clipPath !== 'none'
        ? computed.clipPath
        : undefined;

    const style = {
      fills,
      strokes,
      opacity,
      radius,
      shadows,
      clip: isClipped,
      clipPath,
      layout: parseLayout(computed),
      ...extractFidelityStyle(computed, el),
      ...chainStyle(el, docX, docY),
    };

    const tagName = el.tagName.toLowerCase();

    // 1. Inline SVG elements
    // 1. Canvas elements (WebGL shaders, Three.js, charts, 2D canvas)
    if (tagName === 'canvas') {
      let assetRef: string | undefined;
      let rasterized: { reason: string } | undefined;
      const canvasEl = el as HTMLCanvasElement;
      const tryCanvasDataUrl = (): boolean => {
        try {
          if (typeof canvasEl.toDataURL === 'function' && canvasEl.width > 0 && canvasEl.height > 0) {
            const dataUrl = canvasEl.toDataURL('image/png');
            if (dataUrl && dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 'data:image/png;base64,'.length) {
              const base64 = dataUrl.slice('data:image/png;base64,'.length);
              const assetKey = `asset-${nextAssetId++}`;
              assets[assetKey] = {
                kind: 'image',
                mimeType: 'image/png',
                base64,
              };
              assetRef = assetKey;
              return true;
            }
          }
        } catch {
          // tainted or unreadable canvas
        }
        return false;
      };
      const canvasHasReadablePixels = (): boolean => {
        try {
          const probe = doc.createElement('canvas');
          probe.width = 16;
          probe.height = 16;
          const pctx = probe.getContext('2d');
          if (!pctx) return false;
          pctx.drawImage(canvasEl, 0, 0, 16, 16);
          const d = pctx.getImageData(0, 0, 16, 16).data;
          for (let i = 3; i < d.length; i += 4) {
            if (d[i] > 0) return true;
          }
        } catch {
          // tainted or unsupported
        }
        return false;
      };
      const hasWebgl = Boolean(
        typeof canvasEl.getContext === 'function' &&
        (canvasEl.getContext('webgl2') || canvasEl.getContext('webgl') || canvasEl.getContext('experimental-webgl'))
      );
      if (hasWebgl && w > 0 && h > 0) {
        if (!(canvasHasReadablePixels() && tryCanvasDataUrl()) && hasRuntimeBridge) {
          const assetKey = `asset-${nextAssetId++}`;
          assetRef = assetKey;
          rasterized = { reason: 'webgl-canvas' };
          enqueueRectCapture({ box: { x, y, w, h }, assetKey, nodeId, reason: 'webgl-canvas', invisible: parseFloat(computed.opacity) <= 0 || computed.visibility === 'hidden' });
        }
      } else if (!tryCanvasDataUrl() && w > 0 && h > 0 && hasRuntimeBridge) {
        const assetKey = `asset-${nextAssetId++}`;
        assetRef = assetKey;
        rasterized = { reason: 'tainted-canvas' };
        enqueueRectCapture({ box: { x, y, w, h }, assetKey, nodeId, reason: 'tainted-canvas', invisible: parseFloat(computed.opacity) <= 0 || computed.visibility === 'hidden' });
      }
      if (!assetRef) warning(report, 'canvas_unavailable', 'Canvas pixels could not be captured; the image layer has no embedded snapshot.', nodeId);

      nodes.push({
        id: nodeId,
        parentId,
        type: 'image',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
        assetRef,
        ...(rasterized ? { rasterized } : {}),
      });
      continue;
    }

    // 2. Inline SVG elements
    if (tagName === 'svg') {
      let assetRef: string | undefined;
      try {
        let svgString: string;
        if (typeof XMLSerializer !== 'undefined') {
          svgString = new XMLSerializer().serializeToString(el);
        } else {
          svgString = el.outerHTML;
        }

        if (svgString) {
          const currentColor = computed.color || 'rgba(0, 0, 0, 1)';
          svgString = svgString.replace(/currentColor/gi, currentColor);
          if (!svgString.includes('xmlns=')) {
            svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
          }
// Sprite icons (<use href="#id">): the serialized svg carries only a
           // dangling <use>, so the asset renders empty everywhere. Inline the
           const useEl = typeof el.querySelector === 'function' ? el.querySelector('use') : null;
           const useHref = useEl?.getAttribute?.('href') ?? useEl?.getAttribute?.('xlink:href');
           if (useEl && useHref) {
             try {
               const fragId = decodeURIComponent(useHref.split('#').pop() || '');
               const target = fragId ? doc.getElementById(fragId) : null;
               if (target) {
                 const vb = el.getAttribute('viewBox') || target.getAttribute('viewBox') || target.closest('svg')?.getAttribute('viewBox');
                 const inner = target.innerHTML;
                 const wAttr = el.getAttribute('width');
                 const hAttr = el.getAttribute('height');
                 const sizeAttrs = `${wAttr ? ` width="${wAttr}"` : ''}${hAttr ? ` height="${hAttr}"` : ''}${vb ? ` viewBox="${vb}"` : ''}`;
                 svgString = `<svg xmlns="http://www.w3.org/2000/svg"${sizeAttrs}>${inner}</svg>`;
                 svgString = svgString.replace(/currentColor/gi, currentColor);
               }
             } catch {
               // Unresolvable sprite ref: keep the raw serialization.
             }
           }
           // Computed fill/stroke per shape: apply to the serialized string,
           // not the live DOM (mutating live classes then re-serializing the
           // live svg discards the sprite inlining above).
           const inlineDoc = typeof DOMParser !== 'undefined' ? new DOMParser().parseFromString(svgString, 'image/svg+xml') : null;
           const inlineRoot = inlineDoc?.documentElement ?? null;
           if (inlineRoot && inlineDoc && typeof XMLSerializer !== 'undefined') {
             const childStyles: string[] = [];
             let styleIdx = 0;
             const liveShapes = el.querySelectorAll('path, circle, rect, polygon, g');
             const inlineShapes = inlineRoot.querySelectorAll('path, circle, rect, polygon, g');
             liveShapes.forEach((child, idx) => {
               const inline = inlineShapes[idx] as Element | undefined;
               if (!inline) return;
               const cs = defaultView.getComputedStyle(child);
               const cls = `ck-s-${styleIdx++}`;
               inline.setAttribute('class', `${inline.getAttribute('class') || ''} ${cls}`.trim());
               const rules: string[] = [];
               if (cs.fill && cs.fill !== 'none') rules.push(`fill:${cs.fill}`);
               if (cs.stroke && cs.stroke !== 'none') rules.push(`stroke:${cs.stroke}`);
               if (rules.length > 0) childStyles.push(`.${cls}{${rules.join(';')}}`);
             });
             if (childStyles.length > 0) {
               const styleEl = inlineDoc.createElementNS('http://www.w3.org/2000/svg', 'style');
               styleEl.textContent = childStyles.join('');
               inlineRoot.insertBefore(styleEl, inlineRoot.firstChild);
               svgString = new XMLSerializer().serializeToString(inlineRoot);
             }
           } else if (typeof XMLSerializer !== 'undefined') {
             // Mock/test DOMs without DOMParser: style the live svg and
             // re-serialize it (no sprite inlining needed there).
             const childStyles: string[] = [];
             let styleIdx = 0;
             el.querySelectorAll('path, circle, rect, polygon, g').forEach((child) => {
               const cs = defaultView.getComputedStyle(child);
               const cls = `ck-s-${styleIdx++}`;
               (child as Element).classList.add(cls);
               const rules: string[] = [];
               if (cs.fill && cs.fill !== 'none') rules.push(`fill:${cs.fill}`);
               if (cs.stroke && cs.stroke !== 'none') rules.push(`stroke:${cs.stroke}`);
               if (rules.length > 0) childStyles.push(`.${cls}{${rules.join(';')}}`);
             });
             if (childStyles.length > 0) {
               svgString = new XMLSerializer()
                 .serializeToString(el)
                 .replace('>', `><style>${childStyles.join('')}</style>`);
             }
           }
          const base64 = btoa(unescape(encodeURIComponent(svgString)));
          const assetKey = `asset-${nextAssetId++}`;
          assets[assetKey] = {
            kind: 'image',
            mimeType: 'image/svg+xml',
            base64,
          };
          assetRef = assetKey;
          if (typeof el.querySelectorAll === 'function') {
            const svgImgUrls: Array<{ raw: string; resolved: string }> = [];
            el.querySelectorAll('image').forEach((imgNode) => {
              const rawHref = imgNode.getAttribute('href') || imgNode.getAttribute('xlink:href');
              if (rawHref && !rawHref.startsWith('data:')) {
                try {
                  svgImgUrls.push({ raw: rawHref, resolved: new URL(rawHref, baseURI).href });
                } catch {
                  // ignore unresolvable
                }
              }
            });
            if (svgImgUrls.length > 0) {
              pendingSvgImageInlines.push({ assetKey, urls: svgImgUrls, nodeId });
            }
          }
        }
      } catch {
        warning(report, 'asset_failed', 'Inline SVG bytes could not be captured.', nodeId);
      }

      // Sprite <use> refs keep their shapes in a <symbol>/<g>/<path> elsewhere:
      // resolve every #<id> reference so vector-first fires for sprite icons too.
      const resolvedUseRefs: Array<{ useEl: Element; refEl: Element }> = [];
      if (typeof el.querySelectorAll === 'function') {
        for (const useEl of el.querySelectorAll('use')) {
          const href = useEl.getAttribute?.('href') || useEl.getAttribute?.('xlink:href') || '';
          if (!href.startsWith('#')) continue;
          const rawId = href.slice(1);
          if (!rawId) continue;
          let refEl = doc.getElementById(rawId);
          if (!refEl && rawId.includes('%')) {
            try {
              refEl = doc.getElementById(decodeURIComponent(rawId));
            } catch {
              // ignore malformed URI escape
            }
          }
          if (refEl) {
            resolvedUseRefs.push({ useEl, refEl });
          }
        }
      }
      // Clip-region rules: <clipPath> shapes are region geometry, not artwork.
      const clipDs = (() => {
        try {
          const scopes = [el, ...resolvedUseRefs.map((r) => r.refEl)];
          const out = new Set<string>();
          for (const scope of scopes) {
            if (typeof scope.querySelectorAll !== 'function') continue;
            for (const cp of scope.querySelectorAll('clipPath')) {
              if ((cp as Element).tagName?.toLowerCase() !== 'clippath') continue;
              for (const s of (cp as Element).querySelectorAll('path, rect, circle, polygon')) {
                const dd = (s as Element).getAttribute?.('d');
                if (dd) out.add(dd);
              }
            }
          }
          return out;
        } catch {
          return new Set<string>();
        }
      })();
      const hasSvgImages = typeof el.querySelector === 'function' && Boolean(el.querySelector('image'));
      const rawPaths = [
        ...extractSvgPaths(el, { inheritFrom: [el], fallbackColor: computed.color }),
        ...resolvedUseRefs.flatMap(({ useEl, refEl }) => {
          const useColorAttr = useEl.getAttribute?.('color') || (useEl as HTMLElement).style?.color;
          let useColor = computed.color;
          if (useColorAttr) {
            try {
              const ucs = defaultView.getComputedStyle(useEl);
              if (ucs?.color) useColor = ucs.color;
            } catch {
              useColor = useColorAttr;
            }
          }
          return extractSvgPaths(refEl, {
            inheritFrom: [useEl, el],
            fallbackColor: useColor,
            allowDefsAncestor: true,
          });
        }),
      ];
      const vectorPaths = rawPaths.filter((p) => !clipDs.has(p.d));
      // Vector-first: path-bearing svgs travel as real vector data, which
      // every importer honors. The base64 asset stays as fallback for
      // shape types paths can't express (or svgs with embedded <image>).
      const vectorFirst = vectorPaths.length > 0 && !hasSvgImages;
      // Intrinsic viewBox size: destinations scale path units into the box.
      const vectorViewBox = (() => {
        try {
          const vb =
            el.getAttribute?.('viewBox') ||
            resolvedUseRefs.map((r) => r.refEl.getAttribute?.('viewBox')).find(Boolean);
          const parts = (vb || '').trim().split(/[\s,]+/);
          if (parts.length === 4) {
            const w = parseFloat(parts[2]);
            const h = parseFloat(parts[3]);
            if (w > 0 && h > 0) return { width: w, height: h };
          }
          return undefined;
        } catch {
          return undefined;
        }
      })();
       nodes.push({
         id: nodeId,
         parentId,
         type: vectorFirst ? 'vector' : 'image',
         box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
         style,
         ...(vectorFirst ? {} : { assetRef }),
         vectorPaths: vectorPaths.length > 0 ? vectorPaths : undefined,
        ...(vectorFirst && vectorViewBox ? { vectorViewBox } : {}),
       });
       continue;
    }

    // 2. Image elements
    if (tagName === 'img') {
      const img = el as HTMLImageElement;
      let assetRef: string | undefined;

      const src = resolveHighestDpiSrc(img);
      if (src) {
        if (src.startsWith('data:')) {
          const parsed = dataUriToAsset(src);
          if (parsed) {
            const assetKey = `asset-${nextAssetId++}`;
            assets[assetKey] = {
              kind: 'image',
              mimeType: parsed.mimeType,
              base64: parsed.base64,
            };
            assetRef = assetKey;
          } else warning(report, 'asset_failed', 'Image data could not be read.', nodeId);
        } else {
          try {
            const resolvedUrl = new URL(src, baseURI);
            const isSameOrigin =
              resolvedUrl.origin === defaultView.location?.origin;
            if (isSameOrigin || resolvedUrl.protocol === 'blob:' || hasRuntimeBridge) {
              const cachedKey = urlToAssetKeyCache.get(resolvedUrl.href);
              if (cachedKey) {
                assetRef = cachedKey;
              } else {
                const assetKey = `asset-${nextAssetId++}`;
                urlToAssetKeyCache.set(resolvedUrl.href, assetKey);
                enqueueAssetFetch({ url: resolvedUrl.href, assetKey, nodeId, maxWidth: maxWidthForBox(w) });
                assetRef = assetKey;
              }
            } else {
              warning(report, 'asset_unavailable', `Cross-origin image bytes were not embedded: ${resolvedUrl.href}`, nodeId);
            }
          } catch {
            warning(report, 'asset_failed', `Image URL could not be resolved: ${src}`, nodeId);
          }
        }
      } else {
        warning(report, 'asset_unavailable', 'Image has no available source bytes.', nodeId);
      }

      const fit = computed.objectFit as Node['objectFit'] | undefined;
      const pos = computed.objectPosition || undefined;

      nodes.push({
        id: nodeId,
        parentId,
        type: 'image',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
        assetRef,
        ...(fit && fit !== 'fill' ? { objectFit: fit } : {}),
        ...(pos && pos !== '50% 50%' ? { objectPosition: pos } : {}),
      });
      continue;
    }

    // 3. Iframe elements (same-origin traversal, cross-origin raster fallback)
    if (tagName === 'iframe') {
      let iframeLabel: string | undefined;
      try {
        const host = new URL((el as HTMLIFrameElement).src || '', defaultView.location?.href || baseURI).hostname.replace(/^www\./, '');
        if (host) iframeLabel = `Embed · ${host.slice(0, 24)}`;
      } catch {
        // ignore
      }

      let capturedSameOrigin = false;
      try {
        const iframeEl = el as HTMLIFrameElement;
        const iframeDoc = iframeEl.contentDocument;
        if (iframeDoc && (iframeDoc.body || iframeDoc.documentElement)) {
          capturedSameOrigin = true;
          nodes.push({
            id: nodeId,
            ...(iframeLabel ? { name: iframeLabel } : semanticName ? { name: semanticName } : {}),
            parentId,
            type: 'frame',
            box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
            style,
          });
          const iframeRoot = iframeDoc.body || iframeDoc.documentElement;
          const { diagnostics: iframeDiagnostics } = await prepareCapture(iframeRoot, iframeDoc, opts, false);
          const iframeCapture = await serializeSubtree(
            iframeRoot,
            iframeDoc,
            {
              originX: -x,
              originY: -y,
              width: w,
              height: h,
            },
            opts,
            iframeDiagnostics
          );

          for (const childNode of iframeCapture.nodes) {
            if (!childNode.parentId) {
              childNode.parentId = nodeId;
            }
            nodes.push(childNode);
          }

          Object.assign(assets, iframeCapture.assets);
          for (const diagnostic of iframeCapture.diagnostics ?? []) report({ ...diagnostic, nodeId });
        }
      } catch {
        capturedSameOrigin = false;
      }

      if (!capturedSameOrigin) {
        if (w > 0 && h > 0 && hasRuntimeBridge) {
          const assetKey = `asset-${nextAssetId++}`;
          enqueueRectCapture({ box: { x, y, w, h }, assetKey, nodeId, reason: 'cross-origin-iframe', invisible: parseFloat(computed.opacity) <= 0 || computed.visibility === 'hidden' });
          nodes.push({
            id: nodeId,
            ...(iframeLabel ? { name: iframeLabel } : semanticName ? { name: semanticName } : {}),
            parentId,
            type: 'image',
            box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
            style,
            assetRef: assetKey,
            rasterized: { reason: 'cross-origin-iframe' },
          });
        } else {
          warning(report, 'asset_unavailable', 'Embedded document is unavailable or cross-origin; its content was not captured.', nodeId);
          nodes.push({
            id: nodeId,
            ...(iframeLabel ? { name: iframeLabel } : semanticName ? { name: semanticName } : {}),
            parentId,
            type: 'frame',
            box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
            style,
          });
        }
      }
      continue;
    }

    // 2b. Video elements: rasterize the current frame or poster.
    if (tagName === 'video') {
      const videoEl = el as HTMLVideoElement;
      let assetRef: string | undefined;
      let rasterized: { reason: string } | undefined;
      try {
        if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          const canvas = doc.createElement('canvas');
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(videoEl, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const parsed = dataUrl ? dataUriToAsset(dataUrl) : null;
          if (parsed && parsed.base64) {
            const assetKey = `asset-${nextAssetId++}`;
            assets[assetKey] = { kind: 'image', mimeType: parsed.mimeType, base64: parsed.base64 };
            assetRef = assetKey;
          }
        }
      } catch {
        // Tainted/cross-origin video: fall back to poster or raster capture below.
      }
      if (!assetRef) {
        const poster = videoEl.getAttribute?.('poster') || (videoEl as HTMLVideoElement & { poster?: string }).poster || '';
        if (poster) {
          if (poster.startsWith('data:')) {
            const parsed = dataUriToAsset(poster);
            if (parsed) {
              const assetKey = `asset-${nextAssetId++}`;
              assets[assetKey] = { kind: 'image', mimeType: parsed.mimeType, base64: parsed.base64 };
              assetRef = assetKey;
            }
          } else {
            try {
              const resolvedPoster = new URL(poster, baseURI);
              const isSameOrigin = resolvedPoster.origin === defaultView.location?.origin;
              if (isSameOrigin || resolvedPoster.protocol === 'blob:' || hasRuntimeBridge) {
                const cachedKey = urlToAssetKeyCache.get(resolvedPoster.href);
                if (cachedKey) {
                  assetRef = cachedKey;
                } else {
                  const assetKey = `asset-${nextAssetId++}`;
                  urlToAssetKeyCache.set(resolvedPoster.href, assetKey);
                  enqueueAssetFetch({ url: resolvedPoster.href, assetKey, nodeId, maxWidth: maxWidthForBox(w) });
                  assetRef = assetKey;
                }
              }
            } catch {
              // ignore unresolvable poster
            }
          }
        }
      }
      if (!assetRef && w > 0 && h > 0 && hasRuntimeBridge) {
        const assetKey = `asset-${nextAssetId++}`;
        assetRef = assetKey;
        rasterized = { reason: 'video-frame' };
        enqueueRectCapture({ box: { x, y, w, h }, assetKey, nodeId, reason: 'video-frame', invisible: parseFloat(computed.opacity) <= 0 || computed.visibility === 'hidden' });
      }
      if (!assetRef) warning(report, 'asset_unavailable', 'Video frame pixels could not be captured.', nodeId);

      nodes.push({
        id: nodeId,
        parentId,
        type: 'image',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
        assetRef,
        ...(rasterized ? { rasterized } : {}),
      });
      continue;
    }

    // 4. Form controls
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      const inputType = tagName === 'input' ? (el as HTMLInputElement).type?.toLowerCase() : '';
      const isToggle = inputType === 'checkbox' || inputType === 'radio';
      let controlText = '';
      let isPlaceholder = false;
      if (tagName === 'input' && !isToggle) {
        const input = el as HTMLInputElement;
        controlText = input.value || input.placeholder || '';
        isPlaceholder = !input.value && Boolean(input.placeholder);
      } else if (tagName === 'textarea') {
        const textarea = el as HTMLTextAreaElement;
        controlText = textarea.value || textarea.placeholder || '';
        isPlaceholder = !textarea.value && Boolean(textarea.placeholder);
      } else if (tagName === 'select') {
        const select = el as HTMLSelectElement;
        controlText =
          select.options?.[select.selectedIndex]?.text || select.value || '';
      }

      const controlStyle = { ...style, clip: false };
      if (isToggle) {
        const checked = (el as HTMLInputElement).checked;
        const accent = computed.accentColor && computed.accentColor !== 'auto' ? computed.accentColor : 'rgba(13, 153, 255, 1)';
        controlStyle.fills = checked
          ? [{ type: 'solid' as const, color: accent, opacity: 1 }]
          : controlStyle.fills;
      }
      nodes.push({
        id: nodeId,
        parentId,
        type: 'rect',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style: controlStyle,
      });

      if (controlText.trim().length > 0) {
        const fontSize = parseFloat(computed.fontSize) || 14;
        const align = parseTextAlign(computed.textAlign);
        const padL = (parseFloat(computed.borderLeftWidth) || 0) + (parseFloat(computed.paddingLeft) || 0);
        const padR = (parseFloat(computed.borderRightWidth) || 0) + (parseFloat(computed.paddingRight) || 0);
        const insetL = padL > 0 ? padL : align === 'center' ? 8 : 12;
        const insetR = padR > 0 ? padR : align === 'center' ? 8 : 12;
        const ctrlH = Math.min(h, fontSize * 1.25);
        let textColor = computed.color || 'rgba(0, 0, 0, 1)';
        if (isPlaceholder) {
          try {
            const phColor = defaultView.getComputedStyle(el, '::placeholder')?.color;
            if (phColor && phColor !== 'rgba(0, 0, 0, 0)' && phColor !== 'transparent') textColor = phColor;
          } catch {
            // keep computed.color
          }
        }
        const textNodeId = `node-${nextNodeId++}`;
        const controlTextNode = {
          id: textNodeId,
          parentId: nodeId,
          type: 'text' as const,
          box: {
            x: x + insetL,
            y: y + Math.max(0, (h - ctrlH) / 2),
            w: Math.max(0, w - insetL - insetR),
            h: ctrlH,
          },
          style: {
            fills: [],
            strokes: [],
            opacity: 1,
            radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
            shadows: [],
            clip: false,
          },
          text: {
            content: controlText.trim(),
            fontFamily: computed.fontFamily || 'system-ui, sans-serif',
            fontSize,
            fontWeight: computed.fontWeight || 400,
            lineHeight: (() => { const v = parseFloat(computed.lineHeight); return Number.isNaN(v) ? 'normal' : v; })(),
            letterSpacing: parseFloat(computed.letterSpacing) || 0,
            align,
            color: textColor,
            ...extractTextFidelity(computed),
          },
        };
        foldNodeChain(controlTextNode, el, frameRect, chainFor);
        nodes.push(controlTextNode);
      }
      continue;
    }

    // 4. Regular DOM elements
    const childTextNodes: globalThis.Node[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 3 /* Node.TEXT_NODE */) {
        const textVal = child.textContent?.trim() || '';
        if (textVal.length > 0) {
          childTextNodes.push(child);
        }
      }
    }

    const hasChildren = el.children.length > 0;
    const isOwnBgClipText = style.backgroundClip === 'text' && fills.length > 0;
    if (isOwnBgClipText) {
      bgClipTextFillsMap.set(el, style.fills);
    }
    const inheritedBgClipFills = !isOwnBgClipText && fills.length === 0 ? resolveInheritedBgClipFills(el) : undefined;
    const effectiveBgClipFills = isOwnBgClipText ? style.fills : inheritedBgClipFills;
    const hasVisualDecoration =
      fills.length > 0 ||
      strokes.length > 0 ||
      shadows.length > 0 ||
      radius.topLeft > 0;

    if (!hasVisualDecoration && !hasChildren && childTextNodes.length > 0) {
      const whiteSpace = computed.whiteSpace || 'normal';
      const collapseWs = (raw: string): string => {
        if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces') return raw;
        if (whiteSpace === 'pre-line') return raw.replace(/[ \t\r]+/g, ' ');
        return raw.replace(/\s+/g, ' ');
      };
      let combinedText = collapseWs(childTextNodes.map((n) => n.textContent || '').join('')).trim();

      const fontSize = parseFloat(computed.fontSize) || 16;
      const lineHeightValue = parseFloat(computed.lineHeight);
      let lineHeight: number = Number.isNaN(lineHeightValue) ? round2(fontSize * 1.2) : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue)
        ? 0
        : round2(letterSpacingValue);

      // Content box, not border box: text never starts under the padding.
      const num2 = (v: string | undefined): number => Math.max(0, parseFloat(v ?? '') || 0);
      const cbX = x + num2(computed.borderLeftWidth) + num2(computed.paddingLeft);
      const cbY = y + num2(computed.borderTopWidth) + num2(computed.paddingTop);
      const cbW = Math.max(
        1,
        w -
          num2(computed.borderLeftWidth) -
          num2(computed.borderRightWidth) -
          num2(computed.paddingLeft) -
          num2(computed.paddingRight) +
          2
      );
      const cbH = Math.max(
        1,
        h -
          num2(computed.borderTopWidth) -
          num2(computed.borderBottomWidth) -
          num2(computed.paddingTop) -
          num2(computed.paddingBottom)
      );

      let runs: Array<{ text: string; x?: number; y?: number; w?: number; h?: number; fontFamily?: string; fontSize?: number; fontWeight?: string | number; color?: string; gradientFill?: Fill; fills?: Fill[] }> | undefined;
      if (typeof doc.createRange === 'function' && childTextNodes.length === 1) {
        try {
          const tNode = childTextNodes[0];
          const fullStr = tNode.textContent || '';
          const textStart = nowMs();
          const preserveWs = whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces';
          const { lines, measuredCalls } = measureWrappedLines(
            doc, tNode, fullStr, fontSize, scrollX, scrollY, frameRect.originX, frameRect.originY, preserveWs
          );
          textMs += nowMs() - textStart;
          textCharsMeasured += measuredCalls;

          if (Number.isNaN(lineHeightValue)) {
            if (lines.length > 0 && lines[0].h > 0) {
              lineHeight = round2(lines[0].h);
            } else {
              const r = doc.createRange();
              r.selectNodeContents(tNode);
              const rect = r.getClientRects?.()[0] ?? r.getBoundingClientRect();
              if (rect && rect.height > 0) lineHeight = round2(rect.height);
            }
          }

          let effectiveLines = lines;
          const clampCount = parseInt((computed as unknown as Record<string, string>).webkitLineClamp || '0', 10);
          if (clampCount > 0 && computed.overflow !== 'visible' && effectiveLines.length > clampCount) {
            effectiveLines = effectiveLines.slice(0, clampCount).map((l) => ({ ...l }));
            const last = effectiveLines[effectiveLines.length - 1];
            const trimmed = last.text.replace(/\s+\S*$/, '').trimEnd();
            last.text = `${trimmed || last.text.slice(0, Math.max(1, last.text.length - 3))}…`;
            combinedText = effectiveLines.map((l) => l.text).join('\n');
          } else if (
            computed.textOverflow === 'ellipsis' &&
            computed.overflow !== 'visible' &&
            (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 &&
            fullStr.length > 1
          ) {
            const clientW = (el as HTMLElement).clientWidth;
            let lo = 0;
            let hi = fullStr.length;
            const r = doc.createRange();
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              r.setStart(tNode, 0);
              r.setEnd(tNode, mid);
              if (r.getBoundingClientRect().width <= Math.max(4, clientW - fontSize * 0.7)) lo = mid;
              else hi = mid - 1;
            }
            combinedText = `${fullStr.slice(0, Math.max(1, lo)).trimEnd()}…`;
          }

          if (effectiveLines.length > 1) {
            const gradFill = effectiveBgClipFills?.find((f) => f.type === 'gradient');
            runs = effectiveLines.map((l) => ({
              text: l.text,
              x: round2(l.x),
              y: round2(l.y),
              w: round2(l.w),
              ...(gradFill ? { gradientFill: gradFill } : {}),
            }));
          }
        } catch {
          // ignore
        }
      }

      const leafStyle = effectiveBgClipFills
        ? { ...style, fills: effectiveBgClipFills, backgroundClip: 'text' }
        : style;

      nodes.push({
        id: nodeId,
        ...(semanticName ? { name: semanticName } : {}),
        parentId,
        type: 'text',
        box: { x: cbX, y: cbY, w: cbW, h: cbH },
        style: leafStyle,
        text: {
          content: combinedText,
          fontFamily: computed.fontFamily || 'system-ui, sans-serif',
          fontSize,
          fontWeight: computed.fontWeight || 400,
          lineHeight,
          letterSpacing,
          align: parseTextAlign(computed.textAlign),
          color: resolveEffectiveTextColor(computed, effectiveBgClipFills),
          ...(runs ? { runs } : {}),
          ...extractTextFidelity(computed),
        },
      });
      continue;
    }

    const isBgClipText = Boolean(effectiveBgClipFills && effectiveBgClipFills.length > 0);
    const containerStyle = isOwnBgClipText ? { ...style, fills: [] } : style;

    nodes.push({
      id: nodeId,
      ...(semanticName ? { name: semanticName } : {}),
      parentId,
      type: hasChildren ? 'frame' : 'rect',
      box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
      style: containerStyle,
    });
    // ::before pseudo-element
    const beforeNodes = extractPseudoElement(
      el,
      '::before',
      { x, y, w, h },
      defaultView,
      nodeId,
      () => `node-${nextNodeId++}`,
      (chainFor(el).matrix) ?? null,
      frameRect
    );
    if (beforeNodes) {
      for (const n of beforeNodes) nodes.push(n);
    }

    for (const textNode of childTextNodes) {
      const whiteSpace = computed.whiteSpace || 'normal';
      const preserveWs = whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces';
      const rawText = textNode.textContent || '';
      const textVal = (preserveWs ? rawText : whiteSpace === 'pre-line' ? rawText.replace(/[ \t\r]+/g, ' ') : rawText.replace(/\s+/g, ' ')).trim();
      if (!textVal) continue;

      const num = (v: string | undefined): number => Math.max(0, parseFloat(v ?? "") || 0);
      // Content box: where the line box actually starts. For a lone text leaf
      // this is exact — our renderer re-wraps with the same width/font/
      // line-height, so glyphs land identically. Range rects here would omit
      // half-leading and shift the text down by (line-height − font)/2.
      const contentBox = {
        x: x + num(computed.borderLeftWidth) + num(computed.paddingLeft),
        y: y + num(computed.borderTopWidth) + num(computed.paddingTop),
        w: Math.max(1, w - num(computed.borderLeftWidth) - num(computed.borderRightWidth) - num(computed.paddingLeft) - num(computed.paddingRight) + 2),
        h: Math.max(1, h - num(computed.borderTopWidth) - num(computed.borderBottomWidth) - num(computed.paddingTop) - num(computed.paddingBottom)),
      };

      const fontSize = parseFloat(computed.fontSize) || 16;
      const lineHeightValue = parseFloat(computed.lineHeight);
      const lineHeight: number | string = Number.isNaN(lineHeightValue) ? 'normal' : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue) ? 0 : letterSpacingValue;
      const lineBoxes: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];

      if (typeof doc.createRange === 'function') {
        try {
          const fullStr = rawText;
          const textStart = nowMs();
          const { lines, measuredCalls } = measureWrappedLines(
            doc, textNode, fullStr, fontSize, scrollX, scrollY, frameRect.originX, frameRect.originY, preserveWs
          );
          textMs += nowMs() - textStart;
          textCharsMeasured += measuredCalls;
          for (const l of lines) {
            lineBoxes.push({
              text: l.text,
              x: round2(l.x),
              y: round2(l.y),
              w: round2(l.w),
              h: round2(l.h),
            });
          }
          if (lineBoxes.length === 0) {
            const range = doc.createRange();
            const leadWs = preserveWs ? 0 : fullStr.length - fullStr.trimStart().length;
            const trailWs = preserveWs ? fullStr.length : fullStr.trimEnd().length;
            if ((leadWs > 0 || trailWs < fullStr.length) && leadWs < trailWs && typeof range.setStart === 'function' && typeof range.setEnd === 'function') {
              range.setStart(textNode, leadWs);
              range.setEnd(textNode, trailWs);
            } else {
              range.selectNodeContents(textNode);
            }
            const clientRects = typeof range.getClientRects === 'function'
              ? Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
              : [];
            const rangeRect = clientRects[0] ?? range.getBoundingClientRect();
            if (rangeRect && rangeRect.width > 0 && rangeRect.height > 0) {
              lineBoxes.push({
                text: textVal,
                x: round2(rangeRect.left + scrollX - frameRect.originX),
                y: round2(rangeRect.top + scrollY - frameRect.originY),
                w: round2(rangeRect.width + 2),
                h: round2(rangeRect.height),
              });
            }
          }
        } catch {
          // fallback below
        }
      }
      if (lineBoxes.length === 0) {
        lineBoxes.push({ text: textVal, x: contentBox.x, y: contentBox.y, w: contentBox.w, h: contentBox.h });
      }

      for (const lb of lineBoxes) {
        const textNodeId = `node-${nextNodeId++}`;
        const childTextNode = {
          id: textNodeId,
          parentId: nodeId,
          type: 'text' as const,
          box: { x: lb.x, y: lb.y, w: Math.max(0, lb.w), h: Math.max(0, lb.h) },
          style: {
            fills: isBgClipText && effectiveBgClipFills ? effectiveBgClipFills : [],
            strokes: [],
            opacity: 1,
            radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
            shadows: [],
            clip: false,
            ...(isBgClipText ? { backgroundClip: 'text' } : {}),
          },
          text: {
            content: lb.text,
            fontFamily: computed.fontFamily || 'system-ui, sans-serif',
            fontSize,
            fontWeight: computed.fontWeight || 400,
            lineHeight,
            letterSpacing,
            align: parseTextAlign(computed.textAlign),
            color: resolveEffectiveTextColor(computed, effectiveBgClipFills),
            ...extractTextFidelity(computed),
          },
        };
        foldNodeChain(childTextNode, el, frameRect, chainFor);
        nodes.push(childTextNode);
      }
    }
    // ::after pseudo-element
    const afterNodes = extractPseudoElement(
      el,
      '::after',
      { x, y, w, h },
      defaultView,
      nodeId,
      () => `node-${nextNodeId++}`,
      (chainFor(el).matrix) ?? null,
      frameRect
    );
    if (afterNodes) {
      for (const n of afterNodes) nodes.push(n);
    }
  }
  } finally {
    // Transforms must come back even if serialization throws mid-walk —
    // frozen inline styles are visible to the user's live page.
    for (const [el, frozen] of measure.frozen) thawTransform(el, frozen);
  }
  const nodesMs = nowMs() - nodesStart;

  for (const n of nodes) {
    n.box.x = round2(n.box.x);
    n.box.y = round2(n.box.y);
    n.box.w = round2(n.box.w);
    n.box.h = round2(n.box.h);
  }
  capture.nodes = nodes;
  const usedFontFamilies = new Set<string>();
  const usedFontFaces = new Set<string>();
  for (const n of nodes) {
    if (!n.text) continue;
    const w = normalizeFontWeight(n.text.fontWeight);
    const st = n.text.italic ? 'italic' : 'normal';
    for (const part of n.text.fontFamily.split(',')) {
      const fam = normalizeFontFamily(part);
      if (!fam) continue;
      usedFontFamilies.add(fam);
      usedFontFaces.add(`${fam}|${w}|${st}`);
    }
  }
  const fontsStart = nowMs();
  const embedDeadline = Math.min(fontDeadline ?? Infinity, readinessDeadline, Date.now() + assetTimeoutMs);
  const [, extractedFonts] = await Promise.all([
    Promise.all(activeAssetPromises),
    opts?.fastMode
      ? Promise.resolve([] as Font[])
      : extractWebFonts(
          doc,
          baseURI,
          assets,
          () => `asset-${nextAssetId++}`,
          report,
          embedDeadline,
          usedFontFamilies,
          usedFontFaces,
          assetConcurrency
        ),
  ]);
  if (transcodeStats.toJpeg > 0 || transcodeStats.toPng > 0) {
    diagnostics.push({
      code: 'assets_transcoded',
      severity: 'info',
      message: `Transcoded ${transcodeStats.toJpeg} opaque image(s) to JPEG and ${transcodeStats.toPng} transparent image(s) to PNG`,
    });
  }
  if (transcodeStats.downscaled > 0) {
    diagnostics.push({
      code: 'assets_downscaled',
      severity: 'info',
      message: `Downscaled ${transcodeStats.downscaled} oversized raster image(s)`,
    });
  }
  const fontsMs = nowMs() - fontsStart;
  reconcileMissingFonts(nodes, extractedFonts, report);
  let svgInlineMs = 0;
  if (pendingSvgImageInlines.length > 0) {
    const svgInlineStart = nowMs();
    for (const item of pendingSvgImageInlines) {
      const asset = assets[item.assetKey];
      if (!asset || asset.mimeType !== 'image/svg+xml') continue;
      let svgText = decodeURIComponent(escape(atob(asset.base64)));
      for (const u of item.urls) {
        let dataUrl: string | null = null;
        try {
          const rem = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
          if (rem > 0) {
            const blob = await fetchAssetBlob(u.resolved, rem);
            const buf = await withTimeout(blob.arrayBuffer(), rem);
            const b64 = await arrayBufferToBase64(buf);
            dataUrl = `data:${blob.type || 'image/png'};base64,${b64}`;
          }
        } catch {
          if (sendRuntimeMessage) {
            try {
              const rem = Math.min(assetTimeoutMs, Math.max(0, readinessDeadline - Date.now()));
              if (rem > 0) {
                const bg = (await withTimeout(sendRuntimeMessage({ action: 'fetch-asset', url: u.resolved }), rem)) as { success?: boolean; mimeType?: string; base64?: string } | undefined;
                if (bg?.success && bg.base64) {
                  dataUrl = `data:${bg.mimeType || 'image/png'};base64,${bg.base64}`;
                }
              }
            } catch {
              // ignore
            }
          }
        }
        if (dataUrl) {
          svgText = svgText.split(u.raw).join(dataUrl);
        } else {
          warning(report, 'asset_failed', `SVG <image> asset could not be embedded: ${u.resolved}`, item.nodeId);
        }
      }
      asset.base64 = btoa(unescape(encodeURIComponent(svgText)));
    }
    svgInlineMs = nowMs() - svgInlineStart;
  }
  if (skippedRasterCount > 0) {
    diagnostics.push({
      code: 'raster_skipped_invisible',
      severity: 'info',
      message: `Skipped ${skippedRasterCount} off-screen or invisible raster fallback target(s)`,
    });
  }
  let rasterMs = 0;
  if (!opts?.fastMode && pendingRectCaptures.length > 0 && sendRuntimeMessage) {
    const rasterStart = nowMs();
    try {
      const rem = Math.min(assetTimeoutMs * pendingRectCaptures.length, Math.max(1500, readinessDeadline - Date.now()));
      const batchRes = (await withTimeout(
        Promise.resolve(
          sendRuntimeMessage({
            action: 'capture-element-rects',
            items: pendingRectCaptures.map((r) => ({ key: r.assetKey, box: r.box })),
          })
        ),
        rem
      )) as
        | {
            success?: boolean;
            results?: Array<{ key: string; success: boolean; reason?: string; mimeType?: string; base64?: string }>;
          }
        | undefined;
      if (batchRes?.success && Array.isArray(batchRes.results)) {
        const byKey = new Map(batchRes.results.map((r) => [r.key, r]));
        for (const req of pendingRectCaptures) {
          const res = byKey.get(req.assetKey);
          if (res?.success && res.base64) {
            assets[req.assetKey] = { kind: 'image', mimeType: res.mimeType || 'image/png', base64: res.base64 };
            assetsFetched++;
            assetBytes += Math.floor((res.base64.length * 3) / 4);
          } else if (res?.reason === 'raster_too_large') {
            assetsFailed++;
            warning(report, 'raster_too_large', `Element exceeds max raster tile budget (${req.reason}).`, req.nodeId);
          } else {
            assetsFailed++;
            warning(report, 'asset_unavailable', `Raster fallback (${req.reason}) could not capture element.`, req.nodeId);
          }
        }
      } else {
        for (const req of pendingRectCaptures) {
          try {
            const singleRem = Math.min(assetTimeoutMs, Math.max(1000, readinessDeadline - Date.now()));
            const res = (await withTimeout(
              Promise.resolve(sendRuntimeMessage({ action: 'capture-element-rect', box: req.box })),
              singleRem
            )) as { success?: boolean; mimeType?: string; base64?: string } | undefined;
            if (res?.success && res.base64) {
              assets[req.assetKey] = { kind: 'image', mimeType: res.mimeType || 'image/png', base64: res.base64 };
              assetsFetched++;
              assetBytes += Math.floor((res.base64.length * 3) / 4);
            } else {
              assetsFailed++;
              warning(report, 'asset_unavailable', `Raster fallback (${req.reason}) could not capture element.`, req.nodeId);
            }
          } catch {
            assetsFailed++;
            warning(report, 'asset_unavailable', `Raster fallback (${req.reason}) timed out or failed.`, req.nodeId);
          }
        }
      }
    } catch {
      for (const req of pendingRectCaptures) {
        assetsFailed++;
        warning(report, 'asset_unavailable', `Raster fallback (${req.reason}) timed out or failed.`, req.nodeId);
      }
    }
    rasterMs = nowMs() - rasterStart;
  }
  const assetsMs = assetsStart ? Math.max(0, (assetsEnd || nowMs()) - assetsStart) : 0;
  capture.assets = assets;
  capture.fonts = extractedFonts;
  if (diagnostics.length) capture.diagnostics = diagnostics;

  if (timingCtx?.wantTimings) {
    finalizeTimings(capture, timingCtx, {
      walk: roundMs(walkMs),
      freezeTransforms: roundMs(freezeTransformsMs),
      nodes: roundMs(nodesMs),
      text: roundMs(textMs),
      assets: roundMs(assetsMs),
      fonts: roundMs(fontsMs),
      raster: roundMs(rasterMs),
      fetchBridge: roundMs(fetchBridgeMs),
      svgInline: roundMs(svgInlineMs),
    }, {
      elementsWalked: elements.length,
      nodesEmitted: nodes.length,
      textCharsMeasured,
      transformedElements: measure.transformed.size,
      assetsFetched,
      assetsFailed,
      assetsTimedOut,
      assetBytes,
    });
  }
  return capture;
}

function resolveFastModeOpts(opts?: SerializeOptions): SerializeOptions | undefined {
  return opts?.fastMode
    ? {
        readinessBudgetMs: 3000,
        assetTimeoutMs: 1200,
        fontTimeoutMs: 50,
        imageOptions: { timeoutMs: 300, totalTimeoutMs: 500 },
        ...opts,
      }
    : opts;
}

export async function serializeDocument(
  doc: Document,
  opts?: SerializeOptions
): Promise<Capture> {
  const defaultView = doc.defaultView ?? window;
  const totalStart = nowMs();
  const effectiveOpts = resolveFastModeOpts(opts);
  const wantTimings = Boolean(effectiveOpts?.onTiming || effectiveOpts?.collectTimings);
  const readinessDeadline = Date.now() + boundedNumber(effectiveOpts?.readinessBudgetMs, 4000);

  const { diagnostics, scrollMs, waitImagesMs, prepareMs, fontDeadline } = await prepareCapture(doc, doc, effectiveOpts, !!effectiveOpts?.scrollStitch, readinessDeadline);

  const docEl = doc.documentElement;
  const body = doc.body;

  const frameWidth = Math.max(
    docEl?.clientWidth ?? 0,
    defaultView.innerWidth ?? 1200
  );

  const frameHeight = Math.max(
    docEl?.scrollHeight ?? 0,
    docEl?.clientHeight ?? 0,
    body?.scrollHeight ?? 0,
    defaultView.innerHeight ?? 800
  );

  const targetRoot = body || docEl;
  if (!targetRoot) {
    const empty = emptyCapture({
      url: defaultView.location?.href || 'about:blank',
      version: '0.2.2',
      ...(diagnostics.length ? { diagnostics } : {}),
    });
    if (wantTimings) {
      finalizeTimings(empty, { totalStart, scrollMs, waitImagesMs, prepareMs, wantTimings, onTiming: opts?.onTiming },
        { walk: 0, freezeTransforms: 0, nodes: 0, text: 0, assets: 0, fonts: 0, raster: 0, fetchBridge: 0, svgInline: 0 },
        { elementsWalked: 0, nodesEmitted: 0, textCharsMeasured: 0, transformedElements: 0, assetsFetched: 0, assetsFailed: 0, assetsTimedOut: 0, assetBytes: 0 });
    }
    return empty;
  }

  return serializeSubtree(
    targetRoot,
    doc,
    {
      originX: 0,
      originY: 0,
      width: frameWidth,
      height: frameHeight,
    },
    effectiveOpts,
    diagnostics,
    wantTimings ? { totalStart, scrollMs, waitImagesMs, prepareMs, wantTimings, onTiming: effectiveOpts?.onTiming } : undefined,
    fontDeadline,
    readinessDeadline
  );
}

export async function serializeElement(
  el: Element,
  opts?: SerializeOptions
): Promise<Capture> {
  const totalStart = nowMs();
  const effectiveOpts = resolveFastModeOpts(opts);
  const wantTimings = Boolean(effectiveOpts?.onTiming || effectiveOpts?.collectTimings);
  const readinessDeadline = Date.now() + boundedNumber(effectiveOpts?.readinessBudgetMs, 4000);
  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : (null as unknown as Document));
  const defaultView = doc?.defaultView ?? (typeof window !== 'undefined' ? window : (null as unknown as Window & typeof globalThis));
  const { diagnostics, scrollMs, waitImagesMs, prepareMs, fontDeadline } = await prepareCapture(el, doc, effectiveOpts, false, readinessDeadline);
  const scrollX = defaultView.scrollX ?? 0;
  const scrollY = defaultView.scrollY ?? 0;

  const rect = el.getBoundingClientRect();
  const originX = rect.left + scrollX;
  const originY = rect.top + scrollY;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);

  return serializeSubtree(
    el,
    doc,
    {
      originX,
      originY,
      width,
      height,
    },
    effectiveOpts,
    diagnostics,
    wantTimings ? { totalStart, scrollMs, waitImagesMs, prepareMs, wantTimings, onTiming: effectiveOpts?.onTiming } : undefined,
    fontDeadline,
    readinessDeadline
  );
}

export function startElementPicker(
  doc: Document,
  options: ElementPickerOptions
): () => void {
  const highlightColor = options.highlightColor || '#0284c7';
  const overlayId = '__capture_kit_picker_overlay';
  const badgeId = '__capture_kit_picker_badge';

  let overlay = doc.getElementById(overlayId);
  let badgeEl: Element | null = doc.getElementById(badgeId);
  if (!overlay && doc.body) {
    overlay = doc.createElement('div');
    overlay.id = overlayId;
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.border = `2px solid ${highlightColor}`;
    overlay.style.backgroundColor = `${highlightColor}20`;
    overlay.style.transition = 'all 60ms ease-out';
    overlay.style.display = 'none';

    const badge = doc.createElement('div');
    badge.id = badgeId;
    badge.style.position = 'absolute';
    badge.style.top = '-24px';
    badge.style.left = '0';
    badge.style.backgroundColor = highlightColor;
    badge.style.color = '#ffffff';
    badge.style.fontSize = '11px';
    badge.style.fontFamily = 'monospace';
    badge.style.fontWeight = '600';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '3px';
    badge.style.whiteSpace = 'nowrap';
    overlay.appendChild(badge);
    badgeEl = badge;

    doc.body.appendChild(overlay);
  }

  badgeEl = badgeEl ?? overlay?.firstElementChild ?? null;
  let hoveredElement: Element | null = null;
  const selectedElements: Element[] = [];
  const selectionOverlays: HTMLElement[] = [];

  function isPickerElement(el: Element | null): boolean {
    if (!el) return false;
    if (overlay && (el === overlay || overlay.contains(el))) return true;
    return selectionOverlays.some((selOverlay) => el === selOverlay || selOverlay.contains(el));
  }

  function formatElementLabel(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const classAttr = typeof el.getAttribute === 'function' ? el.getAttribute('class') : null;
    const classStr =
      classAttr ??
      (typeof (el as { className?: unknown }).className === 'string'
        ? (el as { className: string }).className
        : '');
    const firstClass = classStr.trim().split(/\s+/).find(Boolean) || '';
    return firstClass ? `${tag}.${firstClass}` : tag;
  }

  function updateOverlay(el: Element) {
    if (!overlay || isPickerElement(el)) return;
    hoveredElement = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    if (badgeEl) {
      const label = formatElementLabel(el);
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const countSuffix = selectedElements.length ? ` (${selectedElements.length} selected)` : '';
      badgeEl.textContent = `${label} · ${w}×${h}${countSuffix}`;
    }
  }

  function addSelectionOverlay(el: Element) {
    if (!doc.body) return;
    const rect = el.getBoundingClientRect();
    const selOverlay = doc.createElement('div');
    selOverlay.style.position = 'fixed';
    selOverlay.style.pointerEvents = 'none';
    selOverlay.style.zIndex = '2147483646';
    selOverlay.style.border = '2px solid #10b981';
    selOverlay.style.background = 'rgba(16,185,129,0.12)';
    selOverlay.style.left = `${rect.left}px`;
    selOverlay.style.top = `${rect.top}px`;
    selOverlay.style.width = `${rect.width}px`;
    selOverlay.style.height = `${rect.height}px`;
    doc.body.appendChild(selOverlay);
    selectionOverlays.push(selOverlay);
  }

  function finishMultiSelect() {
    const picked = [...selectedElements];
    cleanup();
    if (options.onMultiSelect) {
      void options.onMultiSelect(picked);
    } else {
      options.onSelect(picked[0]);
    }
  }

  function findFirstChildElement(el: Element | null): Element | null {
    let child = el?.firstElementChild ?? null;
    while (child && isPickerElement(child)) {
      child = child.nextElementSibling;
    }
    return child;
  }

  function handleMouseMove(e: MouseEvent) {
    if (typeof doc.elementFromPoint !== 'function') return;
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (el && !isPickerElement(el)) {
      updateOverlay(el);
    }
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!hoveredElement) return;

    if (e.shiftKey) {
      if (!selectedElements.includes(hoveredElement)) {
        selectedElements.push(hoveredElement);
        addSelectionOverlay(hoveredElement);
      }
      updateOverlay(hoveredElement);
      return;
    }

    if (selectedElements.length > 0) {
      if (!selectedElements.includes(hoveredElement)) {
        selectedElements.push(hoveredElement);
      }
      finishMultiSelect();
      return;
    }

    const target = hoveredElement;
    cleanup();
    options.onSelect(target);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cleanup();
      options.onCancel?.();
    } else if (e.key === 'ArrowUp') {
      if (hoveredElement?.parentElement && hoveredElement.parentElement !== doc.documentElement) {
        e.preventDefault();
        updateOverlay(hoveredElement.parentElement);
      }
    } else if (e.key === 'ArrowDown') {
      const child = findFirstChildElement(hoveredElement);
      if (child) {
        e.preventDefault();
        updateOverlay(child);
      }
    } else if (e.key === 'Enter') {
      if (selectedElements.length > 0) {
        e.preventDefault();
        finishMultiSelect();
      }
    }
  }

  function cleanup() {
    doc.removeEventListener('mousemove', handleMouseMove as EventListener, true);
    doc.removeEventListener('click', handleClick as EventListener, true);
    doc.removeEventListener('keydown', handleKeyDown as EventListener, true);
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    for (const selOverlay of selectionOverlays) {
      if (selOverlay.parentNode) {
        selOverlay.parentNode.removeChild(selOverlay);
      }
    }
    selectionOverlays.length = 0;
    selectedElements.length = 0;
    hoveredElement = null;
  }

  doc.addEventListener('mousemove', handleMouseMove as EventListener, true);
  doc.addEventListener('click', handleClick as EventListener, true);
  doc.addEventListener('keydown', handleKeyDown as EventListener, true);

  return cleanup;
}
export * from './replica.js';
