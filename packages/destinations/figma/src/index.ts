import type { Capture, CornerRadius, Node } from '@capture-kit/model';

export interface FigmaExportOptions {
  pasteboardFormat?: 'clipboard' | 'file';
  includeMetadata?: boolean;
  includeDesignSystem?: boolean;
}

export interface FigmaClipboardPayload {
  html: string;
  svg: string;
  plain: string;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseStopAlpha(color: string): number {
  const c = color.trim().toLowerCase();
  if (c === 'transparent') return 0;
  const rgba = c.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/);
  return rgba ? Math.max(0, Math.min(1, parseFloat(rgba[1]))) : 1;
}

function parseGlowColor(color: string): { rgb: string; alpha: number } {
  const c = color.trim();
  const low = c.toLowerCase();
  if (low === 'transparent') return { rgb: '#000000', alpha: 0 };
  const rgbaComma = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbaComma) {
    const a = rgbaComma[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(rgbaComma[4]))) : 1;
    return { rgb: `rgb(${rgbaComma[1]}, ${rgbaComma[2]}, ${rgbaComma[3]})`, alpha: a };
  }
  const rgbaSpace = c.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (rgbaSpace) {
    let a = 1;
    if (rgbaSpace[4]) {
      a = rgbaSpace[4].endsWith('%') ? parseFloat(rgbaSpace[4]) / 100 : parseFloat(rgbaSpace[4]);
      a = Math.max(0, Math.min(1, a));
    }
    return { rgb: `rgb(${rgbaSpace[1]}, ${rgbaSpace[2]}, ${rgbaSpace[3]})`, alpha: a };
  }
  const hex8 = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (hex8) {
    const a = Math.round((parseInt(hex8[2], 16) / 255) * 1000) / 1000;
    return { rgb: `#${hex8[1]}`, alpha: a };
  }
  const hex4 = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex4) {
    const a = Math.round((parseInt(hex4[4] + hex4[4], 16) / 255) * 1000) / 1000;
    return { rgb: `#${hex4[1]}${hex4[1]}${hex4[2]}${hex4[2]}${hex4[3]}${hex4[3]}`, alpha: a };
  }
  return { rgb: c, alpha: 1 };
}

function getAmbientGlowColor(node: Node): string | null {
  if (node.type !== 'rect' && node.type !== 'frame') return null;
  const blurMatch = node.style.filter?.match(/blur\(\s*([\d.]+)\s*px\s*\)/i);
  if (!blurMatch || parseFloat(blurMatch[1]) < 12) return null;
  const primarySolid = node.style.fills.find(
    (f) => f.type === 'solid' && f.color && parseGlowColor(f.color).alpha > 0
  );
  if (primarySolid?.color) return primarySolid.color;
  const gradFill = node.style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  if (gradFill?.stops) {
    const stop = gradFill.stops.find((s) => parseGlowColor(s.color).alpha > 0) ?? gradFill.stops[0];
    if (stop?.color && parseGlowColor(stop.color).alpha > 0) return stop.color;
  }
  return null;
}

function collectAmbientGlowIds(capture: Capture): Set<string> {
  const childrenMap = new Map<string, Node[]>();
  for (const node of capture.nodes) {
    if (node.parentId) {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }
  const hasTextDescendant = (nodeId: string): boolean => {
    const children = childrenMap.get(nodeId) ?? [];
    for (const c of children) {
      if (c.type === 'text') return true;
      if (hasTextDescendant(c.id)) return true;
    }
    return false;
  };
  const ids = new Set<string>();
  for (const node of capture.nodes) {
    if (getAmbientGlowColor(node) && !hasTextDescendant(node.id)) {
      ids.add(node.id);
    }
  }
  return ids;
}

function formatSvgStop(color: string, offsetPct: number): string {
  const alpha = parseStopAlpha(color);
  const rgba = color.trim().match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,/i);
  const rgbColor = rgba ? `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : color.trim().toLowerCase() === 'transparent' ? '#000000' : color;
  const opAttr = alpha < 1 ? ` stop-opacity="${alpha}"` : '';
  return `      <stop offset="${offsetPct}%" stop-color="${escapeXml(rgbColor)}"${opAttr} />`;
}
function cleanSvgFontFamily(fontFamily: string): string {
  const candidates = (fontFamily || 'Inter')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  for (const name of candidates) {
    const low = name.toLowerCase();
    if (low === 'ui-sans-serif' || low === 'system-ui' || low === '-apple-system' || low === 'blinkmacsystemfont' || low === 'sans-serif' || low === 'segoe ui' || low === 'helvetica' || low === 'helvetica neue' || low === 'arial') {
      return 'Inter';
    }
    if (low === 'ui-monospace' || low === 'sfmono-regular' || low === 'menlo' || low === 'monaco' || low === 'consolas' || low === 'monospace' || low === 'courier' || low === 'courier new') {
      return 'Roboto Mono';
    }
    if (low === 'ui-serif' || low === 'serif' || low === 'times' || low === 'times new roman' || low === 'georgia') {
      return 'Georgia';
    }
    if (!low.includes('emoji') && !low.includes('symbol')) {
      return name;
    }
  }
  return 'Inter';
}

function applyTextTransform(str: string, tt?: string): string {
  if (tt === 'uppercase') return str.toUpperCase();
  if (tt === 'lowercase') return str.toLowerCase();
  if (tt === 'capitalize') return str.replace(/\b\w/g, (c) => c.toUpperCase());
  return str;
}
function backgroundPreserveAspectRatio(style: Node['style']): { par: string; tile: 'none' | 'x' | 'y' | 'both' } {
  const size = (style.backgroundSize || '').trim().toLowerCase();
  const repeat = (style.backgroundRepeat || '').trim().toLowerCase();
  if (repeat === 'repeat') return { par: 'xMidYMid slice', tile: 'both' };
  if (repeat === 'repeat-x') return { par: 'xMidYMid slice', tile: 'x' };
  if (repeat === 'repeat-y') return { par: 'xMidYMid slice', tile: 'y' };
  if (size === 'contain') return { par: 'xMidYMid meet', tile: 'none' };
  if (size === 'cover') return { par: 'xMidYMid slice', tile: 'none' };
  if (size === 'auto' || size === '' || size === 'auto auto') return { par: 'none', tile: 'none' };
  const parts = size.split(/\s+/);
  const isPct = (t: string): boolean => t.endsWith('%');
  if (parts.length === 2 && isPct(parts[0]) && isPct(parts[1])) return { par: 'none', tile: 'none' };
  return { par: 'xMidYMid slice', tile: 'none' };
}

function backgroundPositionAlign(pos: string | undefined): { x: 'Min' | 'Mid' | 'Max'; y: 'Min' | 'Mid' | 'Max' } {
  const p = (pos || '').trim().toLowerCase();
  if (!p || p === '0% 0%' || p === 'left top') return { x: 'Min', y: 'Min' };
  const tox = (t: string): 'Min' | 'Mid' | 'Max' => {
    if (t === 'left' || t === 'top') return 'Min';
    if (t === 'right' || t === 'bottom') return 'Max';
    if (t === 'center') return 'Mid';
    if (t.endsWith('%')) {
      const v = parseFloat(t);
      return v <= 33 ? 'Min' : v >= 67 ? 'Max' : 'Mid';
    }
    return 'Mid';
  };
  const parts = p.split(/\s+/);
  return { x: tox(parts[0]), y: tox(parts[1] ?? parts[0]) };
}
function makeAsymmetricRoundRectPath(box: { x: number; y: number; w: number; h: number }, r: CornerRadius): string {
  const { x, y, w, h } = box;
  const maxR = Math.min(w / 2, h / 2);
  const tl = Math.max(0, Math.min(r.topLeft, maxR));
  const tr = Math.max(0, Math.min(r.topRight, maxR));
  const br = Math.max(0, Math.min(r.bottomRight, maxR));
  const bl = Math.max(0, Math.min(r.bottomLeft, maxR));
  return `M ${x + tl} ${y} H ${x + w - tr} A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr} V ${y + h - br} A ${br} ${br} 0 0 1 ${x + w - br} ${y + h} H ${x + bl} A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl} V ${y + tl} A ${tl} ${tl} 0 0 1 ${x + tl} ${y} Z`;
}

function clipShapeForNode(node: Node): string | null {
  const { x, y, w, h } = node.box;
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  const cp = node.style.clipPath?.trim();
  if (cp && cp !== 'none') {
    const poly = cp.match(/polygon\(([^)]+)\)/);
    if (poly?.[1]) {
      const pts = poly[1].split(',').map((pair) => {
        const parts = pair.trim().split(/\s+/);
        const px = parts[0]?.endsWith('%') ? x + (parseFloat(parts[0]) / 100) * w : x + (parseFloat(parts[0] || '0') || 0);
        const py = parts[1]?.endsWith('%') ? y + (parseFloat(parts[1]) / 100) * h : y + (parseFloat(parts[1] || '0') || 0);
        return `${r2(px)},${r2(py)}`;
      }).join(' ');
      return `<polygon points="${pts}" />`;
    }
    const circ = cp.match(/circle\(\s*([^\s]+)(?:\s+at\s+([^\s]+)\s+([^\s)]+))?\s*\)/);
    if (circ) {
      const dim = (tok: string | undefined, size: number): number => {
        if (!tok) return size / 2;
        if (tok.endsWith('%')) return (parseFloat(tok) / 100) * size;
        if (tok === 'left' || tok === 'top') return 0;
        if (tok === 'right' || tok === 'bottom') return size;
        if (tok === 'center') return size / 2;
        return parseFloat(tok) || size / 2;
      };
      const rTok = circ[1] ?? '';
      const cx = x + dim(circ[2], w);
      const cy = y + dim(circ[3], h);
      const rr = rTok.endsWith('%') ? (parseFloat(rTok) / 100) * Math.min(w, h) : parseFloat(rTok) || Math.min(w, h) / 2;
      return `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(rr)}" />`;
    }
    const ell = cp.match(/ellipse\(\s*([^\s]+)\s+([^\s]+)(?:\s+at\s+([^\s]+)\s+([^\s)]+))?\s*\)/);
    if (ell) {
      const dim = (tok: string | undefined, size: number): number => {
        if (!tok) return size / 2;
        if (tok.endsWith('%')) return (parseFloat(tok) / 100) * size;
        if (tok === 'left' || tok === 'top') return 0;
        if (tok === 'right' || tok === 'bottom') return size;
        if (tok === 'center') return size / 2;
        return parseFloat(tok) || size / 2;
      };
      const rx = ell[1]?.endsWith('%') ? (parseFloat(ell[1]) / 100) * w : parseFloat(ell[1] ?? '') || w / 2;
      const ry = ell[2]?.endsWith('%') ? (parseFloat(ell[2]) / 100) * h : parseFloat(ell[2] ?? '') || h / 2;
      const cx = x + dim(ell[3], w);
      const cy = y + dim(ell[4], h);
      return `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" />`;
    }
    const inset = cp.match(/inset\(([^)]+)\)/);
    if (inset?.[1]) {
      const parts = inset[1].trim().split(/\s+/);
      const edge = (tok: string | undefined, size: number): number => {
        if (!tok || tok === '0') return 0;
        if (tok.endsWith('%')) return (parseFloat(tok) / 100) * size;
        return parseFloat(tok) || 0;
      };
      const t = edge(parts[0], h);
      const rr = edge(parts[1] ?? parts[0], w);
      const b = edge(parts[2] ?? parts[0], h);
      const l = edge(parts[3] ?? parts[1] ?? parts[0], w);
      return `<rect x="${r2(x + l)}" y="${r2(y + t)}" width="${r2(Math.max(0, w - l - rr))}" height="${r2(Math.max(0, h - t - b))}" />`;
    }
    return null;
  }
  const r = node.style.radius;
  const hasRadius = Boolean(r && (r.topLeft > 0 || r.topRight > 0 || r.bottomRight > 0 || r.bottomLeft > 0));
  const hasImage = node.type === 'image' || node.style.fills.some((f) => f.type === 'image');
  if (node.style.clip || (hasImage && hasRadius)) {
    const maxR = Math.min(w / 2, h / 2);
    const { tl, tr, br, bl } = cornerInsets(node.style.radius, maxR);
    if (tl === tr && tr === br && br === bl) {
      const rx = tl > 0 ? ` rx="${tl}" ry="${tl}"` : '';
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx} />`;
    }
    return `<path d="${makeAsymmetricRoundRectPath(node.box, node.style.radius ?? { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 })}" />`;
  }
  return null;
}
function cornerInsets(r: CornerRadius | undefined, maxR: number): { tl: number; tr: number; br: number; bl: number } {
  if (!r) return { tl: 0, tr: 0, br: 0, bl: 0 };
  return {
    tl: Math.max(0, Math.min(r.topLeft, maxR)),
    tr: Math.max(0, Math.min(r.topRight, maxR)),
    br: Math.max(0, Math.min(r.bottomRight, maxR)),
    bl: Math.max(0, Math.min(r.bottomLeft, maxR)),
  };
}

function renderPerEdgeLines(node: Node, tmAttr: string): string {
  const lines: string[] = [];
  const b = node.box;
  const maxR = Math.min(b.w / 2, b.h / 2);
  const { tl, tr, br, bl } = cornerInsets(node.style.radius, maxR);
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  for (const s of node.style.strokes ?? []) {
    if (!s.side || s.side === 'all' || s.width <= 0) continue;
    const dash = s.style === 'dashed' ? ` stroke-dasharray="${s.width * 3},${s.width * 2}"` : s.style === 'dotted' ? ` stroke-dasharray="${s.width},${s.width * 1.5}"` : '';
    const w = s.width;
    const c = escapeXml(s.color);
    if (s.side === 'top') lines.push(`    <line x1="${round2(b.x + tl)}" y1="${round2(b.y + w / 2)}" x2="${round2(b.x + b.w - tr)}" y2="${round2(b.y + w / 2)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'bottom') lines.push(`    <line x1="${round2(b.x + bl)}" y1="${round2(b.y + b.h - w / 2)}" x2="${round2(b.x + b.w - br)}" y2="${round2(b.y + b.h - w / 2)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'left') lines.push(`    <line x1="${round2(b.x + w / 2)}" y1="${round2(b.y + tl)}" x2="${round2(b.x + w / 2)}" y2="${round2(b.y + b.h - bl)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'right') lines.push(`    <line x1="${round2(b.x + b.w - w / 2)}" y1="${round2(b.y + tr)}" x2="${round2(b.x + b.w - w / 2)}" y2="${round2(b.y + b.h - br)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
  }
  return lines.join('\n');
}


function svgTransformMatrix(node: Node) {
  const tf = node.style.transform;
  if (!tf || tf === 'none') return null;
  let p: number[] | null = null;
  const m2 = tf.match(/^matrix\(([^)]+)\)$/);
  const m3 = tf.match(/^matrix3d\(([^)]+)\)$/);
  if (m2?.[1]) {
    const v = m2[1].split(',').map((s) => parseFloat(s.trim()));
    if (v.length === 6 && !v.some((n) => Number.isNaN(n))) p = v;
  } else if (m3?.[1]) {
    const v = m3[1].split(',').map((s) => parseFloat(s.trim()));
    if (v.length === 16 && !v.some((n) => Number.isNaN(n))) p = [v[0], v[1], v[4], v[5], v[12], v[13]];
  }
  if (!p) return null;
  const [a, b, c, d, tx, ty] = p;
  if (a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0) return null;
  const { x, y, w, h } = node.box;
  const orig = node.style.transformOrigin?.trim() || '50% 50%';
  const isZero = orig === '0 0' || orig === '0px 0px';
  const ox = isZero ? x : orig.endsWith('px') && !orig.includes('%') ? x + (parseFloat(orig.split(/\s+/)[0]) || w / 2) : x + w / 2;
  const oy = isZero ? y : orig.endsWith('px') && !orig.includes('%') ? y + (parseFloat(orig.split(/\s+/)[1] ?? orig.split(/\s+/)[0]) || h / 2) : y + h / 2;
  const e = Math.round((tx + ox - (a * ox + c * oy)) * 1e6) / 1e6;
  const f = Math.round((ty + oy - (b * ox + d * oy)) * 1e6) / 1e6;
  const matrix = `matrix(${Math.round(a * 1e6) / 1e6} ${Math.round(b * 1e6) / 1e6} ${Math.round(c * 1e6) / 1e6} ${Math.round(d * 1e6) / 1e6} ${e} ${f})`;
  return { attr: ` transform="${matrix}"`, matrix, a, b, c, d, e, f };
}

function isNodeOffscreen(node: Node, frame: Capture['frame']): boolean {
  const { x, y, w, h } = node.box;
  if (w <= 0 && h <= 0 && node.type !== 'frame') return true;
  const tm = svgTransformMatrix(node);
  const pts = tm
    ? [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([cx, cy]) => [tm.a * cx + tm.c * cy + tm.e, tm.b * cx + tm.d * cy + tm.f])
    : [[x, y], [x + w, y + h]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return Math.max(...ys) <= 0 || Math.max(...xs) <= 0 || Math.min(...xs) >= frame.width || Math.min(...ys) >= frame.height;
}

function renderNodeToFigmaSvg(
  node: Node,
  assets: Capture['assets'],
  isGroupSelf = false,
  inlineLeadWidth = 0,
  pillMidY?: number,
  isAmbientGlow = false
): string {
  const { box, style, type } = node;
  const opacityAttr = style.opacity !== undefined && style.opacity < 1 ? ` opacity="${style.opacity}"` : '';
  const r = style.radius;
  const isUniformRadius = !r || (r.topLeft === r.topRight && r.topRight === r.bottomRight && r.bottomRight === r.bottomLeft);
  const rxVal = isUniformRadius && r && r.topLeft ? Math.min(r.topLeft, box.w / 2, box.h / 2) : 0;
  const rx = rxVal > 0 ? ` rx="${rxVal}" ry="${rxVal}"` : '';
  const asymPathD = !isUniformRadius && r ? makeAsymmetricRoundRectPath(box, r) : '';
  const blendStyle = style.mixBlendMode && style.mixBlendMode !== 'normal' ? ` style="mix-blend-mode: ${escapeXml(style.mixBlendMode)};"` : '';
  const tm = svgTransformMatrix(node);
  const transformAttr = tm ? tm.attr : '';
  const hasOuterShadow = Boolean(
    style.shadows?.some(
      (s) => !s.inset && (s.blur > 0 || Math.abs(s.x) > 0 || Math.abs(s.y) > 0) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
    )
  );
  const hasBackdrop = Boolean(style.backdropFilter && style.backdropFilter !== 'none');
  const filterAttr =
    !isGroupSelf && ((style.filter && style.filter !== 'none') || hasOuterShadow || hasBackdrop)
      ? ` filter="url(#fx-${escapeXml(node.id)})"`
      : '';
  const maskAttr = !isGroupSelf && style.maskImage && style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
  const leafClipAttr = !isGroupSelf && clipShapeForNode(node) ? ` clip-path="url(#clip-${escapeXml(node.id)})"` : '';
  let strokeAttrs = '';
  const allSidedStroke = style.strokes?.find((s) => (!s.side || s.side === 'all') && s.width > 0);
  const topHighlight = style.shadows?.find(
    (s) => Boolean(s.inset) && s.x === 0 && s.y > 0 && s.y <= 2 && s.blur <= 2 && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
  );
  const spreadRing = style.shadows?.find(
    (s) => !s.inset && s.x === 0 && s.y === 0 && s.blur <= 1 && s.spread && s.spread > 0 && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
  );
  if (allSidedStroke) {
    const dash = allSidedStroke.style === 'dashed' ? ` stroke-dasharray="${allSidedStroke.width * 3},${allSidedStroke.width * 2}"` : allSidedStroke.style === 'dotted' ? ` stroke-dasharray="${allSidedStroke.width},${allSidedStroke.width * 1.5}"` : '';
    strokeAttrs = ` stroke="${escapeXml(allSidedStroke.color)}" stroke-width="${allSidedStroke.width}"${dash}`;
  } else if (style.shadows && style.shadows.length > 0) {
    const ring = style.shadows.find(
      (s) => s !== topHighlight && Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1 && s.blur <= 2 && ((s.spread && s.spread > 0) || (s.inset && s.y === 0)) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
    );
    if (ring) {
      strokeAttrs = ` stroke="${escapeXml(ring.color)}" stroke-width="${ring.spread && ring.spread > 0 ? ring.spread : 1}"`;
    }
  }
  const edgeLines = renderPerEdgeLines(node, transformAttr);
  const outlineOffset = allSidedStroke?.offset && allSidedStroke.offset !== 0 ? Math.max(0, allSidedStroke.offset) : 0;
  const outlineOverlay = outlineOffset > 0 && allSidedStroke
    ? `\n    <rect id="${escapeXml(node.id)}-outline" x="${box.x - outlineOffset}" y="${box.y - outlineOffset}" width="${box.w + outlineOffset * 2}" height="${box.h + outlineOffset * 2}" fill="none"${rx}${strokeAttrs}${opacityAttr}${transformAttr}${filterAttr} />`
    : '';
  const ringOverlay =
    allSidedStroke && spreadRing && spreadRing.spread
      ? (() => {
          const sp = spreadRing.spread;
          const ringRx = rxVal > 0 ? ` rx="${rxVal + sp}" ry="${rxVal + sp}"` : '';
          return `\n    <rect id="${escapeXml(node.id)}-ring" x="${box.x - sp}" y="${box.y - sp}" width="${box.w + sp * 2}" height="${box.h + sp * 2}" fill="none"${ringRx} stroke="${escapeXml(spreadRing.color)}" stroke-width="${sp}"${opacityAttr}${transformAttr} />`;
        })()
      : '';
  const topHighlightOverlay =
    topHighlight && box.w > 0
      ? (() => {
          const maxR = Math.min(box.w / 2, box.h / 2);
          const { tl, tr } = cornerInsets(style.radius, maxR);
          const round2 = (n: number): number => Math.round(n * 100) / 100;
          const w = topHighlight.y;
          return `\n    <line id="${escapeXml(node.id)}-inset-top" x1="${round2(box.x + tl)}" y1="${round2(box.y + w / 2)}" x2="${round2(box.x + box.w - tr)}" y2="${round2(box.y + w / 2)}" stroke="${escapeXml(topHighlight.color)}" stroke-width="${w}"${opacityAttr}${transformAttr} />`;
        })()
      : '';
  const lineSuffix = edgeLines ? `\n${edgeLines}` : '';

  if (type === 'text') {
    const text = node.text;
    if (!text) return '';

    const content = escapeXml(applyTextTransform(text.content, text.textTransform));
    const anchor = text.align === 'center' ? 'middle' : text.align === 'right' ? 'end' : 'start';
    const anchorAttr = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
    const textX =
      anchor === 'middle'
        ? Math.round((box.x + box.w / 2) * 100) / 100
        : anchor === 'end'
        ? Math.round((box.x + box.w) * 100) / 100
        : box.x;
    const lh = typeof text.lineHeight === 'number' ? text.lineHeight : text.fontSize * 1.25;
    const textGradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
    // bg-clip:text nodes carry the gradient in fills with a transparent text
    // color: emit the gradient on the <text> so the fill survives the paste.
    const textFillAttr = textGradFill ? ` fill="url(#grad-${escapeXml(node.id)})"` : ` fill="${escapeXml(text.color)}"`;
    let effectiveRuns = text.runs;
    if ((!effectiveRuns || effectiveRuns.length <= 1) && inlineLeadWidth > 0 && box.h >= lh * 1.6) {
      const words = text.content.trim().split(/\s+/);
      const firstMax = Math.max(8, Math.floor((box.w - inlineLeadWidth) / (text.fontSize * 0.52)));
      const line1: string[] = [];
      for (const w of words) {
        if (line1.length > 0 && line1.join(' ').length + 1 + w.length > firstMax) break;
        line1.push(w);
      }
      const rest = words.slice(line1.length).join(' ');
      if (line1.length > 0 && rest) effectiveRuns = [{ text: line1.join(' ') }, { text: rest }];
    }
    const firstRunX = inlineLeadWidth > 0 && anchor === 'start' ? Math.round((box.x + inlineLeadWidth + 8) * 100) / 100 : textX;
    const lsAttr = typeof text.letterSpacing === 'number' && text.letterSpacing !== 0 ? ` letter-spacing="${text.letterSpacing}"` : '';
    const wsAttr = typeof text.wordSpacing === 'number' && text.wordSpacing !== 0 ? ` word-spacing="${text.wordSpacing}"` : typeof text.wordSpacing === 'string' && text.wordSpacing && text.wordSpacing !== 'normal' && text.wordSpacing !== '0px' ? ` word-spacing="${escapeXml(text.wordSpacing)}"` : '';
    const textStrokeAttr = text.textStroke ? ` stroke="${escapeXml(text.textStroke.split(/\s+/).slice(1).join(' ') || text.color)}" stroke-width="${escapeXml(text.textStroke.split(/\s+/)[0])}" paint-order="stroke"` : '';
    const dirAttr = text.direction === 'rtl' ? ' direction="rtl" unicode-bidi="embed"' : '';
    const italicAttr = text.italic ? ' font-style="italic"' : '';
    const decoAttr = text.decoration && text.decoration !== 'none' && !text.decoration.startsWith('none') ? ` text-decoration="${escapeXml(text.decoration.split(' ')[0])}"` : '';
    const innerContent =
      effectiveRuns && effectiveRuns.length > 0
        ? effectiveRuns
          .map((r, idx) => {
            const rWeight = r.fontWeight ? ` font-weight="${r.fontWeight}"` : '';
            const rSize = r.fontSize ? ` font-size="${r.fontSize}"` : '';
            const rFamily = r.fontFamily ? ` font-family="${escapeXml(cleanSvgFontFamily(r.fontFamily))}"` : '';
            const rItalic = r.italic ? ' font-style="italic"' : '';
            const rDeco = r.underline ? ' text-decoration="underline"' : '';
            const rColor = !textGradFill && r.color ? ` fill="${escapeXml(r.color)}"` : '';
            const runX = anchor === 'start' && r.x !== undefined ? r.x : idx === 0 && inlineLeadWidth > 0 ? firstRunX : textX;
            const posAttrs = idx > 0 ? ` x="${runX}" dy="${lh}"` : inlineLeadWidth > 0 || (anchor === 'start' && r.x !== undefined) ? ` x="${runX}"` : '';
            return `<tspan${posAttrs}${rFamily}${rSize}${rWeight}${rItalic}${rDeco}${rColor}>${escapeXml(applyTextTransform(r.text, text.textTransform))}</tspan>`;
          })
          .join('')
        : content;

    // Figma's SVG importer ignores dominant-baseline="text-before-edge" and
    // treats y as the alphabetic baseline. Compute the true baseline from the
    // first line's vertical midpoint plus cap-height half-offset (0.35 * em).
    const hasMultiRuns = Boolean(effectiveRuns && effectiveRuns.length > 1);
    const firstLineH = hasMultiRuns ? lh : box.h > 0 ? box.h : lh;
    const lineMidY = !hasMultiRuns && pillMidY !== undefined ? pillMidY : box.y + firstLineH / 2;
    const textY = Math.round((lineMidY + text.fontSize * 0.33) * 100) / 100;
    return `    <text id="${escapeXml(node.name || node.id)}" x="${firstRunX}" y="${textY}"${anchorAttr} font-family="${escapeXml(
      cleanSvgFontFamily(text.fontFamily)
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}"${lsAttr}${wsAttr}${textStrokeAttr}${dirAttr}${italicAttr}${decoAttr}${textFillAttr}${opacityAttr}${transformAttr}${filterAttr}>${innerContent}</text>`;
  }
  if (type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
    // Path data lives in viewBox units: scale into the laid-out box with a
    // meet-fit (SVG default), centering the shorter axis.
    const vb = node.vectorViewBox;
    const sx = vb && vb.width > 0 ? box.w / vb.width : 1;
    const sy = vb && vb.height > 0 ? box.h / vb.height : 1;
    const s = Math.min(sx, sy);
    const dx = box.x + (box.w - (vb ? vb.width : box.w) * s) / 2;
    const dy = box.y + (box.h - (vb ? vb.height : box.h) * s) / 2;
    const scale = s === 1 ? '' : ` scale(${s})`;
    const paths = node.vectorPaths
      .filter((p, idx) => !(idx > 0 && /^M 0 0 H [\d.]+ V [\d.]+ H 0 Z$/.test(p.d) && (p.fill === '#fff' || p.fill === '#ffffff')))
      .map((p) => {
        const rawFill = p.stroke && /^M 0\.5 0\.5 H /.test(p.d) ? 'none' : p.fill?.startsWith('url(') ? 'rgba(133, 139, 152, 0.25)' : p.fill;
        const fill = rawFill ? ` fill="${escapeXml(rawFill)}"` : ' fill="currentColor"';
        const stroke = p.stroke ? ` stroke="${escapeXml(p.stroke)}"` : '';
        const sw = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
        return `      <path d="${escapeXml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    const inner = `<g transform="translate(${dx} ${dy})${scale}">\n${paths}\n      </g>`;
    return leafClipAttr
      ? `    <g id="${escapeXml(node.id)}"${transformAttr}${leafClipAttr}${opacityAttr}>\n      ${inner}\n    </g>`
      : `    <g id="${escapeXml(node.id)}" transform="${tm ? `${tm.matrix} ` : ''}translate(${dx} ${dy})${scale}"${opacityAttr}>\n${paths}\n    </g>`;
  }

  if (type === 'image') {
    const fit = node.objectFit ?? 'cover';
    const meetSlice = fit === 'cover' ? 'slice' : fit === 'contain' ? 'meet' : 'none';
    const align = backgroundPositionAlign(node.objectPosition);
    const par = meetSlice === 'none' ? 'none' : `${align.x}${align.y} ${meetSlice}`;
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
        box.w
      }" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${rx}${transformAttr}${filterAttr}${leafClipAttr} />`;
    }
    return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" fill="#cccccc"${rx}${strokeAttrs}${opacityAttr}${transformAttr}${filterAttr}${leafClipAttr} />`;
  }

  // Handle rect or frame
  if (isAmbientGlow) {
    return `    <ellipse id="${escapeXml(node.id)}" cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${Math.round(box.w * 0.65)}" ry="${Math.round(box.h * 0.65)}" fill="url(#glow-${escapeXml(node.id)})"${opacityAttr}${transformAttr} />`;
  }

  const gradFills = style.fills.filter((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = style.fills.find((f) => f.type === 'image' && f.assetRef);

  if (gradFills.length > 0) {
    const layers: string[] = [];
    if (firstSolid?.color) {
      layers.push(`    <rect id="${escapeXml(node.id)}-base" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${escapeXml(firstSolid.color)}"${rx}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${leafClipAttr} />`);
    }
    if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
      const asset = assets[imageFill.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      const { par: bgPar, tile } = backgroundPreserveAspectRatio(style);
      const align = backgroundPositionAlign(style.backgroundPosition);
      const meetSlice = bgPar.includes('meet') ? 'meet' : bgPar.includes('none') ? 'none' : 'slice';
      const par = tile !== 'none' ? `xMidYMid ${meetSlice}` : `${align.x}${align.y} ${meetSlice}`;
      layers.push(`    <image id="${escapeXml(node.id)}-img" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${rx}${transformAttr}${filterAttr}${leafClipAttr} />`);
    }
    for (let gIdx = gradFills.length - 1; gIdx >= 0; gIdx--) {
      const gradId = gIdx === 0 ? `grad-${escapeXml(node.id)}` : `grad-${escapeXml(node.id)}-${gIdx}`;
      const idAttr = gIdx === 0 && !firstSolid?.color ? ` id="${escapeXml(node.id)}"` : ` id="${escapeXml(node.id)}-grad-${gIdx}"`;
      const sAttr = gIdx === 0 ? strokeAttrs : '';
      layers.push(`    <rect${idAttr} x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#${gradId})"${rx}${sAttr}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${leafClipAttr} />`);
    }
    return `${layers.join('\n')}${outlineOverlay}${ringOverlay}${topHighlightOverlay}${lineSuffix}`;
  }
  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    const asset = assets[imageFill.assetRef];
    const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
    const { par: bgPar, tile } = backgroundPreserveAspectRatio(style);
    const align = backgroundPositionAlign(style.backgroundPosition);
    const meetSlice = bgPar.includes('meet') ? 'meet' : bgPar.includes('none') ? 'none' : 'slice';
    const par = tile !== 'none' ? `xMidYMid ${meetSlice}` : `${align.x}${align.y} ${meetSlice}`;
    return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${rx}${transformAttr}${filterAttr}${leafClipAttr} />`;
  }

  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';
  if (isGroupSelf && fill === 'none' && !strokeAttrs && !edgeLines && !outlineOverlay && !ringOverlay && !topHighlightOverlay) return '';
  const baseStrokeAttrs = outlineOverlay ? '' : strokeAttrs;
  const shapeAttrs = `${baseStrokeAttrs}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${leafClipAttr}${blendStyle}`;
  const baseShape = asymPathD
    ? `    <path id="${escapeXml(node.id)}" d="${asymPathD}" fill="${fill}"${shapeAttrs} />`
    : `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fill}"${rx}${shapeAttrs} />`;
  return `${baseShape}${outlineOverlay}${ringOverlay}${topHighlightOverlay}${lineSuffix}`;
}

function buildFigmaLayers(capture: Capture): string {
  // Build tree to maintain group structure
  const childrenMap = new Map<string, Node[]>();
  const rootNodes: Node[] = [];
  const nodeMap = new Map<string, Node>();
  const glowIds = collectAmbientGlowIds(capture);

  for (const node of capture.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const node of capture.nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    } else {
      rootNodes.push(node);
    }
  }

  function findFirstDescendantText(node: Node): string | null {
    const children = childrenMap.get(node.id) ?? [];
    for (const child of children) {
      if (child.type === 'text' && child.text?.content) {
        const cleaned = child.text.content.replace(/\s+/g, ' ').trim();
        if (cleaned) return cleaned;
      }
      const nested = findFirstDescendantText(child);
      if (nested) return nested;
    }
    return null;
  }

  function findInlineLeadWidth(node: Node): number {
    if (node.type !== 'text' || !node.parentId) return 0;
    const sibs = childrenMap.get(node.parentId) ?? [];
    const lead = sibs.find((s) => s.id !== node.id && s.type === 'text' && Math.abs(s.box.x - node.box.x) < 2 && Math.abs(s.box.y - node.box.y) < 4 && s.box.w < node.box.w * 0.5);
    return lead ? lead.box.w : 0;
  }
  function resolvePillMidY(node: Node): number | undefined {
    if (node.type !== 'text' || !node.parentId) return undefined;
    let anc = nodeMap.get(node.parentId);
    if (anc && anc.style.fills.length === 0 && (!anc.style.strokes || anc.style.strokes.length === 0) && anc.parentId) {
      const gp = nodeMap.get(anc.parentId);
      if (gp && gp.box.h <= 60) anc = gp;
    }
    if (!anc || anc.box.h < 20 || anc.box.h > 60) return undefined;
    const ancMid = anc.box.y + anc.box.h / 2;
    const textMid = node.box.y + (node.box.h > 0 ? node.box.h : node.text?.fontSize ?? 16) / 2;
    return Math.abs(textMid - ancMid) <= 5 ? ancMid : undefined;
  }

  function renderTree(node: Node): string {
    const children = childrenMap.get(node.id);
    if (!children || children.length === 0) {
      return isNodeOffscreen(node, capture.frame)
        ? ''
        : renderNodeToFigmaSvg(node, capture.assets, false, findInlineLeadWidth(node), resolvePillMidY(node), glowIds.has(node.id));
    }
    const childrenSvg = children.map(renderTree).filter(Boolean).join('\n');
    if (!childrenSvg && isNodeOffscreen(node, capture.frame)) return '';
    const isGlow = glowIds.has(node.id);
    const selfLayer = renderNodeToFigmaSvg(node, capture.assets, true, 0, undefined, isGlow);
    const childrenOverflow = children.some(
      (c) =>
        c.box.x < node.box.x - 1 ||
        c.box.y < node.box.y - 1 ||
        c.box.x + c.box.w > node.box.x + node.box.w + 2 ||
        c.box.y + c.box.h > node.box.y + node.box.h + 2
    );
    const clipShape = clipShapeForNode(node);
    const tm = svgTransformMatrix(node);
    const groupHasFilter =
      !isGlow &&
      ((node.style.filter && node.style.filter !== 'none') ||
        (node.style.backdropFilter && node.style.backdropFilter !== 'none') ||
        (node.style.shadows ?? []).some(
          (s) => !s.inset && (s.blur > 0 || Math.abs(s.x) > 0 || Math.abs(s.y) > 0) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
        ));

    if (
      children.length === 1 &&
      !selfLayer &&
      !node.style.clip &&
      !childrenOverflow &&
      !tm &&
      (node.style.opacity ?? 1) >= 1 &&
      (!node.style.filter || node.style.filter === 'none') &&
      (!node.style.backdropFilter || node.style.backdropFilter === 'none') &&
      !groupHasFilter &&
      (!node.style.maskImage || node.style.maskImage === 'none') &&
      !clipShape
    ) {
      return childrenSvg;
    }

    const clipAttr =
      clipShape && childrenOverflow
        ? ` clip-path="url(#clip-${escapeXml(node.id)})" data-clips-content="true"`
        : '';
    const groupOpacity = !selfLayer && node.style.opacity !== undefined && node.style.opacity < 1 ? ` opacity="${node.style.opacity}"` : '';
    const groupMask = node.style.maskImage && node.style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
    const groupFilter = groupHasFilter ? ` filter="url(#fx-${escapeXml(node.id)})"` : '';
    const descendantText = !node.name ? findFirstDescendantText(node) : null;
    const rawGroupId = node.name
      ? `${node.name} (${node.id})`
      : descendantText
      ? `Container · ${descendantText.slice(0, 24).trimEnd()} (${node.id})`
      : `group-${node.id}`;
    const groupId = escapeXml(rawGroupId);
    return [`  <g id="${groupId}"${clipAttr}${groupOpacity}${groupMask}${groupFilter}>`, selfLayer, childrenSvg, '  </g>'].filter(Boolean).join('\n');
  }

  return rootNodes.map(renderTree).filter(Boolean).join('\n');
}

/** Map a CSS filter chain to SVG filter primitives. */
function buildFilterPrimitives(filter: string | undefined, shadows?: Node['style']['shadows'], backdrop?: string): string[] {
  const prims: string[] = [];
  if (backdrop && backdrop !== 'none') {
    for (const m of backdrop.matchAll(/(\w[\w-]*)\(([^()]*)\)/g)) {
      const fn = m[1].toLowerCase();
      const arg = m[2].trim();
      const num = parseFloat(arg);
      if ((fn === 'blur' || fn === 'backdrop-blur') && !Number.isNaN(num) && num > 0) {
        prims.push(`      <feGaussianBlur in="BackgroundImage" stdDeviation="${num}" result="glass-blur" />`);
        prims.push('      <feComposite in="SourceGraphic" in2="glass-blur" operator="over" />');
      } else if (fn === 'brightness' || fn === 'contrast' || fn === 'saturate' || fn === 'grayscale') {
        const v = arg.endsWith('%') ? num / 100 : num;
        const kind = fn === 'brightness' ? 'brightness' : fn === 'contrast' ? 'contrast' : fn;
        if (!Number.isNaN(v)) prims.push(`      <feColorMatrix in="BackgroundImage" type="${kind}" values="${v}" result="glass-tint" />`);
      }
    }
  }
  for (const m of (filter ?? '').matchAll(/(\w[\w-]*)\(([^()]*)\)/g)) {
    const fn = m[1].toLowerCase();
    const arg = m[2].trim();
    const num = parseFloat(arg);
    if (fn === 'blur' && !Number.isNaN(num)) {
      prims.push('      <feGaussianBlur stdDeviation="' + num + '" />');
    } else if ((fn === 'brightness' || fn === 'contrast') && !Number.isNaN(num)) {
      const v = arg.endsWith('%') ? num / 100 : num;
      const ic = fn === 'contrast' ? (1 - v) / 2 : 0;
      prims.push('      <feComponentTransfer><feFuncR type="linear" slope="' + v + '" intercept="' + ic + '"/><feFuncG type="linear" slope="' + v + '" intercept="' + ic + '"/><feFuncB type="linear" slope="' + v + '" intercept="' + ic + '"/></feComponentTransfer>');
    } else if ((fn === 'saturate' || fn === 'grayscale' || fn === 'sepia' || fn === 'invert' || fn === 'opacity') && !Number.isNaN(num)) {
      const v = arg.endsWith('%') ? num / 100 : num;
      if (fn === 'saturate') prims.push('      <feColorMatrix type="saturate" values="' + v + '" />');
      else if (fn === 'grayscale') prims.push('      <feColorMatrix type="saturate" values="' + (1 - v) + '" />');
      else if (fn === 'sepia') prims.push('      <feColorMatrix type="matrix" values="0.393 0.769 0.189 0 0 0.349 0.686 0.168 0 0 0.272 0.534 0.131 0 0 0 0 0 1 0"/>');
      else if (fn === 'invert') prims.push('      <feComponentTransfer><feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer>');
      else prims.push('      <feComponentTransfer><feFuncA type="linear" slope="' + v + '" intercept="0"/></feComponentTransfer>');
    } else if (fn === 'hue-rotate') {
      prims.push('      <feColorMatrix type="hueRotate" values="' + (num || 0) + '" />');
    } else if (fn === 'drop-shadow') {
      const colMatch = arg.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]+|[a-z]+)/i);
      const col = colMatch ? colMatch[0] : 'rgba(0,0,0,0.5)';
      const nums = (arg.replace(col, '').match(/-?[\d.]+/g) || []).map(Number);
      const dx = nums[0] ?? 0; const dy = nums[1] ?? 4; const std = nums[2] ?? 4;
      prims.push('      <feDropShadow dx="' + dx + '" dy="' + dy + '" stdDeviation="' + std + '" flood-color="' + col + '" />');
    }
  }
  for (const s of shadows ?? []) {
    if (!s.inset && (s.blur > 0 || Math.abs(s.x) > 0 || Math.abs(s.y) > 0) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)') {
      const { rgb, alpha } = parseGlowColor(s.color);
      if (alpha > 0) {
        prims.push(
          `      <feDropShadow dx="${s.x}" dy="${s.y}" stdDeviation="${Math.max(0.5, s.blur / 2)}" flood-color="${escapeXml(rgb)}" flood-opacity="${alpha}" />`
        );
      }
    }
  }
  return prims;
}


function buildFigmaDefs(captures: Capture[]): string {
  const defs: string[] = [];
  for (const [cIdx, capture] of captures.entries()) {
    const glowIds = collectAmbientGlowIds(capture);
    for (const node of capture.nodes) {
      if (glowIds.has(node.id)) continue;
      const prims = buildFilterPrimitives(node.style.filter, node.style.shadows, node.style.backdropFilter);
      if (prims.length > 0) {
        defs.push(
          `    <filter id="fx-${escapeXml(node.id)}" x="-40%" y="-40%" width="180%" height="180%">\n${prims.join('\n')}\n    </filter>`
        );
      }
    }
    defs.push(
      `    <clipPath id="frame-clip-${cIdx}">\n      <rect x="0" y="0" width="${capture.frame.width}" height="${capture.frame.height}" />\n    </clipPath>`
    );
    for (const node of capture.nodes) {
      if (glowIds.has(node.id)) {
        const rawColor = getAmbientGlowColor(node);
        if (rawColor) {
          const { rgb, alpha } = parseGlowColor(rawColor);
          const startAlpha = alpha >= 1 ? 0.65 : alpha;
          defs.push(
            `    <radialGradient id="glow-${escapeXml(node.id)}" cx="50%" cy="50%" r="50%">\n` +
            `      <stop offset="0%" stop-color="${escapeXml(rgb)}" stop-opacity="${startAlpha}" />\n` +
            `      <stop offset="100%" stop-color="${escapeXml(rgb)}" stop-opacity="0" />\n` +
            `    </radialGradient>`
          );
        }
        continue;
      }
      const gradFills = node.style.fills.filter((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
      gradFills.forEach((gradFill, gIdx) => {
        if (!gradFill.stops) return;
        const gradId = gIdx === 0 ? `grad-${escapeXml(node.id)}` : `grad-${escapeXml(node.id)}-${gIdx}`;
        const stops = gradFill.stops.map((s) => formatSvgStop(s.color, Math.round(s.position * 100))).join('\n');
        if (gradFill.gradientType === 'radial') {
          const cx = `${Math.round((gradFill.cx ?? 0.5) * 100)}%`;
          const cy = `${Math.round((gradFill.cy ?? 0.5) * 100)}%`;
          defs.push(`    <radialGradient id="${gradId}" cx="${cx}" cy="${cy}" r="75%">\n${stops}\n    </radialGradient>`);
        } else {
          const angleRad = (((gradFill.angle ?? 180) - 90) * Math.PI) / 180;
          const cos = Math.cos(angleRad);
          const sin = Math.sin(angleRad);
          const x1 = `${Math.round((0.5 - cos * 0.5) * 100)}%`;
          const y1 = `${Math.round((0.5 - sin * 0.5) * 100)}%`;
          const x2 = `${Math.round((0.5 + cos * 0.5) * 100)}%`;
          const y2 = `${Math.round((0.5 + sin * 0.5) * 100)}%`;
          defs.push(`    <linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">\n${stops}\n    </linearGradient>`);
        }
      });

      const clipShape = clipShapeForNode(node);
      if (clipShape) {
        defs.push(`    <clipPath id="clip-${escapeXml(node.id)}">\n      ${clipShape}\n    </clipPath>`);
      }
      // CSS mask-image gradient fades: luminance mask so glows fade out.
      const mask = node.style.maskImage;
      if (mask && mask !== 'none') {
        const rawStops = [...mask.matchAll(/((?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+(?:\s+[a-z]+)?))\s+([\d.]+)(%|px)?/gi)];
        const isDot = rawStops.length > 0 && rawStops.every((m) => m[3] === 'px' && parseFloat(m[2]) <= 2);
        const stops = isDot
          ? [{ alpha: 0.25, position: 0 }, { alpha: 0, position: 0.85 }]
          : rawStops.map((m) => ({ alpha: parseStopAlpha(m[1]), position: m[3] === 'px' ? (parseFloat(m[2]) > 0 ? 0.02 : 0) : Math.max(0, Math.min(1, parseFloat(m[2]) / 100)) }));
        for (let k = stops.length - 1; k > 0; k--) {
          if (Math.abs(stops[k].position - stops[k - 1].position) < 0.02) stops.splice(k, 1);
        }
        if (stops.length >= 2) {
           const stopXml = stops.map((s) => `      <stop offset="${Math.round(s.position * 100)}%" stop-color="#ffffff" stop-opacity="${s.alpha}" />`).join('\n');
           const isRadial = mask.trimStart().toLowerCase().startsWith('radial-gradient');
           const { box } = node;
           defs.push(
             isRadial
               ? `    <mask mask-type="luminance" id="mask-${escapeXml(node.id)}" maskUnits="userSpaceOnUse" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}">\n      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#maskgrad-${escapeXml(node.id)})" />\n    </mask>\n    <radialGradient id="maskgrad-${escapeXml(node.id)}" gradientUnits="userSpaceOnUse" cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" r="${Math.max(box.w, box.h) / 2}">\n${stopXml}\n    </radialGradient>`
               : `    <mask mask-type="luminance" id="mask-${escapeXml(node.id)}" maskUnits="userSpaceOnUse" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}">\n      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#maskgrad-${escapeXml(node.id)})" />\n    </mask>\n    <linearGradient id="maskgrad-${escapeXml(node.id)}" gradientUnits="userSpaceOnUse" x1="${box.x}" y1="${box.y}" x2="${box.x + box.w}" y2="${box.y + box.h}">\n${stopXml}\n    </linearGradient>`
           );
        }
      }
    }
  }

  if (defs.length === 0) return '';
  return `  <defs>\n${defs.join('\n')}\n  </defs>\n`;
}

// Gap between pages/viewports when several captures share one paste.
const CAPTURE_GAP = 120;

function captureLabel(capture: Capture): string {
  try {
    const u = new URL(capture.url);
    return `${u.pathname === '/' ? u.hostname : u.pathname} @ ${capture.frame.width}`;
  } catch {
    return `${capture.url} @ ${capture.frame.width}`;
  }
}

function formatColorHexLabel(color: string): string {
  const c = color.trim();
  const toHex = (r: number, g: number, b: number) =>
    [r, g, b]
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

  const comma = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (comma) {
    const hex = toHex(Number(comma[1]), Number(comma[2]), Number(comma[3]));
    const a = comma[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(comma[4]))) : 1;
    return a < 1 ? `#${hex} · ${Math.round(a * 100)}%` : `#${hex}`;
  }

  const space = c.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (space) {
    const hex = toHex(Number(space[1]), Number(space[2]), Number(space[3]));
    let a = 1;
    if (space[4]) {
      a = space[4].endsWith('%') ? parseFloat(space[4]) / 100 : parseFloat(space[4]);
      a = Math.max(0, Math.min(1, a));
    }
    return a < 1 ? `#${hex} · ${Math.round(a * 100)}%` : `#${hex}`;
  }

  const hex6 = c.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return `#${hex6[1].toUpperCase()}`;

  const hex3 = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3) return `#${(hex3[1] + hex3[1] + hex3[2] + hex3[2] + hex3[3] + hex3[3]).toUpperCase()}`;

  const hex8 = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (hex8) {
    const a = parseInt(hex8[2], 16) / 255;
    return a < 1 ? `#${hex8[1].toUpperCase()} · ${Math.round(a * 100)}%` : `#${hex8[1].toUpperCase()}`;
  }

  return c.slice(0, 14);
}

function buildDesignSystemFrame(captures: Capture[], offsetX: number): { svg: string; width: number; height: number } {
  const dsWidth = 640;
  const colorCounts = new Map<string, { count: number; role: string }>();
  const addColor = (raw: string | undefined, role: string) => {
    if (!raw) return;
    const c = raw.trim();
    if (!c || c === 'none' || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c.startsWith('url(')) return;
    const prev = colorCounts.get(c);
    colorCounts.set(c, { count: (prev?.count ?? 0) + 1, role: prev?.role ?? role });
  };
  type GradientStop = { color: string; position: number };
  const gradientMap = new Map<string, GradientStop[]>();
  const typoMap = new Map<string, { family: string; size: number; weight: string | number; lh: string | number; sample: string }>();
  for (const cap of captures) {
    addColor(cap.frame.background, 'Canvas');
    for (const n of cap.nodes) {
      for (const f of n.style.fills) {
        if (f.type === 'solid') addColor(f.color, 'Surface');
        if (f.type === 'gradient' && f.stops && f.stops.length >= 2) {
          for (const s of f.stops) addColor(s.color, 'Accent');
          if (gradientMap.size < 6) {
            const gradKey = f.stops
              .map((s) => `${formatColorHexLabel(s.color)}@${Math.round(s.position * 100)}`)
              .join('|');
            if (!gradientMap.has(gradKey)) {
              gradientMap.set(gradKey, f.stops);
            }
          }
        }
      }
      for (const st of n.style.strokes ?? []) addColor(st.color, 'Border');
      if (n.type === 'text' && n.text) {
        addColor(n.text.color, 'Text');
        const fam = n.text.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'sans-serif';
        const key = `${fam}|${Math.round(n.text.fontSize)}|${n.text.fontWeight}`;
        if (!typoMap.has(key) && n.text.content.trim().length >= 2) {
          typoMap.set(key, {
            family: fam,
            size: Math.round(n.text.fontSize),
            weight: n.text.fontWeight,
            lh: n.text.lineHeight,
            sample: n.text.content.trim().slice(0, 28),
          });
        }
      }
    }
  }
  const topColors = [...colorCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  const topGradients = [...gradientMap.values()].slice(0, 6);
  const topTypo = [...typoMap.values()].sort((a, b) => b.size - a.size).slice(0, 8);

  const dsDefs: string[] = [];
  topGradients.forEach((stops, i) => {
    const stopXml = stops
      .map((s) => formatSvgStop(s.color, Math.round(s.position * 100)))
      .join('\n');
    dsDefs.push(`      <linearGradient id="ds-grad-${i}" x1="0%" y1="0%" x2="100%" y2="0%">\n${stopXml}\n      </linearGradient>`);
  });

  const lines: string[] = [];
  let curY = 88;
  lines.push('    <text id="DS · Title" x="32" y="48" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="700" fill="#f8fafc">Design System &amp; Brand Kit</text>');
  lines.push('    <text id="DS · Colors Heading" x="32" y="80" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="0.8" fill="#94a3b8">COLOR TOKENS</text>');
  curY = 96;
  topColors.forEach(([color, meta], idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const sx = 32 + col * 146;
    const sy = curY + row * 94;
    const hexLabel = formatColorHexLabel(color);
    lines.push(`    <g id="Swatch · ${escapeXml(hexLabel)}">`);
    lines.push(`      <rect x="${sx}" y="${sy}" width="134" height="82" rx="8" ry="8" fill="#1e293b" stroke="#334155" stroke-width="1" />`);
    lines.push(`      <rect x="${sx + 4}" y="${sy + 4}" width="126" height="38" rx="5" ry="5" fill="${escapeXml(color)}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />`);
    lines.push(`      <text x="${sx + 10}" y="${sy + 57}" font-family="Roboto Mono, monospace" font-size="10.5" font-weight="600" fill="#f8fafc">${escapeXml(hexLabel)}</text>`);
    lines.push(`      <text x="${sx + 10}" y="${sy + 72}" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="500" fill="#94a3b8">${escapeXml(meta.role)}</text>`);
    lines.push(`      <text x="${sx + 124}" y="${sy + 72}" text-anchor="end" font-family="Roboto Mono, monospace" font-size="9" font-weight="500" fill="#64748b">${meta.count}×</text>`);
    lines.push('    </g>');
  });
  curY += Math.ceil(topColors.length / 4) * 94 + 28;

  if (topGradients.length > 0) {
    lines.push(`    <text id="DS · Gradients Heading" x="32" y="${curY}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="0.8" fill="#94a3b8">GRADIENTS</text>`);
    curY += 16;
    topGradients.forEach((stops, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const sx = 32 + col * 294;
      const sy = curY + row * 84;
      const startHex = formatColorHexLabel(stops[0].color);
      const endHex = formatColorHexLabel(stops[stops.length - 1].color);
      const stopLabel = `${startHex} → ${endHex}`;
      lines.push(`    <g id="Gradient · ${escapeXml(stopLabel)}">`);
      lines.push(`      <rect x="${sx}" y="${sy}" width="282" height="72" rx="8" ry="8" fill="#1e293b" stroke="#334155" stroke-width="1" />`);
      lines.push(`      <rect x="${sx + 6}" y="${sy + 6}" width="270" height="36" rx="18" ry="18" fill="url(#ds-grad-${i})" stroke="rgba(255,255,255,0.12)" stroke-width="1" />`);
      lines.push(`      <text x="${sx + 10}" y="${sy + 59}" font-family="Roboto Mono, monospace" font-size="10" font-weight="600" fill="#e2e8f0">${escapeXml(stopLabel)}</text>`);
      lines.push(`      <text x="${sx + 272}" y="${sy + 59}" text-anchor="end" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="500" fill="#94a3b8">${stops.length} stops</text>`);
      lines.push('    </g>');
    });
    curY += Math.ceil(topGradients.length / 2) * 84 + 28;
  }

  lines.push(`    <text id="DS · Typography Heading" x="32" y="${curY}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="0.8" fill="#94a3b8">TYPOGRAPHY SCALE</text>`);
  curY += 20;
  for (const t of topTypo) {
    const dispSize = Math.min(28, Math.max(12, t.size));
    const rowH = dispSize + 28;
    const maxChars = Math.max(10, Math.floor(330 / (dispSize * 0.58)));
    const sampleStr = t.sample.length > maxChars ? `${t.sample.slice(0, maxChars - 1).trimEnd()}…` : t.sample;
    const resolvedFont = cleanSvgFontFamily(t.family);
    lines.push(`    <g id="Type · ${t.size}px ${escapeXml(String(t.weight))}">`);
    lines.push(`      <rect x="32" y="${curY}" width="576" height="${rowH}" rx="8" ry="8" fill="#111827" stroke="#1f2937" stroke-width="1" />`);
    lines.push(`      <text x="48" y="${Math.round(curY + rowH / 2 + 4)}" font-family="Roboto Mono, monospace" font-size="11" font-weight="500" fill="#94a3b8">${escapeXml(t.family.slice(0, 12))} · ${t.size}px · w${escapeXml(String(t.weight))}</text>`);
    lines.push(`      <text x="240" y="${Math.round(curY + rowH / 2 + dispSize * 0.33)}" font-family="${escapeXml(resolvedFont)}" font-size="${dispSize}" font-weight="${escapeXml(String(t.weight))}" fill="#f8fafc">${escapeXml(sampleStr)}</text>`);
    lines.push('    </g>');
    curY += rowH + 10;
  }
  const dsHeight = Math.max(420, curY + 24);
  const defsBlock = dsDefs.length > 0 ? [`    <defs>`, ...dsDefs, '    </defs>'] : [];
  const svg = [
    `  <g id="Design System" transform="translate(${offsetX} 0)">`,
    ...defsBlock,
    `    <rect id="DS · Background" x="0" y="0" width="${dsWidth}" height="${dsHeight}" rx="16" ry="16" fill="#0b0f19" stroke="#1e293b" stroke-width="1" />`,
    ...lines,
    '  </g>',
  ].join('\n');
  return { svg, width: dsWidth, height: dsHeight };
}

function buildFigmaSvg(captures: Capture[], opts?: FigmaExportOptions): string {
  const defs = buildFigmaDefs(captures);
  if (captures.length === 1 && !opts?.includeDesignSystem) {
    const { width, height } = captures[0].frame;
    const frameBg = captures[0].frame.background;
    const bgRect = frameBg
      ? `  <rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(frameBg)}" />\n`
      : '';
    return [
      `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
      defs,
      bgRect.trimEnd(),
      `  <g id="Frame" clip-path="url(#frame-clip-0)" data-clips-content="true">`,
      buildFigmaLayers(captures[0]),
      '  </g>',
      '</svg>',
    ].filter(Boolean).join('\n');
  }

  const rows = new Map<string, Capture[]>();
  for (const capture of captures) rows.set(capture.url, [...(rows.get(capture.url) ?? []), capture]);

  const groups: string[] = [];
  let y = 0;
  let width = 0;
  let cIdx = 0;
  for (const row of rows.values()) {
    let x = 0;
    for (const capture of row) {
      const frameBg = capture.frame.background
        ? `  <rect x="0" y="0" width="${capture.frame.width}" height="${capture.frame.height}" fill="${escapeXml(capture.frame.background)}" />`
        : '';
      groups.push(
        [
          `<g id="${escapeXml(captureLabel(capture))}" transform="translate(${x} ${y})" clip-path="url(#frame-clip-${cIdx++})" data-clips-content="true">`,
          frameBg,
          buildFigmaLayers(capture),
          '</g>',
        ].filter(Boolean).join('\n')
      );
      x += capture.frame.width + CAPTURE_GAP;
    }
    width = Math.max(width, x - CAPTURE_GAP);
    y += Math.max(...row.map((c) => c.frame.height)) + CAPTURE_GAP;
  }
  let height = y - CAPTURE_GAP;
  if (opts?.includeDesignSystem) {
    const ds = buildDesignSystemFrame(captures, width + CAPTURE_GAP);
    groups.push(ds.svg);
    width += CAPTURE_GAP + ds.width;
    height = Math.max(height, ds.height);
  }
  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
    defs,
    groups.join('\n'),
    '</svg>',
  ].filter(Boolean).join('\n');
}

export function modelToFigma(
  capture: Capture | Capture[],
  opts?: FigmaExportOptions
): FigmaClipboardPayload {
  const captures = Array.isArray(capture) ? capture : [capture];
  if (captures.length === 0) throw new Error('Nothing to export');
  const svg = buildFigmaSvg(captures, opts);

  // HTML clipboard fragment that Figma's clipboard handler detects and ingests as vector layers
  const html = [
    '<meta charset="utf-8">',
    '<!--StartFragment-->',
    svg,
    '<!--EndFragment-->',
  ].join('\n');

  return {
    html,
    svg,
    plain: svg,
  };
}

export async function copyToFigmaClipboard(capture: Capture | Capture[], opts?: FigmaExportOptions): Promise<void> {
  const payload = modelToFigma(capture, opts);
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      if (typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(payload.svg);
        return;
      }
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
        const textBlob = new Blob([payload.plain], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': textBlob })]);
        return;
      }
    } catch (err) {
      if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
        const ta = document.createElement('textarea');
        ta.value = payload.svg;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) return;
      }
      throw err;
    }
  }
  throw new Error('Clipboard API is unavailable in current environment');
}
