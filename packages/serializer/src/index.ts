import {
  type Asset,
  type Capture,
  type CaptureDiagnostic,
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
  /** Concurrent image asset fetches, default 8. */
  assetConcurrency?: number;
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
  const concurrency = Math.floor(boundedNumber(opts?.concurrency, 8, 1));
  const maxImages = opts?.maxImages === undefined ? Infinity : Math.floor(boundedNumber(opts.maxImages, Infinity));
  const images: HTMLImageElement[] = [];
  if ('tagName' in root && root.tagName.toLowerCase() === 'img') images.push(root as HTMLImageElement);
  if (typeof root.querySelectorAll === 'function') images.push(...Array.from(root.querySelectorAll<HTMLImageElement>('img')));
  const doc = 'tagName' in root ? root.ownerDocument : root;
  const viewportHeight = doc.defaultView?.innerHeight ?? 800;
  const candidates = images.filter((img) => {
    const source = resolveHighestDpiSrc(img);
    if (!source || state.sources.get(img) === source) return false;
    if (!visibleOnly) return true;
    const rect = img.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= viewportHeight;
  });
  let next = 0;
  let decoded = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (next < candidates.length && state.considered < maxImages && state.pending < concurrency && Date.now() < deadline) {
      const img = candidates[next++];
      const source = resolveHighestDpiSrc(img);
      state.sources.set(img, source);
      state.considered++;
      try {
        if (img.complete) {
          if (img.naturalWidth <= 0) throw new Error('Image has no decoded pixels');
        } else if (typeof img.decode === 'function') {
          const decoding = img.decode();
          state.pending++;
          const pending = decoding.finally(() => { state.pending--; });
          await withTimeout(pending, Math.min(timeoutMs, Math.max(0, deadline - Date.now())));
        } else {
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
          await promise;
        }
        decoded++;
        state.sources.set(img, resolveHighestDpiSrc(img));
      } catch (error) {
        warning(state.report, error instanceof CaptureTimeout ? 'image_timeout' : 'image_failed',
          `${error instanceof CaptureTimeout ? 'Image readiness timed out' : 'Image could not be decoded'}: ${source}`);
        // Decode cannot be cancelled. Do not start another image in this slot
        // while a timed-out browser decode may still be pending.
        if (error instanceof CaptureTimeout) return;
      }
    }
  }));
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

async function prepareCapture(
  root: Document | Element,
  doc: Document,
  opts: SerializeOptions | undefined,
  scroll: boolean
): Promise<CaptureDiagnostic[]> {
  const diagnostics: CaptureDiagnostic[] = [];
  const seen = new Set<string>();
  const report: ReportDiagnostic = (diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.nodeId ?? ''}|${diagnostic.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(diagnostic);
    }
  };
  const state: ImageReadinessState = { sources: new Map(), considered: 0, pending: 0, report };
  const fontState: FontReadinessState = { ready: null, waited: false };
  if (scroll && doc.defaultView) {
    try {
      await scrollPage(doc.defaultView, opts?.scrollOptions, (deadline) => Promise.all([
        waitForImageElements(root, opts?.imageOptions, state, true, deadline),
        waitForFonts(doc, Math.min(boundedNumber(opts?.fontTimeoutMs, 2500), Math.max(0, deadline - Date.now())), report, fontState),
      ]), report);
    } catch (error) {
      warning(report, 'scroll_failed', `Page scrolling failed; lazy content may be incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await Promise.all([
    waitForImageElements(root, opts?.imageOptions, state),
    waitForFonts(doc, opts?.fontTimeoutMs, report, fontState),
  ]);
  return diagnostics;
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

function parseBoxShadow(shadowStr: string) {
  if (!shadowStr || shadowStr === 'none') return [];
  const parts = shadowStr.split(/,(?![^(]*\))/);
  const shadows = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const inset = trimmed.includes('inset');
    const clean = trimmed.replace('inset', '').trim();
    const colorMatch = clean.match(/rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+/);
    const color = colorMatch ? colorMatch[0] : 'rgba(0, 0, 0, 0.2)';
    const lengths = clean
      .replace(color, '')
      .trim()
      .split(/\s+/)
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
  const m = uri.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!m) return null;
  const mimeType = m[1];
  if (m[2]) return { mimeType, base64: m[3] };
  try {
    const decoded = decodeURIComponent(m[3]);
    return { mimeType, base64: btoa(unescape(encodeURIComponent(decoded))) };
  } catch {
    return null;
  }
}
function resolveHighestDpiSrc(img: HTMLImageElement): string {
  if (img.currentSrc) return img.currentSrc;
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const candidates = srcset.split(',').map((s) => s.trim().split(/\s+/));
    let bestUrl = '';
    let bestDensity = 0;
    for (const [candUrl, descriptor] of candidates) {
      if (!candUrl) continue;
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
    if (bestUrl) return bestUrl;
  }
  return img.src || img.getAttribute('src') || '';
}
// Deterministic subpixel boxes: 1341.333px renders identically to 1341.33px
// at any real zoom, but long float tails make exports non-repeatable.
const round2 = (n: number): number => Math.round(n * 100) / 100;

function parseCssGradients(bgImage: string): Fill[] {
  if (!bgImage || bgImage === 'none') return [];
  const fills: Fill[] = [];

  const linearMatches = bgImage.matchAll(/linear-gradient\(\s*([^()]+|\([^()]*\))+\)/gi);
  for (const m of linearMatches) {
    const inside = m[0].replace(/^linear-gradient\(\s*|\s*\)$/gi, '').trim();
    const parts = inside.split(/,(?![^(]*\))/).map((s) => s.trim());
    if (parts.length >= 2) {
      let angle = 180;
      let stopStartIndex = 0;

      const first = parts[0].toLowerCase();
      if (first.includes('deg')) {
        angle = parseFloat(first) || 180;
        stopStartIndex = 1;
      } else if (first.includes('to right') && first.includes('top')) {
        angle = 45;
        stopStartIndex = 1;
      } else if (first.includes('to right') && first.includes('bottom')) {
        angle = 135;
        stopStartIndex = 1;
      } else if (first.includes('to left') && first.includes('bottom')) {
        angle = 225;
        stopStartIndex = 1;
      } else if (first.includes('to left') && first.includes('top')) {
        angle = 315;
        stopStartIndex = 1;
      } else if (first.includes('to right')) {
        angle = 90;
        stopStartIndex = 1;
      } else if (first.includes('to left')) {
        angle = 270;
        stopStartIndex = 1;
      } else if (first.includes('to top')) {
        angle = 0;
        stopStartIndex = 1;
      } else if (first.includes('to bottom')) {
        angle = 180;
        stopStartIndex = 1;
      }

      const rawStops = parts.slice(stopStartIndex);
      const stops: Array<{ color: string; position: number }> = [];

      for (let i = 0; i < rawStops.length; i++) {
        const s = rawStops[i];
        const match = s.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)(?:\s+([\d.]+)%)?/i);
        if (match) {
          const color = match[1];
          const defaultPos = rawStops.length > 1 ? i / (rawStops.length - 1) : 0;
          const position = match[2] ? parseFloat(match[2]) / 100 : defaultPos;
          stops.push({ color, position: Math.max(0, Math.min(1, position)) });
        }
      }

      if (stops.length >= 2) {
        fills.push({
          type: 'gradient',
          gradientType: 'linear',
          angle,
          stops,
          opacity: 1,
        });
      }
    }
  }
  const radialMatches = bgImage.matchAll(/radial-gradient\(\s*([^()]+|\([^()]*\))+\)/gi);
  for (const m of radialMatches) {
    const inside = m[0].replace(/^radial-gradient\(\s*|\s*\)$/gi, '').trim();
    const parts = inside.split(/,(?![^(]*\))/).map((s) => s.trim());
    if (parts.length < 1) continue;

    // Skip the optional shape/size/position preamble (circle, ellipse, at center…).
    let stopStartIndex = 0;
    let cx: number | undefined;
    let cy: number | undefined;
    const first = parts[0].toLowerCase();
    if (first.includes('circle') || first.includes('ellipse') || first.includes('closest') || first.includes('farthest') || first.includes('at ') || /^\d/.test(first)) {
      stopStartIndex = 1;
      const atMatch = first.match(/at\s+([^\s,]+)(?:\s+([^\s,]+))?/);
      if (atMatch) {
        const parseAxis = (tok: string | undefined): number => {
          if (!tok || tok === 'center') return 0.5;
          if (tok === 'left' || tok === 'top') return 0;
          if (tok === 'right' || tok === 'bottom') return 1;
          if (tok.endsWith('%')) return Math.max(0, Math.min(1, (parseFloat(tok) || 50) / 100));
          return 0.5;
        };
        cx = parseAxis(atMatch[1]);
        cy = parseAxis(atMatch[2] ?? atMatch[1]);
      }
    }
    const rawStops = parts.slice(stopStartIndex);
    const stops: Array<{ color: string; position: number }> = [];

    for (let i = 0; i < rawStops.length; i++) {
      const s = rawStops[i];
      const match = s.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)(?:\s+([\d.]+)%)?/i);
      if (match) {
        const color = match[1];
        const defaultPos = rawStops.length > 1 ? i / (rawStops.length - 1) : 0;
        const position = match[2] ? parseFloat(match[2]) / 100 : defaultPos;
        stops.push({ color, position: Math.max(0, Math.min(1, position)) });
      }
    }

    if (stops.length >= 2) {
      fills.push({
        type: 'gradient',
        gradientType: 'radial',
        stops,
        opacity: 1,
        ...(cx !== undefined ? { cx } : {}),
        ...(cy !== undefined ? { cy } : {}),
      });
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
   const bgClip = computed.backgroundClip?.trim() || (computed as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip?.trim();
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

function extractSvgPaths(
  svgEl: Element
): Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }> {
  const paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }> = [];

  if (typeof svgEl.querySelectorAll !== 'function') return paths;
  for (const child of svgEl.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')) {
    if (typeof child.closest === 'function' && child.closest('defs, clipPath, mask, pattern, marker')) continue;
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
      let fill = child.getAttribute('fill') || (typeof child.closest === 'function' ? child.closest('[fill]')?.getAttribute('fill') : null) || undefined;
      let stroke = child.getAttribute('stroke') || (typeof child.closest === 'function' ? child.closest('[stroke]')?.getAttribute('stroke') : null) || undefined;
      if (fill && fill.startsWith('url(')) {
        const gId = fill.match(/#([^)\s"']+)/)?.[1];
        const stop = gId ? svgEl.ownerDocument?.getElementById(gId)?.querySelector?.('stop') : null;
        fill = stop?.getAttribute?.('stop-color') || undefined;
      }
      if (!fill || fill === 'currentColor' || fill === 'inherit' || stroke === 'currentColor' || stroke === 'inherit') {
        try {
          const host = svgEl.tagName?.toLowerCase() === 'symbol' ? svgEl.closest('svg') ?? svgEl : svgEl;
          const cs = (svgEl.ownerDocument?.defaultView ?? window).getComputedStyle(host as Element);
          if (cs?.color) {
            if (!fill || fill === 'currentColor' || fill === 'inherit') fill = cs.color;
            if (stroke === 'currentColor' || stroke === 'inherit') stroke = cs.color;
          }
        } catch {
          // keep currentColor
        }
      }
      const sw = child.getAttribute('stroke-width');
      const strokeWidth = sw ? parseFloat(sw) : undefined;
      paths.push({ d, fill, stroke, strokeWidth });
    }
  }

  return paths;
}



async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parseCornerRadius(computed: CSSStyleDeclaration): CornerRadius {
  return {
    topLeft: Math.max(0, parseFloat(computed.borderTopLeftRadius) || 0),
    topRight: Math.max(0, parseFloat(computed.borderTopRightRadius) || 0),
    bottomRight: Math.max(0, parseFloat(computed.borderBottomRightRadius) || 0),
    bottomLeft: Math.max(0, parseFloat(computed.borderBottomLeftRadius) || 0),
  };
}

function parseStrokes(computed: CSSStyleDeclaration): Stroke[] {
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
      const ok = w > 0 && e.style && e.style !== 'none' && e.color && e.color !== 'transparent' && e.color !== 'rgba(0, 0, 0, 0)';
      const st: 'solid' | 'dashed' | 'dotted' = e.style === 'dashed' || e.style === 'dotted' ? e.style : 'solid';
      return ok ? { side: e.side, width: w, style: st, color: e.color } : null;
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
    const oc = computed.outlineColor;
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

    const bg = computed.backgroundColor;
    const hasBg = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
    const strokes = parseStrokes(computed);
    const radius = parseCornerRadius(computed);
    const shadows = parseBoxShadow(computed.boxShadow);
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

    const isVisibleShape = (hasBg || strokes.length > 0) && borderW > 0 && borderH > 0;
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
      y = Number.isNaN(topVal) ? parentBox.y + pBdT : parentBox.y + pBdT + topVal;
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
    const fills: Fill[] = hasBg ? [{ type: 'solid', color: bg, opacity: 1 }] : [];
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
          color: computed.color || 'rgba(0, 0, 0, 1)',
          ...extractTextFidelity(computed),
        },
      });
    }

    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
async function extractWebFonts(
  doc: Document,
  baseURI: string,
  assets: Record<string, Asset>,
  nextAssetId: () => string,
  report: ReportDiagnostic,
  timeoutMs: number
): Promise<Font[]> {
  const fonts: Font[] = [];
  const seenFamilies = new Set<string>();
  const defaultView = doc.defaultView ?? window;
  const deadline = Date.now() + timeoutMs;

  // 1. Inspect doc.fonts (FontFaceSet API)
  if (doc.fonts && typeof doc.fonts.forEach === 'function') {
    try {
      doc.fonts.forEach((fontFace: FontFace) => {
        const family = fontFace.family.replace(/^["']|["']$/g, '').trim();
        if (family && !seenFamilies.has(family)) {
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

  // 2. Inspect CSSStyleSheets for @font-face rules
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
          if (rule.type === 5) {
            const fontRule = rule as CSSFontFaceRule;
            const style = fontRule.style;
            if (!style) continue;

            const family = (style.fontFamily || '').replace(/^["']|["']$/g, '').trim();
            if (!family) continue;

            const weight = style.fontWeight || '400';
            const fontStyle = style.fontStyle || 'normal';

            let assetRef: string | undefined;
            const srcDeclaration =
              typeof style.getPropertyValue === 'function'
                ? style.getPropertyValue('src')
                : '';
            const match = srcDeclaration.match(/url\(\s*['"]?(.*?)['"]?\s*\)/);
            if (match && match[1]) {
              const fontUrl = match[1];
              if (fontUrl.startsWith('data:')) {
                const dataMatch = fontUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (dataMatch) {
                  const assetKey = nextAssetId();
                  assets[assetKey] = {
                    kind: 'font',
                    mimeType: dataMatch[1],
                    base64: dataMatch[2],
                  };
                  assetRef = assetKey;
                } else {
                  warning(report, 'asset_failed', `Font data could not be read: ${family}`);
                }
              } else {
                try {
                  const resolved = new URL(fontUrl, baseURI);
                  const isSameOrigin = resolved.origin === defaultView.location?.origin;
                  if (isSameOrigin || resolved.protocol === 'blob:') {
                    if (Date.now() >= deadline) throw new CaptureTimeout('Font asset budget exhausted');
                    const blob = await fetchAssetBlob(resolved.href, Math.max(0, deadline - Date.now()));
                    const buffer = await withTimeout(blob.arrayBuffer(), Math.max(0, deadline - Date.now()));
                    const base64 = await arrayBufferToBase64(buffer);
                    const assetKey = nextAssetId();
                    assets[assetKey] = {
                      kind: 'font',
                      mimeType: blob.type || 'font/woff2',
                      base64,
                    };
                    assetRef = assetKey;
                  } else {
                    warning(report, 'asset_unavailable', `Cross-origin font bytes were not embedded: ${resolved.href}`);
                  }
                } catch (error) {
                  warning(report, error instanceof CaptureTimeout ? 'asset_timeout' : 'asset_failed',
                    `Font asset could not be embedded: ${family} (${fontUrl})`);
                }
              }
            }

            const fontIdentity = `${family}|${weight}|${fontStyle}`;
            if (!seenFamilies.has(fontIdentity)) {
              seenFamilies.add(fontIdentity);
              fonts.push({
                family,
                weight,
                style: fontStyle,
                assetRef,
              });
            }
          }
        }
      }
    }
  } catch {
    warning(report, 'asset_unavailable', 'Stylesheets could not be inspected for font assets.');
  }

  return fonts;
}


/**
 * Transcode rasters that vector importers reject (webp/avif/bmp) to PNG via
 * an offscreen canvas. Returns null when no transcode is needed or possible,
 * in which case the caller keeps the original bytes.
 */
async function transcodeToPng(
  blob: Blob,
  report: ReportDiagnostic,
  nodeId: string,
  timeoutMs: number
): Promise<Blob | null> {
  const t = (blob.type || '').toLowerCase();
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/gif' || t === 'image/svg+xml') {
    return null;
  }
  let bitmap: ImageBitmap | undefined;
  let expired = false;
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      throw new Error('Image conversion is unavailable');
    }
    const decoded = await withTimeout(createImageBitmap(blob).then((value) => {
      if (expired) value.close();
      return value;
    }), timeoutMs);
    bitmap = decoded;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, decoded.width);
    canvas.height = Math.max(1, decoded.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable');
    ctx.drawImage(decoded, 0, 0);
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, 'image/png');
    const out = await withTimeout(promise, timeoutMs);
    if (!out) throw new Error('Canvas returned no image bytes');
    return out;
  } catch (error) {
    expired = true;
    warning(report, error instanceof CaptureTimeout ? 'asset_timeout' : 'asset_unavailable',
      `Image could not be converted to PNG; original ${t || 'unknown-format'} bytes were retained.`, nodeId);
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
  diagnostics: CaptureDiagnostic[] = []
): Promise<Capture> {
  const report: ReportDiagnostic = (diagnostic) => diagnostics.push(diagnostic);
  const assetTimeoutMs = boundedNumber(opts?.assetTimeoutMs, 2500);
  const defaultView = doc.defaultView ?? window;
  const scrollX = defaultView.scrollX ?? 0;
  const scrollY = defaultView.scrollY ?? 0;

  const baseURI = opts?.baseURI || doc.baseURI || defaultView.location?.href || 'about:blank';

  let rootBackground: string | undefined;
  try {
    const rootEl = doc.documentElement;
    if (rootEl) {
      const rootBg = defaultView.getComputedStyle(rootEl).backgroundColor;
      if (rootBg && rootBg !== 'transparent' && rootBg !== 'rgba(0, 0, 0, 0)') {
        rootBackground = rootBg;
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
  const pendingAssetFetches: Array<{ url: string; assetKey: string; nodeId: string }> = [];
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
  walkInto(root);
  for (let i = 0; i < elements.length; i++) {
    const sr = (elements[i] as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) walkInto(sr);
  }

  // Freeze every active transform so all measurement below (element rects,
  // range rects, pseudo boxes) happens in pure layout space. Frozen values
  // are folded back per node as one composed matrix after the walk.
  const measure: MeasureState = {
    transformed: new Set(),
    frozen: new Map(),
    boxes: new Map(),
  };
  for (const el of elements) {
    const frozen = freezeTransform(el, defaultView);
    if (frozen) {
      measure.transformed.add(el);
      measure.frozen.set(el, frozen);
    }
  }
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
    const bg = computed.backgroundColor;
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
          if (isSameOrigin || resolvedUrl.protocol === 'blob:') {
            const cachedKey = urlToAssetKeyCache.get(resolvedUrl.href);
            if (cachedKey) {
              fills.push({ type: 'image', assetRef: cachedKey, opacity: 1 });
            } else {
              const assetKey = `asset-${nextAssetId++}`;
              urlToAssetKeyCache.set(resolvedUrl.href, assetKey);
              pendingAssetFetches.push({ url: resolvedUrl.href, assetKey, nodeId });
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
    const gradients = parseCssGradients(computed.backgroundImage);
    fills.push(...gradients);


    const strokes = parseStrokes(computed);
    const opacity = Math.max(0, Math.min(1, parseFloat(computed.opacity) || 1));
    const radius = parseCornerRadius(computed);
    const shadows = parseBoxShadow(computed.boxShadow);
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
      try {
        const canvasEl = el as HTMLCanvasElement;
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
          }
        }
      } catch {
        // Report the unavailable snapshot below, including tainted canvases.
      }
      if (!assetRef) warning(report, 'canvas_unavailable', 'Canvas pixels could not be captured; the image layer has no embedded snapshot.', nodeId);

      nodes.push({
        id: nodeId,
        parentId,
        type: 'image',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
        assetRef,
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
        }
      } catch {
        warning(report, 'asset_failed', 'Inline SVG bytes could not be captured.', nodeId);
      }

       // Sprite <use> refs keep their shapes in a <symbol> elsewhere: query
       // the resolved target so vector-first fires for sprite icons too.
       const spriteTarget = (() => {
         try {
           const u = typeof el.querySelector === 'function' ? el.querySelector('use') : null;
           const href = u?.getAttribute?.('href') ?? u?.getAttribute?.('xlink:href');
           if (!u || !href) return null;
           const fragId = decodeURIComponent(href.split('#').pop() || '');
           return fragId ? doc.getElementById(fragId) : null;
         } catch {
           return null;
         }
       })();
       // Clip-region rules: the symbol's own <clipPath> shapes are region
      // geometry, not artwork — keeping them paints a solid box behind the
      // real shapes (netlify's white rect). Match by path data.
      const clipDs = (() => {
        try {
          const scope = spriteTarget ?? el;
          if (typeof scope.querySelectorAll !== 'function') return new Set<string>();
          const out = new Set<string>();
          for (const cp of scope.querySelectorAll('clipPath')) {
            for (const s of (cp as Element).querySelectorAll('path, rect, circle, polygon')) {
              const dd = (s as Element).getAttribute?.('d');
              if (dd) out.add(dd);
            }
          }
          return out;
        } catch {
          return new Set<string>();
        }
      })();
      const vectorPaths = extractSvgPaths(spriteTarget ?? el).filter((p) => !clipDs.has(p.d));
      // Vector-first: path-bearing svgs travel as real vector data, which
      // every importer honors. The base64 asset stays as fallback for
      // shape types paths can't express.
      const vectorFirst = vectorPaths.length > 0;
       // Intrinsic viewBox size: destinations scale path units into the box.
       const vectorViewBox = (() => {
         try {
           // Sprite symbols rarely carry their own viewBox: fall back to the
          // host svg's (astro puts 0 0 512 209 on the svg, not the symbol).
          const vb = (spriteTarget ?? el).getAttribute?.('viewBox') || el.getAttribute?.('viewBox');
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
            if (isSameOrigin || resolvedUrl.protocol === 'blob:') {
              const cachedKey = urlToAssetKeyCache.get(resolvedUrl.href);
              if (cachedKey) {
                assetRef = cachedKey;
              } else {
                const assetKey = `asset-${nextAssetId++}`;
                urlToAssetKeyCache.set(resolvedUrl.href, assetKey);
                pendingAssetFetches.push({ url: resolvedUrl.href, assetKey, nodeId });
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

    // 3. Iframe elements (same-origin traversal)
    if (tagName === 'iframe') {
      let iframeLabel: string | undefined;
      try {
        const host = new URL((el as HTMLIFrameElement).src || '', defaultView.location?.href || baseURI).hostname.replace(/^www\./, '');
        if (host) iframeLabel = `Embed · ${host.slice(0, 24)}`;
      } catch {
        // ignore
      }
      nodes.push({
        id: nodeId,
        ...(iframeLabel ? { name: iframeLabel } : semanticName ? { name: semanticName } : {}),
        parentId,
        type: 'frame',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
      });

      try {
        const iframeEl = el as HTMLIFrameElement;
        const iframeDoc = iframeEl.contentDocument;
        if (iframeDoc && (iframeDoc.body || iframeDoc.documentElement)) {
          const iframeRoot = iframeDoc.body || iframeDoc.documentElement;
          const iframeDiagnostics = await prepareCapture(iframeRoot, iframeDoc, opts, false);
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
        } else {
          warning(report, 'asset_unavailable', 'Embedded document is unavailable or cross-origin; its content was not captured.', nodeId);
        }
      } catch {
        warning(report, 'asset_unavailable', 'Embedded document content could not be captured.', nodeId);
      }
      continue;
    }

    // 2b. Video elements: rasterize the current frame so the replica shows
    // exactly what the user saw instead of a dead black box.
    if (tagName === 'video') {
      const videoEl = el as HTMLVideoElement;
      let assetRef: string | undefined;
      try {
        if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          const canvas = doc.createElement('canvas');
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(videoEl, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const match = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
          if (match) {
            const assetKey = `asset-${nextAssetId++}`;
            assets[assetKey] = { kind: 'image', mimeType: 'image/jpeg', base64: match[1] };
            assetRef = assetKey;
          }
        }
      } catch {
        // Tainted/cross-origin video: fall back to poster attribute below.
        const poster = videoEl.getAttribute('poster');
        if (poster?.startsWith('data:image/')) {
          const m = poster.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            const assetKey = `asset-${nextAssetId++}`;
            assets[assetKey] = { kind: 'image', mimeType: m[1], base64: m[2] };
            assetRef = assetKey;
          }
        }
      }
      if (!assetRef) warning(report, 'asset_unavailable', 'Video frame pixels could not be captured.', nodeId);

      nodes.push({
        id: nodeId,
        parentId,
        type: 'image',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
        assetRef,
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
    const hasVisualDecoration =
      fills.length > 0 ||
      strokes.length > 0 ||
      shadows.length > 0 ||
      radius.topLeft > 0;

    if (!hasVisualDecoration && !hasChildren && childTextNodes.length > 0) {
      const combinedText = childTextNodes
        .map((n) => n.textContent || '')
        .join(' ')
        .trim();

      const fontSize = parseFloat(computed.fontSize) || 16;
      const lineHeightValue = parseFloat(computed.lineHeight);
      const lineHeight: number | string = Number.isNaN(lineHeightValue)
        ? 'normal'
        : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue)
        ? 0
        : letterSpacingValue;

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

      let runs: Array<{ text: string; x?: number; y?: number; w?: number; fontFamily?: string; fontSize?: number; fontWeight?: string | number; color?: string }> | undefined;
      if (typeof doc.createRange === 'function' && childTextNodes.length === 1) {
        try {
          const tNode = childTextNodes[0];
          const fullStr = tNode.textContent || '';
          const range = doc.createRange();
          range.selectNodeContents(tNode);
          const clientRects = range.getClientRects();
          if (clientRects && clientRects.length > 1) {
            const lineRuns: Array<{ text: string; x?: number; y?: number; w?: number }> = [];
            let currentLine = '';
            let minL = Infinity, minT = Infinity, maxR = -Infinity;
            let prevTop: number | null = null;
            const charRange = doc.createRange();
            for (let ci = 0; ci < fullStr.length; ci++) {
              charRange.setStart(tNode, ci);
              charRange.setEnd(tNode, ci + 1);
              const cr = charRange.getBoundingClientRect();
              if (cr.width === 0 && cr.height === 0) {
                currentLine += fullStr[ci];
                continue;
              }
              if (prevTop !== null && Math.abs(cr.top - prevTop) > fontSize * 0.4) {
                if (currentLine.trim()) {
                  lineRuns.push({
                    text: currentLine.trim(),
                    ...(minL < Infinity ? { x: round2(minL + scrollX - frameRect.originX), y: round2(minT + scrollY - frameRect.originY), w: round2(maxR - minL + 2) } : {}),
                  });
                }
                currentLine = fullStr[ci];
                minL = cr.left; minT = cr.top; maxR = cr.right;
              } else {
                currentLine += fullStr[ci];
                minL = Math.min(minL, cr.left); minT = Math.min(minT, cr.top); maxR = Math.max(maxR, cr.right);
              }
              prevTop = cr.top;
            }
            if (currentLine.trim()) {
              lineRuns.push({
                text: currentLine.trim(),
                ...(minL < Infinity ? { x: round2(minL + scrollX - frameRect.originX), y: round2(minT + scrollY - frameRect.originY), w: round2(maxR - minL + 2) } : {}),
              });
            }
            if (lineRuns.length > 1) runs = lineRuns;
          }
        } catch {
          // ignore
        }
      }

      nodes.push({
        id: nodeId,
        ...(semanticName ? { name: semanticName } : {}),
        parentId,
        type: 'text',
        box: { x: cbX, y: cbY, w: cbW, h: cbH },
        style,
        text: {
          content: combinedText,
          fontFamily: computed.fontFamily || 'system-ui, sans-serif',
          fontSize,
          fontWeight: computed.fontWeight || 400,
          lineHeight,
          letterSpacing,
          align: parseTextAlign(computed.textAlign),
          color: computed.color || 'rgba(0, 0, 0, 1)',
          ...(runs ? { runs } : {}),
          ...extractTextFidelity(computed),
        },
      });
      continue;
    }

    const isBgClipText = style.backgroundClip === 'text';
    const containerStyle = isBgClipText ? { ...style, fills: [] } : style;

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
      const textVal = textNode.textContent?.trim() || '';
      if (!textVal) continue;

      let textX = x;
      let textY = y;
      let textW = w;
      let textH = h;

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
          const range = doc.createRange();
          range.selectNodeContents(textNode);
          const clientRects = range.getClientRects?.();
          const fullStr = textNode.textContent || '';
          if (clientRects && clientRects.length > 1) {
            let curText = '';
            let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
            let prevTop: number | null = null;
            const crRange = doc.createRange();
            for (let ci = 0; ci < fullStr.length; ci++) {
              crRange.setStart(textNode, ci);
              crRange.setEnd(textNode, ci + 1);
              const cr = crRange.getBoundingClientRect();
              if (cr.width === 0 && cr.height === 0) {
                curText += fullStr[ci];
                continue;
              }
              if (prevTop !== null && Math.abs(cr.top - prevTop) > fontSize * 0.4) {
                if (curText.trim() && minL < Infinity) {
                  lineBoxes.push({ text: curText.trim(), x: minL + scrollX - frameRect.originX, y: minT + scrollY - frameRect.originY, w: maxR - minL + 2, h: maxB - minT });
                }
                curText = fullStr[ci];
                minL = cr.left; minT = cr.top; maxR = cr.right; maxB = cr.bottom;
              } else {
                curText += fullStr[ci];
                minL = Math.min(minL, cr.left); minT = Math.min(minT, cr.top);
                maxR = Math.max(maxR, cr.right); maxB = Math.max(maxB, cr.bottom);
              }
              prevTop = cr.top;
            }
            if (curText.trim() && minL < Infinity) {
              lineBoxes.push({ text: curText.trim(), x: minL + scrollX - frameRect.originX, y: minT + scrollY - frameRect.originY, w: maxR - minL + 2, h: maxB - minT });
            }
          }
          if (lineBoxes.length === 0) {
            const rangeRect = range.getBoundingClientRect();
            if (rangeRect.width > 0 && rangeRect.height > 0) {
              lineBoxes.push({ text: textVal, x: rangeRect.left + scrollX - frameRect.originX, y: rangeRect.top + scrollY - frameRect.originY, w: rangeRect.width + 2, h: rangeRect.height });
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
            fills: isBgClipText ? style.fills : [],
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
            color:
              isBgClipText && style.fills[0]?.stops?.[0]?.color
                ? style.fills[0].stops[0].color
                : computed.color || 'rgba(0, 0, 0, 1)',
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
  // Resolve assets with bounded concurrency, including the extension fallback.
  let nextFetch = 0;
  const assetConcurrency = Math.floor(boundedNumber(opts?.assetConcurrency, 8, 1));
  await Promise.all(Array.from({ length: Math.min(assetConcurrency, pendingAssetFetches.length) }, async () => {
    while (nextFetch < pendingAssetFetches.length) {
      const { url, assetKey, nodeId } = pendingAssetFetches[nextFetch++];
      let failure: unknown;
      try {
        const blob = await fetchAssetBlob(url, assetTimeoutMs);
        const transcoded = await transcodeToPng(blob, report, nodeId, assetTimeoutMs);
        const finalBlob = transcoded ?? blob;
        const buffer = await withTimeout(finalBlob.arrayBuffer(), assetTimeoutMs);
        const base64 = await arrayBufferToBase64(buffer);
        assets[assetKey] = { kind: 'image', mimeType: finalBlob.type || 'image/png', base64 };
      } catch (error) {
        failure = error;
        const rawChrome: unknown = defaultView && 'chrome' in defaultView ? defaultView.chrome : undefined;
        const runtime = rawChrome && typeof rawChrome === 'object' && 'runtime' in rawChrome ? rawChrome.runtime : undefined;
        if (runtime && typeof runtime === 'object' && 'sendMessage' in runtime && typeof runtime.sendMessage === 'function') {
          try {
            const bg = (await withTimeout(Promise.resolve(runtime.sendMessage({ action: 'fetch-asset', url })), assetTimeoutMs)) as { success?: boolean; mimeType?: string; base64?: string } | undefined;
            if (bg?.success && bg.base64) {
              assets[assetKey] = { kind: 'image', mimeType: bg.mimeType || 'image/png', base64: bg.base64 };
            }
          } catch (error) {
            failure = error;
          }
        }
      }
      if (!assets[assetKey]) {
        warning(report, failure instanceof CaptureTimeout ? 'asset_timeout' : 'asset_failed',
          `Image asset could not be embedded: ${url}${failure instanceof Error ? ` (${failure.message})` : ''}`, nodeId);
      }
    }
  }));

  for (const n of nodes) {
    n.box.x = round2(n.box.x);
    n.box.y = round2(n.box.y);
    n.box.w = round2(n.box.w);
    n.box.h = round2(n.box.h);
  }
  capture.nodes = nodes;
  capture.assets = assets;
  capture.fonts = await extractWebFonts(doc, baseURI, assets, () => `asset-${nextAssetId++}`, report, assetTimeoutMs);
  if (diagnostics.length) capture.diagnostics = diagnostics;
  return capture;
}

export async function serializeDocument(
  doc: Document,
  opts?: SerializeOptions
): Promise<Capture> {
  const defaultView = doc.defaultView ?? window;

  const diagnostics = await prepareCapture(doc, doc, opts, !!opts?.scrollStitch);

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
    return emptyCapture({
      url: defaultView.location?.href || 'about:blank',
      version: '0.2.2',
      ...(diagnostics.length ? { diagnostics } : {}),
    });
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
    opts,
    diagnostics
  );
}

export async function serializeElement(
  el: Element,
  opts?: SerializeOptions
): Promise<Capture> {
  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : (null as unknown as Document));
  const defaultView = doc?.defaultView ?? (typeof window !== 'undefined' ? window : (null as unknown as Window & typeof globalThis));
  const diagnostics = await prepareCapture(el, doc, opts, false);
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
    opts,
    diagnostics
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

    doc.body.appendChild(overlay);
  }

  const badgeEl = doc.getElementById(badgeId);
  let currentTarget: Element | null = null;

  function updateOverlay(el: Element) {
    if (!overlay || el === overlay || overlay.contains(el)) return;
    currentTarget = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    if (badgeEl) {
      const tag = el.tagName.toLowerCase();
      const idStr = el.id ? `#${el.id}` : '';
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      badgeEl.textContent = `${tag}${idStr} (${w}x${h})`;
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (typeof doc.elementFromPoint !== 'function') return;
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== overlay && !overlay?.contains(el)) {
      updateOverlay(el);
    }
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (currentTarget) {
      cleanup();
      options.onSelect(currentTarget);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cleanup();
      options.onCancel?.();
    }
  }

  function cleanup() {
    doc.removeEventListener('mousemove', handleMouseMove as EventListener, true);
    doc.removeEventListener('click', handleClick as EventListener, true);
    doc.removeEventListener('keydown', handleKeyDown as EventListener, true);
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  doc.addEventListener('mousemove', handleMouseMove as EventListener, true);
  doc.addEventListener('click', handleClick as EventListener, true);
  doc.addEventListener('keydown', handleKeyDown as EventListener, true);

  return cleanup;
}
