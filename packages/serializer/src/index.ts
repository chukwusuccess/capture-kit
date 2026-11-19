import {
  createEmptyCapture,
  MODEL_VERSION,
  type Asset,
  type Box,
  type Capture,
  type CaptureNode,
  type CornerRadius,
  type Fill,
  type Rgba,
  type Shadow,
  type Style,
  type TextAlign,
  type TextProps,
} from "@capture-kit/model";

export interface SerializeOptions {
  /** Inline same-origin/data-URI images as base64 assets. Default true. */
  inlineImages?: boolean;
  /** Skip elements smaller than this (CSS px) to prune invisible subtrees. */
  minSize?: number;
}

const SKIPPED_TAGS = new Set([
  "SCRIPT", "STYLE", "LINK", "META", "HEAD", "NOSCRIPT", "TEMPLATE", "BASE", "TITLE",
]);
const TEXT_CONTAINERS = new Set([
  "P", "SPAN", "A", "LABEL", "BUTTON", "LI", "TD", "TH", "H1", "H2", "H3", "H4",
  "H5", "H6", "BLOCKQUOTE", "FIGCAPTION", "SUMMARY", "DT", "DD", "OPTION",
]);

/**
 * Serialize a document into the neutral capture model.
 * Browser-context only (uses DOM + fetch); no chrome.* APIs here.
 */
export async function serializeDocument(doc: Document, opts: SerializeOptions = {}): Promise<Capture> {
  const inlineImages = opts.inlineImages ?? true;
  const minSize = opts.minSize ?? 0.5;

  const win = doc.defaultView;
  if (!win) throw new Error("serializeDocument: document has no defaultView");

  const capture = createEmptyCapture(doc.location?.href ?? "", {
    width: doc.documentElement.scrollWidth,
    height: doc.documentElement.scrollHeight,
    baseURI: doc.baseURI,
  });

  const scrollX = win.scrollX;
  const scrollY = win.scrollY;
  const counter = { id: 0, asset: 0 };
  // src -> { node, src } for deferred async image inlining
  const imageJobs: Array<{ node: CaptureNode; src: string }> = [];

  const visit = (el: Element, parentId: string | undefined): void => {
    // TODO(phase-4): handle IFRAME elements (capture same-origin frames, note cross-origin ones).
    if (SKIPPED_TAGS.has(el.tagName)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;

    const rect = el.getBoundingClientRect();
    const box: Box = {
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      w: rect.width,
      h: rect.height,
    };
    if (box.w < minSize && box.h < minSize) return;

    const style = extractStyle(cs);
    const id = `n-${counter.id++}`;

    if (el.tagName === "IMG") {
      const node: CaptureNode = { id, parentId, type: "image", box, style };
      const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
      if (src) imageJobs.push({ node, src });
      capture.nodes.push(node);
      return;
    }

    const text = directText(el);
    if (text && TEXT_CONTAINERS.has(el.tagName)) {
      capture.nodes.push({ id, parentId, type: "text", box, style, text: extractTextProps(cs, text) });
      return; // Phase 0: treat text containers as leaves (children like <strong> ignored).
    }

    capture.nodes.push({ id, parentId, type: "frame", box, style });
    for (const child of Array.from(el.children)) visit(child, id);
  };

  for (const child of Array.from(doc.body.children)) visit(child, undefined);

  // TODO(phase-4): auto-scroll the page to trigger lazy-loaded content before serializing.
  if (inlineImages) await inlineAssets(capture, imageJobs, counter);

  return capture;
}

/** Fetch unique image srcs and attach base64 assets; failures are skipped gracefully. */
async function inlineAssets(
  capture: Capture,
  imageJobs: Array<{ node: CaptureNode; src: string }>,
  counter: { asset: number },
): Promise<void> {
  const bySrc = new Map<string, string>(); // src -> assetRef
  for (const { node, src } of imageJobs) {
    let assetRef = bySrc.get(src);
    if (assetRef === undefined) {
      const asset = await fetchImageAsset(src);
      if (asset) {
        assetRef = `a-${counter.asset++}`;
        capture.assets[assetRef] = asset;
        bySrc.set(src, assetRef);
      }
    }
    if (assetRef) node.assetRef = assetRef;
    // Cross-origin / failed fetches leave the node without assetRef.
  }
}

async function fetchImageAsset(src: string): Promise<Asset | undefined> {
  try {
    const isData = src.startsWith("data:");
    let sameOrigin = false;
    if (!isData) {
      try { sameOrigin = new URL(src, location.href).origin === location.origin; } catch { return undefined; }
    }
    if (!isData && !sameOrigin) return undefined;
    const res = await fetch(src); // TODO(phase-4): consider a fetch cache for repeated assets.
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (blob.size === 0 || blob.type.startsWith("text/")) return undefined;
    const mimeType = blob.type || "image/png";
    const base64 = await blobToBase64(blob);
    return { kind: "image", mimeType, base64 };
  } catch {
    return undefined;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function extractStyle(cs: CSSStyleDeclaration): Style {
  const fills: Fill[] = [];
  const bg = parseColor(cs.backgroundColor);
  if (bg && bg.a > 0) fills.push({ type: "solid", color: bg });

  const strokeWidth = parseFloat(cs.borderTopWidth) || 0;
  const borderColor = parseColor(cs.borderTopColor);
  const strokes =
    strokeWidth > 0 && borderColor && borderColor.a > 0
      ? [{ color: borderColor, width: strokeWidth }]
      : [];

  return {
    fills,
    strokes,
    opacity: clamp01(parseFloat(cs.opacity) || 1),
    radius: parseRadius(cs),
    shadows: parseBoxShadows(cs.boxShadow),
  };
}

function parseRadius(cs: CSSStyleDeclaration): CornerRadius {
  const zero = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  const parts = cs.borderRadius.split(" ").map(parseFloat);
  if (parts.length === 0 || parts.every((p) => !p)) return zero;
  if (parts.length === 1) {
    const v = parts[0] || 0;
    return { topLeft: v, topRight: v, bottomRight: v, bottomLeft: v };
  }
  // Per-corner values: computed style returns up to four space-separated values.
  const [tl, tr, br, bl] = [
    parts[0] || 0,
    parts[1] || parts[0] || 0,
    parts[2] || parts[0] || 0,
    parts[3] || parts[1] || parts[0] || 0,
  ];
  return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
}

function parseBoxShadows(css: string): Shadow[] {
  if (!css || css === "none") return [];
  // Phase 0: naive single-shadow parse (multi-shadow comma splitting is unreliable
  // because rgba() colors contain commas). TODO(phase-1): full box-shadow parser.
  const m = css.match(
    /^(inset\s+)?(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(.+)$/,
  );
  if (!m) return [];
  const color = parseColor(m[6]);
  if (!color) return [];
  return [
    {
      color,
      offsetX: parseFloat(m[2]),
      offsetY: parseFloat(m[3]),
      blur: Math.abs(parseFloat(m[4])),
      spread: m[5] ? Math.abs(parseFloat(m[5])) : 0,
      inset: Boolean(m[1]),
    },
  ];
}

function directText(el: Element): string | undefined {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) out += child.textContent ?? "";
  }
  const trimmed = out.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function extractTextProps(cs: CSSStyleDeclaration, content: string): TextProps {
  const alignMap: Record<string, TextAlign> = {
    left: "left", start: "left",
    center: "center",
    right: "right", end: "right",
    justify: "justify",
  };
  return {
    content,
    fontFamily: cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""),
    fontSize: parseFloat(cs.fontSize) || 16,
    fontWeight: parseFloat(cs.fontWeight) || 400,
    lineHeight: parseLineHeight(cs, parseFloat(cs.fontSize) || 16),
    letterSpacing: parsePx(cs.letterSpacing),
    align: alignMap[cs.textAlign] ?? "left",
    color: parseColor(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 },
  };
}

function parseLineHeight(cs: CSSStyleDeclaration, fontSize: number): number {
  const lh = cs.lineHeight;
  if (!lh || lh === "normal") return fontSize * 1.2;
  if (lh.endsWith("px")) return parseFloat(lh);
  const ratio = parseFloat(lh);
  return Number.isFinite(ratio) ? ratio * fontSize : fontSize * 1.2;
}

function parsePx(value: string): number {
  if (!value || value === "normal") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Parse rgba()/rgb()/hex colors; returns undefined if unsupported. */
export function parseColor(css: string): Rgba | undefined {
  const s = css.trim().toLowerCase();
  const rgba = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return undefined;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const num = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a };
  }
  return undefined;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
