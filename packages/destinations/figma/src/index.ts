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
    const anchor =
      text.align === 'center'
        ? 'middle'
        : text.align === 'right'
        ? 'end'
        : 'start';

    const textX =
      anchor === 'middle'
        ? box.x + box.w / 2
        : anchor === 'end'
        ? box.x + box.w
        : box.x;

    const lh = typeof text.lineHeight === 'number' ? text.lineHeight : text.fontSize * 1.25;
    const innerContent =
      text.runs && text.runs.length > 0
        ? text.runs
            .map((r, idx) => {
              const rWeight = r.fontWeight ? ` font-weight="${r.fontWeight}"` : '';
              const rColor = r.color ? ` fill="${escapeXml(r.color)}"` : '';
              const posAttrs = idx > 0 ? ` x="${textX}" dy="${lh}"` : '';
              return `<tspan${posAttrs}${rWeight}${rColor}>${escapeXml(r.text)}</tspan>`;
            })
            .join('')
        : content;

    const textGradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
    const textFillAttr = textGradFill ? `url(#grad-${escapeXml(node.id)})` : escapeXml(text.color);
    const textY = box.y;
    return `    <text id="${escapeXml(node.id)}" x="${textX}" y="${textY}" dominant-baseline="text-before-edge" font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}" fill="${textFillAttr}" text-anchor="${anchor}"${opacityAttr}${transformStyle}>${innerContent}</text>`;
  }
  if (type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
    const paths = node.vectorPaths
      .map((p) => {
        const fill = p.fill ? ` fill="${escapeXml(p.fill)}"` : ' fill="currentColor"';
        const stroke = p.stroke ? ` stroke="${escapeXml(p.stroke)}"` : '';
        const sw = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
        return `      <path d="${escapeXml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    return `    <g id="${escapeXml(node.id)}" transform="translate(${box.x} ${box.y})"${opacityAttr}>\n${paths}\n    </g>`;
  }


  if (type === 'image') {
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
        box.w
      }" height="${box.h}" href="${dataUri}" preserveAspectRatio="none"${opacityAttr}${rx}${transformStyle} />`;
    }
    return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" fill="#cccccc"${rx}${strokeAttrs}${opacityAttr}${transformStyle} />`;
  }

  // Handle rect or frame
  const gradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = style.fills.find((f) => f.type === 'image' && f.assetRef);

  if (gradFill) {
    return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" fill="url(#grad-${escapeXml(node.id)})"${rx}${strokeAttrs}${opacityAttr}${transformStyle} />`;
  }

  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    const asset = assets[imageFill.assetRef];
    const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
    return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" href="${dataUri}" preserveAspectRatio="none"${opacityAttr}${rx}${transformStyle} />`;
  }

  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';

  return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
    box.w
  }" height="${box.h}" fill="${fill}"${rx}${strokeAttrs}${opacityAttr}${transformStyle} />`;
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
    const layout = node.style.layout;
    let layoutAttrs = '';
    if (layout && layout.mode !== 'none') {
      const mode = layout.mode === 'vertical' ? 'VERTICAL' : 'HORIZONTAL';
      layoutAttrs = ` data-layout-mode="${mode}" data-item-spacing="${layout.gap || 0}" data-padding-top="${layout.paddingTop || 0}" data-padding-right="${layout.paddingRight || 0}" data-padding-bottom="${layout.paddingBottom || 0}" data-padding-left="${layout.paddingLeft || 0}"`;
    }

    return [
      `  <g id="group-${escapeXml(node.id)}"${clipAttr}${layoutAttrs}>`,
      selfLayer,
      childrenSvg,
      '  </g>',
    ].join('\n');
  }

  return rootNodes.map(renderTree).join('\n');
}

function buildFigmaDefs(captures: Capture[]): string {
  const defs: string[] = [];
  for (const [cIdx, capture] of captures.entries()) {
    defs.push(
      `    <clipPath id="frame-clip-${cIdx}">\n      <rect x="0" y="0" width="${capture.frame.width}" height="${capture.frame.height}" />\n    </clipPath>`
    );
    for (const node of capture.nodes) {
      const gradFill = node.style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
      if (gradFill && gradFill.stops) {
        const angleRad = (((gradFill.angle ?? 180) - 90) * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const x1 = `${Math.round((0.5 - cos * 0.5) * 100)}%`;
        const y1 = `${Math.round((0.5 - sin * 0.5) * 100)}%`;
        const x2 = `${Math.round((0.5 + cos * 0.5) * 100)}%`;
        const y2 = `${Math.round((0.5 + sin * 0.5) * 100)}%`;

        const stops = gradFill.stops
          .map((s) => `      <stop offset="${Math.round(s.position * 100)}%" stop-color="${escapeXml(s.color)}" />`)
          .join('\n');

        defs.push(`    <linearGradient id="grad-${escapeXml(node.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">\n${stops}\n    </linearGradient>`);
      }

      if (node.style.clip) {
        const rx = node.style.radius?.topLeft ? ` rx="${node.style.radius.topLeft}"` : '';
        defs.push(
          `    <clipPath id="clip-${escapeXml(node.id)}">\n      <rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}"${rx} />\n    </clipPath>`
        );
      }
    }
  }
  const fontFaces: string[] = [];
  for (const capture of captures) {
    for (const f of capture.fonts) {
      if (f.assetRef && capture.assets[f.assetRef]) {
        const asset = capture.assets[f.assetRef];
        fontFaces.push(`    @font-face {
      font-family: '${escapeXml(f.family)}';
      font-weight: ${f.weight || '400'};
      font-style: ${f.style || 'normal'};
      src: url('data:${asset.mimeType};base64,${asset.base64}');
    }`);
      }
    }
  }
  if (fontFaces.length > 0) {
    defs.push(`    <style>\n${fontFaces.join('\n')}\n    </style>`);
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
    return [
      `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
      defs,
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
