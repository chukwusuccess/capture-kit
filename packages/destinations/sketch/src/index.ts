/**
 * Sketch destination writer.
 *
 * Current fidelity features:
 * - Solid fills and background colors.
 * - Embedded image assets and native bitmap layers (_class: "bitmap").
 * - Pattern image fills on shape layers.
 * - Stroke conversion: border width, stroke color, border styles (solid, dashed, dotted).
 * - Outer and inner box shadows (blur, offset, spread, color).
 * - Text layers with attributedString, color, and font metrics.
 * - Corner radii on rectangle layers.
 *
 * In-progress / Planned:
 * - Multiple stacked fills.
 * - Hierarchical group layers from parentId.
 */

import JSZip from 'jszip';
import type { Capture, Node, Shadow, Stroke } from '@capture-kit/model';

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

function makeRectPoints(radius: number) {
  return [
    {
      _class: 'curvePoint',
      cornerRadius: radius,
      curveFrom: '{0, 0}',
      curveMode: 1,
      curveTo: '{0, 0}',
      hasCurveFrom: false,
      hasCurveTo: false,
      point: '{0, 0}',
    },
    {
      _class: 'curvePoint',
      cornerRadius: radius,
      curveFrom: '{1, 0}',
      curveMode: 1,
      curveTo: '{1, 0}',
      hasCurveFrom: false,
      hasCurveTo: false,
      point: '{1, 0}',
    },
    {
      _class: 'curvePoint',
      cornerRadius: radius,
      curveFrom: '{1, 1}',
      curveMode: 1,
      curveTo: '{1, 1}',
      hasCurveFrom: false,
      hasCurveTo: false,
      point: '{1, 1}',
    },
    {
      _class: 'curvePoint',
      cornerRadius: radius,
      curveFrom: '{0, 1}',
      curveMode: 1,
      curveTo: '{0, 1}',
      hasCurveFrom: false,
      hasCurveTo: false,
      point: '{0, 1}',
    },
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

function convertNodeToSketchLayer(
  node: Node,
  assets: Capture['assets']
): Record<string, unknown> {
  const commonFrame = {
    _class: 'rect',
    constrainProportions: false,
    x: node.box.x,
    y: node.box.y,
    width: node.box.w,
    height: node.box.h,
  };

  const { borders, borderOptions } = convertStrokes(node.style.strokes ?? []);
  const { outerShadows, innerShadows } = convertShadows(node.style.shadows ?? []);

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
      name: content.slice(0, 32) || `Text ${node.id}`,
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
        attributes: [
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

  // Handle image type: native bitmap layer if asset is present
  if (node.type === 'image') {
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
      points: makeRectPoints(node.style.radius?.topLeft ?? 0),
      fixedRadius: node.style.radius?.topLeft ?? 0,
      needsConvertionToNewRoundCorners: false,
    };
  }

  // Handle frame and rect
  const firstSolid = node.style.fills.find((f) => f.type === 'solid' && f.color);
  const imageFill = node.style.fills.find((f) => f.type === 'image' && f.assetRef);
  const fillList: Array<Record<string, unknown>> = [];

  if (imageFill && imageFill.assetRef && assets[imageFill.assetRef]) {
    fillList.push({
      _class: 'fill',
      isEnabled: true,
      fillType: 4, // pattern / image fill
      image: {
        _class: 'MSJSONFileReference',
        _ref_class: 'MSImageData',
        _ref: `images/${imageFill.assetRef}.png`,
      },
      patternFillType: 1,
      patternTileScale: 1,
      noiseIntensity: 0,
      noiseIndex: 0,
    });
  } else if (firstSolid && firstSolid.color) {
    const parsed = parseCssColor(firstSolid.color);
    fillList.push({
      _class: 'fill',
      isEnabled: true,
      fillType: 0,
      color: {
        _class: 'color',
        red: parsed.red,
        green: parsed.green,
        blue: parsed.blue,
        alpha: (firstSolid.opacity ?? 1) * parsed.alpha,
      },
    });
  }

  const radius = node.style.radius?.topLeft ?? 0;

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
    name: `${node.type} ${node.id}`,
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
    },
    edited: false,
    isClosed: true,
    pointRadiusBehaviour: 1,
    points: makeRectPoints(radius),
    fixedRadius: radius,
    needsConvertionToNewRoundCorners: false,
  };
}

export async function modelToSketch(capture: Capture): Promise<Blob> {
  const zip = new JSZip();

  const pageId = 'page-1';
  const artboardId = 'artboard-1';

  // Embed assets into images/ folder
  for (const [key, asset] of Object.entries(capture.assets)) {
    if (asset.base64) {
      zip.file(`images/${key}.png`, asset.base64, { base64: true });
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

  // Build artboard and layers
  const artboardLayers = capture.nodes.map((node) =>
    convertNodeToSketchLayer(node, capture.assets)
  );

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
