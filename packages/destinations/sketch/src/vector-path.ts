interface Position { x: number; y: number }
interface Vertex extends Position { incoming?: Position; outgoing?: Position }
export interface Contour { points: Vertex[]; closed: boolean }

// SVG endpoint-to-center conversion (SVG 2, implementation notes F.6).
// Sketch stores cubic Beziers, so elliptic arcs are approximated by segments
// of at most 90 degrees (the usual cubic circle approximation).
function arcCubics(
  start: Position, end: Position, rx: number, ry: number, rotation: number,
  large: boolean, sweep: boolean,
): Array<{ c1: Position; c2: Position; end: Position }> {
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotation % 360) * Math.PI / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (start.x - end.x) / 2, dy = (start.y - end.y) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const stretch = Math.hypot(xp / rx, yp / ry);
  if (stretch > 1) { rx *= stretch; ry *= stretch; }
  const ux = xp / rx, uy = yp / ry;
  const squared = ux * ux + uy * uy;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (1 - squared) / squared));
  const cxp = factor * rx * uy, cyp = -factor * ry * ux;
  const cx = cos * cxp - sin * cyp + (start.x + end.x) / 2;
  const cy = sin * cxp + cos * cyp + (start.y + end.y) / 2;
  const ax = (xp - cxp) / rx, ay = (yp - cyp) / ry;
  const bx = (-xp - cxp) / rx, by = (-yp - cyp) / ry;
  let theta = Math.atan2(ay, ax);
  let delta = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-12));
  const step = delta / count;
  const map = (x: number, y: number): Position => ({ x: cx + cos * rx * x - sin * ry * y, y: cy + sin * rx * x + cos * ry * y });
  const segments: Array<{ c1: Position; c2: Position; end: Position }> = [];
  for (let i = 0; i < count; i++) {
    const next = theta + step;
    const alpha = 4 / 3 * Math.tan(step / 4);
    segments.push({
      c1: map(Math.cos(theta) - alpha * Math.sin(theta), Math.sin(theta) + alpha * Math.cos(theta)),
      c2: map(Math.cos(next) + alpha * Math.sin(next), Math.sin(next) - alpha * Math.cos(next)),
      end: i === count - 1 ? end : map(Math.cos(next), Math.sin(next)),
    });
    theta = next;
  }
  return segments;
}

/** Parse all SVG path commands into absolute cubic contours, without flattening. */
export function parseVectorPath(data: string): Contour[] {
  const contours: Contour[] = [];
  let contour: Contour | undefined;
  let current: Position = { x: 0, y: 0 };
  let previous = '';
  let cubicControl: Position | undefined;
  let quadraticControl: Position | undefined;
  let cursor = 0;
  let command = '';
  const separators = () => { while (cursor < data.length && /[\s,]/.test(data[cursor])) cursor++; };
  const fail = (message: string): never => { throw new Error(`${message} at character ${cursor}`); };
  const number = (): number => {
    separators();
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(data.slice(cursor));
    if (!match) return fail('Expected SVG path number');
    cursor += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return fail('Non-finite SVG path number');
    return value;
  };
  const flag = (): boolean => {
    separators();
    const value = data[cursor++];
    if (value !== '0' && value !== '1') return fail('Expected arc flag 0 or 1');
    return value === '1';
  };
  const begin = (p: Position) => {
    contour = { points: [{ ...p }], closed: false };
    contours.push(contour);
    current = p;
  };
  const line = (end: Position, c1?: Position, c2?: Position) => {
    if (!contour || contour.closed) begin(current);
    const active = contour!;
    if (c1) active.points[active.points.length - 1].outgoing = c1;
    active.points.push({ ...end, ...(c2 ? { incoming: c2 } : {}) });
    current = end;
  };
  while (true) {
    separators();
    if (cursor >= data.length) break;
    if (/[a-zA-Z]/.test(data[cursor])) command = data[cursor++];
    else if (!command) fail('Expected SVG path command');
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (!'MLHVCSQTAZ'.includes(upper)) fail(`Unsupported SVG path command ${command}`);
    if (!contours.length && upper !== 'M') fail('SVG path must start with moveto');
    if (upper === 'Z') {
      if (!contour) fail('Close without a subpath');
      const active = contour!;
      const first = active.points[0], last = active.points[active.points.length - 1];
      // A cubic ending on its start must retain both control handles at the seam.
      if (active.points.length > 1 && first.x === last.x && first.y === last.y) {
        first.incoming = last.incoming;
        active.points.pop();
      }
      active.closed = true;
      current = { x: first.x, y: first.y };
      previous = upper; cubicControl = undefined; quadraticControl = undefined;
      command = '';
      continue;
    }
    const origin = current;
    const position = (): Position => {
      const x = number(), y = number();
      return { x: x + (relative ? origin.x : 0), y: y + (relative ? origin.y : 0) };
    };
    let nextCubic: Position | undefined;
    let nextQuadratic: Position | undefined;
    switch (upper) {
      case 'M':
        begin(position());
        // Subsequent coordinate pairs following moveto are implicit lineto.
        command = relative ? 'l' : 'L';
        break;
      case 'L': line(position()); break;
      case 'H': line({ x: number() + (relative ? origin.x : 0), y: origin.y }); break;
      case 'V': line({ x: origin.x, y: number() + (relative ? origin.y : 0) }); break;
      case 'C': {
        const c1 = position(), c2 = position(), end = position();
        line(end, c1, c2); nextCubic = c2;
        break;
      }
      case 'S': {
        const c1 = (previous === 'C' || previous === 'S') && cubicControl
          ? { x: 2 * origin.x - cubicControl.x, y: 2 * origin.y - cubicControl.y } : origin;
        const c2 = position(), end = position();
        line(end, c1, c2); nextCubic = c2;
        break;
      }
      case 'Q':
      case 'T': {
        const control = upper === 'Q' ? position()
          : (previous === 'Q' || previous === 'T') && quadraticControl
            ? { x: 2 * origin.x - quadraticControl.x, y: 2 * origin.y - quadraticControl.y } : origin;
        const end = position();
        line(end,
          { x: origin.x + 2 / 3 * (control.x - origin.x), y: origin.y + 2 / 3 * (control.y - origin.y) },
          { x: end.x + 2 / 3 * (control.x - end.x), y: end.y + 2 / 3 * (control.y - end.y) });
        nextQuadratic = control;
        break;
      }
      case 'A': {
        const rx = number(), ry = number(), rotation = number();
        const large = flag(), sweep = flag(), end = position();
        if (end.x !== origin.x || end.y !== origin.y) {
          if (rx === 0 || ry === 0) line(end);
          else for (const segment of arcCubics(origin, end, rx, ry, rotation, large, sweep)) {
            line(segment.end, segment.c1, segment.c2);
          }
        }
        break;
      }
    }
    previous = upper; cubicControl = nextCubic; quadraticControl = nextQuadratic;
  }
  for (const c of contours) for (const p of c.points) {
    if (![p, p.incoming, p.outgoing].every(v => !v || (Number.isFinite(v.x) && Number.isFinite(v.y)))) {
      fail('SVG path geometry is outside finite coordinate range');
    }
  }
  return contours;
}

/** Sketch points and handles are relative to their layer frame, not viewBox units. */
export function sketchContourPoints(contour: Contour, width: number, height: number, scale: number, dx: number, dy: number) {
  const pointString = (p: Position) => {
    const x = (dx + p.x * scale) / (width || 1), y = (dy + p.y * scale) / (height || 1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Non-finite normalized SVG coordinate');
    return `{${x}, ${y}}`;
  };
  return contour.points.map(p => ({
    _class: 'curvePoint', cornerRadius: 0, cornerStyle: 0,
    curveMode: p.incoming || p.outgoing ? 4 : 1,
    point: pointString(p),
    // Sketch's curveFrom is incoming; curveTo is outgoing.
    curveFrom: pointString(p.incoming ?? p), curveTo: pointString(p.outgoing ?? p),
    hasCurveFrom: Boolean(p.incoming), hasCurveTo: Boolean(p.outgoing),
  }));
}
