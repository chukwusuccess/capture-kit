import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { emptyCapture, type Node } from '../../model/src/index.js';
import { modelToSketch } from './src/index.js';

interface Point {
  point: string;
  curveFrom: string;
  curveTo: string;
  hasCurveFrom: boolean;
  hasCurveTo: boolean;
}
interface Layer {
  _class: string;
  do_objectID: string;
  frame: { x: number; y: number; width: number; height: number };
  isClosed: boolean;
  points: Point[];
  layers: Layer[];
  windingRule: number;
  style: {
    windingRule: number;
    contextSettings: { opacity: number };
    fills: Array<{ color: { red: number; green: number; blue: number } }>;
    borders: Array<{ thickness: number; position: number; color: { red: number } }>;
  };
}
const style: Node['style'] = {
  fills: [], strokes: [], opacity: 0.7,
  radius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 }, shadows: [],
};
function vector(d: string, overrides: Partial<Node> = {}): Node {
  return {
    id: 'vector-proof', type: 'vector', box: { x: 30, y: 40, w: 200, h: 100 }, style,
    vectorViewBox: { width: 100, height: 100 },
    vectorPaths: [{ d, fill: '#123456', stroke: '#ff0000', strokeWidth: 2 }],
    ...overrides,
  };
}
async function exportLayers(nodes: Node[]): Promise<{ layers: Layer[]; zip: JSZip }> {
  const capture = emptyCapture({
    url: 'https://test.capture-kit.local', version: '0.1.1',
    frame: { width: 800, height: 600, baseURI: 'https://test.capture-kit.local/' }, nodes,
  });
  const blob = await modelToSketch(capture);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const page = JSON.parse(await zip.file('pages/page-1.json')!.async('text'));
  return { layers: page.layers[0].layers, zip };
}
function pair(value: string): number[] {
  return value.slice(1, -1).split(',').map(Number);
}
function near(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function pointNear(value: string, x: number, y: number): void {
  const actual = pair(value);
  near(actual[0], x); near(actual[1], y);
}
function contours(layer: Layer): Layer[] {
  if (layer._class === 'shapePath') return [layer];
  return layer.layers.flatMap(contours);
}

async function run(): Promise<void> {
  // Serializer path-bearing vectors have no assetRef: they must not become gray rectangles.
  const { layers, zip } = await exportLayers([vector('M0 0 L100 0 L100 100 Z')]);
  const root = layers[0];
  assert.equal(root.do_objectID, 'vector-proof');
  assert.deepEqual(root.frame, { _class: 'rect', constrainProportions: false, x: 30, y: 40, width: 200, height: 100 });
  const triangle = contours(root)[0];
  assert.equal(triangle._class, 'shapePath');
  assert.equal(triangle.isClosed, true);
  assert.equal(triangle.points.length, 3);
  // SVG xMidYMid meet: 100x100 viewBox is centered in the 200x100 box.
  pointNear(triangle.points[0].point, 0.25, 0);
  pointNear(triangle.points[1].point, 0.75, 0);
  pointNear(triangle.points[2].point, 0.75, 1);
  const paint = root.layers[0].style;
  near(paint.fills[0].color.red, 0x12 / 255);
  near(paint.fills[0].color.green, 0x34 / 255);
  near(paint.fills[0].color.blue, 0x56 / 255);
  assert.equal(paint.borders[0].position, 0, 'SVG strokes must be centered, not CSS inside borders');
  assert.equal(paint.borders[0].thickness, 2);
  assert.equal(paint.borders[0].color.red, 1);
  assert.equal(root.style.contextSettings.opacity, 0.7);
  assert.equal(zip.folder('images')!.file(/.*/).length, 0);

  const relative = contours((await exportLayers([vector('m10 20 20 0 h10 v20 l-10 10 H10 V20 z')])).layers[0])[0];
  assert.equal(relative.isClosed, true);
  assert.equal(relative.points.length, 6);
  pointNear(relative.points[0].point, 0.3, 0.2);
  pointNear(relative.points[4].point, 0.4, 0.5);
  // The explicitly repeated starting endpoint is merged on close, not duplicated.
  pointNear(relative.points[5].point, 0.3, 0.5);

  const open = contours((await exportLayers([vector('M1e1,+2e1L.5-.25 30 40')])).layers[0])[0];
  assert.equal(open.isClosed, false);
  assert.equal(open.points.length, 3);
  pointNear(open.points[1].point, 0.2525, -0.0025);

  const curves = contours((await exportLayers([vector('M0 0 C10 0 20 10 30 10 s20 10 30 0 Q70 0 80 10 t20 0')])).layers[0])[0];
  assert.equal(curves.points.length, 5);
  pointNear(curves.points[0].curveTo, 0.3, 0);
  assert.equal(curves.points[0].hasCurveTo, true);
  pointNear(curves.points[1].curveFrom, 0.35, 0.1);
  pointNear(curves.points[1].curveTo, 0.45, 0.1);
  pointNear(curves.points[2].curveFrom, 0.5, 0.2);
  pointNear(curves.points[2].curveTo, 0.25 + (60 + 20 / 3) / 200, 1 / 30);
  pointNear(curves.points[3].curveFrom, 0.25 + (80 - 20 / 3) / 200, 1 / 30);
  pointNear(curves.points[3].curveTo, 0.25 + (80 + 20 / 3) / 200, 1 / 6);

  const reset = contours((await exportLayers([vector('M0 0 q10 20 20 0 l10 0 t10 10 c0 10 10 10 10 0 h10 s10 0 20 10')])).layers[0])[0];
  pointNear(reset.points[2].curveTo, 0.4, 0);
  pointNear(reset.points[5].curveTo, 0.55, 0.1);

  const closedCurve = contours((await exportLayers([vector('M0 0 C10 0 20 20 0 0 Z')])).layers[0])[0];
  assert.equal(closedCurve.points.length, 1);
  assert.equal(closedCurve.points[0].hasCurveFrom, true);
  assert.equal(closedCurve.points[0].hasCurveTo, true);
  pointNear(closedCurve.points[0].curveFrom, 0.35, 0.2);

  const circle = contours((await exportLayers([vector('M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z')])).layers[0])[0];
  assert.equal(circle.isClosed, true);
  assert.equal(circle.points.length, 4);
  const k = 4 * Math.tan(Math.PI / 8) / 3;
  pointNear(circle.points[0].curveTo, 0.25, 0.5 + k / 2);
  pointNear(circle.points[1].point, 0.5, 1);
  pointNear(circle.points[3].point, 0.5, 0);

  // Arc flags may be adjacent, and relative arc endpoints use the current position.
  const compactArc = contours((await exportLayers([vector('M0 0 a50 50 0 01100 0')])).layers[0])[0];
  assert.equal(compactArc.points.length, 3);
  pointNear(compactArc.points[2].point, 0.75, 0);
  const rotated = contours((await exportLayers([vector('M0 0 A10 20 45 0 1 100 100')])).layers[0])[0];
  assert.equal(rotated.points.length, 3, 'Too-small arc radii must be expanded, not discarded');
  pointNear(rotated.points[2].point, 0.75, 1);
  assert.ok(rotated.points.every(p => [...pair(p.point), ...pair(p.curveFrom), ...pair(p.curveTo)].every(Number.isFinite)));
  const degenerate = contours((await exportLayers([vector('M0 0 A0 20 0 0 1 50 50 A10 10 0 0 1 50 50')])).layers[0])[0];
  assert.equal(degenerate.points.length, 2);
  assert.equal(degenerate.points[0].hasCurveTo, false);

  const compoundRoot = (await exportLayers([vector('M0 0h100v100H0z M20 20v60h60V20z M10 10L90 90')])).layers[0];
  assert.equal(compoundRoot.layers[0]._class, 'shapeGroup');
  assert.equal(compoundRoot.layers[0].windingRule, 0, 'SVG defaults to nonzero compound winding');
  assert.deepEqual(contours(compoundRoot).map(c => c.isClosed), [true, true, false]);

  const absolute = contours((await exportLayers([vector(
    'M10 10 L20 20 H30 V40 C40 40 40 50 50 50 S60 60 70 50 Q80 40 90 50 T110 50 A10 10 0 0 1 130 50 Z',
  )])).layers[0])[0];
  const equivalentRelative = contours((await exportLayers([vector(
    'm10 10 l10 10 h10 v20 c10 0 10 10 20 10 s10 10 20 0 q10 -10 20 0 t20 0 a10 10 0 0 1 20 0 z',
  )])).layers[0])[0];
  assert.deepEqual(equivalentRelative.points, absolute.points, 'Relative and absolute commands must produce identical editable geometry');

  const scaled = (await exportLayers([vector('M0 0 L100 100', { box: { x: 0, y: 0, w: 400, h: 200 } })])).layers[0];
  assert.equal(scaled.layers[0].style.borders[0].thickness, 4, 'Strokes scale with viewBox geometry');
  const unscaled = contours((await exportLayers([vector('M0 0L200 100', { vectorViewBox: undefined })])).layers[0])[0];
  pointNear(unscaled.points[1].point, 1, 1);

  const multi = (await exportLayers([vector('', {
    vectorPaths: [{ d: 'M0 0L100 0', fill: 'none', stroke: '#ff0000' }, { d: 'M0 10L100 10', fill: '#123456' }],
  })])).layers[0];
  assert.equal(multi.layers.length, 2);
  assert.equal(multi.layers[0].style.fills.length, 0);
  assert.equal(multi.layers[0].style.borders[0].thickness, 1, 'SVG default stroke width is one user unit');
  assert.equal(multi.layers[1].style.borders.length, 0);

  const nested = await exportLayers([
    { id: 'parent', type: 'frame', box: { x: 10, y: 20, w: 300, h: 200 }, style },
    vector('M0 0L100 100', { parentId: 'parent' }),
  ]);
  assert.equal(nested.layers[0]._class, 'group');
  assert.equal(nested.layers[0].layers[0].frame.x, 20);
  assert.equal(nested.layers[0].layers[0].frame.y, 20);

  for (const d of ['L0 0', 'M0 0 X1 2', 'M0 0C1 2', 'M0 0 A10 10 0 2 0 20 20', 'M0 0L1e999 0']) {
    await assert.rejects(exportLayers([vector(d)]), /vector-proof.*path 1/i, `Invalid path must identify its source: ${d}`);
  }

  // Phase 4 B2/B3 tests: embedded fontReferences, PostScript font resolution, SVG asset vector conversion, fill stacking, artboard bg
  const svgAssetBase64 = Buffer.from('<svg viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" fill="#00ff00"/></svg>', 'utf8').toString('base64');
  const richCapture = emptyCapture({
    url: 'https://test.capture-kit.local',
    version: '0.1.1',
    frame: { width: 800, height: 600, baseURI: 'https://test.capture-kit.local/' },
    fonts: [{ family: 'CustomSans', weight: '400', style: 'normal', assetRef: 'font-1', embedded: true }],
    assets: {
      'font-1': { kind: 'font', mimeType: 'font/woff2', base64: 'd29mZjI=' },
      'svg-1': { kind: 'image', mimeType: 'image/svg+xml', base64: svgAssetBase64 },
    },
    nodes: [
      {
        id: 'root',
        type: 'frame',
        box: { x: 0, y: 0, w: 800, h: 400 },
        style: { fills: [{ type: 'solid', color: 'rgb(15, 23, 42)' }], strokes: [], opacity: 1, radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, shadows: [] },
      },
      {
        id: 'txt',
        parentId: 'root',
        type: 'text',
        box: { x: 10, y: 10, w: 200, h: 30 },
        style,
        text: { content: 'Hello', fontFamily: '"system-ui", sans-serif', fontSize: 16, fontWeight: 700, lineHeight: 1.5, letterSpacing: 1, align: 'center', color: 'rgb(255,255,255)' },
      },
      {
        id: 'svg-img',
        parentId: 'root',
        type: 'image',
        box: { x: 10, y: 50, w: 40, h: 40 },
        style,
        assetRef: 'svg-1',
      },
      {
        id: 'multi-fill',
        parentId: 'root',
        type: 'rect',
        box: { x: 10, y: 100, w: 40, h: 40 },
        style: {
          fills: [
            { type: 'gradient', gradientType: 'linear', angle: 90, stops: [{ color: 'rgba(255,0,0,0.5)', position: 0 }, { color: 'rgba(255,0,0,0.5)', position: 1 }] },
            { type: 'gradient', gradientType: 'conic', angle: 0, stops: [{ color: 'rgb(0,0,255)', position: 0 }, { color: 'rgb(0,0,255)', position: 1 }] },
          ],
          strokes: [], opacity: 1, radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, shadows: [],
        },
      },
    ],
  });
  const richZip = await JSZip.loadAsync(await (await modelToSketch(richCapture)).arrayBuffer());
  const docJson = JSON.parse(await richZip.file('document.json')!.async('text'));
  assert.equal(docJson.fontReferences.length, 1, 'Embedded font must appear in document.json fontReferences');
  assert.equal(docJson.fontReferences[0].fontFamilyName, 'CustomSans');
  const richPage = JSON.parse(await richZip.file('pages/page-1.json')!.async('text'));
  const artboard = richPage.layers[0];
  assert.ok(artboard.backgroundColor.red < 0.1 && artboard.backgroundColor.blue > 0.1, 'Artboard inherits root solid background');
  const rootGroup = artboard.layers[0];
  const txtLayer = rootGroup.layers.find((l: any) => l.do_objectID === 'txt');
  assert.equal(txtLayer.style.textStyle.encodedAttributes.MSAttributedStringFontAttribute.attributes.name, 'HelveticaNeue-Bold');
  assert.equal(txtLayer.style.textStyle.encodedAttributes.paragraphStyle.alignment, 2);
  const svgLayer = rootGroup.layers.find((l: any) => l.do_objectID === 'svg-img');
  assert.equal(svgLayer._class, 'group', 'SVG image asset converts to Sketch vector group instead of broken bitmap');
  const multiFillLayer = rootGroup.layers.find((l: any) => l.do_objectID === 'multi-fill');
  assert.equal(multiFillLayer.style.fills[0].gradient.gradientType, 2, 'Conic gradient maps to Sketch angular gradient and stacks bottom-to-top');

  // Beast Accuracy Upgrades: gradient text fills, 2D transform rotation, and spread ring shadow border fallback
  const cos30 = Math.cos((30 * Math.PI) / 180);
  const sin30 = Math.sin((30 * Math.PI) / 180);
  const beastNodes: Node[] = [
    {
      id: 'grad-rotated-text',
      type: 'text',
      box: { x: 20, y: 20, w: 240, h: 40 },
      style: {
        fills: [
          {
            type: 'gradient',
            gradientType: 'linear',
            angle: 90,
            stops: [
              { color: 'rgb(99, 102, 241)', position: 0 },
              { color: 'rgb(56, 189, 248)', position: 1 },
            ],
          },
        ],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        shadows: [],
        backgroundClip: 'text',
        transform: `matrix(${cos30}, ${sin30}, ${-sin30}, ${cos30}, 0, 0)`,
      },
      text: {
        content: 'Gradient Heading',
        fontFamily: 'Inter, sans-serif',
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 34,
        letterSpacing: 0,
        align: 'left',
        color: 'rgba(0, 0, 0, 0)',
      },
    },
    {
      id: 'ring-only-card',
      type: 'rect',
      box: { x: 20, y: 80, w: 200, h: 100 },
      style: {
        fills: [{ type: 'solid', color: 'rgb(30, 41, 59)' }],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
        shadows: [{ x: 0, y: 0, blur: 0, spread: 1, color: 'rgba(255, 255, 255, 0.2)', inset: true }],
      },
    },
  ];
  const { layers: beastLayers } = await exportLayers(beastNodes);
  const gradTextLayer: any = beastLayers.find((l: any) => l.do_objectID === 'grad-rotated-text');
  assert.ok(gradTextLayer, 'Gradient text layer must be exported');
  assert.equal(gradTextLayer.rotation, -30, '2D matrix rotation (30deg clockwise CSS) must map to -30 in Sketch');
  assert.equal(gradTextLayer.style.fills?.length, 1, 'Text layer with gradient fill must include fills on style');
  assert.equal(gradTextLayer.style.fills[0].fillType, 1, 'Text gradient fill must have fillType 1 (gradient)');
  assert.equal(gradTextLayer.style.fills[0].gradient.stops.length, 2, 'Text gradient fill must preserve gradient stops');

  const ringCardLayer: any = beastLayers.find((l: any) => l.do_objectID === 'ring-only-card');
  assert.ok(ringCardLayer, 'Ring card layer must be exported');
  assert.equal(ringCardLayer.style.borders.length, 1, 'Zero-offset zero-blur spread ring shadow must convert to Sketch border when no CSS border exists');
  assert.equal(ringCardLayer.style.borders[0].thickness, 1);
  assert.equal(ringCardLayer.style.borders[0].position, 1);

  // Round 2 upgrades: VectorPath.fillGradient and mixBlendMode mapping
  const round2Nodes: Node[] = [
    {
      id: 'vec-gradient-logo',
      type: 'vector',
      box: { x: 10, y: 10, w: 64, h: 64 },
      style: { ...style, opacity: 1, mixBlendMode: 'multiply' },
      vectorViewBox: { width: 24, height: 24 },
      vectorPaths: [
        {
          d: 'M0 0 L24 0 L24 24 Z',
          fillGradient: {
            type: 'gradient',
            gradientType: 'linear',
            angle: 90,
            stops: [
              { color: 'rgb(99, 102, 241)', position: 0 },
              { color: 'rgb(56, 189, 248)', position: 1 },
            ],
          },
        },
      ],
    },
    {
      id: 'screen-glow-rect',
      type: 'rect',
      box: { x: 100, y: 10, w: 120, h: 80 },
      style: {
        fills: [{ type: 'solid', color: 'rgba(56, 189, 248, 0.5)' }],
        strokes: [],
        opacity: 0.9,
        radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
        shadows: [],
        mixBlendMode: 'screen',
      },
    },
  ];
  const { layers: round2Layers } = await exportLayers(round2Nodes);
  const vecGradLayer: any = round2Layers.find((l: any) => l.do_objectID === 'vec-gradient-logo');
  assert.ok(vecGradLayer, 'Vector gradient layer must be exported');
  assert.equal(vecGradLayer.style.contextSettings.blendMode, 1, 'mixBlendMode: multiply must map to Sketch blendMode 1');
  assert.equal(vecGradLayer.layers[0].style.fills[0].fillType, 1, 'VectorPath.fillGradient must produce Sketch gradient fill');
  assert.equal(vecGradLayer.layers[0].style.fills[0].gradient.stops.length, 2, 'VectorPath.fillGradient must preserve stops');

  const screenRectLayer: any = round2Layers.find((l: any) => l.do_objectID === 'screen-glow-rect');
  assert.ok(screenRectLayer, 'Screen blend rect layer must be exported');
  assert.equal(screenRectLayer.style.contextSettings.blendMode, 5, 'mixBlendMode: screen must map to Sketch blendMode 5');
  assert.equal(screenRectLayer.style.fills[0].contextSettings.blendMode, 5, 'Fill graphicsContextSettings must inherit Sketch blendMode 5');

  console.log('Sketch vector archive behavior tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
