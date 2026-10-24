import type { Capture, Node } from '@capture-kit/model';

export interface FigmaExportOptions {
  pasteboardFormat?: 'clipboard' | 'file';
  includeMetadata?: boolean;
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

function renderNodeToFigmaSvg(node: Node, assets: Capture['assets']): string {
  const { box, style, type } = node;
  const opacityAttr =
    style.opacity !== undefined && style.opacity < 1
      ? ` opacity="${style.opacity}"`
      : '';
  const rxVal = style.radius?.topLeft ? Math.min(style.radius.topLeft, box.w / 2, box.h / 2) : 0;
  const rx = rxVal > 0 ? ` rx="${rxVal}" ry="${rxVal}"` : '';
  const transformStyle = style.transform
    ? ` style="transform: ${escapeXml(style.transform)}; transform-origin: ${escapeXml(style.transformOrigin || '50% 50%')}; transform-box: fill-box;"`
    : '';
  const filterAttr = style.filter && style.filter !== 'none' ? ` filter="url(#fx-${escapeXml(node.id)})"` : '';
  // Masked glow washes: point at the mask built in defs from maskImage.
  const maskAttr = style.maskImage && style.maskImage !== 'none' ? ` mask="url(#mask-${escapeXml(node.id)})"` : '';
  // Stroke attributes
  let strokeAttrs = '';
  if (style.strokes && style.strokes.length > 0) {
    const stroke = style.strokes[0];
    if (stroke.width > 0) {
      const dash =
        stroke.style === 'dashed'
          ? ` stroke-dasharray="${stroke.width * 3},${stroke.width * 2}"`
          : stroke.style === 'dotted'
          ? ` stroke-dasharray="${stroke.width},${stroke.width * 1.5}"`
          : '';
      strokeAttrs = ` stroke="${escapeXml(stroke.color)}" stroke-width="${
        stroke.width
      }"${dash}`;
    }
  }

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
    // bg-clip:text nodes carry the gradient in fills with a transparent text
    // color: emit the gradient on the <text> so the fill survives the paste.
    const textFillAttr = textGradFill ? ` fill="url(#grad-${escapeXml(node.id)})"` : ` fill="${escapeXml(text.color)}"`;
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

    // Figma's SVG importer ignores dominant-baseline="text-before-edge" and
    // treats y as the alphabetic baseline. Compute the true baseline from the
    // first line's vertical midpoint plus cap-height half-offset (0.35 * em).
    const hasMultiRuns = Boolean(text.runs && text.runs.length > 1);
    const firstLineH = hasMultiRuns ? lh : box.h > 0 ? box.h : lh;
    const textY = Math.round((box.y + firstLineH / 2 + text.fontSize * 0.35) * 100) / 100;
    return `    <text id="${escapeXml(node.id)}" x="${textX}" y="${textY}"${anchorAttr} font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}"${textFillAttr}${opacityAttr}${transformStyle}${filterAttr}>${innerContent}</text>`;
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
      .map((p) => {
        const fill = p.fill ? ` fill="${escapeXml(p.fill)}"` : ' fill="currentColor"';
        const stroke = p.stroke ? ` stroke="${escapeXml(p.stroke)}"` : '';
        const sw = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
        return `      <path d="${escapeXml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    return `    <g id="${escapeXml(node.id)}" transform="translate(${dx} ${dy})${scale}"${opacityAttr}>\n${paths}\n    </g>`;
  }


  if (type === 'image') {
    const fit = node.objectFit && node.objectFit !== 'fill' ? node.objectFit : 'cover';
    const par = fit === 'cover' ? 'xMidYMid slice' : fit === 'contain' ? 'xMidYMid meet' : 'none';
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
        box.w
      }" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${rx}${transformStyle}${filterAttr} />`;
    }
    return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" fill="#cccccc"${rx}${strokeAttrs}${opacityAttr}${transformStyle}${filterAttr} />`;
  }

  // Handle rect or frame
  const gradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = style.fills.find((f) => f.type === 'image' && f.assetRef);

  if (gradFill) {
    return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" fill="url(#grad-${escapeXml(node.id)})"${rx}${strokeAttrs}${opacityAttr}${transformStyle}${filterAttr}${maskAttr} />`;
  }

  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    const asset = assets[imageFill.assetRef];
    const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
    return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" xlink:href="${dataUri}" href="${dataUri}" preserveAspectRatio="xMidYMid slice"${opacityAttr}${rx}${transformStyle}${filterAttr} />`;
  }

  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';

  return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
    box.w
  }" height="${box.h}" fill="${fill}"${rx}${strokeAttrs}${opacityAttr}${transformStyle}${filterAttr}${maskAttr} />`;
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

  function renderTree(node: Node): string {
    const children = childrenMap.get(node.id);
    if (!children || children.length === 0) {
      return renderNodeToFigmaSvg(node, capture.assets);
    }

    const selfLayer = renderNodeToFigmaSvg(node, capture.assets);
    const childrenSvg = children.map(renderTree).join('\n');

    const clipAttr = node.style.clip
      ? ` clip-path="url(#clip-${escapeXml(node.id)})" data-clips-content="true"`
      : '';
    // No auto-layout hints: Figma reflows children with its own font and
    // box metrics on import, shifting pills, labels, and hero text. Absolute
    // boxes already place every child exactly — groups stay untyped.
    void node.style.layout;
    const layoutAttrs = '';

    return [
      `  <g id="group-${escapeXml(node.id)}"${clipAttr}${layoutAttrs}>`,
      selfLayer,
      childrenSvg,
      '  </g>',
    ].join('\n');
  }

  return rootNodes.map(renderTree).join('\n');
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


function buildFigmaDefs(captures: Capture[]): string {
  const defs: string[] = [];
  for (const [cIdx, capture] of captures.entries()) {
    for (const node of capture.nodes) {
      const prims = buildFilterPrimitives(node.style.filter);
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
      const gradFill = node.style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
      if (gradFill && gradFill.stops) {
        const stops = gradFill.stops
          .map((s) => `      <stop offset="${Math.round(s.position * 100)}%" stop-color="${escapeXml(s.color)}" />`)
          .join('\n');

        if (gradFill.gradientType === 'radial') {
          defs.push(`    <radialGradient id="grad-${escapeXml(node.id)}" cx="50%" cy="50%" r="75%">\n${stops}\n    </radialGradient>`);
        } else {
          const angleRad = (((gradFill.angle ?? 180) - 90) * Math.PI) / 180;
          const cos = Math.cos(angleRad);
          const sin = Math.sin(angleRad);
          const x1 = `${Math.round((0.5 - cos * 0.5) * 100)}%`;
          const y1 = `${Math.round((0.5 - sin * 0.5) * 100)}%`;
          const x2 = `${Math.round((0.5 + cos * 0.5) * 100)}%`;
          const y2 = `${Math.round((0.5 + sin * 0.5) * 100)}%`;

          defs.push(`    <linearGradient id="grad-${escapeXml(node.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">\n${stops}\n    </linearGradient>`);
        }
      }

      if (node.style.clip) {
        const rx = node.style.radius?.topLeft ? ` rx="${node.style.radius.topLeft}"` : '';
        defs.push(
          `    <clipPath id="clip-${escapeXml(node.id)}">\n      <rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}"${rx} />\n    </clipPath>`
        );
      }
      // CSS mask-image gradient fades: luminance mask so glows fade out.
      const mask = node.style.maskImage;
      if (mask && mask !== 'none') {
        const stops = [...mask.matchAll(/((?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+(?:\s+[a-z]+)?))\s+([\d.]+)(%|px)?/gi)].map((m) => ({
           color: m[1].trim(),
           position: m[3] === 'px' ? (parseFloat(m[2]) > 0 ? 0.02 : 0) : Math.max(0, Math.min(1, parseFloat(m[2]) / 100)),
        }));
        // Collapse adjacent stops closer than 2%: dot-pattern masks repeat
        // the same color and would band in the importer.
        for (let k = stops.length - 1; k > 0; k--) {
          if (Math.abs(stops[k].position - stops[k - 1].position) < 0.02) stops.splice(k, 1);
        }
        if (stops.length >= 2) {
           const stopXml = stops
             .map((s) => `      <stop offset="${Math.round(s.position * 100)}%" stop-color="${escapeXml(s.color)}" />`)
             .join('\n');
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

function buildFigmaSvg(captures: Capture[]): string {
  const defs = buildFigmaDefs(captures);
  if (captures.length === 1) {
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

  // Several captures: one row per page, its sizes left to right, one named group each.
  const rows = new Map<string, Capture[]>();
  for (const capture of captures) rows.set(capture.url, [...(rows.get(capture.url) ?? []), capture]);

  const groups: string[] = [];
  let y = 0;
  let width = 0;
  let cIdx = 0;
  for (const row of rows.values()) {
    let x = 0;
    for (const capture of row) {
      groups.push(
        [
          `<g id="${escapeXml(captureLabel(capture))}" transform="translate(${x} ${y})" clip-path="url(#frame-clip-${cIdx++})" data-clips-content="true">`,
          buildFigmaLayers(capture),
          '</g>',
        ].join('\n')
      );
      x += capture.frame.width + CAPTURE_GAP;
    }
    width = Math.max(width, x - CAPTURE_GAP);
    y += Math.max(...row.map((c) => c.frame.height)) + CAPTURE_GAP;
  }
  const height = y - CAPTURE_GAP;
  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
    defs,
    groups.join('\n'),
    '</svg>',
  ].filter(Boolean).join('\n');
}

export function modelToFigma(
  capture: Capture | Capture[],
  _opts?: FigmaExportOptions
): FigmaClipboardPayload {
  const captures = Array.isArray(capture) ? capture : [capture];
  if (captures.length === 0) throw new Error('Nothing to export');
  const svg = buildFigmaSvg(captures);

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

export async function copyToFigmaClipboard(capture: Capture | Capture[]): Promise<void> {
  const payload = modelToFigma(capture);

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
