import {
  type Asset,
  type Capture,
  type CornerRadius,
  type Fill,
  type Node,
  type Stroke,
  type TextProps,
  emptyCapture,
} from '@capture-kit/model';

export interface SerializeOptions {
  baseURI?: string;
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
      // If uniform borders, one stroke is sufficient
      break;
    }
  }

  return strokes;
}

export async function serializeDocument(
  doc: Document,
  opts?: SerializeOptions
): Promise<Capture> {
  const defaultView = doc.defaultView ?? window;
  const scrollX = defaultView.scrollX ?? 0;
  const scrollY = defaultView.scrollY ?? 0;

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

  const baseURI = opts?.baseURI || doc.baseURI || defaultView.location?.href || 'about:blank';

  const capture = emptyCapture({
    url: defaultView.location?.href || baseURI,
    version: '0.1.0',
    frame: {
      width: Math.max(1, frameWidth),
      height: Math.max(1, frameHeight),
      baseURI,
    },
  });
  const nodes: Node[] = [];
  const assets: Record<string, Asset> = {};
  let nextNodeId = 1;
  let nextAssetId = 1;

  const elementToIdMap = new Map<Element, string>();

  // TODO(phase-4): Support auto-scroll and full-page stitching
  // TODO(phase-4): Support iframes traversal
  // TODO(phase-4): Support ::before and ::after pseudo-elements
  // TODO(phase-4): Support custom web font extraction and embedding


  const elements: Element[] = [];
  if (body) {
    const showElementFilter = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1;
    const walker = doc.createTreeWalker(body, showElementFilter);
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
  }

  for (const el of elements) {
    const computed = defaultView.getComputedStyle(el);
    if (!computed || computed.display === 'none' || computed.visibility === 'hidden') {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + scrollX);
    const y = Math.round(rect.top + scrollY);
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
            const res = await fetch(resolvedUrl.href);
            if (res.ok) {
              const blob = await res.blob();
              const buffer = await blob.arrayBuffer();
              const base64 = await arrayBufferToBase64(buffer);
              const assetKey = `asset-${nextAssetId++}`;
              assets[assetKey] = {
                kind: 'image',
                mimeType: blob.type || 'image/png',
                base64,
              };
              fills.push({
                type: 'image',
                assetRef: assetKey,
                opacity: 1,
              });
            }
          }
        } catch {
          // Cross-origin or network error ignored gracefully
        }
      }
    }

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
        // Fallback to placeholder rect if serialization fails
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

    // 2. Image elements (with srcset / currentSrc support)
    if (tagName === 'img') {
      const img = el as HTMLImageElement;
      let assetRef: string | undefined;

      const src = img.currentSrc || img.src || img.getAttribute('src');
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
              const res = await fetch(resolvedUrl.href);
              if (res.ok) {
                const blob = await res.blob();
                const buffer = await blob.arrayBuffer();
                const base64 = await arrayBufferToBase64(buffer);
                const assetKey = `asset-${nextAssetId++}`;
                assets[assetKey] = {
                  kind: 'image',
                  mimeType: blob.type || 'image/png',
                  base64,
                };
                assetRef = assetKey;
              }
            }
          } catch {
            // Gracefully ignore fetch / cross-origin failures
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

    // 3. Form controls (input, textarea, select)
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

      // Container node for the control
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

    // 4. Regular DOM elements: inspect direct child text nodes
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

    // If element is a pure text container without visual decorations and has no element children
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

    // Container element (frame or rect)
    nodes.push({
      id: nodeId,
      parentId,
      type: hasChildren ? 'frame' : 'rect',
      box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
      style,
    });

    // If container element has direct text nodes, emit each measured text node
    for (const textNode of childTextNodes) {
      const textVal = textNode.textContent?.trim() || '';
      if (!textVal) continue;

      let textX = x;
      let textY = y;
      let textW = w;
      let textH = h;

      // Use Range for precise sub-pixel text bounding box if available
      if (typeof doc.createRange === 'function') {
        try {
          const range = doc.createRange();
          range.selectNodeContents(textNode);
          const rangeRect = range.getBoundingClientRect();
          if (rangeRect.width > 0 && rangeRect.height > 0) {
            textX = Math.round(rangeRect.left + scrollX);
            textY = Math.round(rangeRect.top + scrollY);
            textW = Math.round(rangeRect.width);
            textH = Math.round(rangeRect.height);
          }
        } catch {
          // Range calculation fallback
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
  }

  capture.nodes = nodes;
  capture.assets = assets;

  return capture;
}
