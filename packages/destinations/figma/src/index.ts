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
function makeAsymmetricRoundRectPath(box: { x: number; y: number; w: number; h: number }, r: CornerRadius): string {
  const { x, y, w, h } = box;
  const maxR = Math.min(w / 2, h / 2);
  const tl = Math.max(0, Math.min(r.topLeft, maxR));
  const tr = Math.max(0, Math.min(r.topRight, maxR));
  const br = Math.max(0, Math.min(r.bottomRight, maxR));
  const bl = Math.max(0, Math.min(r.bottomLeft, maxR));
  return `M ${x + tl} ${y} H ${x + w - tr} A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr} V ${y + h - br} A ${br} ${br} 0 0 1 ${x + w - br} ${y + h} H ${x + bl} A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl} V ${y + tl} A ${tl} ${tl} 0 0 1 ${x + tl} ${y} Z`;
}

function renderPerEdgeLines(node: Node, tmAttr: string): string {
  const lines: string[] = [];
  const b = node.box;
  for (const s of node.style.strokes ?? []) {
    if (!s.side || s.side === 'all' || s.width <= 0) continue;
    const dash = s.style === 'dashed' ? ` stroke-dasharray="${s.width * 3},${s.width * 2}"` : s.style === 'dotted' ? ` stroke-dasharray="${s.width},${s.width * 1.5}"` : '';
    const w = s.width;
    const c = escapeXml(s.color);
    if (s.side === 'top') lines.push(`    <line x1="${b.x}" y1="${Math.round((b.y + w / 2) * 100) / 100}" x2="${b.x + b.w}" y2="${Math.round((b.y + w / 2) * 100) / 100}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'bottom') lines.push(`    <line x1="${b.x}" y1="${Math.round((b.y + b.h - w / 2) * 100) / 100}" x2="${b.x + b.w}" y2="${Math.round((b.y + b.h - w / 2) * 100) / 100}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'left') lines.push(`    <line x1="${Math.round((b.x + w / 2) * 100) / 100}" y1="${b.y}" x2="${Math.round((b.x + w / 2) * 100) / 100}" y2="${b.y + b.h}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
    else if (s.side === 'right') lines.push(`    <line x1="${Math.round((b.x + b.w - w / 2) * 100) / 100}" y1="${b.y}" x2="${Math.round((b.x + b.w - w / 2) * 100) / 100}" y2="${b.y + b.h}" stroke="${c}" stroke-width="${w}"${dash}${tmAttr} />`);
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
  pillMidY?: number
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
  const filterAttr =
    !isGroupSelf && ((style.filter && style.filter !== 'none') || hasOuterShadow)
      ? ` filter="url(#fx-${escapeXml(node.id)})"`
      : '';
  const maskAttr = !isGroupSelf && style.maskImage && style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
  const leafClipAttr = !isGroupSelf && style.clip ? ` clip-path="url(#clip-${escapeXml(node.id)})"` : '';
  let strokeAttrs = '';
  const allSidedStroke = style.strokes?.find((s) => (!s.side || s.side === 'all') && s.width > 0);
  if (allSidedStroke) {
    const dash = allSidedStroke.style === 'dashed' ? ` stroke-dasharray="${allSidedStroke.width * 3},${allSidedStroke.width * 2}"` : allSidedStroke.style === 'dotted' ? ` stroke-dasharray="${allSidedStroke.width},${allSidedStroke.width * 1.5}"` : '';
    strokeAttrs = ` stroke="${escapeXml(allSidedStroke.color)}" stroke-width="${allSidedStroke.width}"${dash}`;
  } else if (style.shadows && style.shadows.length > 0) {
    const ring = style.shadows.find(
      (s) => Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1 && s.blur <= 2 && ((s.spread && s.spread > 0) || s.inset) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)'
    );
    if (ring) {
      strokeAttrs = ` stroke="${escapeXml(ring.color)}" stroke-width="${ring.spread && ring.spread > 0 ? ring.spread : 1}"`;
    }
  }
  const edgeLines = renderPerEdgeLines(node, transformAttr);
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
    const italicAttr = text.italic ? ' font-style="italic"' : '';
    const decoAttr = text.decoration && text.decoration !== 'none' && !text.decoration.startsWith('none') ? ` text-decoration="${escapeXml(text.decoration.split(' ')[0])}"` : '';
    const innerContent =
      effectiveRuns && effectiveRuns.length > 0
        ? effectiveRuns
          .map((r, idx) => {
            const rWeight = r.fontWeight ? ` font-weight="${r.fontWeight}"` : '';
            const rColor = !textGradFill && r.color ? ` fill="${escapeXml(r.color)}"` : '';
            const runX = anchor === 'start' && r.x !== undefined ? r.x : idx === 0 && inlineLeadWidth > 0 ? firstRunX : textX;
            const posAttrs = idx > 0 ? ` x="${runX}" dy="${lh}"` : inlineLeadWidth > 0 || (anchor === 'start' && r.x !== undefined) ? ` x="${runX}"` : '';
            return `<tspan${posAttrs}${rWeight}${rColor}>${escapeXml(applyTextTransform(r.text, text.textTransform))}</tspan>`;
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
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}"${lsAttr}${italicAttr}${decoAttr}${textFillAttr}${opacityAttr}${transformAttr}${filterAttr}>${innerContent}</text>`;
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
    const fit = node.objectFit && node.objectFit !== 'fill' ? node.objectFit : 'cover';
    const par = fit === 'cover' ? 'xMidYMid slice' : fit === 'contain' ? 'xMidYMid meet' : 'none';
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
  const gradFills = style.fills.filter((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = style.fills.find((f) => f.type === 'image' && f.assetRef);

  if (gradFills.length > 0) {
    const layers: string[] = [];
    if (firstSolid?.color) {
      layers.push(`    <rect id="${escapeXml(node.id)}-base" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${escapeXml(firstSolid.color)}"${rx}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${leafClipAttr} />`);
    }
    gradFills.forEach((_, gIdx) => {
      const gradId = gIdx === 0 ? `grad-${escapeXml(node.id)}` : `grad-${escapeXml(node.id)}-${gIdx}`;
      const idAttr = gIdx === 0 && !firstSolid?.color ? ` id="${escapeXml(node.id)}"` : ` id="${escapeXml(node.id)}-grad-${gIdx}"`;
      const sAttr = gIdx === gradFills.length - 1 ? strokeAttrs : '';
      layers.push(`    <rect${idAttr} x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#${gradId})"${rx}${sAttr}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${leafClipAttr} />`);
    });
    return layers.join('\n');
  }
  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    const asset = assets[imageFill.assetRef];
    const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
    return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="xMidYMid slice"${opacityAttr}${rx}${transformAttr}${filterAttr}${leafClipAttr} />`;
  }

  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';
  if (isGroupSelf && fill === 'none' && !strokeAttrs && !edgeLines) return '';
  const shapeAttrs = `${strokeAttrs}${opacityAttr}${transformAttr}${filterAttr}${maskAttr}${leafClipAttr}${blendStyle}`;
  const baseShape = asymPathD
    ? `    <path id="${escapeXml(node.id)}" d="${asymPathD}" fill="${fill}"${shapeAttrs} />`
    : `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fill}"${rx}${shapeAttrs} />`;
  return `${baseShape}${lineSuffix}`;
}

function buildFigmaLayers(capture: Capture): string {
  // Build tree to maintain group structure
  const childrenMap = new Map<string, Node[]>();
  const rootNodes: Node[] = [];
  const nodeMap = new Map<string, Node>();

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
        : renderNodeToFigmaSvg(node, capture.assets, false, findInlineLeadWidth(node), resolvePillMidY(node));
    }
    const childrenSvg = children.map(renderTree).filter(Boolean).join('\n');
    if (!childrenSvg && isNodeOffscreen(node, capture.frame)) return '';
    const selfLayer = renderNodeToFigmaSvg(node, capture.assets, true);
    const childrenOverflow = children.some(
      (c) =>
        c.box.x < node.box.x - 1 ||
        c.box.y < node.box.y - 1 ||
        c.box.x + c.box.w > node.box.x + node.box.w + 2 ||
        c.box.y + c.box.h > node.box.y + node.box.h + 2
    );
    const clipAttr =
      node.style.clip && childrenOverflow
        ? ` clip-path="url(#clip-${escapeXml(node.id)})" data-clips-content="true"`
        : '';
    const groupOpacity = !selfLayer && node.style.opacity !== undefined && node.style.opacity < 1 ? ` opacity="${node.style.opacity}"` : '';
    const groupMask = node.style.maskImage && node.style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
    const groupFilter = node.style.filter && node.style.filter !== 'none' ? ` filter="url(#fx-${escapeXml(node.id)})"` : '';
    const groupId = node.name ? `${escapeXml(node.name)} (${escapeXml(node.id)})` : `group-${escapeXml(node.id)}`;
    return [`  <g id="${groupId}"${clipAttr}${groupOpacity}${groupMask}${groupFilter}>`, selfLayer, childrenSvg, '  </g>'].filter(Boolean).join('\n');
  }

  return rootNodes.map(renderTree).filter(Boolean).join('\n');
}

/** Map a CSS filter chain to SVG filter primitives. */
function buildFilterPrimitives(filter: string | undefined, shadows?: Node['style']['shadows']): string[] {
  const prims: string[] = [];
  if (shadows) {
    for (const s of shadows) {
      if (!s.inset && (s.blur > 0 || Math.abs(s.x) > 0 || Math.abs(s.y) > 0) && s.color && s.color !== 'transparent' && s.color !== 'rgba(0, 0, 0, 0)') {
        prims.push(`      <feDropShadow dx="${s.x}" dy="${s.y}" stdDeviation="${Math.max(0.5, s.blur / 2)}" flood-color="${escapeXml(s.color)}" />`);
      }
    }
  }
  if (!filter || filter === 'none') return prims;
  for (const m of filter.matchAll(/(\w[\w-]*)\(([^()]*)\)/g)) {
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


function buildFigmaDefs(captures: Capture[]): string {
  const defs: string[] = [];
  for (const [cIdx, capture] of captures.entries()) {
    for (const node of capture.nodes) {
      const prims = buildFilterPrimitives(node.style.filter, node.style.shadows);
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

      if (node.style.clipPath && node.style.clipPath !== 'none') {
        const cp = node.style.clipPath.trim();
        const poly = cp.match(/polygon\(([^)]+)\)/);
        const circ = cp.match(/circle\(([^)]+)\)/);
        const { x, y, w, h } = node.box;
        if (poly?.[1]) {
          const pts = poly[1].split(',').map((pair) => {
            const parts = pair.trim().split(/\s+/);
            const px = parts[0]?.endsWith('%') ? x + (parseFloat(parts[0]) / 100) * w : x + (parseFloat(parts[0] || '0') || 0);
            const py = parts[1]?.endsWith('%') ? y + (parseFloat(parts[1]) / 100) * h : y + (parseFloat(parts[1] || '0') || 0);
            return `${Math.round(px * 100) / 100},${Math.round(py * 100) / 100}`;
          }).join(' ');
          defs.push(`    <clipPath id="clip-${escapeXml(node.id)}">\n      <polygon points="${pts}" />\n    </clipPath>`);
        } else if (circ?.[1]) {
          const rNum = parseFloat(circ[1]) || w / 2;
          const rVal = circ[1].includes('%') ? (rNum / 100) * Math.min(w, h) : rNum;
          defs.push(`    <clipPath id="clip-${escapeXml(node.id)}">\n      <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${rVal}" />\n    </clipPath>`);
        }
      } else if (node.style.clip) {
        const clipRxVal = node.style.radius?.topLeft
          ? Math.min(node.style.radius.topLeft, node.box.w / 2, node.box.h / 2)
          : 0;
        const rx = clipRxVal > 0 ? ` rx="${clipRxVal}" ry="${clipRxVal}"` : '';
        defs.push(
          `    <clipPath id="clip-${escapeXml(node.id)}">\n      <rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}"${rx} />\n    </clipPath>`
        );
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
  const typoMap = new Map<string, { family: string; size: number; weight: string | number; lh: string | number; sample: string }>();
  for (const cap of captures) {
    addColor(cap.frame.background, 'Canvas');
    for (const n of cap.nodes) {
      for (const f of n.style.fills) {
        if (f.type === 'solid') addColor(f.color, 'Surface');
        if (f.type === 'gradient' && f.stops) for (const s of f.stops) addColor(s.color, 'Accent');
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
  const topTypo = [...typoMap.values()].sort((a, b) => b.size - a.size).slice(0, 8);
  const lines: string[] = [];
  let curY = 88;
  lines.push('    <text id="DS · Title" x="32" y="48" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="700" fill="#f8fafc">Design System &amp; Brand Kit</text>');
  lines.push('    <text id="DS · Colors Heading" x="32" y="80" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="0.8" fill="#94a3b8">COLOR TOKENS</text>');
  curY = 96;
  const toHexLabel = (raw: string): string => {
    const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return raw.slice(0, 12);
    const hex = [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
    const a = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 100) : 100;
    return a < 100 ? `#${hex} ${a}%` : `#${hex}`;
  };
  topColors.forEach(([color, meta], idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const sx = 32 + col * 146;
    const sy = curY + row * 84;
    const hexLabel = toHexLabel(color);
    lines.push(`    <g id="Swatch · ${escapeXml(hexLabel)}">`);
    lines.push(`      <rect x="${sx}" y="${sy}" width="134" height="72" rx="8" ry="8" fill="#1e293b" stroke="#334155" stroke-width="1" />`);
    lines.push(`      <rect x="${sx + 4}" y="${sy + 4}" width="126" height="40" rx="5" ry="5" fill="${escapeXml(color)}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />`);
    lines.push(`      <text x="${sx + 10}" y="${sy + 61}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10" font-weight="600" fill="#e2e8f0">${escapeXml(hexLabel)}</text>`);
    lines.push(`      <text x="${sx + 124}" y="${sy + 61}" text-anchor="end" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="500" fill="#94a3b8">${escapeXml(meta.role)}</text>`);
    lines.push('    </g>');
  });
  curY += Math.ceil(topColors.length / 4) * 84 + 28;
  lines.push(`    <text id="DS · Typography Heading" x="32" y="${curY}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="0.8" fill="#94a3b8">TYPOGRAPHY SCALE</text>`);
  curY += 20;
  for (const t of topTypo) {
    const dispSize = Math.min(28, Math.max(12, t.size));
    const rowH = dispSize + 28;
    const maxChars = Math.max(10, Math.floor(330 / (dispSize * 0.58)));
    const sampleStr = t.sample.length > maxChars ? `${t.sample.slice(0, maxChars - 1).trimEnd()}…` : t.sample;
    lines.push(`    <g id="Type · ${t.size}px ${escapeXml(String(t.weight))}">`);
    lines.push(`      <rect x="32" y="${curY}" width="576" height="${rowH}" rx="8" ry="8" fill="#111827" stroke="#1f2937" stroke-width="1" />`);
    lines.push(`      <text x="48" y="${Math.round(curY + rowH / 2 + 4)}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="500" fill="#94a3b8">${escapeXml(t.family.slice(0, 12))} · ${t.size}px · w${escapeXml(String(t.weight))}</text>`);
    lines.push(`      <text x="240" y="${Math.round(curY + rowH / 2 + dispSize * 0.33)}" font-family="${escapeXml(t.family)}, system-ui, sans-serif" font-size="${dispSize}" font-weight="${escapeXml(String(t.weight))}" fill="#f8fafc">${escapeXml(sampleStr)}</text>`);
    lines.push('    </g>');
    curY += rowH + 10;
  }
  const dsHeight = Math.max(420, curY + 24);
  const svg = [
    `  <g id="Design System" transform="translate(${offsetX} 0)">`,
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
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof ClipboardItem !== 'undefined'
  ) {
    const htmlBlob = new Blob([payload.html], { type: 'text/html' });
    const textBlob = new Blob([payload.plain], { type: 'text/plain' });
    const item = new ClipboardItem({
      'text/html': htmlBlob,
      'text/plain': textBlob,
    });
    await navigator.clipboard.write([item]);
  } else {
    throw new Error('Clipboard API is unavailable in current environment');
  }
}
