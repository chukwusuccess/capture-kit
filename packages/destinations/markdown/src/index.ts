import type { Capture, Node, Style, TextProps } from '@capture-kit/model';

export interface MarkdownExportOptions {
  componentName?: string;
  includeAiPrompt?: boolean;
}

function formatFills(style: Style): string {
  if (!style.fills || style.fills.length === 0) return 'none';
  return style.fills
    .map((f) => {
      if (f.type === 'gradient') {
        const stops = (f.stops ?? [])
          .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
          .join(', ');
        return `gradient (${f.gradientType ?? 'linear'}, ${f.angle ?? 180}deg: ${stops})`;
      }
      if (f.type === 'image') {
        return `image-fill (${f.assetRef ?? 'embedded'})`;
      }
      return f.color || 'solid';
    })
    .join(', ');
}

function formatStrokes(style: Style): string {
  if (!style.strokes || style.strokes.length === 0) return 'none';
  return style.strokes
    .map((s) => `${s.width}px ${s.style || 'solid'} ${s.color}`)
    .join(', ');
}

function formatRadius(style: Style): string {
  const r = style.radius;
  if (!r || (r.topLeft === 0 && r.topRight === 0 && r.bottomRight === 0 && r.bottomLeft === 0)) {
    return '0px';
  }
  if (r.topLeft === r.topRight && r.topRight === r.bottomRight && r.bottomRight === r.bottomLeft) {
    return `${r.topLeft}px`;
  }
  return `${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px`;
}

function formatShadows(style: Style): string {
  if (!style.shadows || style.shadows.length === 0) return 'none';
  return style.shadows
    .map((s) => {
      const inset = s.inset ? 'inset ' : '';
      const spread = s.spread !== undefined ? ` ${s.spread}px` : '';
      return `${inset}${s.x}px ${s.y}px ${s.blur}px${spread} ${s.color}`;
    })
    .join(', ');
}

function extractTypographyTokens(nodes: Node[]): string[] {
  const tokenMap = new Map<string, TextProps>();
  for (const n of nodes) {
    if (n.type === 'text' && n.text) {
      const key = `${n.text.fontFamily}|${n.text.fontSize}|${n.text.fontWeight}|${n.text.color}`;
      if (!tokenMap.has(key)) {
        tokenMap.set(key, n.text);
      }
    }
  }

  const tokens: string[] = [];
  for (const t of tokenMap.values()) {
    tokens.push(
      `- Font: ${t.fontFamily}, Size: ${t.fontSize}px, Weight: ${t.fontWeight}, Line Height: ${t.lineHeight}px, Color: ${t.color}`
    );
  }
  return tokens;
}

export function modelToMarkdown(
  capture: Capture,
  opts?: MarkdownExportOptions
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
        return 'Component';
      } catch {
        return 'Component';
      }
    })();

  const { width, height } = capture.frame;

  // Build hierarchical tree
  const nodeMap = new Map<string, Node>();
  const childrenMap = new Map<string, Node[]>();
  const rootNodes: Node[] = [];

  for (const n of capture.nodes) {
    nodeMap.set(n.id, n);
  }

  for (const n of capture.nodes) {
    if (n.parentId && nodeMap.has(n.parentId)) {
      const list = childrenMap.get(n.parentId) ?? [];
      list.push(n);
      childrenMap.set(n.parentId, list);
    } else {
      rootNodes.push(n);
    }
  }

  const treeLines: string[] = [];

  function printTreeNode(node: Node, depth: number): void {
    const indent = '  '.repeat(depth);
    const boxStr = `x: ${node.box.x}, y: ${node.box.y}, w: ${node.box.w}, h: ${node.box.h}`;

    if (node.type === 'text' && node.text) {
      treeLines.push(
        `${indent}- **Text** ("${node.text.content}") [${boxStr}]`
      );
      treeLines.push(
        `${indent}  Style: font=${node.text.fontSize}px/${node.text.fontWeight} ${node.text.fontFamily}, color=${node.text.color}, align=${node.text.align}`
      );
    } else if (node.type === 'image') {
      treeLines.push(
        `${indent}- **Image** [${boxStr}] (asset: ${node.assetRef ?? 'placeholder'})`
      );
    } else {
      const fills = formatFills(node.style);
      const strokes = formatStrokes(node.style);
      const radius = formatRadius(node.style);
      const shadows = formatShadows(node.style);

      treeLines.push(
        `${indent}- **${node.type === 'frame' ? 'Container/Frame' : 'Shape/Rect'}** (${node.id}) [${boxStr}]`
      );
      treeLines.push(
        `${indent}  Style: bg=${fills}, border=${strokes}, radius=${radius}, shadow=${shadows}`
      );
    }

    const children = childrenMap.get(node.id) ?? [];
    for (const child of children) {
      printTreeNode(child, depth + 1);
    }
  }

  for (const root of rootNodes) {
    printTreeNode(root, 0);
  }

  // Extract clean text content in sequence
  const cleanTexts: string[] = [];
  for (const n of capture.nodes) {
    if (n.type === 'text' && n.text?.content) {
      cleanTexts.push(n.text.content);
    }
  }

  const typographyTokens = extractTypographyTokens(capture.nodes);

  const sections: string[] = [
    `# Component Specification: ${name}`,
    '',
    '## 1. Bounding Geometry & Canvas',
    `- Canvas Dimensions: ${width}px width × ${height}px height`,
    `- Total Elements: ${capture.nodes.length} nodes`,
    `- Source URL: ${capture.url}`,
    '',
    '## 2. Typography & Color Tokens',
    typographyTokens.length > 0
      ? typographyTokens.join('\n')
      : '- Standard system typography defaults',
    '',
    '## 3. Element Hierarchy & Layout Tree',
    treeLines.length > 0
      ? treeLines.join('\n')
      : '- Single canvas without nested elements',
    '',
    '## 4. Content Copy (Raw Text)',
    cleanTexts.length > 0
      ? cleanTexts.map((t) => `> ${t}`).join('\n>\n')
      : '> (No text elements captured)',
  ];

  if (opts?.includeAiPrompt !== false) {
    sections.push(
      '',
      '## 5. AI Reproduction Prompt',
      '```prompt',
      `Recreate this "${name}" component faithfully in React with Tailwind CSS (or your target framework).`,
      'Requirements:',
      `1. Match the exact bounding canvas of ${width}px × ${height}px and per-element relative bounding boxes.`,
      '2. Apply the exact typography tokens (font family, font size, weight, line-height, text color).',
      '3. Recreate the background fills, gradients, borders, corner radii, and box-shadows specified in the hierarchy.',
      '4. Preserve the exact content copy from section 4.',
      '5. Output clean, self-contained, accessible, production-ready code with responsive flex/grid wrappers.',
      '```'
    );
  }

  return sections.join('\n');
}
