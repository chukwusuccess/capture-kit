import JSZip from "jszip";
import type { Capture, CaptureNode, Rgba } from "@capture-kit/model";

/**
 * model -> .sketch (open sketch-file-format, zip with JSON entries).
 *
 * Known simplifications (Phase 0):
 * - One page, one artboard sized to the capture frame.
 * - frame/rect nodes -> rectangle layers; text nodes -> text layers; image
 *   nodes -> gray placeholder rectangles (embedded bitmaps are Phase 2).
 * - Only the first solid fill is written; strokes are dropped; shadows are
 *   dropped (TODO(phase-2): fills beyond the first, strokes, shadows).
 * - Frames with fills render as rectangles too (no group-with-background).
 * - Fonts are mapped by family name only (no font asset embedding).
 * - No overflow/scroll, no nested artboards, no layer styles/symbols.
 */
export async function modelToSketch(capture: Capture): Promise<Blob> {
  const zip = new JSZip();
  const pageId = uid();
  const artboardId = uid();

  const layers = capture.nodes
    .map((node, i) => toSketchLayer(node, i, capture))
    .filter((l): l is Record<string, unknown> => l !== undefined);

  const page = {
    _class: "page",
    do_objectID: pageId,
    booleanOperation: -1,
    clippingMaskMode: 0,
    hasClickThrough: true,
    hasClippingMask: false,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    name: "Page 1",
    shouldBreakMaskChain: false,
    exportOptions: exportOptions(),
    frame: rect(0, 0, 0, 0),
    layers: [
      {
        _class: "artboard",
        do_objectID: artboardId,
        booleanOperation: -1,
        clippingMaskMode: 0,
        hasBackgroundColor: true,
        hasClickThrough: false,
        hasClippingMask: false,
        includeInCloudUpload: true,
        isFixedToViewport: false,
        isFlippedHorizontal: false,
        isFlippedVertical: false,
        isLocked: false,
        name: "Capture",
        shouldBreakMaskChain: false,
        backgroundColor: color({ r: 255, g: 255, b: 255, a: 1 }),
        exportOptions: exportOptions(),
        frame: rect(0, 0, capture.frame.width, capture.frame.height),
        hasBigClip: false,
        isOverflowing: false,
        resizesContent: false,
        resizeToFitLayoutMargins: false,
        presetDictionary: {},
        layers,
        style: emptyStyle(),
      },
    ],
    style: emptyStyle(),
  };

  const documentJson = {
    _class: "document",
    do_objectID: uid(),
    assets: {
      _class: "assetCollection",
      do_objectID: uid(),
      imageCollection: { _class: "imageCollection", images: {} },
      images: [],
    },
    colorSpace: 0,
    currentPageIndex: 0,
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    foreignSwatches: [],
    layerStyles: { _class: "sharedStyleContainer", objects: [] },
    layerSymbols: { _class: "symbolContainer", objects: [] },
    layerTextStyles: { _class: "sharedTextStyleContainer", objects: [] },
    perDocumentLibraries: [],
    pages: [{ _class: "MSJSONFileReference", _ref_class: "MSImmutablePage", _ref: "pages/page-1" }],
  };

  const metaJson = {
    commit: "0000000000000000000000000000000000000000",
    pagesAndArtboards: {
      [pageId]: { name: "Page 1", artboards: { [artboardId]: { name: "Capture" } } },
    },
    version: 136,
    compatibilityVersion: 99,
    app: "com.bohemiancoding.sketch3",
    autosaved: 0,
    variant: "NONAPPSTORE",
    created: {
      commit: "0000000000000000000000000000000000000000",
      appVersion: "99.1",
      build: 1,
      app: "com.bohemiancoding.sketch3",
      compatibilityVersion: 99,
      version: 136,
      variant: "NONAPPSTORE",
    },
    saveHistory: ["NONAPPSTORE.136"],
    appVersion: "99.1",
    build: 1,
  };

  const userJson = {};

  zip.file("document.json", JSON.stringify(documentJson));
  zip.file("meta.json", JSON.stringify(metaJson));
  zip.file("user.json", JSON.stringify(userJson));
  zip.file("pages/page-1.json", JSON.stringify(page));

  return zip.generateAsync({ type: "blob" });
}

function toSketchLayer(
  node: CaptureNode,
  index: number,
  capture: Capture,
): Record<string, unknown> | undefined {
  const base = {
    do_objectID: uid(),
    booleanOperation: -1,
    clippingMaskMode: 0,
    exportOptions: exportOptions(),
    frame: rect(node.box.x, node.box.y, node.box.w, node.box.h),
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    name: `${node.type}-${index}`,
    shouldBreakMaskChain: false,
    hasClippingMask: false,
    layerIndex: index,
    style: layerStyle(node, capture),
  };

  if (node.type === "text") {
    const text = node.text;
    if (!text) return undefined;
    const fontName = text.fontFamily || "Helvetica";
    return {
      ...base,
      _class: "text",
      automaticallyDrawOnUnderlyingPath: false,
      dontSynchroniseWithSymbol: false,
      glyphBounds: `{{${node.box.x}, ${node.box.y}}, {${node.box.w}, ${node.box.h}}}`,
      lineSpacing: 0,
      textBehaviour: 0, // auto width/height; Sketch recomputes on open
      attributedString: {
        _class: "attributedString",
        string: text.content,
        attributes: [
          {
            _class: "stringAttribute",
            location: 0,
            length: text.content.length,
            attributes: {
              MSAttributedStringFontAttribute: {
                _class: "fontDescriptor",
                attributes: { name: fontName, size: text.fontSize },
              },
              MSAttributedStringColorAttribute: color(text.color),
              textStyleVerticalAlignmentKey: 0,
            },
          },
        ],
      },
    };
  }

  if (node.type === "image") {
    // TODO(phase-2): embed bitmap assets in document.json assets + image fill (fillType 4).
    // Placeholder rect for now so positions survive.
    return {
      ...base,
      _class: "rectangle",
      fixedRadius: 0,
      pointRadiuses: { _class: "pointRadiuses", topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    };
  }

  // frame (with fill) and rect -> rectangle
  const radius = node.style.radius;
  const uniform =
    radius.topLeft === radius.topRight && radius.topRight === radius.bottomRight && radius.bottomRight === radius.bottomLeft;
  return {
    ...base,
    _class: "rectangle",
    fixedRadius: uniform ? radius.topLeft : 0,
    pointRadiuses: {
      _class: "pointRadiuses",
      topLeft: radius.topLeft,
      topRight: radius.topRight,
      bottomRight: radius.bottomRight,
      bottomLeft: radius.bottomLeft,
    },
  };
}

function layerStyle(node: CaptureNode, capture: Capture): Record<string, unknown> {
  const fills: Record<string, unknown>[] = [];
  const firstSolid = node.style.fills.find((f) => f.type === "solid");
  if (firstSolid && firstSolid.type === "solid") {
    fills.push(styleFill(color(firstSolid.color)));
  } else if (node.type === "image" || node.type === "frame") {
    // Placeholder gray for images / unfilled frames still get a faint fill? No —
    // only images get the placeholder fill so empty frames stay transparent.
    if (node.type === "image") fills.push(styleFill(color({ r: 220, g: 220, b: 220, a: 1 })));
  }
  void capture;
  return {
    ...emptyStyle(),
    fills,
    contextSettings: {
      _class: "graphicsContextSettings",
      blendMode: 0,
      opacity: node.style.opacity,
    },
  };
}

function emptyStyle(): Record<string, unknown> {
  return {
    _class: "style",
    endDecorationType: 0,
    miterLimit: 10,
    startDecorationType: 0,
    windingRule: 1,
    blur: { _class: "blur", isEnabled: false, center: "{0.5, 0.5}", motionAngle: 180, radius: 10, saturation: 1, type: 0 },
    borders: [],
    colorControls: { _class: "colorControls", hue: 0, saturation: 1, brightness: 1 },
    contextSettings: { _class: "graphicsContextSettings", blendMode: 0, opacity: 1 },
    fills: [],
    shadows: [],
  };
}

function styleFill(c: Record<string, unknown>): Record<string, unknown> {
  return {
    _class: "styleFill",
    isEnabled: true,
    fillType: 0, // color
    color: c,
    noiseIndex: 0,
    noiseIntensity: 0,
    patternFillType: 1,
    patternTileScale: 1,
  };
}

function exportOptions(): Record<string, unknown> {
  return { _class: "exportOptions", exportFormats: [], includedLayerIds: [], layerOptions: 0, shouldTrim: false };
}

function rect(x: number, y: number, width: number, height: number): Record<string, unknown> {
  return { _class: "rect", constrainProportions: false, x, y, width, height };
}

function color(c: Rgba): Record<string, unknown> {
  return {
    _class: "color",
    alpha: c.a,
    blue: c.b / 255,
    green: c.g / 255,
    red: c.r / 255,
  };
}

let uidCounter = 0;
/** Sketch object IDs are 24-char uppercase hex; ours are deterministic per session. */
function uid(): string {
  return (uidCounter++).toString(16).toUpperCase().padStart(24, "0");
}
