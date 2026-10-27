import assert from 'node:assert/strict';
import { emptyCapture, type Node } from '@capture-kit/model';
import { nativeTextAlignment, parseNativeCaptures, planNativeCapture, parseNativeColor } from './src/native.js';

export function runNativePlanningTests(): void {
  const makeNode = (id: string, box: Node['box'], parentId?: string): Node => ({
    id, type: 'frame', box, ...(parentId ? { parentId } : {}),
    style: { fills: [], strokes: [], shadows: [], opacity: 1, radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 } },
  });
  assert.equal(nativeTextAlignment('left'), 'LEFT');
  assert.equal(nativeTextAlignment('center'), 'CENTER');
  assert.equal(nativeTextAlignment('right'), 'RIGHT');
  assert.equal(nativeTextAlignment('justify'), 'JUSTIFIED', 'Figma names justified alignment differently from CSS');
  const row = makeNode('row', { x: 100, y: 200, w: 220, h: 60 });
  row.style.layout = { mode: 'horizontal', gap: 20, paddingTop: 10, paddingLeft: 10, paddingRight: 10, paddingBottom: 10, alignItems: 'stretch' };
  const first = makeNode('first', { x: 110, y: 210, w: 80, h: 40 }, 'row');
  const second = makeNode('second', { x: 210, y: 210, w: 100, h: 40 }, 'row');
  const capture = emptyCapture({ nodes: [second, row, first] });
  // Captures retain DOM/paint order. A reverse sequence must not be silently
  // rearranged to obtain a superficially matching Auto Layout result.
  const reversed = planNativeCapture(parseNativeCaptures(capture)[0]);
  assert.equal(reversed.roots[0].layout, 'positioned');
  assert.ok(reversed.diagnostics.some((diagnostic) => diagnostic.code === 'native-positioned-layout'));
  capture.nodes = [row, first, second];
  const valid = planNativeCapture(parseNativeCaptures(capture)[0]);
  assert.equal(valid.roots[0].layout, 'horizontal');
  assert.deepEqual(valid.roots[0].children.map((plan) => plan.source.id), ['first', 'second']);
  assert.equal(valid.diagnostics.length, 0);

  const column = makeNode('column', { x: 0, y: 0, w: 200, h: 200 });
  column.style.layout = { mode: 'vertical', gap: 10, justifyContent: 'center', alignItems: 'center' };
  const a = makeNode('a', { x: 75, y: 45, w: 50, h: 50 }, 'column');
  const b = makeNode('b', { x: 75, y: 105, w: 50, h: 50 }, 'column');
  const vertical = planNativeCapture(parseNativeCaptures(emptyCapture({ nodes: [column, a, b] }))[0]);
  assert.equal(vertical.roots[0].layout, 'vertical');
  a.box.x += 12;
  assert.equal(planNativeCapture(emptyCapture({ nodes: [column, a, b] })).roots[0].layout, 'positioned', 'unrepresented margins stay positioned');

  for (const unsupported of [{ mode: 'grid' as const }, { mode: 'horizontal' as const, wrap: true }]) {
    const input = emptyCapture({ nodes: [{ ...row, style: { ...row.style, layout: unsupported } }, first, second] });
    const plan = planNativeCapture(parseNativeCaptures(input)[0]);
    assert.equal(plan.roots[0].layout, 'positioned');
    assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.nodeId === 'row'));
  }
  const transformed = emptyCapture({ nodes: [{ ...row, style: { ...row.style, transform: 'matrix(1, 0, 0, 1, 10, 0)' } }, first, second] });
  const fallback = planNativeCapture(parseNativeCaptures(transformed)[0]);
  assert.equal(fallback.roots[0].layout, 'positioned');
  assert.ok(fallback.diagnostics.some((diagnostic) => diagnostic.code === 'native-unsupported-css'));

  assert.equal(parseNativeCaptures([capture, capture]).length, 2, 'extension batch JSON accepted');
  assert.throws(() => parseNativeCaptures([]), /empty/);
  assert.throws(() => parseNativeCaptures({}), /Capture 1/);
  assert.throws(() => parseNativeCaptures(emptyCapture({ nodes: [row, row] })), /duplicate/);
  assert.throws(() => parseNativeCaptures(emptyCapture({ nodes: [first] })), /missing parent/);
  assert.throws(() => parseNativeCaptures(emptyCapture({ nodes: [{ ...row, parentId: 'first' }, first] })), /cyclic/);
  assert.throws(() => parseNativeCaptures(emptyCapture({ nodes: [{ ...row, box: { ...row.box, w: Infinity } }] })), /finite/);
  assert.throws(() => parseNativeCaptures(emptyCapture({ nodes: [{ ...row, type: 'text' }] })), /text properties/);
  const diagnosticCapture = emptyCapture({ nodes: [] });
  diagnosticCapture.diagnostics = [{ code: 'asset-timeout', severity: 'warning', message: 'An image did not load.' }];
  assert.equal(planNativeCapture(parseNativeCaptures(diagnosticCapture)[0]).diagnostics[0].code, 'asset-timeout', 'capture warnings survive import planning');
  assert.deepEqual(parseNativeColor('#ff000080'), { r: 1, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseNativeColor('rgba(0, 128, 255, 0.5)'), { r: 0, g: 128 / 255, b: 1, a: 0.5 });
  assert.equal(parseNativeColor('color(display-p3 1 0 0)'), undefined, 'unsupported color spaces must not pretend to be converted');
  const deep = Array.from({ length: 257 }, (_, index) => makeNode(`depth-${index}`, row.box, index ? `depth-${index - 1}` : undefined));
  assert.throws(() => parseNativeCaptures(emptyCapture({ nodes: deep })), /256 levels/, 'depth bounds apply even when ancestors precede their children');
  console.log('Figma native planning behavior tests passed (no Figma runtime claims).');
}
