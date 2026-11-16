import { CaptureSchema, type Capture, type Layout, type Node, type TextProps } from '@capture-kit/model';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Build editable SVG markup using the viewBox's intrinsic aspect ratio. */
export function nativeSvgForPaths(source: Node): string {
  const width = source.vectorViewBox?.width ?? Math.max(0.01, source.box.w);
  const height = source.vectorViewBox?.height ?? Math.max(0.01, source.box.h);
  const paths = (source.vectorPaths ?? []).map((path) =>
    `<path d="${escapeXml(path.d)}" fill="${escapeXml(path.fill ?? 'black')}"${path.stroke ? ` stroke="${escapeXml(path.stroke)}" stroke-width="${path.strokeWidth ?? 1}"` : ''}/>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(0.01, source.box.w)}" height="${Math.max(0.01, source.box.h)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

export function nativeTextAlignment(align: TextProps['align']): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
  return align === 'justify' ? 'JUSTIFIED' : align.toUpperCase() as 'LEFT' | 'CENTER' | 'RIGHT';
}

export interface NativeDiagnostic {
  code: string;
  message: string;
  severity: 'warning' | 'info';
  nodeId?: string;
}

export interface NativeNodePlan {
  source: Node;
  children: NativeNodePlan[];
  layout: 'positioned' | 'horizontal' | 'vertical';
}

export interface NativeCapturePlan {
  capture: Capture;
  roots: NativeNodePlan[];
  diagnostics: NativeDiagnostic[];
}

/** Validate before touching the Figma document, including referential integrity. */
export function parseNativeCaptures(input: unknown): Capture[] {
  const values = Array.isArray(input) ? input : [input];
  if (!values.length) throw new Error('The capture array is empty.');
  return values.map((value, index) => {
    // Before the schema: zod 4 rejects Infinity itself, with a less helpful message.
    const finiteNumbers = (value: unknown): boolean => {
      if (typeof value === 'number') return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(finiteNumbers);
      if (value && typeof value === 'object') return Object.values(value).every(finiteNumbers);
      return true;
    };
    if (!finiteNumbers(value)) throw new Error(`Capture ${index + 1}: all numeric values must be finite.`);
    const parsed = CaptureSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Capture ${index + 1}: ${issue.path.join('.') || 'payload'}: ${issue.message}`);
    }
    const capture = parsed.data;
    if (capture.nodes.length > 25000) throw new Error(`Capture ${index + 1}: exceeds the 25,000 layer import limit.`);
    const nodes = new Map<string, Node>();
    for (const node of capture.nodes) {
      if (!node.id || nodes.has(node.id)) throw new Error(`Capture ${index + 1}: empty or duplicate node id '${node.id}'.`);
      if (node.type === 'text' && !node.text) throw new Error(`Text node '${node.id}' is missing text properties.`);
      nodes.set(node.id, node);
    }
    const done = new Map<string, number>();
    for (const node of capture.nodes) {
      const chain = new Set<string>();
      let current: Node | undefined = node;
      while (current && !done.has(current.id)) {
        if (chain.has(current.id)) throw new Error(`Capture ${index + 1}: cyclic hierarchy at '${current.id}'.`);
        chain.add(current.id);
        if (chain.size > 256) throw new Error(`Capture ${index + 1}: hierarchy exceeds 256 levels.`);
        if (current.parentId && !nodes.has(current.parentId)) throw new Error(`Node '${current.id}' has missing parent '${current.parentId}'.`);
        current = current.parentId ? nodes.get(current.parentId) : undefined;
      }
      let depth = current ? done.get(current.id)! : 0;
      if (depth + chain.size > 256) throw new Error(`Capture ${index + 1}: hierarchy exceeds 256 levels.`);
      for (const id of [...chain].reverse()) done.set(id, ++depth);
    }
    return capture;
  });
}

function unsupportedStyle(node: Node): string[] {
  const s = node.style;
  const fields: Array<[string, string | undefined, string]> = [
    ['transform', s.transform, 'none'], ['filter', s.filter, 'none'],
    ['backdrop filter', s.backdropFilter, 'none'], ['blend mode', s.mixBlendMode, 'normal'],
    ['clip path', s.clipPath, 'none'], ['mask', s.maskImage, 'none'],
    ['background clip', s.backgroundClip, 'border-box'],
  ];
  return fields.filter(([, value, normal]) => value && value !== normal).map(([label]) => label);
}

/** The model has no margins, flex-grow, order, or absolute-position metadata.
 * Only promote a flex container if the captured boxes agree with native flow.
 * Otherwise preserve its coordinates instead of claiming equivalent Auto Layout.
 */
function matchesFlow(node: Node, children: NativeNodePlan[], layout: Layout): boolean {
  if (!children.length) return true;
  const horizontal = layout.mode === 'horizontal';
  const start = horizontal ? node.box.x : node.box.y;
  const crossStart = horizontal ? node.box.y : node.box.x;
  const before = (horizontal ? layout.paddingLeft : layout.paddingTop) ?? 0;
  const after = (horizontal ? layout.paddingRight : layout.paddingBottom) ?? 0;
  const crossBefore = (horizontal ? layout.paddingTop : layout.paddingLeft) ?? 0;
  const crossAfter = (horizontal ? layout.paddingBottom : layout.paddingRight) ?? 0;
  const inner = (horizontal ? node.box.w : node.box.h) - before - after;
  const crossInner = (horizontal ? node.box.h : node.box.w) - crossBefore - crossAfter;
  let gap = layout.gap ?? 0;
  const sizes = children.map(({ source: child }) => horizontal ? child.box.w : child.box.h);
  const spare = inner - sizes.reduce((sum, size) => sum + size, 0) - gap * (children.length - 1);
  let cursor = start + before;
  switch (layout.justifyContent) {
    case 'center': cursor += spare / 2; break;
    case 'end': cursor += spare; break;
    case 'between': if (children.length > 1) gap += Math.max(0, spare) / (children.length - 1); break;
    case 'around': gap += Math.max(0, spare) / children.length; cursor += Math.max(0, spare) / children.length / 2; break;
    case 'evenly': gap += Math.max(0, spare) / (children.length + 1); cursor += Math.max(0, spare) / (children.length + 1); break;
  }
  return children.every(({ source: child }, index) => {
    const main = horizontal ? child.box.x : child.box.y;
    const cross = horizontal ? child.box.y : child.box.x;
    const crossSize = horizontal ? child.box.h : child.box.w;
    let expectedCross = crossStart + crossBefore;
    if (layout.alignItems === 'center') expectedCross += (crossInner - crossSize) / 2;
    if (layout.alignItems === 'end') expectedCross += crossInner - crossSize;
    const fits = Math.abs(main - cursor) <= 2 && Math.abs(cross - expectedCross) <= 2
      && (layout.alignItems !== 'stretch' || Math.abs(crossSize - crossInner) <= 2);
    cursor += sizes[index] + gap;
    return fits;
  });
}

export function planNativeCapture(capture: Capture): NativeCapturePlan {
  const diagnostics: NativeDiagnostic[] = [...(capture.diagnostics ?? [])];
  const plans = new Map(capture.nodes.map((source) => [source.id, { source, children: [], layout: 'positioned' } as NativeNodePlan]));
  const roots: NativeNodePlan[] = [];
  for (const plan of plans.values()) {
    if (plan.source.parentId) plans.get(plan.source.parentId)!.children.push(plan);
    else roots.push(plan);
  }
  for (const plan of plans.values()) {
    const node = plan.source;
    const unsupported = unsupportedStyle(node);
    if (unsupported.length) diagnostics.push({ code: 'native-unsupported-css', severity: 'warning', nodeId: node.id, message: `Unsupported ${unsupported.join(', ')}: kept captured bounds; these effects are not reproduced.` });
    const layout = node.style.layout;
    if (!layout || layout.mode === 'none') continue;
    let reason: string | undefined;
    if (layout.mode === 'grid') reason = 'CSS Grid is not mapped to native Auto Layout.';
    else if (layout.wrap) reason = 'Wrapped flex layout lacks captured row/column gap and alignment metadata.';
    else if (layout.alignItems === 'baseline') reason = 'CSS baseline alignment cannot be confirmed from the captured metadata.';
    else if (node.type !== 'frame') reason = 'Only frame containers can be promoted to Auto Layout.';
    else if (unsupported.length || plan.children.some(({ source }) => unsupportedStyle(source).length > 0)) reason = 'Complex CSS on the container or its children prevents reliable native flow.';
    else if ([layout.gap, layout.paddingTop, layout.paddingRight, layout.paddingBottom, layout.paddingLeft].some((value) => value !== undefined && value < 0)) reason = 'Negative spacing cannot be represented by this importer.';
    else if (!matchesFlow(node, plan.children, layout)) reason = 'Captured child bounds differ from the declared flex flow (possible margins, absolute children, reverse order, or flex sizing).';
    if (reason) diagnostics.push({ code: 'native-positioned-layout', severity: 'warning', nodeId: node.id, message: `${reason} Preserved positioned children instead.` });
    else if (layout.mode === 'horizontal' || layout.mode === 'vertical') plan.layout = layout.mode;
  }
  return { capture, roots, diagnostics };
}

export interface FigmaFontName {
  family: string;
  style: string;
}

export interface FigmaFontResolution {
  font: FigmaFontName;
  requestedFamily: string;
  substitutedFrom?: string;
  reason: 'exact' | 'nearest-weight' | 'fallback-stack' | 'metric-table' | 'default-fallback';
}

export const METRIC_COMPATIBLE_GOOGLE_FONTS: Record<string, string[]> = {
  'helvetica': ['Inter', 'Arimo', 'Roboto'],
  'helvetica neue': ['Inter', 'Arimo', 'Roboto'],
  'arial': ['Inter', 'Arimo', 'Roboto'],
  'sf pro': ['Inter', 'Roboto'],
  'sf pro text': ['Inter', 'Roboto'],
  'sf pro display': ['Inter', 'Roboto'],
  '-apple-system': ['Inter', 'Roboto'],
  'blinkmacsystemfont': ['Inter', 'Roboto'],
  'system-ui': ['Inter', 'Roboto'],
  'segoe ui': ['Inter', 'Roboto'],
  'times': ['Tinos', 'Libre Baskerville', 'Noto Serif'],
  'times new roman': ['Tinos', 'Libre Baskerville', 'Noto Serif'],
  'georgia': ['Libre Baskerville', 'Tinos', 'Merriweather'],
  'courier': ['Roboto Mono', 'JetBrains Mono', 'Cousine'],
  'courier new': ['Roboto Mono', 'JetBrains Mono', 'Cousine'],
  'menlo': ['JetBrains Mono', 'Roboto Mono'],
  'monaco': ['JetBrains Mono', 'Roboto Mono'],
  'consolas': ['JetBrains Mono', 'Roboto Mono'],
};

function styleWeightNumber(style: string): number {
  const s = style.toLowerCase().replace(/[\s-]/g, '');
  if (s.includes('black') || s.includes('heavy')) return 900;
  if (s.includes('extrabold') || s.includes('ultrabold')) return 800;
  if (s.includes('semibold') || s.includes('demibold')) return 600;
  if (s.includes('bold')) return 700;
  if (s.includes('medium')) return 500;
  if (s.includes('extralight') || s.includes('ultralight')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('thin') || s.includes('hairline')) return 100;
  return 400;
}

function pickFontStyle(candidates: FigmaFontName[], numericWeight: number, italic: boolean): { font: FigmaFontName; exact: boolean } {
  const desiredName = numericWeight >= 850 ? 'black' : numericWeight >= 750 ? 'extrabold' : numericWeight >= 650 ? 'bold' : numericWeight >= 550 ? 'semibold' : numericWeight >= 450 ? 'medium' : numericWeight >= 350 ? 'regular' : numericWeight >= 250 ? 'light' : 'thin';
  const normalized = (style: string) => style.toLowerCase().replace(/[\s-]/g, '').replace('normal', 'regular');
  const desiredStyle = `${desiredName}${italic ? 'italic' : ''}`;
  const exact = candidates.find((font) => normalized(font.style) === desiredStyle || (desiredName === 'regular' && italic && normalized(font.style) === 'italic'));
  if (exact) return { font: exact, exact: true };
  // Nearest weight within same family, preferring matching italic flag
  const sorted = [...candidates].sort((a, b) => {
    const aItalicMatch = /italic|oblique/i.test(a.style) === italic ? 0 : 1;
    const bItalicMatch = /italic|oblique/i.test(b.style) === italic ? 0 : 1;
    if (aItalicMatch !== bItalicMatch) return aItalicMatch - bItalicMatch;
    return Math.abs(styleWeightNumber(a.style) - numericWeight) - Math.abs(styleWeightNumber(b.style) - numericWeight);
  });
  return { font: sorted[0], exact: false };
}

/**
 * Resolve a Figma font in fixed priority order:
 * 1) exact family + style, 2) same family nearest weight, 3) capture CSS fallbackStack, 4) metric-compatible Google font table.
 */
export function resolveFigmaFontChoice(
  availableFonts: FigmaFontName[],
  familyList: string,
  weight: string | number,
  italic: boolean,
  captureFonts?: Capture['fonts']
): FigmaFontResolution {
  if (!availableFonts.length) throw new Error('No available Figma fonts can render editable text.');
  const parseList = (list: string) => list.split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const families = parseList(familyList);
  const requestedFamily = families[0] || 'system-ui';
  const numericWeight = typeof weight === 'number' ? weight : weight === 'bold' ? 700 : Number(weight) || 400;

  const findFamily = (fam: string) => availableFonts.filter((f) => f.family.toLowerCase() === fam.toLowerCase());

  // 1 & 2: Exact family (exact style or nearest weight)
  const primaryCandidates = findFamily(requestedFamily);
  if (primaryCandidates.length) {
    const picked = pickFontStyle(primaryCandidates, numericWeight, italic);
    return {
      font: picked.font,
      requestedFamily,
      ...(picked.exact ? {} : { substitutedFrom: requestedFamily }),
      reason: picked.exact ? 'exact' : 'nearest-weight',
    };
  }

  // 3: Capture CSS fallbackStack (from capture.fonts entry + remaining families in text.fontFamily)
  const matchingCaptureFont = captureFonts?.find((f) => f.family.toLowerCase() === requestedFamily.toLowerCase());
  const fallbackCandidates = [
    ...(matchingCaptureFont?.fallbackStack ? parseList(matchingCaptureFont.fallbackStack) : []),
    ...families.slice(1),
  ];
  for (const fam of fallbackCandidates) {
    const cands = findFamily(fam);
    if (cands.length) {
      const picked = pickFontStyle(cands, numericWeight, italic);
      return {
        font: picked.font,
        requestedFamily,
        substitutedFrom: requestedFamily,
        reason: 'fallback-stack',
      };
    }
  }

  // 4: Metric-compatible Google font table
  const searchNames = [requestedFamily, ...fallbackCandidates];
  for (const name of searchNames) {
    const mappedList = METRIC_COMPATIBLE_GOOGLE_FONTS[name.toLowerCase()] ?? [];
    for (const mapped of mappedList) {
      const cands = findFamily(mapped);
      if (cands.length) {
        const picked = pickFontStyle(cands, numericWeight, italic);
        return {
          font: picked.font,
          requestedFamily,
          substitutedFrom: requestedFamily,
          reason: 'metric-table',
        };
      }
    }
  }

  const fallback = availableFonts.find((f) => f.family === 'Inter' && f.style === 'Regular')
    ?? availableFonts.find((f) => f.family === 'Inter')
    ?? availableFonts[0];
  return {
    font: fallback,
    requestedFamily,
    substitutedFrom: requestedFamily,
    reason: 'default-fallback',
  };
}

export function formatFontSubstitutionSummary(substitutions: Map<string, string>): string | null {
  if (substitutions.size === 0) return null;
  const pairs = [...substitutions.entries()].map(([from, to]) => `${from} → ${to}`);
  return `${substitutions.size} font${substitutions.size === 1 ? '' : 's'} substituted: ${pairs.join(', ')}`;
}

export function parseNativeColor(value: string): { r: number; g: number; b: number; a: number } | undefined {
  const color = value.trim().toLowerCase();
  if (color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    const full = hex[1].length < 5 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { r: parseInt(full.slice(0, 2), 16) / 255, g: parseInt(full.slice(2, 4), 16) / 255, b: parseInt(full.slice(4, 6), 16) / 255, a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (!rgb) return undefined;
  const clamp = (number: number) => Math.max(0, Math.min(1, number));
  return { r: clamp(Number(rgb[1]) / 255), g: clamp(Number(rgb[2]) / 255), b: clamp(Number(rgb[3]) / 255), a: clamp(Number(rgb[4] ?? 1)) };
}
