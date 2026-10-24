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
  const rxVal = style.radius?.topLeft ? Math.min(style.radius.topLeft, box.w / 2, box.h / 2) : 0;
  const rx = rxVal > 0 ? ` rx="${rxVal}" ry="${rxVal}"` : '';
  const transformStyle = style.transform
    ? ` style="transform: ${escapeXml(style.transform)}; transform-origin: ${escapeXml(style.transformOrigin || '50% 50%')}; transform-box: fill-box;"`
    : '';
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

    const textY = box.y;
    return `  <text x="${textX}" y="${textY}" dominant-baseline="text-before-edge" font-family="${escapeXml(
      text.fontFamily
    )}" font-size="${text.fontSize}" font-weight="${text.fontWeight}" fill="${textFillAttr}" text-anchor="${anchor}"${opacityAttr}${transformStyle}>${innerContent}</text>`;
  }
  if (type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
    const paths = node.vectorPaths
      .map((p) => {
        const fill = p.fill ? ` fill="${escapeXml(p.fill)}"` : ' fill="currentColor"';
        const stroke = p.stroke ? ` stroke="${escapeXml(p.stroke)}"` : '';
        const sw = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
        return `    <path d="${escapeXml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    return `  <g id="${escapeXml(node.id)}" transform="translate(${box.x} ${box.y})"${opacityAttr}>\n${paths}\n  </g>`;
  }


  if (type === 'image') {
    if (node.assetRef && assets[node.assetRef]) {
      const asset = assets[node.assetRef];
      const dataUri = `data:${asset.mimeType};base64,${asset.base64}`;
      const fit = node.objectFit && node.objectFit !== 'fill' ? node.objectFit : 'cover';
      const par = fit === 'cover' ? 'xMidYMid slice' : fit === 'contain' ? 'xMidYMid meet' : 'none';
      if (fit === 'cover') {
        return [
          `  <clipPath id="imgclip-${escapeXml(node.id)}">`,
          `    <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"${rx} />`,
          '  </clipPath>',
          `  <g clip-path="url(#imgclip-${escapeXml(node.id)})"${opacityAttr}${transformStyle}>`,
          `    <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" href="${dataUri}" preserveAspectRatio="${par}" />`,
          '  </g>',
        ].join('\n');
      }
      return `  <image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" href="${dataUri}" preserveAspectRatio="${par}"${opacityAttr}${transformStyle} />`;
    }
    return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#cccccc"${rx}${opacityAttr}${transformStyle} />`;
  }

  // Frame or rect
  const gradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  if (gradFill) {
    return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#grad-${escapeXml(node.id)})"${rx}${opacityAttr}${transformStyle} />`;
  }

  const firstSolid = style.fills.find((f) => f.type === 'solid' && f.color);
  const fill = firstSolid?.color ? escapeXml(firstSolid.color) : 'none';

  return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fill}"${rx}${opacityAttr}${transformStyle} />`;
}
function buildSvgDefs(capture: Capture): string {
  const defs: string[] = [];

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

  const fontFaces: string[] = [];
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
  if (fontFaces.length > 0) {
    defs.push(`    <style>\n${fontFaces.join('\n')}\n    </style>`);
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
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    buildSvgDefs(capture),
    frameBg,
    elements,
  ].filter(Boolean).join('\n');
}
