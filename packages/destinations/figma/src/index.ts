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
  const rx = style.radius?.topLeft ? ` rx="${style.radius.topLeft}"` : '';

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

    const textY = box.y + text.fontSize;

    return `    <text id="${escapeXml(node.id)}" x="${textX}" y="${textY}" font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}" fill="${escapeXml(
      text.color
    )}" text-anchor="${anchor}"${opacityAttr}>${content}</text>`;
  }

  if (type === 'image') {
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
        box.w
      }" height="${box.h}" href="${dataUri}" preserveAspectRatio="none"${opacityAttr}${rx} />`;
    }
    return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" fill="#cccccc"${rx}${strokeAttrs}${opacityAttr} />`;
  }

  // Handle rect or frame
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = style.fills.find((f) => f.type === 'image' && f.assetRef);

  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    const asset = assets[imageFill.assetRef];
    const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
    return `    <image id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
      box.w
    }" height="${box.h}" href="${dataUri}" preserveAspectRatio="none"${opacityAttr}${rx} />`;
  }

  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';

  return `    <rect id="${escapeXml(node.id)}" x="${box.x}" y="${box.y}" width="${
    box.w
  }" height="${box.h}" fill="${fill}"${rx}${strokeAttrs}${opacityAttr} />`;
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

    return [
      `  <g id="group-${escapeXml(node.id)}">`,
      selfLayer,
      childrenSvg,
      '  </g>',
    ].join('\n');
  }

  return rootNodes.map(renderTree).join('\n');
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
  if (captures.length === 1) {
    const { width, height } = captures[0].frame;
    return [
      `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
      buildFigmaLayers(captures[0]),
      '</svg>',
    ].join('\n');
  }

  // Several captures: lay them out left to right, one named group each.
  let x = 0;
  const groups = captures.map((capture) => {
    const group = [
      `<g id="${escapeXml(captureLabel(capture))}" transform="translate(${x} 0)">`,
      buildFigmaLayers(capture),
      '</g>',
    ].join('\n');
    x += capture.frame.width + CAPTURE_GAP;
    return group;
  });
  const width = x - CAPTURE_GAP;
  const height = Math.max(...captures.map((c) => c.frame.height));
  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
    ...groups,
    '</svg>',
  ].join('\n');
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
