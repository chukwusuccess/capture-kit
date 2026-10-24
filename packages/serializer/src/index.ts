import {
  type Asset,
  type Capture,
  type CornerRadius,
  type Fill,
  type Font,
  type Node,
  type Stroke,
  type TextProps,
  emptyCapture,
} from '@capture-kit/model';

export interface ScrollStitchOptions {
  step?: number;
  delayMs?: number;
}

export interface SerializeOptions {
  baseURI?: string;
  scrollStitch?: boolean;
  scrollOptions?: ScrollStitchOptions;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function triggerPageScroll(
  win: Window & typeof globalThis,
  opts?: ScrollStitchOptions
): Promise<void> {
  if (typeof win.scrollTo !== 'function') return;
  const step = opts?.step ?? Math.max(300, Math.round((win.innerHeight || 800) * 0.8));
  const delayMs = opts?.delayMs ?? 50;

  const doc = win.document;
  const docEl = doc?.documentElement;
  const body = doc?.body;

  const totalHeight = Math.max(
    docEl?.scrollHeight ?? 0,
    docEl?.clientHeight ?? 0,
    body?.scrollHeight ?? 0,
    win.innerHeight ?? 800
  );

  let currentY = 0;
  while (currentY < totalHeight) {
    currentY += step;
    win.scrollTo(0, currentY);
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  win.scrollTo(0, 0);
  if (delayMs > 0) {
    await delay(delayMs);
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

function extractCssUrl(bgImage: string): string | null {
  if (!bgImage || bgImage === 'none') return null;
  const match = bgImage.match(/url\(\s*['"]?(.*?)['"]?\s*\)/);
  return match && match[1] ? match[1] : null;
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

  return fills;
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
  const edges = [
    { width: computed.borderTopWidth, style: computed.borderTopStyle, color: computed.borderTopColor },
    { width: computed.borderRightWidth, style: computed.borderRightStyle, color: computed.borderRightColor },
    { width: computed.borderBottomWidth, style: computed.borderBottomStyle, color: computed.borderBottomColor },
    { width: computed.borderLeftWidth, style: computed.borderLeftStyle, color: computed.borderLeftColor },
  ];

  for (const edge of edges) {
    const width = Math.max(0, parseFloat(edge.width) || 0);
    const style = edge.style;
    const color = edge.color;

    if (
      width > 0 &&
      style &&
      style !== 'none' &&
      color &&
      color !== 'transparent' &&
      color !== 'rgba(0, 0, 0, 0)'
    ) {
      strokes.push({
        color,
        width,
        style: style === 'dashed' || style === 'dotted' ? style : 'solid',
      });
      break;
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
  nextNodeId: () => string
): Node | null {
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

    const widthVal = parseFloat(computed.width) || 0;
    const heightVal = parseFloat(computed.height) || 0;
    const isVisibleShape = (hasBg || strokes.length > 0) && widthVal > 0 && heightVal > 0;

    if (!cleanContent && !isVisibleShape) {
      return null;
    }

    const fills: Fill[] = hasBg ? [{ type: 'solid', color: bg, opacity: 1 }] : [];
    const style = { fills, strokes, opacity, radius, shadows };

    const topVal = parseFloat(computed.top) || 0;
    const leftVal = parseFloat(computed.left) || 0;
    const isAbsolute = computed.position === 'absolute' || computed.position === 'fixed';

    const w = widthVal > 0 ? widthVal : Math.max(1, parentBox.w);
    const h = heightVal > 0 ? heightVal : Math.max(1, parentBox.h);
    const x = isAbsolute ? parentBox.x + leftVal : parentBox.x;
    const y = isAbsolute
      ? parentBox.y + topVal
      : pseudo === '::after'
      ? parentBox.y + parentBox.h - h
      : parentBox.y;

    const box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };

    if (cleanContent.length > 0) {
      const fontSize = parseFloat(computed.fontSize) || 14;
      const lineHeightValue = parseFloat(computed.lineHeight);
      const lineHeight = Number.isNaN(lineHeightValue) ? fontSize * 1.2 : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue) ? 0 : letterSpacingValue;

      return {
        id: nextNodeId(),
        parentId,
        type: 'text',
        box,
        style,
        text: {
          content: cleanContent,
          fontFamily: computed.fontFamily || 'system-ui, sans-serif',
          fontSize,
          fontWeight: computed.fontWeight || 400,
          lineHeight,
          letterSpacing,
          align: parseTextAlign(computed.textAlign),
          color: computed.color || 'rgba(0, 0, 0, 1)',
        },
      };
    }

    return {
      id: nextNodeId(),
      parentId,
      type: 'rect',
      box,
      style,
    };
  } catch {
    return null;
  }
}
async function extractWebFonts(
  doc: Document,
  baseURI: string,
  assets: Record<string, Asset>,
  nextAssetId: () => string
): Promise<Font[]> {
  const fonts: Font[] = [];
  const seenFamilies = new Set<string>();
  const defaultView = doc.defaultView ?? window;

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
      // FontFaceSet access ignored
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

            if (!seenFamilies.has(family)) {
              seenFamilies.add(family);
              fonts.push({
                family,
                weight,
                style: fontStyle,
              });
            }

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
                }
              } else {
                try {
                  const resolved = new URL(fontUrl, baseURI);
                  const isSameOrigin = resolved.origin === defaultView.location?.origin;
                  if (isSameOrigin || resolved.protocol === 'blob:') {
                    const res = await fetch(resolved.href);
                    if (res.ok) {
                      const blob = await res.blob();
                      const buffer = await blob.arrayBuffer();
                      const base64 = await arrayBufferToBase64(buffer);
                      const assetKey = nextAssetId();
                      assets[assetKey] = {
                        kind: 'font',
                        mimeType: blob.type || 'font/woff2',
                        base64,
                      };
                    }
                  }
                } catch {
                  // Ignore font fetch failure
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // StyleSheets access fallback
  }

  return fonts;
}


async function serializeSubtree(
  root: Element,
  doc: Document,
  frameRect: { originX: number; originY: number; width: number; height: number },
  opts?: SerializeOptions
): Promise<Capture> {
  const defaultView = doc.defaultView ?? window;
  const scrollX = defaultView.scrollX ?? 0;
  const scrollY = defaultView.scrollY ?? 0;

  const baseURI = opts?.baseURI || doc.baseURI || defaultView.location?.href || 'about:blank';

  const capture = emptyCapture({
    url: defaultView.location?.href || baseURI,
    version: '0.1.0',
    frame: {
      width: Math.max(1, Math.round(frameRect.width)),
      height: Math.max(1, Math.round(frameRect.height)),
      baseURI,
    },
  });

  const nodes: Node[] = [];
  const assets: Record<string, Asset> = {};
  let nextNodeId = 1;
  let nextAssetId = 1;

  const elementToIdMap = new Map<Element, string>();
  const urlToAssetKeyCache = new Map<string, string>();
  const pendingAssetFetches: Array<{ url: string; assetKey: string }> = [];
  const hiddenAncestors = new Set<Element>();
  // TODO(phase-4): Support auto-scroll and full-page stitching
  // TODO(phase-4): Support iframes traversal
  // TODO(phase-4): Support ::before and ::after pseudo-elements
  // TODO(phase-4): Support custom web font extraction and embedding

  const elements: Element[] = [];
  const showElementFilter = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1;
  const walker = doc.createTreeWalker(root, showElementFilter);

  let currentNode: globalThis.Node | null = walker.currentNode;
  while (currentNode) {
    if (currentNode.nodeType === 1) {
      const el = currentNode as Element;
      const tag = el.tagName.toLowerCase();
      if (!IGNORED_TAGS[tag]) {
        elements.push(el);
      }
    }
    currentNode = walker.nextNode();
  }

  for (const el of elements) {
    if (el.parentElement && hiddenAncestors.has(el.parentElement)) {
      hiddenAncestors.add(el);
      continue;
    }

    const computed = defaultView.getComputedStyle(el);
    if (!computed || computed.display === 'none' || computed.visibility === 'hidden') {
      hiddenAncestors.add(el);
      continue;
    }

    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + scrollX - frameRect.originX);
    const y = Math.round(rect.top + scrollY - frameRect.originY);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (w <= 0 && h <= 0) {
      continue;
    }

    const nodeId = `node-${nextNodeId++}`;
    elementToIdMap.set(el, nodeId);

    // Parent ID from nearest mapped ancestor
    let parentId: string | undefined;
    let parent = el.parentElement;
    while (parent) {
      if (elementToIdMap.has(parent)) {
        parentId = elementToIdMap.get(parent);
        break;
      }
      parent = parent.parentElement;
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
        const match = bgImageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const assetKey = `asset-${nextAssetId++}`;
          assets[assetKey] = {
            kind: 'image',
            mimeType: match[1],
            base64: match[2],
          };
          fills.push({
            type: 'image',
            assetRef: assetKey,
            opacity: 1,
          });
        }
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
              pendingAssetFetches.push({ url: resolvedUrl.href, assetKey });
              fills.push({ type: 'image', assetRef: assetKey, opacity: 1 });
            }
          }
        } catch {
          // Cross-origin or network error ignored
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

    const style = {
      fills,
      strokes,
      opacity,
      radius,
      shadows,
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
          if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
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
        // Tainted canvas fallback
      }

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
        // Fallback placeholder rect
      }

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

    // 2. Image elements
    if (tagName === 'img') {
      const img = el as HTMLImageElement;
      let assetRef: string | undefined;

      const src = resolveHighestDpiSrc(img);
      if (src) {
        if (src.startsWith('data:')) {
          const match = src.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const assetKey = `asset-${nextAssetId++}`;
            assets[assetKey] = {
              kind: 'image',
              mimeType: match[1],
              base64: match[2],
            };
            assetRef = assetKey;
          }
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
                pendingAssetFetches.push({ url: resolvedUrl.href, assetKey });
                assetRef = assetKey;
              }
            }
          } catch {
            // Fetch failure ignored gracefully
          }
        }
      }

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

    // 3. Iframe elements (same-origin traversal)
    if (tagName === 'iframe') {
      nodes.push({
        id: nodeId,
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
          const iframeCapture = await serializeSubtree(
            iframeRoot,
            iframeDoc,
            {
              originX: -x,
              originY: -y,
              width: w,
              height: h,
            },
            opts
          );

          for (const childNode of iframeCapture.nodes) {
            if (!childNode.parentId) {
              childNode.parentId = nodeId;
            }
            nodes.push(childNode);
          }

          Object.assign(assets, iframeCapture.assets);
        }
      } catch {
        // Cross-origin iframe or inaccessible document ignored gracefully
      }
      continue;
    }

    // 4. Form controls
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      let controlText = '';
      if (tagName === 'input') {
        const input = el as HTMLInputElement;
        controlText = input.value || input.placeholder || '';
      } else if (tagName === 'textarea') {
        const textarea = el as HTMLTextAreaElement;
        controlText = textarea.value || textarea.placeholder || '';
      } else if (tagName === 'select') {
        const select = el as HTMLSelectElement;
        controlText =
          select.options?.[select.selectedIndex]?.text || select.value || '';
      }

      nodes.push({
        id: nodeId,
        parentId,
        type: 'rect',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
      });

      if (controlText.trim().length > 0) {
        const fontSize = parseFloat(computed.fontSize) || 14;
        const textNodeId = `node-${nextNodeId++}`;
        nodes.push({
          id: textNodeId,
          parentId: nodeId,
          type: 'text',
          box: {
            x: x + 8,
            y: y + Math.max(0, Math.round((h - fontSize) / 2)),
            w: Math.max(0, w - 16),
            h: Math.min(h, Math.round(fontSize * 1.4)),
          },
          style: {
            fills: [],
            strokes: [],
            opacity: 1,
            radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
            shadows: [],
          },
          text: {
            content: controlText.trim(),
            fontFamily: computed.fontFamily || 'system-ui, sans-serif',
            fontSize,
            fontWeight: computed.fontWeight || 400,
            lineHeight: fontSize * 1.2,
            letterSpacing: parseFloat(computed.letterSpacing) || 0,
            align: parseTextAlign(computed.textAlign),
            color: computed.color || 'rgba(0, 0, 0, 1)',
          },
        });
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
      const lineHeight = Number.isNaN(lineHeightValue)
        ? fontSize * 1.2
        : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue)
        ? 0
        : letterSpacingValue;

      nodes.push({
        id: nodeId,
        parentId,
        type: 'text',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
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
        },
      });
      continue;
    }

    nodes.push({
      id: nodeId,
      parentId,
      type: hasChildren ? 'frame' : 'rect',
      box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
      style,
    });
    // ::before pseudo-element
    const beforeNode = extractPseudoElement(
      el,
      '::before',
      { x, y, w, h },
      defaultView,
      nodeId,
      () => `node-${nextNodeId++}`
    );
    if (beforeNode) {
      nodes.push(beforeNode);
    }

    for (const textNode of childTextNodes) {
      const textVal = textNode.textContent?.trim() || '';
      if (!textVal) continue;

      let textX = x;
      let textY = y;
      let textW = w;
      let textH = h;

      const isSingleTextLeaf = childTextNodes.length === 1 && !hasChildren;
      if (!isSingleTextLeaf && typeof doc.createRange === 'function') {
        try {
          const range = doc.createRange();
          range.selectNodeContents(textNode);
          const rangeRect = range.getBoundingClientRect();
          if (rangeRect.width > 0 && rangeRect.height > 0) {
            textX = Math.round(rangeRect.left + scrollX - frameRect.originX);
            textY = Math.round(rangeRect.top + scrollY - frameRect.originY);
            textW = Math.round(rangeRect.width);
            textH = Math.round(rangeRect.height);
          }
        } catch {
          // Range fallback
        }
      }

      const fontSize = parseFloat(computed.fontSize) || 16;
      const lineHeightValue = parseFloat(computed.lineHeight);
      const lineHeight = Number.isNaN(lineHeightValue)
        ? fontSize * 1.2
        : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue)
        ? 0
        : letterSpacingValue;

      const textNodeId = `node-${nextNodeId++}`;
      nodes.push({
        id: textNodeId,
        parentId: nodeId,
        type: 'text',
        box: {
          x: textX,
          y: textY,
          w: Math.max(0, textW),
          h: Math.max(0, textH),
        },
        style: {
          fills: [],
          strokes: [],
          opacity: 1,
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadows: [],
        },
        text: {
          content: textVal,
          fontFamily: computed.fontFamily || 'system-ui, sans-serif',
          fontSize,
          fontWeight: computed.fontWeight || 400,
          lineHeight,
          letterSpacing,
          align: parseTextAlign(computed.textAlign),
          color: computed.color || 'rgba(0, 0, 0, 1)',
        },
      });
    }
    // ::after pseudo-element
    const afterNode = extractPseudoElement(
      el,
      '::after',
      { x, y, w, h },
      defaultView,
      nodeId,
      () => `node-${nextNodeId++}`
    );
    if (afterNode) {
      nodes.push(afterNode);
    }
  }
  // Concurrent parallel asset resolution
  if (pendingAssetFetches.length > 0) {
    await Promise.all(
      pendingAssetFetches.map(async ({ url, assetKey }) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
          if (res.ok) {
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            const base64 = await arrayBufferToBase64(buffer);
            assets[assetKey] = {
              kind: 'image',
              mimeType: blob.type || 'image/png',
              base64,
            };
          }
        } catch {
          // fetch failure ignored
        }
      })
    );
  }

  capture.nodes = nodes;
  capture.assets = assets;
  capture.fonts = await extractWebFonts(doc, baseURI, assets, () => `asset-${nextAssetId++}`);
  return capture;
}

export async function serializeDocument(
  doc: Document,
  opts?: SerializeOptions
): Promise<Capture> {
  const defaultView = doc.defaultView ?? window;

  if (opts?.scrollStitch && defaultView) {
    await triggerPageScroll(defaultView, opts.scrollOptions);
  }

  const docEl = doc.documentElement;
  const body = doc.body;

  const frameWidth = Math.max(
    docEl?.scrollWidth ?? 0,
    docEl?.clientWidth ?? 0,
    body?.scrollWidth ?? 0,
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
      version: '0.1.0',
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
    opts
  );
}

export async function serializeElement(
  el: Element,
  opts?: SerializeOptions
): Promise<Capture> {
  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : (null as unknown as Document));
  const defaultView = doc?.defaultView ?? (typeof window !== 'undefined' ? window : (null as unknown as Window & typeof globalThis));
  const scrollX = defaultView.scrollX ?? 0;
  const scrollY = defaultView.scrollY ?? 0;

  const rect = el.getBoundingClientRect();
  const originX = Math.round(rect.left + scrollX);
  const originY = Math.round(rect.top + scrollY);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  return serializeSubtree(
    el,
    doc,
    {
      originX,
      originY,
      width,
      height,
    },
    opts
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
