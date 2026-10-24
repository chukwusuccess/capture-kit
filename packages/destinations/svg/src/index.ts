import type { Capture, Node } from '@capture-kit/model';

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

function svgTransformMatrix(
  node: Node
): { attr: string; matrix: string; a: number; b: number; c: number; d: number; e: number; f: number } | null {
  const tf = node.style.transform;
  if (!tf || tf === 'none') return null;
  const m = tf.match(/^matrix\(([^)]+)\)$/);
  if (!m || !m[1]) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (p.length !== 6 || p.some((n) => Number.isNaN(n))) return null;
  const [a, b, c, d, tx, ty] = p;
  if (a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0) return null;
  const { x, y, w, h } = node.box;
  const isZero = node.style.transformOrigin === '0 0' || node.style.transformOrigin === '0px 0px';
  const ox = isZero ? x : x + w / 2;
  const oy = isZero ? y : y + h / 2;
  const ra = Math.round(a * 1e6) / 1e6;
  const rb = Math.round(b * 1e6) / 1e6;
  const rc = Math.round(c * 1e6) / 1e6;
  const rd = Math.round(d * 1e6) / 1e6;
  const e = Math.round((tx + ox - (a * ox + c * oy)) * 1e6) / 1e6;
  const f = Math.round((ty + oy - (b * ox + d * oy)) * 1e6) / 1e6;
  const matrix = `matrix(${ra} ${rb} ${rc} ${rd} ${e} ${f})`;
  return { attr: ` transform="${matrix}"`, matrix, a, b, c, d, e, f };
}

function renderNodeToSvg(node: Node, assets: Capture['assets']): string {
  const { box, style, type } = node;
  const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity}"` : '';
  const rxVal = style.radius?.topLeft ? Math.min(style.radius.topLeft, box.w / 2, box.h / 2) : 0;
  const rx = rxVal > 0 ? ` rx="${rxVal}" ry="${rxVal}"` : '';
  const tm = svgTransformMatrix(node);
  const transformAttr = tm ? tm.attr : '';
  const filterAttr = style.filter && style.filter !== 'none' ? ` filter="url(#fx-${escapeXml(node.id)})"` : '';
  const maskAttr = style.maskImage && style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
  if (type === 'text') {
    const text = node.text;
    if (!text) return '';

    const content = escapeXml(text.content);
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
    const innerContent =
      text.runs && text.runs.length > 0
        ? text.runs
            .map((r, idx) => {
              const rWeight = r.fontWeight ? ` font-weight="${r.fontWeight}"` : '';
              const rColor = !textGradFill && r.color ? ` fill="${escapeXml(r.color)}"` : '';
              const posAttrs = idx > 0 ? ` x="${textX}" dy="${lh}"` : '';
              return `<tspan${posAttrs}${rWeight}${rColor}>${escapeXml(r.text)}</tspan>`;
            })
            .join('')
        : content;

    const hasMultiRuns = Boolean(text.runs && text.runs.length > 1);
    const firstLineH = hasMultiRuns ? lh : box.h > 0 ? box.h : lh;
    const textY = Math.round((box.y + firstLineH / 2 + text.fontSize * 0.35) * 100) / 100;
    return `  <text x="${textX}" y="${textY}"${anchorAttr} font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}" fill="${textFillAttr}"${opacityAttr}${transformAttr}${filterAttr}>${innerContent}</text>`;
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
      .map((p) => {
        const fill = p.fill ? ` fill="${escapeXml(p.fill)}"` : ' fill="currentColor"';
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
      const fit = node.objectFit && node.objectFit !== 'fill' ? node.objectFit : 'cover';
      const par = fit === 'cover' ? 'xMidYMid slice' : fit === 'contain' ? 'xMidYMid meet' : 'none';
      if (fit === 'cover') {
        return `  <g clip-path="url(#imgclip-${escapeXml(node.id)})"${opacityAttr}${transformAttr}${filterAttr}>\n    <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}" />\n  </g>`;
      }
      return `  <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${transformAttr}${filterAttr} />`;
    }
    return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#cccccc"${rx}${opacityAttr}${transformAttr}${filterAttr} />`;
  }

  // Frame or rect
  const gradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  if (gradFill) {
    return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#grad-${escapeXml(node.id)})"${rx}${opacityAttr}${transformAttr}${filterAttr}${maskAttr} />`;
  }

  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';

  return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fill}"${rx}${opacityAttr}${transformAttr}${filterAttr}${maskAttr} />`;
}
/** Map a CSS filter chain to SVG filter primitives. */
function buildFilterPrimitives(filter: string | undefined): string[] {
  if (!filter || filter === 'none') return [];
  const prims: string[] = [];
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


function buildSvgDefs(capture: Capture): string {
  const defs: string[] = [];

  for (const node of capture.nodes) {
    const prims = buildFilterPrimitives(node.style.filter);
    if (prims.length === 0) continue;
    defs.push(
      `    <filter id="fx-${escapeXml(node.id)}" x="-40%" y="-40%" width="180%" height="180%">\n${prims.join("\n")}\n    </filter>`
    );
  }
  for (const node of capture.nodes) {
    const gradFill = node.style.fills.find(
      (f) => f.type === 'gradient' && f.stops && f.stops.length > 0
    );
    if (gradFill && gradFill.stops) {
      const stops = gradFill.stops
        .map(
          (s) =>
            `      <stop offset="${Math.round(s.position * 100)}%" stop-color="${escapeXml(s.color)}" />`
        )
        .join('\n');

      if (gradFill.gradientType === 'radial') {
        defs.push(
          `    <radialGradient id="grad-${escapeXml(node.id)}" cx="50%" cy="50%" r="75%">\n${stops}\n    </radialGradient>`
        );
      } else {
        const angleRad = (((gradFill.angle ?? 180) - 90) * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const x1 = `${Math.round((0.5 - cos * 0.5) * 100)}%`;
        const y1 = `${Math.round((0.5 - sin * 0.5) * 100)}%`;
        const x2 = `${Math.round((0.5 + cos * 0.5) * 100)}%`;
        const y2 = `${Math.round((0.5 + sin * 0.5) * 100)}%`;

        defs.push(
          `    <linearGradient id="grad-${escapeXml(node.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">\n${stops}\n    </linearGradient>`
        );
      }
    }
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
