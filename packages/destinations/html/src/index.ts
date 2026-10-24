import type { Capture, Node, Shadow } from '@capture-kit/model';

export interface HtmlExportOptions {
  standalone?: boolean;
  title?: string;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatShadows(shadows: Shadow[]): string {
  if (!shadows || shadows.length === 0) return '';
  return shadows
    .map((s) => {
      const inset = s.inset ? 'inset ' : '';
      const spread = s.spread !== undefined ? ` ${s.spread}px` : '';
      return `${inset}${s.x}px ${s.y}px ${s.blur}px${spread} ${s.color}`;
    })
    .join(', ');
}

function renderNodeToHtml(node: Node, assets: Capture['assets']): string {
  const { box, style, type, text, assetRef } = node;
  const styles: string[] = [
    'position: absolute',
    `left: ${box.x}px`,
    `top: ${box.y}px`,
    `width: ${box.w}px`,
    `height: ${box.h}px`,
    'box-sizing: border-box',
  ];

  if (style.opacity < 1) {
    styles.push(`opacity: ${style.opacity}`);
  }
  // Clipping
  if (style.clip) {
    styles.push('overflow: hidden');
  }
  if (style.clipPath) {
    styles.push(`clip-path: ${style.clipPath}`);
  }


  // Radius
  const r = style.radius;
  if (r && (r.topLeft > 0 || r.topRight > 0 || r.bottomRight > 0 || r.bottomLeft > 0)) {
    styles.push(`border-radius: ${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px`);
  }

  // Strokes / borders
  if (style.strokes && style.strokes.length > 0) {
    const stroke = style.strokes[0];
    styles.push(`border: ${stroke.width}px ${stroke.style || 'solid'} ${stroke.color}`);
  }

  // Shadows
  const shadowStr = formatShadows(style.shadows ?? []);
  if (shadowStr) {
    styles.push(`box-shadow: ${shadowStr}`);
  }

  // Fills
  const solidFill = style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = style.fills.find((f) => f.type === 'image' && f.assetRef);

  if (solidFill && solidFill.color) {
    styles.push(`background-color: ${solidFill.color}`);
  }
  const gradFill = style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);
  if (gradFill && gradFill.stops) {
    const stopsStr = gradFill.stops
      .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
      .join(', ');
    styles.push(`background-image: linear-gradient(${gradFill.angle ?? 180}deg, ${stopsStr})`);
  }


  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    const asset = assets[imageFill.assetRef];
    styles.push(
      `background-image: url('data:${asset.mimeType};base64,${asset.base64}')`,
      'background-size: cover',
      'background-position: center'
    );
  }

  const styleAttr = ` style="${styles.join('; ')}"`;
  if (type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
    const paths = node.vectorPaths
      .map((p) => {
        const fill = p.fill ? ` fill="${escapeHtml(p.fill)}"` : ' fill="currentColor"';
        const stroke = p.stroke ? ` stroke="${escapeHtml(p.stroke)}"` : '';
        const sw = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
        return `      <path d="${escapeHtml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    return `    <svg id="${escapeHtml(node.id)}"${styleAttr} viewBox="0 0 ${box.w} ${box.h}">\n${paths}\n    </svg>`;
  }


  if (type === 'image') {
    if (assetRef && assets[assetRef]) {
      const asset = assets[assetRef];
      const src = `data:${asset.mimeType};base64,${asset.base64}`;
      return `    <img id="${escapeHtml(node.id)}"${styleAttr} src="${src}" alt="Captured image" style="${styles.join('; ')}; object-fit: cover;" />`;
    }
    return `    <div id="${escapeHtml(node.id)}"${styleAttr}></div>`;
  }

  if (type === 'text' && text) {
    const textStyles: string[] = [
      ...styles,
      `font-family: ${text.fontFamily}`,
      `font-size: ${text.fontSize}px`,
      `font-weight: ${text.fontWeight}`,
      `line-height: ${typeof text.lineHeight === 'number' ? `${text.lineHeight}px` : text.lineHeight}`,
      `color: ${text.color}`,
      `text-align: ${text.align}`,
      'white-space: pre-wrap',
      'word-break: break-word',
    ];
    if (text.letterSpacing) {
      textStyles.push(`letter-spacing: ${typeof text.letterSpacing === 'number' ? `${text.letterSpacing}px` : text.letterSpacing}`);
    }

    return `    <div id="${escapeHtml(node.id)}" style="${textStyles.join('; ')}">${escapeHtml(text.content)}</div>`;
  }

  return `    <div id="${escapeHtml(node.id)}"${styleAttr}></div>`;
}

export function modelToHtml(capture: Capture, opts?: HtmlExportOptions): string {
  const standalone = opts?.standalone ?? true;
  const title = opts?.title ?? 'Captured Document';
  const { width, height } = capture.frame;

  const renderedNodes = capture.nodes
    .map((node) => renderNodeToHtml(node, capture.assets))
    .join('\n');

  const canvasHtml = [
    `  <div class="capture-canvas" style="position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #ffffff;">`,
    renderedNodes,
    '  </div>',
  ].join('\n');

  if (!standalone) {
    return canvasHtml;
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    '    body { margin: 0; padding: 0; background-color: #f1f5f9; display: flex; justify-content: center; }',
    '    .capture-canvas { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); margin: 24px auto; }',
    '  </style>',
    '</head>',
    '<body>',
    canvasHtml,
    '</body>',
    '</html>',
  ].join('\n');
}
