import type { Capture, Node, Style, TextProps } from '@capture-kit/model';

export interface ReactExportOptions {
  componentName?: string;
  typescript?: boolean;
}

function escapeJsxText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mapRadiusToTailwind(style: Style): string {
  const r = style.radius;
  if (!r || (r.topLeft === 0 && r.topRight === 0 && r.bottomRight === 0 && r.bottomLeft === 0)) {
    return '';
  }
  if (r.topLeft === r.topRight && r.topRight === r.bottomRight && r.bottomRight === r.bottomLeft) {
    const val = r.topLeft;
    if (val === 2) return 'rounded-sm';
    if (val === 4) return 'rounded';
    if (val === 6) return 'rounded-md';
    if (val === 8) return 'rounded-lg';
    if (val === 12) return 'rounded-xl';
    if (val === 16) return 'rounded-2xl';
    if (val === 24) return 'rounded-3xl';
    if (val >= 9999) return 'rounded-full';
    return `rounded-[${val}px]`;
  }
  return `rounded-[${r.topLeft}px_${r.topRight}px_${r.bottomRight}px_${r.bottomLeft}px]`;
}

function mapShadowToTailwind(style: Style): string {
  if (!style.shadows || style.shadows.length === 0) return '';
  const first = style.shadows[0];
  const colorClean = first.color.replace(/\s+/g, '');
  const inset = first.inset ? 'inset_' : '';
  const spread = first.spread !== undefined ? `_${first.spread}px` : '';
  return `shadow-[${inset}${first.x}px_${first.y}px_${first.blur}px${spread}_${colorClean}]`;
}

function mapFontWeightToTailwind(weight: string | number): string {
  const num = typeof weight === 'number' ? weight : parseInt(weight, 10);
  if (num <= 300) return 'font-light';
  if (num === 400) return 'font-normal';
  if (num === 500) return 'font-medium';
  if (num === 600) return 'font-semibold';
  if (num === 700) return 'font-bold';
  if (num >= 800) return 'font-extrabold';
  return 'font-normal';
}

function buildNodeClasses(
  node: Node,
  isRoot: boolean,
  parentBox?: { x: number; y: number }
): string[] {
  const cls: string[] = [];

  const rx = isRoot ? 'relative' : 'absolute';
  const relX = parentBox ? Math.round((node.box.x - parentBox.x) * 100) / 100 : Math.round(node.box.x * 100) / 100;
  const relY = parentBox ? Math.round((node.box.y - parentBox.y) * 100) / 100 : Math.round(node.box.y * 100) / 100;
  const w = Math.round(node.box.w * 100) / 100;
  const h = Math.round(node.box.h * 100) / 100;

  if (isRoot) {
    cls.push(rx, `w-[${w}px]`, `h-[${h}px]`, 'overflow-hidden');
  } else {
    cls.push(rx, `left-[${relX}px]`, `top-[${relY}px]`, `w-[${w}px]`, `h-[${h}px]`);
  }
  if (node.style.clip) {
    cls.push('overflow-hidden');
  }


  // Fills
  const solidFill = node.style.fills.find((f) => f.type === 'solid' && f.color);
  const gradFill = node.style.fills.find((f) => f.type === 'gradient' && f.stops && f.stops.length > 0);

  if (gradFill && gradFill.stops) {
    const stopsStr = gradFill.stops
      .map((s) => `${s.color.replace(/\s+/g, '')}_${Math.round(s.position * 100)}%`)
      .join(',');
    cls.push(`bg-[linear-gradient(${gradFill.angle ?? 180}deg,${stopsStr})]`);
  } else if (solidFill && solidFill.color) {
    const c = solidFill.color.replace(/\s+/g, '');
    if (c === '#ffffff' || c === 'rgba(255,255,255,1)' || c === 'rgb(255,255,255)') {
      cls.push('bg-white');
    } else if (c === '#000000' || c === 'rgba(0,0,0,1)' || c === 'rgb(0,0,0)') {
      cls.push('bg-black');
    } else {
      cls.push(`bg-[${c}]`);
    }
  }

  // Radius
  const radiusCls = mapRadiusToTailwind(node.style);
  if (radiusCls) cls.push(radiusCls);

  // Strokes / borders
  if (node.style.strokes && node.style.strokes.length > 0) {
    const stroke = node.style.strokes[0];
    const c = stroke.color.replace(/\s+/g, '');
    cls.push(`border-[${stroke.width}px]`, stroke.style === 'dashed' ? 'border-dashed' : stroke.style === 'dotted' ? 'border-dotted' : 'border-solid', `border-[${c}]`);
  }

  // Shadows
  const shadowCls = mapShadowToTailwind(node.style);
  if (shadowCls) cls.push(shadowCls);

  // Opacity
  if (node.style.opacity < 1) {
    cls.push(`opacity-[${node.style.opacity}]`);
  }

  // Text specific
  if (node.type === 'text' && node.text) {
    cls.push(`text-[${node.text.fontSize}px]`);
    cls.push(mapFontWeightToTailwind(node.text.fontWeight));
    if (node.style.backgroundClip === 'text') {
      cls.push('bg-clip-text', 'text-transparent');
    } else {
      cls.push(`text-[${node.text.color.replace(/\s+/g, '')}]`);
    }
    if (node.text.lineHeight) {
      const lh = typeof node.text.lineHeight === 'number' ? `${node.text.lineHeight}px` : node.text.lineHeight;
      cls.push(`leading-[${lh}]`);
    }
    if (node.text.align === 'center') cls.push('text-center');
    else if (node.text.align === 'right') cls.push('text-right');
    else cls.push('text-left');
    if (node.text.italic) cls.push('italic');
    if (node.text.textTransform === 'uppercase') cls.push('uppercase');
    if (node.text.letterSpacing) {
      const ls = typeof node.text.letterSpacing === 'number' ? `${node.text.letterSpacing}px` : node.text.letterSpacing;
      cls.push(`tracking-[${ls}]`);
    }
    cls.push('m-0');
  }

  return cls;
}

export function modelToReact(
  capture: Capture,
  opts?: ReactExportOptions
): string {
  const name =
    opts?.componentName ||
    (() => {
      try {
        const u = new URL(capture.url);
        const segment = u.pathname.split('/').filter(Boolean).pop();
        if (segment) {
          return segment
            .split(/[-_]/)
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');
        }
        return 'CapturedComponent';
      } catch {
        return 'CapturedComponent';
      }
    })();

  const childrenMap = new Map<string, Node[]>();
  const rootNodes: Node[] = [];
  const nodeMap = new Map<string, Node>();

  for (const n of capture.nodes) nodeMap.set(n.id, n);

  for (const n of capture.nodes) {
    if (n.parentId && nodeMap.has(n.parentId)) {
      const list = childrenMap.get(n.parentId) ?? [];
      list.push(n);
      childrenMap.set(n.parentId, list);
    } else {
      rootNodes.push(n);
    }
  }

  function renderJsxNode(
    node: Node,
    depth: number,
    isRoot: boolean,
    parentBox?: { x: number; y: number }
  ): string {
    const indent = '  '.repeat(depth);
    const classes = buildNodeClasses(node, isRoot, parentBox).join(' ');
    const children = childrenMap.get(node.id) ?? [];
    const styleObj: string[] = [];
    if (node.style.transform) {
      styleObj.push(`transform: '${node.style.transform}'`);
      if (node.style.transformOrigin) {
        styleObj.push(`transformOrigin: '${node.style.transformOrigin}'`);
      }
    }
    if (node.style.backdropFilter) {
      styleObj.push(`backdropFilter: '${node.style.backdropFilter}'`);
    }
    if (node.type === 'text' && node.text?.fontFamily) {
      styleObj.push(`fontFamily: '${node.text.fontFamily.replace(/'/g, "\\'")}'`);
    }
    const styleAttr = styleObj.length > 0 ? ` style={{ ${styleObj.join(', ')} }}` : '';


    if (node.type === 'text' && node.text) {
      const content = escapeJsxText(node.text.content);
      const tag = node.text.fontSize >= 24 ? 'h2' : node.text.fontSize >= 18 ? 'h3' : 'p';
      return `${indent}<${tag} className="${classes}"${styleAttr}>${content}</${tag}>`;
    }
    if (node.type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
      const paths = node.vectorPaths
        .map((p) => {
          const fill = p.fill || 'currentColor';
          const stroke = p.stroke ? ` stroke="${p.stroke}"` : '';
          const sw = p.strokeWidth ? ` strokeWidth="${p.strokeWidth}"` : '';
          return `${indent}  <path d="${p.d}" fill="${fill}"${stroke}${sw} />`;
        })
        .join('\n');
      return `${indent}<svg viewBox="0 0 ${node.box.w} ${node.box.h}" className="${classes}">\n${paths}\n${indent}</svg>`;
    }


    if (node.type === 'image') {
      const src =
        node.assetRef && capture.assets[node.assetRef]
          ? `data:${capture.assets[node.assetRef].mimeType};base64,${capture.assets[node.assetRef].base64}`
          : 'https://placehold.co/400x300';
      const fit = node.objectFit && node.objectFit !== 'fill' ? node.objectFit : 'cover';
      const fitCls = fit === 'cover' ? 'object-cover' : fit === 'contain' ? 'object-contain' : fit === 'none' ? 'object-none' : 'object-fill';
      return `${indent}<img src="${src}" alt="${node.id}" className="${classes} ${fitCls}"${styleAttr} />`;
    }

    if (children.length === 0) {
      return `${indent}<div className="${classes}"${styleAttr} />`;
    }

    const childrenJsx = children
      .map((c) => renderJsxNode(c, depth + 1, false, { x: node.box.x, y: node.box.y }))
      .join('\n');

    return `${indent}<div className="${classes}"${styleAttr}>\n${childrenJsx}\n${indent}</div>`;
  }

  let bodyJsx = '';
  if (rootNodes.length === 1) {
    bodyJsx = renderJsxNode(rootNodes[0], 2, true);
  } else {
    const rootBox = { x: 0, y: 0, w: capture.frame.width, h: capture.frame.height };
    const rootNode: Node = {
      id: 'root-canvas',
      type: 'frame',
      box: rootBox,
      style: {
        fills: [{ type: 'solid', color: '#ffffff' }],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        shadows: [],
        clip: true,
      },
    };
    childrenMap.set('root-canvas', rootNodes);
    bodyJsx = renderJsxNode(rootNode, 2, true);
  }

  return [
    "import React from 'react';",
    '',
    `export function ${name}() {`,
    '  return (',
    bodyJsx,
    '  );',
    '}',
  ].join('\n');
}
