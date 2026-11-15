import { buildFontFaceCss, type Capture, type Node, type Shadow } from '@capture-kit/model';

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
  // Pixel-fidelity fields (only set when non-default)
  if (style.transform) styles.push(`transform: ${style.transform}`);
  if (style.transformOrigin) styles.push(`transform-origin: ${style.transformOrigin}`);
  if (style.filter) styles.push(`filter: ${style.filter}`);
  if (style.backdropFilter) styles.push(`backdrop-filter: ${style.backdropFilter}`);
  if (style.mixBlendMode) styles.push(`mix-blend-mode: ${style.mixBlendMode}`);
  if (style.backgroundSize) styles.push(`background-size: ${style.backgroundSize}`);
  if (style.backgroundPosition) styles.push(`background-position: ${style.backgroundPosition}`);
  if (style.backgroundRepeat) styles.push(`background-repeat: ${style.backgroundRepeat}`);
  if (style.backgroundClip) {
    styles.push(`background-clip: ${style.backgroundClip}`, `-webkit-background-clip: ${style.backgroundClip}`);
  }
  if (style.maskImage) {
    styles.push(`mask-image: ${style.maskImage}`, `-webkit-mask-image: ${style.maskImage}`);
  }

  // Radius
  const r = style.radius;
  if (r && (r.topLeft > 0 || r.topRight > 0 || r.bottomRight > 0 || r.bottomLeft > 0)) {
    styles.push(`border-radius: ${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px`);
  }

  // Strokes / borders
  if (style.strokes && style.strokes.length > 0) {
    for (const stroke of style.strokes) {
      const prop = stroke.side && stroke.side !== 'all' ? `border-${stroke.side}` : 'border';
      styles.push(`${prop}: ${stroke.width}px ${stroke.style || 'solid'} ${stroke.color}`);
    }
  }

  // Shadows
  const shadowStr = formatShadows(style.shadows ?? []);
  if (shadowStr) {
    styles.push(`box-shadow: ${shadowStr}`);
  }

  // Fills
  const solidFill = style.fills.find((f) => f.type === 'solid' && f.color);
  if (solidFill && solidFill.color) {
    styles.push(`background-color: ${solidFill.color}`);
  }

  const bgLayers: string[] = [];
  const bgSizes: string[] = [];
  const bgPositions: string[] = [];
  const bgRepeats: string[] = [];
  let hasLayerMeta = false;

  for (const fill of style.fills) {
    if (fill.type === 'gradient' && fill.stops && fill.stops.length > 0) {
      const stopsStr = fill.stops
        .map((s) => `${s.color} ${s.positionPx !== undefined ? `${s.positionPx}px` : `${Math.round(s.position * 10000) / 100}%`}`)
        .join(', ');
      const prefix = fill.repeating ? 'repeating-' : '';
      if (fill.gradientType === 'radial') {
        const atStr =
          fill.cx !== undefined || fill.cy !== undefined
            ? `at ${Math.round((fill.cx ?? 0.5) * 10000) / 100}% ${Math.round((fill.cy ?? 0.5) * 10000) / 100}%`
            : '';
        const pre = [fill.radialShape || (fill.radialSize ? undefined : 'circle'), fill.radialSize, atStr]
          .filter(Boolean)
          .join(' ');
        bgLayers.push(`${prefix}radial-gradient(${pre ? `${pre}, ` : ''}${stopsStr})`);
      } else if (fill.gradientType === 'conic') {
        const fromStr = fill.angle !== undefined ? `from ${fill.angle}deg` : '';
        const atStr =
          fill.cx !== undefined || fill.cy !== undefined
            ? `at ${Math.round((fill.cx ?? 0.5) * 10000) / 100}% ${Math.round((fill.cy ?? 0.5) * 10000) / 100}%`
            : '';
        const pre = [fromStr, atStr].filter(Boolean).join(' ');
        bgLayers.push(`${prefix}conic-gradient(${pre ? `${pre}, ` : ''}${stopsStr})`);
      } else {
        bgLayers.push(`${prefix}linear-gradient(${fill.angle ?? 180}deg, ${stopsStr})`);
      }
    } else if (fill.type === 'image' && fill.assetRef && assets[fill.assetRef]) {
      const asset = assets[fill.assetRef];
      bgLayers.push(`url('data:${asset.mimeType};base64,${asset.base64}')`);
    } else {
      continue;
    }
    if (fill.backgroundSize || fill.backgroundPosition || fill.backgroundRepeat) hasLayerMeta = true;
    bgSizes.push(fill.backgroundSize || style.backgroundSize || (fill.type === 'image' ? 'cover' : 'auto'));
    bgPositions.push(fill.backgroundPosition || style.backgroundPosition || (fill.type === 'image' ? 'center' : '0% 0%'));
    bgRepeats.push(fill.backgroundRepeat || style.backgroundRepeat || 'repeat');
  }

  if (bgLayers.length > 0) {
    styles.push(`background-image: ${bgLayers.join(', ')}`);
    if (hasLayerMeta) {
      styles.push(
        `background-size: ${bgSizes.join(', ')}`,
        `background-position: ${bgPositions.join(', ')}`,
        `background-repeat: ${bgRepeats.join(', ')}`
      );
    } else if (style.fills.some((f) => f.type === 'image' && f.assetRef)) {
      if (!style.backgroundSize) styles.push('background-size: cover');
      if (!style.backgroundPosition) styles.push('background-position: center');
    }
  }

  const styleAttr = ` style="${escapeHtml(styles.join('; '))}"`;
  if (type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
    const paths = node.vectorPaths
      .map((p) => {
        const fill = p.fill ? ` fill="${escapeHtml(p.fill)}"` : ' fill="currentColor"';
        const stroke = p.stroke ? ` stroke="${escapeHtml(p.stroke)}"` : '';
        const sw = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
        return `      <path d="${escapeHtml(p.d)}"${fill}${stroke}${sw} />`;
      })
      .join('\n');
    const vb2 = node.vectorViewBox;
    const vbAttr = vb2 ? `0 0 ${vb2.width} ${vb2.height}` : `0 0 ${box.w} ${box.h}`;
    return `    <svg id="${escapeHtml(node.id)}"${styleAttr} viewBox="${vbAttr}">\n${paths}\n    </svg>`;
  }


    if (type === 'image') {
    if (assetRef && assets[assetRef]) {
      const asset = assets[assetRef];
      const src = `data:${asset.mimeType};base64,${asset.base64}`;
      const fit = node.objectFit || 'fill';
      const posStyle = node.objectPosition ? `; object-position: ${escapeHtml(node.objectPosition)}` : '';
      return `    <img id="${escapeHtml(node.id)}" src="${src}" alt="Captured image" width="${box.w}" height="${box.h}" style="${escapeHtml(`${styles.join('; ')}; object-fit: ${fit}${posStyle}`)}" />`;
    }
    return `    <div id="${escapeHtml(node.id)}"${styleAttr}></div>`;
  }

  if (type === 'text' && text) {
    const isTightSingleLineBox =
      !text.runs &&
      !text.content.includes('\n') &&
      typeof text.lineHeight === 'number' &&
      box.h < text.lineHeight - 1;
    const textStyles: string[] = [
      ...styles,
      `font-family: ${text.fontFamily}`,
      `font-size: ${text.fontSize}px`,
      `font-weight: ${text.fontWeight}`,
      `line-height: ${isTightSingleLineBox ? 'normal' : typeof text.lineHeight === 'number' ? `${text.lineHeight}px` : text.lineHeight}`,
      `color: ${style.backgroundClip === 'text' ? 'transparent' : text.color}`,
      `text-align: ${text.align}`,
      'white-space: pre-wrap',
      'word-break: break-word',
    ];
    if (text.letterSpacing) {
      textStyles.push(`letter-spacing: ${typeof text.letterSpacing === 'number' ? `${text.letterSpacing}px` : text.letterSpacing}`);
    }
    if (text.italic) textStyles.push('font-style: italic');
    if (text.decoration) textStyles.push(`text-decoration: ${text.decoration}`);
    if (text.textTransform) textStyles.push(`text-transform: ${text.textTransform}`);
    if (text.textShadow) textStyles.push(`text-shadow: ${text.textShadow}`);
    if (text.overflow === 'ellipsis') {
      textStyles.push('overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap');
    }

    if (text.runs && text.runs.length > 0) {
      const positioned = text.runs.every((r) => typeof r.x === 'number' && typeof r.y === 'number');
      if (positioned) {
        const spans = text.runs.map((r) => {
          const rx = Math.round(((r.x ?? box.x) - box.x) * 100) / 100;
          const ry = Math.round(((r.y ?? box.y) - box.y) * 100) / 100;
          return `<span style="position: absolute; left: ${rx}px; top: ${ry}px; line-height: normal; white-space: pre">${escapeHtml(r.text)}</span>`;
        }).join('');
        return `    <div id="${escapeHtml(node.id)}" style="${escapeHtml(textStyles.join('; '))}">${spans}</div>`;
      }
      return `    <div id="${escapeHtml(node.id)}" style="${escapeHtml(textStyles.join('; '))}">${escapeHtml(text.runs.map((r) => r.text).join('\n'))}</div>`;
    }

    return `    <div id="${escapeHtml(node.id)}" style="${escapeHtml(textStyles.join('; '))}">${escapeHtml(text.content)}</div>`;
  }

  return `    <div id="${escapeHtml(node.id)}"${styleAttr}></div>`;
}

export function modelToHtml(capture: Capture, opts?: HtmlExportOptions): string {
  const standalone = opts?.standalone ?? true;
  const title = opts?.title ?? 'Captured Document';
  const { width, height } = capture.frame;
  const frameBg = capture.frame.background || '#ffffff';

  const renderedNodes = capture.nodes
    .map((node) => renderNodeToHtml(node, capture.assets))
    .join('\n');

  const fontFaceRules = buildFontFaceCss(capture).map((rule) => `    ${rule}`);

  const canvasHtml = [
  `  <div class="capture-canvas" style="position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${escapeHtml(frameBg)};">`,
    renderedNodes,
    '  </div>',
  ].join('\n');

  if (!standalone) {
    if (fontFaceRules.length === 0) return canvasHtml;
    return [
      '  <style>',
      ...fontFaceRules,
      '  </style>',
      canvasHtml,
    ].join('\n');
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    ...fontFaceRules,
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
