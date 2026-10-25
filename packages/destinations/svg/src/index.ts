import type { Capture, CornerRadius, Node } from '@capture-kit/model';

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
  if (rgba) return Math.max(0, Math.min(1, parseFloat(rgba[1])));
  return 1;
}
function formatSvgStop(color: string, offsetPct: number): string {
  const alpha = parseStopAlpha(color);
  const rgba = color.trim().match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,/i);
  const rgbColor = rgba ? `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : color.trim().toLowerCase() === 'transparent' ? '#000000' : color;
  const opAttr = alpha < 1 ? ` stop-opacity="${alpha}"` : '';
  return `      <stop offset="${offsetPct}%" stop-color="${escapeXml(rgbColor)}"${opAttr} />`;
}

function applyTextTransform(str: string, tt?: string): string {
  if (tt === 'uppercase') return str.toUpperCase();
  if (tt === 'lowercase') return str.toLowerCase();
  if (tt === 'capitalize') return str.replace(/\b\w/g, (c) => c.toUpperCase());
  return str;
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
    if (s.side === 'top') lines.push(`  <line x1="${round2(b.x + tl)}" y1="${round2(b.y + w / 2)}" x2="${round2(b.x + b.w - tr)}" y2="${round2(b.y + w / 2)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'bottom') lines.push(`  <line x1="${round2(b.x + bl)}" y1="${round2(b.y + b.h - w / 2)}" x2="${round2(b.x + b.w - br)}" y2="${round2(b.y + b.h - w / 2)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'left') lines.push(`  <line x1="${round2(b.x + w / 2)}" y1="${round2(b.y + tl)}" x2="${round2(b.x + w / 2)}" y2="${round2(b.y + b.h - bl)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'right') lines.push(`  <line x1="${round2(b.x + b.w - w / 2)}" y1="${round2(b.y + tr)}" x2="${round2(b.x + b.w - w / 2)}" y2="${round2(b.y + b.h - br)}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
  }
  return lines.join('\n');
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
  if (node.style.clip) {
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

function renderNodeToSvg(node: Node, assets: Capture['assets']): string {
  const { box, style, type } = node;
  const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity}"` : '';
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
  const filterAttr = (style.filter && style.filter !== 'none') || hasOuterShadow || hasBackdrop ? ` filter="url(#fx-${escapeXml(node.id)})"` : '';
  const maskAttr = style.maskImage && style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
  const leafClipAttr = clipShapeForNode(node) ? ` clip-path="url(#clip-${escapeXml(node.id)})"` : '';
  let strokeAttrs = '';
  const allSidedStroke = style.strokes?.find((s) => (!s.side || s.side === 'all') && s.width > 0);
  if (allSidedStroke) {
    const dash = allSidedStroke.style === 'dashed' ? ` stroke-dasharray="${allSidedStroke.width * 3},${allSidedStroke.width * 2}"` : allSidedStroke.style === 'dotted' ? ` stroke-dasharray="${allSidedStroke.width},${allSidedStroke.width * 1.5}"` : '';
    strokeAttrs = ` stroke="${escapeXml(allSidedStroke.color)}" stroke-width="${allSidedStroke.width}"${dash}`;
  } else if (style.shadows && style.shadows.length > 0) {
    const ring = style.shadows.find(
      (s) => Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1 && s.blur <= 2 && ((s.spread && s.spread > 0) || s.inset) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
    );
    if (ring) strokeAttrs = ` stroke="${escapeXml(ring.color)}" stroke-width="${ring.spread && ring.spread > 0 ? ring.spread : 1}"`;
  }
  const edgeLines = renderPerEdgeLines(node, transformAttr);
  const outlineOffset = allSidedStroke?.offset && allSidedStroke.offset !== 0 ? Math.max(0, allSidedStroke.offset) : 0;
  const outlineOverlay = outlineOffset > 0 && allSidedStroke
    ? `\n  <rect id="${escapeXml(node.id)}-outline" x="${box.x - outlineOffset}" y="${box.y - outlineOffset}" width="${box.w + outlineOffset * 2}" height="${box.h + outlineOffset * 2}" fill="none"${rx}${strokeAttrs}${opacityAttr}${transformAttr}${filterAttr} />`
    : '';
  const lineSuffix = `${outlineOverlay}${edgeLines ? `\n${edgeLines}` : ''}`;
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
    const textFillAttr = textGradFill ? `url(#grad-${escapeXml(node.id)})` : escapeXml(text.color);
    const lsAttr = typeof text.letterSpacing === 'number' && text.letterSpacing !== 0 ? ` letter-spacing="${text.letterSpacing}"` : '';
    const italicAttr = text.italic ? ' font-style="italic"' : '';
    const decoAttr = text.decoration && text.decoration !== 'none' && !text.decoration.startsWith('none') ? ` text-decoration="${escapeXml(text.decoration.split(' ')[0])}"` : '';
    const wsAttr = typeof text.wordSpacing === 'number' && text.wordSpacing !== 0 ? ` word-spacing="${text.wordSpacing}"` : typeof text.wordSpacing === 'string' && text.wordSpacing && text.wordSpacing !== 'normal' && text.wordSpacing !== '0px' ? ` word-spacing="${escapeXml(text.wordSpacing)}"` : '';
    const textStrokeAttr = text.textStroke ? ` stroke="${escapeXml(text.textStroke.split(/\s+/).slice(1).join(' ') || text.color)}" stroke-width="${escapeXml(text.textStroke.split(/\s+/)[0])}" paint-order="stroke"` : '';
    const dirAttr = text.direction === 'rtl' ? ' direction="rtl" unicode-bidi="embed"' : '';
    const innerContent =
      text.runs && text.runs.length > 0
        ? text.runs
            .map((r, idx) => {
              const rWeight = r.fontWeight ? ` font-weight="${r.fontWeight}"` : '';
              const rColor = !textGradFill && r.color ? ` fill="${escapeXml(r.color)}"` : '';
              const runX = anchor === 'start' && r.x !== undefined ? r.x : textX;
              const posAttrs = idx > 0 ? ` x="${runX}" dy="${lh}"` : anchor === 'start' && r.x !== undefined ? ` x="${runX}"` : '';
              return `<tspan${posAttrs}${rWeight}${rColor}>${escapeXml(applyTextTransform(r.text, text.textTransform))}</tspan>`;
            })
            .join('')
        : content;

    const hasMultiRuns = Boolean(text.runs && text.runs.length > 1);
    const firstLineH = hasMultiRuns ? lh : box.h > 0 ? box.h : lh;
    const textY = Math.round((box.y + firstLineH / 2 + text.fontSize * 0.33) * 100) / 100;
    return `  <text x="${textX}" y="${textY}"${anchorAttr} font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}"${lsAttr}${wsAttr}${textStrokeAttr}${dirAttr}${italicAttr}${decoAttr} fill="${textFillAttr}"${opacityAttr}${transformAttr}${filterAttr}>${innerContent}</text>`;
  }
  if (type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
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
        return `    <path d="${escapeXml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    const vecTransform = `${tm ? `${tm.matrix} ` : ''}translate(${dx} ${dy})${scale}`;
    return `  <g id="${escapeXml(node.id)}" transform="${vecTransform}"${opacityAttr}${filterAttr}>\n${paths}\n  </g>`;
  }

  if (type === 'image') {
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      const fit = node.objectFit ?? 'cover';
      const meetSlice = fit === 'cover' ? 'slice' : fit === 'contain' ? 'meet' : 'none';
      const align = backgroundPositionAlign(node.objectPosition);
      const par = meetSlice === 'none' ? 'none' : `${align.x}${align.y} ${meetSlice}`;
      if (fit === 'cover') {
        return `  <g clip-path="url(#imgclip-${escapeXml(node.id)})"${opacityAttr}${transformAttr}${filterAttr}>\n    <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}" />\n  </g>`;
      }
      return `  <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${transformAttr}${filterAttr} />`;
    }
    return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#cccccc"${rx}${opacityAttr}${transformAttr}${filterAttr} />`;
  }

  // Frame or rect
  const gradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';
  const shapeAttrs = `${outlineOverlay ? '' : strokeAttrs}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${blendStyle}${leafClipAttr}`;
  const baseShape = asymPathD
    ? `  <path id="${escapeXml(node.id)}" d="${asymPathD}" fill="${fill}"${shapeAttrs} />`
    : `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fill}"${rx}${shapeAttrs} />`;
  if (gradFill) {
    const gradShape = asymPathD
      ? `  <path id="${escapeXml(node.id)}" d="${asymPathD}" fill="url(#grad-${escapeXml(node.id)})"${shapeAttrs} />`
      : `  <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#grad-${escapeXml(node.id)})"${rx}${shapeAttrs} />`;
    return `${gradShape}${lineSuffix}`;
  }
  return `${baseShape}${lineSuffix}`;
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
  if (shadows) {
    for (const s of shadows) {
      if (!s.inset && (s.blur > 0 || Math.abs(s.x) > 0 || Math.abs(s.y) > 0) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)') {
        prims.push(`      <feDropShadow dx="${s.x}" dy="${s.y}" stdDeviation="${Math.max(0.5, s.blur / 2)}" flood-color="${escapeXml(s.color)}" />`);
      }
    }
  }
  if (!filter || filter === 'none') return prims;
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
  return prims;
}


function buildSvgDefs(capture: Capture): string {
  const defs: string[] = [];

  for (const node of capture.nodes) {
    const prims = buildFilterPrimitives(node.style.filter, node.style.shadows, node.style.backdropFilter);
    if (prims.length === 0) continue;
    defs.push(
      `    <filter id="fx-${escapeXml(node.id)}" x="-40%" y="-40%" width="180%" height="180%">\n${prims.join("\n")}\n    </filter>`
    );
  }
  for (const node of capture.nodes) {
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
  }

  for (const node of capture.nodes) {
    if (node.type !== 'image' || !node.assetRef || !capture.assets[node.assetRef]) continue;
    const fit = node.objectFit && node.objectFit !== 'fill' ? node.objectFit : 'cover';
    if (fit !== 'cover') continue;
    const { box, style } = node;
    const rxV = style.radius?.topLeft ? Math.min(style.radius.topLeft, box.w / 2, box.h / 2) : 0;
    const rxA = rxV > 0 ? ` rx="${rxV}" ry="${rxV}"` : '';
    defs.push(
      `    <clipPath id="imgclip-${escapeXml(node.id)}">\n      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"${rxA} />\n    </clipPath>`
    );
  }
  for (const node of capture.nodes) {
    const clipShape = clipShapeForNode(node);
    if (clipShape) {
      defs.push(`    <clipPath id="clip-${escapeXml(node.id)}">\n      ${clipShape}\n    </clipPath>`);
    }
  }
  // CSS mask-image fades (radial/linear-gradient(...)): convert the alpha
  // channel into a luminance mask. Only gradient masks supported; anything
  // else falls back to no mask (node paints unmasked).
  for (const node of capture.nodes) {
    const mask = node.style.maskImage;
    if (!mask || mask === 'none') continue;
    const rawStops = [...mask.matchAll(/((?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+(?:\s+[a-z]+)?))\s+([\d.]+)(%|px)?/gi)];
    const isDotPattern = rawStops.length > 0 && rawStops.every((m) => m[3] === 'px' && parseFloat(m[2]) <= 2);
    const stops = isDotPattern
      ? [
          { alpha: 0.25, position: 0 },
          { alpha: 0, position: 0.85 },
        ]
      : rawStops.map((m) => ({
          alpha: parseStopAlpha(m[1]),
          position: m[3] === 'px' ? (parseFloat(m[2]) > 0 ? 0.02 : 0) : Math.max(0, Math.min(1, parseFloat(m[2]) / 100)),
        }));
    for (let k = stops.length - 1; k > 0; k--) {
      if (Math.abs(stops[k].position - stops[k - 1].position) < 0.02) stops.splice(k, 1);
    }
    if (stops.length < 2) continue;
    const stopXml = stops
      .map((s) => `      <stop offset="${Math.round(s.position * 100)}%" stop-color="#ffffff" stop-opacity="${s.alpha}" />`)
      .join('\n');
    const isRadial = mask.trimStart().toLowerCase().startsWith('radial-gradient');
    const { box } = node;
    defs.push(
      isRadial
         ? `    <mask mask-type="luminance" id="mask-${escapeXml(node.id)}" maskUnits="userSpaceOnUse" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}">\n      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#maskgrad-${escapeXml(node.id)})" />\n    </mask>\n    <radialGradient id="maskgrad-${escapeXml(node.id)}" gradientUnits="userSpaceOnUse" cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" r="${Math.max(box.w, box.h) / 2}">\n${stopXml}\n    </radialGradient>`
         : `    <mask mask-type="luminance" id="mask-${escapeXml(node.id)}" maskUnits="userSpaceOnUse" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}">\n      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#maskgrad-${escapeXml(node.id)})" />\n    </mask>\n    <linearGradient id="maskgrad-${escapeXml(node.id)}" gradientUnits="userSpaceOnUse" x1="${box.x}" y1="${box.y}" x2="${box.x + box.w}" y2="${box.y + box.h}">\n${stopXml}\n    </linearGradient>`
    );
  }

  if (defs.length === 0) return '';
  return `  <defs>\n${defs.join('\n')}\n  </defs>`;
}


export function modelToSvg(capture: Capture): string {
  const { width, height } = capture.frame;

  const elements = capture.nodes
    .map((node) => renderNodeToSvg(node, capture.assets))
    .filter(Boolean)
    .join('\n');

  const frameBg = capture.frame.background
    ? `  <rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(capture.frame.background)}" />`
    : '';
  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
    buildSvgDefs(capture),
    frameBg,
    elements,
  ].filter(Boolean).join('\n');
}
