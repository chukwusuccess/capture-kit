/**
 * Sketch destination writer.
 *
 * Current fidelity features:
 * - Solid fills and background colors.
 * - Embedded image assets and native bitmap layers (_class: "bitmap").
 * - Pattern image fills on shape layers.
 * - Multiple stacked fills.
 * - Hierarchical group layers (_class: "group") reconstructed from parentId with relative frames.
 * - Stroke conversion: border width, stroke color, border styles (solid, dashed, dotted).
 * - Outer and inner box shadows (blur, offset, spread, color).
 * - Text layers with attributedString, color, and font metrics.
 * - Corner radii on rectangle layers.
 * - Editable SVG shape paths, compound contours, and viewBox meet-fit scaling.
 *   All SVG path commands are normalized to cubic Sketch geometry; elliptic
 *   arcs use cubic segments spanning at most 90 degrees. Invalid paths reject
 *   export with the node/path identity instead of silently producing placeholders.
 */

import JSZip from 'jszip';
import type { Capture, CornerRadius, Fill, Node, Shadow, Stroke } from '@capture-kit/model';
import { parseVectorPath, sketchContourPoints } from './vector-path.js';

interface SketchColor {
  _class: 'color';
  alpha: number;
  blue: number;
  green: number;
  red: number;
}

function parseCssColor(colorStr: string): SketchColor {
  const normalized = colorStr.trim().toLowerCase();

  if (normalized === 'transparent') {
    return { _class: 'color', red: 0, green: 0, blue: 0, alpha: 0 };
  }

  // Handle #rgb, #rgba, #rrggbb, #rrggbbaa
  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return { _class: 'color', red: r, green: g, blue: b, alpha: a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { _class: 'color', red: r, green: g, blue: b, alpha: a };
    }
  }

  // Handle rgb(...) and rgba(...)
  const rgbMatch = normalized.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]) / 255;
    const g = parseFloat(rgbMatch[2]) / 255;
    const b = parseFloat(rgbMatch[3]) / 255;
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    return {
      _class: 'color',
      red: Math.max(0, Math.min(1, r)),
      green: Math.max(0, Math.min(1, g)),
      blue: Math.max(0, Math.min(1, b)),
      alpha: Math.max(0, Math.min(1, a)),
    };
  }

  // Fallback black
  return { _class: 'color', red: 0, green: 0, blue: 0, alpha: 1 };
}

function makeRectPoints(r: CornerRadius | number, maxR = Infinity) {
  const tl = typeof r === 'number' ? Math.min(r, maxR) : Math.min(r.topLeft, maxR);
  const tr = typeof r === 'number' ? Math.min(r, maxR) : Math.min(r.topRight, maxR);
  const br = typeof r === 'number' ? Math.min(r, maxR) : Math.min(r.bottomRight, maxR);
  const bl = typeof r === 'number' ? Math.min(r, maxR) : Math.min(r.bottomLeft, maxR);
  return [
    { _class: 'curvePoint', cornerRadius: tl, curveFrom: '{0, 0}', curveMode: 1, curveTo: '{0, 0}', hasCurveFrom: false, hasCurveTo: false, point: '{0, 0}' },
    { _class: 'curvePoint', cornerRadius: tr, curveFrom: '{1, 0}', curveMode: 1, curveTo: '{1, 0}', hasCurveFrom: false, hasCurveTo: false, point: '{1, 0}' },
    { _class: 'curvePoint', cornerRadius: br, curveFrom: '{1, 1}', curveMode: 1, curveTo: '{1, 1}', hasCurveFrom: false, hasCurveTo: false, point: '{1, 1}' },
    { _class: 'curvePoint', cornerRadius: bl, curveFrom: '{0, 1}', curveMode: 1, curveTo: '{0, 1}', hasCurveFrom: false, hasCurveTo: false, point: '{0, 1}' },
  ];
}

function convertStrokes(strokes: Stroke[]): {
  borders: Array<Record<string, unknown>>;
  borderOptions?: Record<string, unknown>;
} {
  const borders: Array<Record<string, unknown>> = [];
  let dashPattern: number[] = [];

  for (const stroke of strokes) {
    if (stroke.width <= 0) continue;
    if (stroke.side && stroke.side !== 'all') continue;
    borders.push({
      _class: 'border',
      isEnabled: true,
      fillType: 0,
      color: parseCssColor(stroke.color),
      position: 1, // inside (matches CSS border-box)
      thickness: stroke.width,
    });

    if (stroke.style === 'dashed') {
      dashPattern = [stroke.width * 3, stroke.width * 2];
    } else if (stroke.style === 'dotted') {
      dashPattern = [stroke.width, stroke.width * 1.5];
    }
  }

  const borderOptions =
    borders.length > 0
      ? {
          _class: 'borderOptions',
          isEnabled: true,
          dashPattern,
          lineCapStyle: 0,
          lineJoinStyle: 0,
        }
      : undefined;

  return { borders, borderOptions };
}

function convertShadows(shadows: Shadow[]): {
  outerShadows: Array<Record<string, unknown>>;
  innerShadows: Array<Record<string, unknown>>;
} {
  const outerShadows: Array<Record<string, unknown>> = [];
  const innerShadows: Array<Record<string, unknown>> = [];

  for (const shadow of shadows) {
    const isInner = Boolean(shadow.inset);
    const shadowObj = {
      _class: isInner ? 'innerShadow' : 'shadow',
      isEnabled: true,
      blurRadius: shadow.blur,
      color: parseCssColor(shadow.color),
      contextSettings: {
        _class: 'graphicsContextSettings',
        blendMode: 0,
        opacity: 1,
      },
      offsetX: shadow.x,
      offsetY: shadow.y,
      spread: shadow.spread ?? 0,
    };

    if (isInner) {
      innerShadows.push(shadowObj);
    } else {
      outerShadows.push(shadowObj);
    }
  }

  return { outerShadows, innerShadows };
}
function convertFills(
  fills: Fill[],
  assets: Capture['assets']
): Array<Record<string, unknown>> {
  const fillList: Array<Record<string, unknown>> = [];

  for (const fill of fills) {
    if (fill.type === 'image' && fill.assetRef && assets[fill.assetRef]) {
      fillList.push({
        _class: 'fill',
        isEnabled: true,
        fillType: 4, // pattern / image fill
        image: {
          _class: 'MSJSONFileReference',
          _ref_class: 'MSImageData',
          _ref: `images/${fill.assetRef}.png`,
        },
        patternFillType: 1, // fill / stretch
        patternTileScale: 1,
        noiseIntensity: 0,
        noiseIndex: 0,
        contextSettings: {
          _class: 'graphicsContextSettings',
          blendMode: 0,
          opacity: fill.opacity ?? 1,
        },
      });
    } else if (fill.type === 'solid' && fill.color) {
      const parsed = parseCssColor(fill.color);
      fillList.push({
        _class: 'fill',
        isEnabled: true,
        fillType: 0, // solid color
        color: {
          _class: 'color',
          red: parsed.red,
          green: parsed.green,
          blue: parsed.blue,
          alpha: (fill.opacity ?? 1) * parsed.alpha,
        },
        contextSettings: {
          _class: 'graphicsContextSettings',
          blendMode: 0,
          opacity: fill.opacity ?? 1,
        },
      });
    } else if (fill.type === 'gradient' && fill.stops && fill.stops.length > 0) {
      const angleRad = (((fill.angle ?? 180) - 90) * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const fromX = Number((0.5 - cos * 0.5).toFixed(3));
      const fromY = Number((0.5 - sin * 0.5).toFixed(3));
      const toX = Number((0.5 + cos * 0.5).toFixed(3));
      const toY = Number((0.5 + sin * 0.5).toFixed(3));

      const gradientStops = fill.stops.map((s) => ({
        _class: 'gradientStop',
        position: s.position,
        color: parseCssColor(s.color),
      }));

      fillList.push({
        _class: 'fill',
        isEnabled: true,
        fillType: 1, // 1 = gradient
        gradient: {
          _class: 'gradient',
          elipseLength: 0,
          from: `{${fromX}, ${fromY}}`,
          to: `{${toX}, ${toY}}`,
          gradientType: fill.gradientType === 'radial' ? 1 : 0,
          stops: gradientStops,
        },
        contextSettings: {
          _class: 'graphicsContextSettings',
          blendMode: 0,
          opacity: fill.opacity ?? 1,
        },
      });
    }
  }

  return fillList;
}

function edgeLineLayers(node: Node, offsetX: number, offsetY: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const b = node.box;
  for (const s of node.style.strokes ?? []) {
    if (!s.side || s.side === 'all' || s.width <= 0) continue;
    const w = s.width;
    const frame =
      s.side === 'top'
        ? { x: b.x - offsetX, y: b.y - offsetY, width: b.w, height: w }
        : s.side === 'bottom'
        ? { x: b.x - offsetX, y: b.y + b.h - w - offsetY, width: b.w, height: w }
        : s.side === 'left'
        ? { x: b.x - offsetX, y: b.y - offsetY, width: w, height: b.h }
        : { x: b.x + b.w - w - offsetX, y: b.y - offsetY, width: w, height: b.h };
    out.push({
      _class: 'rectangle',
      do_objectID: `${node.id}-edge-${s.side}`,
      booleanOperation: -1,
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: false,
      isVisible: true,
      layerListExpandedType: 0,
      name: `Border ${s.side} ${node.name || node.id}`,
      nameIsFixed: false,
      resizingConstraint: 63,
      resizingType: 0,
      rotation: 0,
      shouldBreakMaskChain: false,
      hasClippingMask: false,
      clippingMaskMode: 0,
      isTemplate: false,
      frame: { _class: 'rect', constrainProportions: false, ...frame },
      style: {
        _class: 'style',
        endMarkerType: 0,
        miterLimit: 10,
        startMarkerType: 0,
        windingRule: 1,
        fills: [{ _class: 'fill', isEnabled: true, fillType: 0, color: parseCssColor(s.color), contextSettings: { _class: 'graphicsContextSettings', blendMode: 0, opacity: 1 } }],
        borders: [],
        shadows: [],
        innerShadows: [],
      },
      edited: false,
      isClosed: true,
      pointRadiusBehaviour: 1,
      points: makeRectPoints(0),
      fixedRadius: 0,
      needsConvertionToNewRoundCorners: false,
    });
  }
  return out;
}

function convertVectorLayer(
  node: Node,
  assets: Capture['assets'],
  frame: Record<string, unknown>
): Record<string, unknown> {
  const vb = node.vectorViewBox;
  const scale = vb ? Math.min(node.box.w / vb.width, node.box.h / vb.height) : 1;
  const dx = vb ? (node.box.w - vb.width * scale) / 2 : 0;
  const dy = vb ? (node.box.h - vb.height * scale) / 2 : 0;
  const base = {
    booleanOperation: -1, isFixedToViewport: false,
    isFlippedHorizontal: false, isFlippedVertical: false, isLocked: false,
    isVisible: true, layerListExpandedType: 0, nameIsFixed: false,
    resizingConstraint: 63, resizingType: 0, rotation: 0,
    shouldBreakMaskChain: false, hasClippingMask: false,
    clippingMaskMode: 0, isTemplate: false,
  };
  const localFrame = {
    _class: 'rect', constrainProportions: false,
    x: 0, y: 0, width: node.box.w, height: node.box.h,
  };
  const emptyStyle = {
    _class: 'style', endMarkerType: 0, miterLimit: 10, startMarkerType: 0,
    windingRule: 0, fills: [], borders: [], shadows: [], innerShadows: [],
  };
  const layers = node.vectorPaths!.map((path, index) => {
    try {
      const contours = parseVectorPath(path.d);
      const fill = path.fill ?? '#000000';
      const fills: Fill[] = fill === 'none' ? [] : [{ type: 'solid', color: fill }];
      const strokeWidth = (path.strokeWidth ?? 1) * scale;
      const strokes: Stroke[] = path.stroke && path.stroke !== 'none' && strokeWidth > 0
        ? [{ color: path.stroke, width: strokeWidth, style: 'solid' }] : [];
      const { borders, borderOptions } = convertStrokes(strokes);
      // SVG strokes straddle the path, unlike CSS borders.
      for (const border of borders) border.position = 0;
      return {
        ...base, _class: 'shapeGroup', do_objectID: `${node.id}-path-${index + 1}`,
        name: `Path ${index + 1}`, frame: localFrame, windingRule: 0,
        hasClickThrough: false, groupLayout: { _class: 'MSImmutableFreeformGroupLayout' },
        style: {
          ...emptyStyle, fills: convertFills(fills, assets), borders,
          ...(borderOptions ? { borderOptions } : {}),
        },
        layers: contours.map((contour, contourIndex) => ({
          ...base, _class: 'shapePath',
          do_objectID: `${node.id}-path-${index + 1}-contour-${contourIndex + 1}`,
          name: `Contour ${contourIndex + 1}`, frame: localFrame,
          style: emptyStyle, edited: true, isClosed: contour.closed,
          pointRadiusBehaviour: 1,
          points: sketchContourPoints(contour, node.box.w, node.box.h, scale, dx, dy),
        })),
      };
    } catch (error) {
      throw new Error(`Cannot export Sketch vector ${node.id}, path ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const { outerShadows, innerShadows } = convertShadows(node.style.shadows ?? []);
  return {
    ...base, _class: 'group', do_objectID: node.id,
    name: node.name || `Vector ${node.id}`, frame,
    hasClickThrough: false, groupLayout: { _class: 'MSImmutableFreeformGroupLayout' },
    style: {
      ...emptyStyle, shadows: outerShadows, innerShadows,
      contextSettings: { _class: 'graphicsContextSettings', blendMode: 0, opacity: node.style.opacity ?? 1 },
    },
    layers,
  };
}

function convertNodeToSketchLayer(
  node: Node,
  assets: Capture['assets'],
  offsetX = 0,
  offsetY = 0
): Record<string, unknown> {
  const commonFrame = {
    _class: 'rect',
    constrainProportions: false,
    x: node.box.x - offsetX,
    y: node.box.y - offsetY,
    width: node.box.w,
    height: node.box.h,
  };

  const { borders, borderOptions } = convertStrokes(node.style.strokes ?? []);
  const { outerShadows, innerShadows } = convertShadows(node.style.shadows ?? []);

  const blurMatch = node.style.backdropFilter?.match(/blur\(([\d.]+)px\)/);
  const blur = blurMatch ? { _class: 'blur', isEnabled: true, radius: parseFloat(blurMatch[1]), type: 1 } : undefined;
  if (node.type === 'text') {
    const textProps = node.text ?? {
      content: '',
      fontFamily: 'Helvetica',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      align: 'left',
      color: 'rgba(0, 0, 0, 1)',
    };

    const textColor = parseCssColor(textProps.color);
    const content = textProps.content;

    return {
      _class: 'text',
      do_objectID: node.id,
      booleanOperation: -1,
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: false,
      isVisible: true,
      layerListExpandedType: 0,
      name: node.name || content.slice(0, 32) || `Text ${node.id}`,
      nameIsFixed: false,
      resizingConstraint: 63,
      resizingType: 0,
      rotation: 0,
      shouldBreakMaskChain: false,
      hasClippingMask: false,
      clippingMaskMode: 0,
      isTemplate: false,
      frame: commonFrame,
      style: {
        _class: 'style',
        endMarkerType: 0,
        miterLimit: 10,
        startMarkerType: 0,
        windingRule: 1,
        borders,
        ...(borderOptions ? { borderOptions } : {}),
        shadows: outerShadows,
        innerShadows,
        textStyle: {
          _class: 'textStyle',
          encodedAttributes: {
            MSAttributedStringFontAttribute: {
              _class: 'fontDescriptor',
              attributes: {
                name: textProps.fontFamily,
                size: textProps.fontSize,
              },
            },
            MSAttributedStringColorAttribute: textColor,
          },
        },
      },
      attributedString: {
        _class: 'attributedString',
        string: content,
        attributes:
          textProps.runs && textProps.runs.length > 0
            ? (() => {
                const attrs: Array<Record<string, unknown>> = [];
                let loc = 0;
                for (const r of textProps.runs) {
                  const rColor = r.color ? parseCssColor(r.color) : textColor;
                  attrs.push({
                    _class: 'stringAttribute',
                    location: loc,
                    length: r.text.length,
                    attributes: {
                      MSAttributedStringFontAttribute: {
                        _class: 'fontDescriptor',
                        attributes: {
                          name: r.fontFamily || textProps.fontFamily,
                          size: r.fontSize || textProps.fontSize,
                        },
                      },
                      MSAttributedStringColorAttribute: rColor,
                    },
                  });
                  loc += r.text.length;
                }
                return attrs;
              })()
            : [
                {
                  _class: 'stringAttribute',
                  location: 0,
                  length: content.length,
                  attributes: {
                    MSAttributedStringFontAttribute: {
                      _class: 'fontDescriptor',
                      attributes: {
                        name: textProps.fontFamily,
                        size: textProps.fontSize,
                      },
                    },
                    MSAttributedStringColorAttribute: textColor,
                  },
                },
              ],
      },
      automaticallyDrawOnUnderlyingPath: false,
      dontSynchroniseWithSymbol: false,
      lineSpacingBehaviour: 2,
      textBehaviour: 1,
    };
  }

  if (node.type === 'vector' && node.vectorPaths && node.vectorPaths.length > 0) {
    return convertVectorLayer(node, assets, commonFrame);
  }

  // Handle image and vector types: bitmap layer if asset is present
  if (node.type === 'image' || node.type === 'vector') {
    if (node.assetRef && assets[node.assetRef]) {
      return {
        _class: 'bitmap',
        do_objectID: node.id,
        booleanOperation: -1,
        isFixedToViewport: false,
        isFlippedHorizontal: false,
        isFlippedVertical: false,
        isLocked: false,
        isVisible: true,
        layerListExpandedType: 0,
        name: node.name || (node.type === 'vector' ? `Vector ${node.id}` : `Image ${node.id}`),
        nameIsFixed: false,
        resizingConstraint: 63,
        resizingType: 0,
        rotation: 0,
        shouldBreakMaskChain: false,
        hasClippingMask: false,
        clippingMaskMode: 0,
        isTemplate: false,
        frame: commonFrame,
        style: {
          _class: 'style',
          endMarkerType: 0,
          miterLimit: 10,
          startMarkerType: 0,
          windingRule: 1,
          fills: [],
          borders,
          ...(borderOptions ? { borderOptions } : {}),
          shadows: outerShadows,
          innerShadows,
        },
        image: {
          _class: 'MSJSONFileReference',
          _ref_class: 'MSImageData',
          _ref: `images/${node.assetRef}.png`,
        },
        clippingMask: '{{0, 0}, {1, 1}}',
        fillReplacesImage: false,
      };
    }

    // Fallback placeholder rect if asset is absent
    return {
      _class: 'rectangle',
      do_objectID: node.id,
      booleanOperation: -1,
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: false,
      isVisible: true,
      layerListExpandedType: 0,
      name: `Image ${node.id}`,
      nameIsFixed: false,
      resizingConstraint: 63,
      resizingType: 0,
      rotation: 0,
      shouldBreakMaskChain: false,
      hasClippingMask: false,
      clippingMaskMode: 0,
      isTemplate: false,
      frame: commonFrame,
      style: {
        _class: 'style',
        endMarkerType: 0,
        miterLimit: 10,
        startMarkerType: 0,
        windingRule: 1,
        fills: [
          {
            _class: 'fill',
            isEnabled: true,
            fillType: 0,
            color: {
              _class: 'color',
              red: 0.82,
              green: 0.82,
              blue: 0.82,
              alpha: 1,
            },
          },
        ],
        borders,
        ...(borderOptions ? { borderOptions } : {}),
        shadows: outerShadows,
        innerShadows,
      },
      edited: false,
      isClosed: true,
      pointRadiusBehaviour: 1,
      points: makeRectPoints(node.style.radius ?? 0, Math.min(node.box.w / 2, node.box.h / 2)),
      fixedRadius: node.style.radius?.topLeft ?? 0,
      needsConvertionToNewRoundCorners: false,
    };
  }

  // Handle frame and rect
  const fillList = convertFills(node.style.fills ?? [], assets);

  const rawRadius = node.style.radius?.topLeft ?? 0;
  const radius = Math.min(rawRadius, node.box.w / 2, node.box.h / 2);

  return {
    _class: 'rectangle',
    do_objectID: node.id,
    booleanOperation: -1,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    name: node.name || `${node.type} ${node.id}`,
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    hasClippingMask: false,
    clippingMaskMode: 0,
    isTemplate: false,
    frame: commonFrame,
    style: {
      _class: 'style',
      endMarkerType: 0,
      miterLimit: 10,
      startMarkerType: 0,
      windingRule: 1,
      fills: fillList,
      borders,
      ...(borderOptions ? { borderOptions } : {}),
      shadows: outerShadows,
      innerShadows,
        ...(blur ? { blur } : {}),
    },
    edited: false,
    isClosed: true,
    pointRadiusBehaviour: 1,
    points: makeRectPoints(node.style.radius ?? 0, Math.min(node.box.w / 2, node.box.h / 2)),
    fixedRadius: node.style.radius?.topLeft ?? 0,
    needsConvertionToNewRoundCorners: false,
  };
}
function buildSketchLayerTree(
  nodes: Node[],
  assets: Capture['assets']
): Array<Record<string, unknown>> {
  const nodeMap = new Map<string, Node>();
  const childrenMap = new Map<string, Node[]>();
  const rootNodes: Node[] = [];

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    } else {
      rootNodes.push(node);
    }
  }

  function processNode(
    node: Node,
    parentOffsetX: number,
    parentOffsetY: number
  ): Array<Record<string, unknown>> {
    const children = childrenMap.get(node.id);

    // Leaf node: render standard Sketch layer plus per-edge border lines
    if (!children || children.length === 0) {
      return [convertNodeToSketchLayer(node, assets, parentOffsetX, parentOffsetY), ...edgeLineLayers(node, parentOffsetX, parentOffsetY)];
    }

    // Node with children: emit Sketch group layer
    const groupFrame = {
      _class: 'rect',
      constrainProportions: false,
      x: node.box.x - parentOffsetX,
      y: node.box.y - parentOffsetY,
      width: node.box.w,
      height: node.box.h,
    };

    const groupLayers: Array<Record<string, unknown>> = [];

    // If container node has styling, render background rectangle inside the group
    const hasVisuals =
      (node.style.fills && node.style.fills.length > 0) ||
      (node.style.strokes && node.style.strokes.length > 0) ||
      (node.style.shadows && node.style.shadows.length > 0) ||
      (node.style.radius && node.style.radius.topLeft > 0);

    if (hasVisuals || node.style.clip) {
      const bgRectNode: Node = {
        ...node,
        id: `${node.id}-bg`,
        box: { x: node.box.x, y: node.box.y, w: node.box.w, h: node.box.h },
      };
      const bgLayer = convertNodeToSketchLayer(bgRectNode, assets, node.box.x, node.box.y);
      if (node.style.clip) {
        bgLayer.hasClippingMask = true;
        bgLayer.clippingMaskMode = 0;
      }
      groupLayers.push(bgLayer);
    }

    // Process children relative to container origin
    for (const child of children) {
      groupLayers.push(...processNode(child, node.box.x, node.box.y));
    }
    groupLayers.push(...edgeLineLayers(node, node.box.x, node.box.y));

    const groupLayout =
      node.style.layout && node.style.layout.mode !== 'none'
        ? {
            _class: 'MSImmutableInferredGroupLayout',
            axis: node.style.layout.mode === 'vertical' ? 1 : 0,
            layoutAnchor: 0,
          }
        : { _class: 'MSImmutableFreeformGroupLayout' };

    return [{
      _class: 'group',
      do_objectID: node.id,
      booleanOperation: -1,
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: false,
      isVisible: true,
      layerListExpandedType: 0,
      name: node.name || `Group ${node.id}`,
      nameIsFixed: false,
      resizingConstraint: 63,
      resizingType: 0,
      rotation: 0,
      shouldBreakMaskChain: false,
      hasClippingMask: false,
      clippingMaskMode: 0,
      isTemplate: false,
      frame: groupFrame,
      style: {
        _class: 'style',
        endMarkerType: 0,
        miterLimit: 10,
        startMarkerType: 0,
        windingRule: 1,
      },
      hasClickThrough: false,
      groupLayout,
      layers: groupLayers,
    }];
  }

  return rootNodes.flatMap((root) => processNode(root, 0, 0));
}


export async function modelToSketch(capture: Capture): Promise<Blob> {
  const zip = new JSZip();

  const pageId = 'page-1';
  const artboardId = 'artboard-1';

  // Embed assets into images/ and fonts/ folder
  for (const [key, asset] of Object.entries(capture.assets)) {
    if (asset.base64) {
      if (asset.kind === 'font') {
        const ext = asset.mimeType.includes('woff2')
          ? 'woff2'
          : asset.mimeType.includes('woff')
          ? 'woff'
          : asset.mimeType.includes('truetype') || asset.mimeType.includes('ttf')
          ? 'ttf'
          : 'otf';
        zip.file(`fonts/${key}.${ext}`, asset.base64, { base64: true });
      } else {
        zip.file(`images/${key}.png`, asset.base64, { base64: true });
      }
    }
  }

  // meta.json
  const metaJson = {
    commit: 'capture-kit-phase2',
    pagesAndArtboards: {
      [pageId]: {
        name: 'Page 1',
        artboards: {
          [artboardId]: {
            name: 'Artboard',
          },
        },
      },
    },
    version: 140,
    compatibilityVersion: 99,
    app: 'com.bohemiancoding.sketch3',
    autosaved: 0,
    variant: 'NONAPPSTORE',
    created: {
      commit: 'capture-kit',
      appVersion: '96',
      build: 167265,
      app: 'com.bohemiancoding.sketch3',
      compatibilityVersion: 99,
      version: 140,
    },
    saveHistory: ['NONAPPSTORE.167265'],
    appVersion: '96',
    build: 167265,
  };

  // user.json
  const userJson = {
    [pageId]: {
      scrollOrigin: '{0, 0}',
      zoomValue: 1,
    },
    document: {
      pageListCollapsed: 0,
      pageListHeightClosed: 0,
    },
  };

  // document.json
  const documentJson = {
    _class: 'document',
    do_objectID: 'document-root',
    assets: {
      _class: 'assetCollection',
      colorAssets: [],
      images: [],
      colors: [],
      gradients: [],
      exportPresets: [],
    },
    colorSpace: 0,
    currentPageIndex: 0,
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    layerStyles: {
      _class: 'sharedStyleContainer',
      objects: [],
    },
    layerSymbols: {
      _class: 'symbolContainer',
      objects: [],
    },
    layerTextStyles: {
      _class: 'sharedTextStyleContainer',
      objects: [],
    },
    pages: [
      {
        _class: 'MSJSONFileReference',
        _ref_class: 'MSImmutablePage',
        _ref: `pages/${pageId}`,
      },
    ],
  };

  // Build artboard and layers hierarchically
  const artboardLayers = buildSketchLayerTree(capture.nodes, capture.assets);

  const pageJson = {
    _class: 'page',
    do_objectID: pageId,
    booleanOperation: -1,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    name: 'Page 1',
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    hasClippingMask: false,
    clippingMaskMode: 0,
    isTemplate: false,
    style: {
      _class: 'style',
      endMarkerType: 0,
      miterLimit: 10,
      startMarkerType: 0,
      windingRule: 1,
    },
    frame: {
      _class: 'rect',
      constrainProportions: false,
      height: 0,
      width: 0,
      x: 0,
      y: 0,
    },
    layers: [
      {
        _class: 'artboard',
        do_objectID: artboardId,
        booleanOperation: -1,
        isFixedToViewport: false,
        isFlippedHorizontal: false,
        isFlippedVertical: false,
        isLocked: false,
        isVisible: true,
        layerListExpandedType: 0,
        name: 'Artboard',
        nameIsFixed: false,
        resizingConstraint: 63,
        resizingType: 0,
        rotation: 0,
        shouldBreakMaskChain: false,
        hasClippingMask: false,
        clippingMaskMode: 0,
        isTemplate: false,
        style: {
          _class: 'style',
          endMarkerType: 0,
          miterLimit: 10,
          startMarkerType: 0,
          windingRule: 1,
        },
        frame: {
          _class: 'rect',
          constrainProportions: false,
          height: capture.frame.height,
          width: capture.frame.width,
          x: 0,
          y: 0,
        },
        hasBackgroundColor: true,
        backgroundColor: {
          _class: 'color',
          alpha: 1,
          blue: 1,
          green: 1,
          red: 1,
        },
        layers: artboardLayers,
      },
    ],
  };

  zip.file('meta.json', JSON.stringify(metaJson, null, 2));
  zip.file('user.json', JSON.stringify(userJson, null, 2));
  zip.file('document.json', JSON.stringify(documentJson, null, 2));
  zip.file(`pages/${pageId}.json`, JSON.stringify(pageJson, null, 2));

  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new Blob([arrayBuffer], { type: 'application/zip' });
}
