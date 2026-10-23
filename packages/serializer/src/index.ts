import {
  type Asset,
  type Capture,
  type Fill,
  type Node,
  type Stroke,
  type TextProps,
  emptyCapture,
} from '@capture-kit/model';

export interface SerializeOptions {
  baseURI?: string;
}

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

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
    let currentNode: globalThis.Node | null = walker.currentNode;
    while (currentNode) {
      if (currentNode instanceof Element) {
        elements.push(currentNode);
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

    // Skip empty non-visible nodes
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

    const strokes: Stroke[] = [];
    const borderWidth = parseFloat(computed.borderTopWidth) || 0;
    const borderColor = computed.borderTopColor;
    const borderStyle = computed.borderTopStyle;
    if (
      borderWidth > 0 &&
      borderStyle !== 'none' &&
      borderColor !== 'transparent' &&
      borderColor !== 'rgba(0, 0, 0, 0)'
    ) {
      strokes.push({
        color: borderColor,
        width: borderWidth,
        style:
          borderStyle === 'dashed' || borderStyle === 'dotted'
            ? borderStyle
            : 'solid',
      });
    }

    const opacity = Math.max(0, Math.min(1, parseFloat(computed.opacity) || 1));
    const radius = {
      topLeft: Math.max(0, parseFloat(computed.borderTopLeftRadius) || 0),
      topRight: Math.max(0, parseFloat(computed.borderTopRightRadius) || 0),
      bottomRight: Math.max(0, parseFloat(computed.borderBottomRightRadius) || 0),
      bottomLeft: Math.max(0, parseFloat(computed.borderBottomLeftRadius) || 0),
    };
    const shadows = parseBoxShadow(computed.boxShadow);

    const style = {
      fills,
      strokes,
      opacity,
      radius,
      shadows,
    };

    const tagName = el.tagName.toLowerCase();
    const isImage = tagName === 'img';

    // Direct text detection
    let directText = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 3 /* Node.TEXT_NODE */) {
        directText += child.textContent || '';
      }
    }
    directText = directText.trim();

    const isTypographicTag = [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'span',
      'a',
      'label',
      'button',
      'li',
      'strong',
      'em',
      'b',
      'i',
    ].includes(tagName);

    if (isImage) {
      const img = el as HTMLImageElement;
      let assetRef: string | undefined;

      const src = img.src || img.getAttribute('src');
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
            // Gracefully ignore fetch / cross-origin failures per Phase 0 spec
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
    } else if (
      directText.length > 0 &&
      (isTypographicTag || el.children.length === 0)
    ) {
      const fontSize = parseFloat(computed.fontSize) || 16;
      const lineHeightValue = parseFloat(computed.lineHeight);
      const lineHeight = Number.isNaN(lineHeightValue)
        ? fontSize * 1.2
        : lineHeightValue;
      const letterSpacingValue = parseFloat(computed.letterSpacing);
      const letterSpacing = Number.isNaN(letterSpacingValue)
        ? 0
        : letterSpacingValue;

      const textProps: TextProps = {
        content: directText,
        fontFamily: computed.fontFamily || 'system-ui, sans-serif',
        fontSize,
        fontWeight: computed.fontWeight || 400,
        lineHeight,
        letterSpacing,
        align: parseTextAlign(computed.textAlign),
        color: computed.color || 'rgba(0, 0, 0, 1)',
      };

      nodes.push({
        id: nodeId,
        parentId,
        type: 'text',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
        text: textProps,
      });
    } else {
      const isFrame = el.children.length > 0;
      nodes.push({
        id: nodeId,
        parentId,
        type: isFrame ? 'frame' : 'rect',
        box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
        style,
      });
    }
  }

  capture.nodes = nodes;
  capture.assets = assets;

  return capture;
}
