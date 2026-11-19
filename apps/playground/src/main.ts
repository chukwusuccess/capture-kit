import { serializeDocument } from "@capture-kit/serializer";
import { captureSchema, type Capture } from "@capture-kit/model";
import { modelToSketch } from "@capture-kit/dest-sketch";
import { modelToSvg } from "@capture-kit/dest-svg";

let capture: Capture | undefined;

const jsonEl = document.getElementById("json")!;
const buttons = {
  run: document.getElementById("run")!,
  json: document.getElementById("dl-json")!,
  sketch: document.getElementById("dl-sketch")!,
  svg: document.getElementById("dl-svg")!,
} as const;

buttons.run.addEventListener("click", async () => {
  capture = await serializeDocument(document);
  const result = captureSchema.safeParse(capture);
  if (!result.success) {
    jsonEl.textContent = `INVALID MODEL:\n${result.error.message}`;
    setEnabled(false);
    return;
  }
  jsonEl.textContent = JSON.stringify(capture, null, 2);
  setEnabled(true);
});

buttons.json.addEventListener("click", () => {
  if (capture) download("capture.json", new Blob([JSON.stringify(capture, null, 2)], { type: "application/json" }));
});

buttons.sketch.addEventListener("click", async () => {
  if (!capture) return;
  // Note: the toolbar buttons themselves are included in the capture — expected for a dev harness.
  download("capture.sketch", await modelToSketch(capture));
});

buttons.svg.addEventListener("click", () => {
  if (capture) download("capture.svg", new Blob([modelToSvg(capture)], { type: "image/svg+xml" }));
});

function setEnabled(on: boolean): void {
  for (const key of ["json", "sketch", "svg"] as const) buttons[key].disabled = !on;
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
