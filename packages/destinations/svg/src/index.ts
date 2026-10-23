import type { Capture, Node } from '@capture-kit/model';

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderNodeToSvg(node: Node, assets: Capture['assets']): string {
  const { box, style, type } = node;
  const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity}"` : '';
  const rx = style.radius?.topLeft ? ` rx="${style.radius.topLeft}"` : '';

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

    // Approximating baseline offset for SVG text
    const textY = box.y + text.fontSize;

    return `  <text x="${textX}" y="${textY}" font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}" fill="${escapeXml(
      text.color
    )}" text-anchor="${anchor}"${opacityAttr}>${content}</text>`;
  }

  if (type === 'image') {
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      return `  <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" href="${dataUri}" preserveAspectRatio="none"${opacityAttr} />`;
    }
    return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#cccccc"${rx}${opacityAttr} />`;
  }

  // Frame or rect
  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';

  return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fill}"${rx}${opacityAttr} />`;
}

export function modelToSvg(capture: Capture): string {
  const { width, height } = capture.frame;

  const elements = capture.nodes
    .map((node) => renderNodeToSvg(node, capture.assets))
    .filter(Boolean)
    .join('\n');

  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    elements,
    '</svg>',
  ].join('\n');
}
