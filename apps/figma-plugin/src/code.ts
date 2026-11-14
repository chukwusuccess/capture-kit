import type { Capture, Node } from '@capture-kit/model';
import { nativeSvgForPaths, parseNativeCaptures, planNativeCapture, type NativeDiagnostic, type NativeNodePlan } from '@capture-kit/destination-figma/native';
import { FontImporter } from './fonts.js';
import { PaintImporter, type Warn } from './paints.js';

figma.showUI(__html__, { width: 440, height: 560, themeColors: true });
let importing = false;


function embeddedSvg(capture: Capture, source: Node): string | undefined {
  const asset = source.assetRef ? capture.assets[source.assetRef] : undefined;
  if (asset?.mimeType !== 'image/svg+xml') return undefined;
  const bytes = figma.base64Decode(asset.base64.replace(/^data:[^,]+,/, ''));
  // The plugin sandbox does not provide the browser TextDecoder API.
  let encoded = '';
  for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, '0')}`;
  return decodeURIComponent(encoded);
}

function isLayoutChild(node: SceneNode): node is SceneNode & LayoutMixin {
  return 'layoutPositioning' in node && 'layoutSizingHorizontal' in node && 'layoutSizingVertical' in node;
}

function autoLayout(frame: FrameNode, plan: NativeNodePlan, warn: Warn): void {
  if (plan.layout === 'positioned') return;
  const layout = plan.source.style.layout!;
  frame.layoutMode = plan.layout === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
  frame.layoutWrap = 'NO_WRAP';
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';
  frame.itemSpacing = layout.gap ?? 0;
  frame.paddingTop = layout.paddingTop ?? 0;
  frame.paddingRight = layout.paddingRight ?? 0;
  frame.paddingBottom = layout.paddingBottom ?? 0;
  frame.paddingLeft = layout.paddingLeft ?? 0;
  frame.primaryAxisAlignItems = layout.justifyContent === 'center' ? 'CENTER'
    : layout.justifyContent === 'end' ? 'MAX'
    : layout.justifyContent === 'between' ? 'SPACE_BETWEEN'
    : layout.justifyContent === 'around' ? 'SPACE_AROUND'
    : layout.justifyContent === 'evenly' ? 'SPACE_EVENLY' : 'MIN';
  frame.counterAxisAlignItems = layout.alignItems === 'center' ? 'CENTER' : layout.alignItems === 'end' ? 'MAX' : 'MIN';
  for (const child of frame.children) {
    if (!isLayoutChild(child)) {
      warn('native-layout-child', `Figma child type '${child.type}' does not support auto layout sizing; its captured position is retained.`, plan.source.id);
      continue;
    }
    child.layoutPositioning = 'AUTO';
    child.layoutSizingHorizontal = 'FIXED';
    child.layoutSizingVertical = 'FIXED';
    if (layout.alignItems === 'stretch') {
      if (plan.layout === 'horizontal') child.layoutSizingVertical = 'FILL';
      else child.layoutSizingHorizontal = 'FILL';
    }
  }
}

async function renderNode(plan: NativeNodePlan, parent: FrameNode, parentSource: Node | undefined, capture: Capture, paints: PaintImporter, fonts: FontImporter, warn: Warn): Promise<void> {
  const source = plan.source;
  let target: FrameNode | RectangleNode | TextNode;
  const needsWrapper = source.type === 'frame' || plan.children.length > 0 || source.type === 'vector'
    || (source.type === 'image' && capture.assets[source.assetRef ?? '']?.mimeType === 'image/svg+xml');
  if (needsWrapper) {
    target = figma.createFrame();
    target.fills = [];
    target.clipsContent = source.style.clip ?? false;
  } else if (source.type === 'text') target = figma.createText();
  else target = figma.createRectangle();
  parent.appendChild(target);
  target.name = source.name || `${source.type} ${source.id}`;
  target.setPluginData('captureKitNodeId', source.id);
  target.x = source.box.x - (parentSource?.box.x ?? 0);
  target.y = source.box.y - (parentSource?.box.y ?? 0);
  if (target.type !== 'TEXT') target.resize(Math.max(0.01, source.box.w), Math.max(0.01, source.box.h));
  if (source.box.w === 0 || source.box.h === 0) warn('native-zero-bounds', 'Figma cannot size this layer to zero; used a 0.01px minimum.', source.id);
  paints.apply(target, source.type === 'image' && capture.assets[source.assetRef ?? '']?.mimeType === 'image/svg+xml' ? { ...source, type: 'frame' } : source);
  if (source.type === 'text') {
    if (target.type === 'TEXT') {
      await fonts.apply(target, source);
      target.resize(Math.max(0.01, source.box.w), Math.max(0.01, source.box.h));
    }
    else if (target.type === 'FRAME') {
      const text = figma.createText();
      target.appendChild(text);
      text.name = 'Editable text';
      await fonts.apply(text, source);
      text.resize(Math.max(0.01, source.box.w), Math.max(0.01, source.box.h));
      warn('native-content-wrapper', 'A native frame wraps text and descendants to preserve the captured hierarchy.', source.id);
    }
  }
  if (source.type === 'vector' || source.type === 'image') {
    try {
      const svg = source.type === 'vector' && source.vectorPaths?.length ? nativeSvgForPaths(source) : embeddedSvg(capture, source);
      if (svg) {
        if (target.type !== 'FRAME') throw new Error('SVG content requires a native frame container.');
        const vector = figma.createNodeFromSvg(svg);
        target.appendChild(vector);
        vector.name = 'Native SVG paths';
        vector.x = 0;
        vector.y = 0;
        vector.resize(Math.max(0.01, source.box.w), Math.max(0.01, source.box.h));
        warn('native-svg-conversion', 'SVG converted to editable Figma vector layers; unsupported SVG effects may differ from browser rendering.', source.id);
      } else if (source.type === 'vector') warn('native-vector-missing', 'Vector path data is unavailable; kept an empty native frame at the captured bounds.', source.id);
    } catch (error) {
      warn('native-vector-decode', `Vector import failed; kept captured bounds: ${error instanceof Error ? error.message : String(error)}`, source.id);
    }
  }
  if (target.type === 'FRAME') {
    for (const child of plan.children) await renderNode(child, target, source, capture, paints, fonts, warn);
    autoLayout(target, plan, warn);
    target.setPluginData('captureKitLayout', plan.layout);
  }
}

figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'close') { if (!importing) figma.closePlugin(); return; }
  if (message.type !== 'import' || importing || !('payload' in message)) return;
  importing = true;
  const created: FrameNode[] = [];
  const diagnostics: NativeDiagnostic[] = [];
  const seen = new Set<string>();
  const warn: Warn = (code, text, nodeId) => {
    const key = `${code}\u0000${nodeId ?? ''}\u0000${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({ code, message: text, severity: 'warning', ...(nodeId ? { nodeId } : {}) });
  };
  try {
    const captures = parseNativeCaptures(message.payload);
    const plans = captures.map(planNativeCapture);
    const availableFonts = await figma.listAvailableFontsAsync();
    let x = figma.viewport.center.x;
    const y = figma.viewport.center.y;
    let autoLayoutCount = 0;
    for (const [index, plan] of plans.entries()) {
      const capture = plan.capture;
      diagnostics.push(...plan.diagnostics);
      const root = figma.createFrame();
      created.push(root);
      root.name = `Capture ${index + 1} - ${capture.url} - ${capture.frame.width}px`;
      root.resize(Math.max(0.01, capture.frame.width), Math.max(0.01, capture.frame.height));
      root.x = x;
      root.y = y;
      root.clipsContent = false;
      root.setPluginData('captureKitUrl', capture.url);
      const paints = new PaintImporter(capture, warn);
      const background = capture.frame.background ? paints.color(capture.frame.background, 'capture-root') : undefined;
      root.fills = background ? [background] : [];
      const fonts = new FontImporter(availableFonts, paints, warn);
      for (const node of plan.roots) await renderNode(node, root, undefined, capture, paints, fonts, warn);
      const countLayout = (nodes: NativeNodePlan[]): number => nodes.reduce((count, node) => count + (node.layout === 'positioned' ? 0 : 1) + countLayout(node.children), 0);
      autoLayoutCount += countLayout(plan.roots);
      x += root.width + 80;
      figma.ui.postMessage({ type: 'progress', message: `Imported capture ${index + 1} of ${plans.length}.` });
    }
    figma.currentPage.selection = created;
    figma.viewport.scrollAndZoomIntoView(created);
    figma.ui.postMessage({ type: 'complete', message: `Imported ${created.length} capture${created.length === 1 ? '' : 's'} with ${autoLayoutCount} native Auto Layout frame${autoLayoutCount === 1 ? '' : 's'}.`, diagnostics });
  } catch (error) {
    for (const node of created) if (!node.removed) node.remove();
    figma.ui.postMessage({ type: 'error', message: `${error instanceof Error ? error.message : String(error)} No imported captures were kept.`, diagnostics });
  } finally {
    importing = false;
  }
};
