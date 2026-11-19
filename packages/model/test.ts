import assert from "node:assert/strict";
import {
  captureSchema,
  createEmptyCapture,
  MODEL_VERSION,
  type Capture,
} from "./src/index.ts";

// 1. Minimal capture is accepted.
const minimal: Capture = createEmptyCapture("https://example.com", {
  width: 100,
  height: 50,
  baseURI: "https://example.com/",
});
assert.equal(captureSchema.safeParse(minimal).success, true, "minimal capture rejected");

// 2. Capture with a node is accepted.
const withNode: Capture = {
  ...minimal,
  nodes: [
    {
      id: "n-0",
      type: "rect",
      box: { x: 0, y: 0, w: 10, h: 10 },
      style: {
        fills: [{ type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } }],
        strokes: [],
        opacity: 1,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        shadows: [],
      },
    },
  ],
};
assert.equal(captureSchema.safeParse(withNode).success, true, "capture with node rejected");

// 3. Malformed captures are rejected.
const badType = { ...minimal, version: "one" };
assert.equal(captureSchema.safeParse(badType).success, false, "non-numeric version accepted");

const badNode = {
  ...minimal,
  nodes: [{ id: 1, type: "circle", box: { x: 0, y: 0, w: -1, h: 0 }, style: {} }],
};
assert.equal(captureSchema.safeParse(badNode).success, false, "malformed node accepted");

const badOpacity = {
  ...minimal,
  nodes: [
    {
      id: "n-0",
      type: "frame",
      box: { x: 0, y: 0, w: 1, h: 1 },
      style: { fills: [], strokes: [], opacity: 5, radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, shadows: [] },
    },
  ],
};
assert.equal(captureSchema.safeParse(badOpacity).success, false, "opacity out of range accepted");

// 4. Empty factory produces the right version.
assert.equal(minimal.version, MODEL_VERSION);

console.log("model: all checks passed");
