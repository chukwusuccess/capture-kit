import type { Capture, Fill, Node } from '@capture-kit/model';
import { parseNativeColor } from '@capture-kit/destination-figma/native';

export type Warn = (code: string, message: string, nodeId?: string) => void;

export class PaintImporter {
  private images = new Map<string, string>();

  constructor(private capture: Capture, private warn: Warn) {}

  color(value: string, nodeId: string): SolidPaint | undefined {
    const color = parseNativeColor(value);
    if (!color) {
      this.warn('native-color-unsupported', `Color '${value}' is not supported; the paint was omitted.`, nodeId);
      return undefined;
    }
    return { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a };
  }

  image(ref: string | undefined, node: Node): ImagePaint | undefined {
    const asset = ref ? this.capture.assets[ref] : undefined;
    if (!asset || asset.kind !== 'image') {
      this.warn('native-image-missing', `Image asset '${ref ?? '(missing reference)'}' is unavailable; no image fill was created.`, node.id);
      return undefined;
    }
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(asset.mimeType)) {
      this.warn('native-image-format', `Image format '${asset.mimeType}' is not supported as a bitmap fill.`, node.id);
      return undefined;
    }
    try {
      let hash = this.images.get(ref!);
      if (!hash) {
        hash = figma.createImage(figma.base64Decode(asset.base64.replace(/^data:[^,]+,/, ''))).hash;
        this.images.set(ref!, hash);
      }
      const fit = node.objectFit ?? (node.style.backgroundSize === 'contain' ? 'contain' : 'cover');
      if (fit === 'none' || fit === 'scale-down') this.warn('native-image-fit', `object-fit '${fit}' is approximated with contain.`, node.id);
      if (fit === 'fill') this.warn('native-image-fit', "object-fit 'fill' is approximated with cover because Figma image fills preserve image aspect ratio.", node.id);
      if (node.objectPosition && node.objectPosition !== '50% 50%') this.warn('native-image-position', 'Custom image positioning is not reproduced; the image is centered.', node.id);
      if (node.style.backgroundPosition && node.style.backgroundPosition !== '50% 50%') this.warn('native-background-position', 'Custom background positioning is not reproduced; the image is centered.', node.id);
      if (node.style.backgroundRepeat && node.style.backgroundRepeat !== 'no-repeat') this.warn('native-background-repeat', 'Repeating background images are imported as a single image fill.', node.id);
      return { type: 'IMAGE', imageHash: hash, scaleMode: fit === 'cover' || fit === 'fill' ? 'FILL' : 'FIT' };
    } catch (error) {
      this.warn('native-image-decode', `Image '${ref}' could not be decoded: ${error instanceof Error ? error.message : String(error)}`, node.id);
      return undefined;
    }
  }

  fill(fill: Fill, node: Node): Paint | undefined {
    if (fill.type === 'image') {
      const image = this.image(fill.assetRef, node);
      return image ? { ...image, opacity: fill.opacity ?? 1 } : undefined;
    }
    if (fill.type === 'solid') {
      const solid = this.color(fill.color ?? 'transparent', node.id);
      return solid ? { ...solid, opacity: (solid.opacity ?? 1) * (fill.opacity ?? 1) } : undefined;
    }
    const stops: ColorStop[] = [];
    for (const stop of fill.stops ?? []) {
      const color = parseNativeColor(stop.color);
      if (!color) {
        this.warn('native-gradient-color', 'A gradient has an unsupported stop color; the gradient was omitted.', node.id);
        return undefined;
      }
      stops.push({ position: stop.position, color });
    }
    if (stops.length < 2) {
      this.warn('native-gradient-stops', 'A gradient needs at least two valid stops; the gradient was omitted.', node.id);
      return undefined;
    }
    stops.sort((a, b) => a.position - b.position);
    const angle = ((fill.angle ?? 180) - 90) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.warn('native-gradient-geometry', 'Gradient stops remain editable; CSS gradient sizing is approximated by the Figma gradient geometry.', node.id);
    return {
      type: fill.gradientType === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
      gradientStops: stops,
      gradientTransform: fill.gradientType === 'radial'
        ? [[1, 0, 0.5 - (fill.cx ?? 0.5)], [0, 1, 0.5 - (fill.cy ?? 0.5)]]
        : [[cos, sin, 0.5 - (cos + sin) / 2], [-sin, cos, 0.5 + (sin - cos) / 2]],
      opacity: fill.opacity ?? 1,
    };
  }

  apply(target: FrameNode | RectangleNode | TextNode, node: Node): void {
    const fills: Paint[] = [];
    for (const fill of node.style.fills) {
      const paint = this.fill(fill, node);
      if (paint) fills.push(paint);
    }
    if (node.type === 'image') {
      const image = this.image(node.assetRef, node);
      if (image) fills.push(image);
    }
    target.fills = fills;
    target.opacity = node.style.opacity;
    const strokes = node.style.strokes;
    const uniform = strokes.filter((stroke) => !stroke.side || stroke.side === 'all');
    if (uniform.length) {
      const first = uniform[0];
      const paint = this.color(first.color, node.id);
      target.strokes = paint ? [paint] : [];
      target.strokeWeight = first.width;
      target.strokeAlign = 'INSIDE';
      if (first.style === 'dashed') target.dashPattern = [first.width * 3, first.width * 3];
      if (first.style === 'dotted') target.dashPattern = [first.width, first.width];
      if (uniform.length > 1) this.warn('native-multiple-strokes', 'Only the first all-sided border is reproduced.', node.id);
      if (first.offset) this.warn('native-stroke-offset', 'Border/outline offset is not reproduced.', node.id);
    } else target.strokes = [];
    const sides = strokes.filter((stroke) => stroke.side && stroke.side !== 'all');
    if (sides.length) {
      if (target.type !== 'TEXT' && strokes.every((stroke) => stroke.color === strokes[0].color && (!stroke.style || stroke.style === 'solid') && !stroke.offset)) {
        const paint = this.color(strokes[0].color, node.id);
        target.strokes = paint ? [paint] : [];
        target.strokeAlign = 'INSIDE';
        const all = uniform[0]?.width ?? 0;
        target.strokeTopWeight = sides.find((stroke) => stroke.side === 'top')?.width ?? all;
        target.strokeRightWeight = sides.find((stroke) => stroke.side === 'right')?.width ?? all;
        target.strokeBottomWeight = sides.find((stroke) => stroke.side === 'bottom')?.width ?? all;
        target.strokeLeftWeight = sides.find((stroke) => stroke.side === 'left')?.width ?? all;
      } else this.warn('native-sided-border', 'Side borders with different colors, patterns or offsets are not reproduced; only an all-sided border, if present, is kept.', node.id);
    }
    if (target.type !== 'TEXT') {
      const radius = node.style.radius;
      target.topLeftRadius = radius.topLeft;
      target.topRightRadius = radius.topRight;
      target.bottomRightRadius = radius.bottomRight;
      target.bottomLeftRadius = radius.bottomLeft;
    }
    const effects: Effect[] = [];
    for (const shadow of node.style.shadows) {
      const color = parseNativeColor(shadow.color);
      if (!color) {
        this.warn('native-shadow-color', 'A shadow color is unsupported; the shadow was omitted.', node.id);
        continue;
      }
      effects.push({ type: shadow.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color, offset: { x: shadow.x, y: shadow.y }, radius: shadow.blur / 2, spread: shadow.spread ?? 0, visible: true, blendMode: 'NORMAL' });
    }
    target.effects = effects;
  }
}
