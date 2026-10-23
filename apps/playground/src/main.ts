import { CaptureSchema, type Capture } from '@capture-kit/model';
import {
  serializeDocument,
  serializeElement,
  startElementPicker,
} from '@capture-kit/serializer';
import { modelToSketch } from '@capture-kit/destination-sketch';
import { modelToSvg } from '@capture-kit/destination-svg';
import { copyToFigmaClipboard } from '@capture-kit/destination-figma';

let latestCapture: Capture | null = null;

const runBtn = document.getElementById('btn-run') as HTMLButtonElement | null;
const pickBtn = document.getElementById('btn-pick') as HTMLButtonElement | null;
const copyFigmaBtn = document.getElementById('btn-copy-figma') as HTMLButtonElement | null;
const dlJsonBtn = document.getElementById('btn-dl-json') as HTMLButtonElement | null;
const dlSketchBtn = document.getElementById('btn-dl-sketch') as HTMLButtonElement | null;
const dlSvgBtn = document.getElementById('btn-dl-svg') as HTMLButtonElement | null;
const statusEl = document.getElementById('status') as HTMLSpanElement | null;
const jsonPreview = document.getElementById('json-preview') as HTMLPreElement | null;

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function enableActionButtons(): void {
  if (copyFigmaBtn) copyFigmaBtn.disabled = false;
  if (dlJsonBtn) dlJsonBtn.disabled = false;
  if (dlSketchBtn) dlSketchBtn.disabled = false;
  if (dlSvgBtn) dlSvgBtn.disabled = false;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function onCaptureComplete(validated: Capture): void {
  latestCapture = validated;
  if (jsonPreview) {
    jsonPreview.textContent = JSON.stringify(validated, null, 2);
  }
  enableActionButtons();
  setStatus(`Captured ${validated.nodes.length} nodes successfully (${validated.frame.width}x${validated.frame.height})`);
}

runBtn?.addEventListener('click', async () => {
  setStatus('Serializing document...');
  if (runBtn) runBtn.disabled = true;

  try {
    const rawCapture = await serializeDocument(document);
    const validated = CaptureSchema.parse(rawCapture);
    onCaptureComplete(validated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Serialization error: ${message}`);
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
});

pickBtn?.addEventListener('click', () => {
  setStatus('Click any element to inspect & capture (or press Esc to cancel)...');

  startElementPicker(document, {
    onSelect: async (el: Element) => {
      setStatus(`Serializing selected <${el.tagName.toLowerCase()}> element...`);
      try {
        const rawCapture = await serializeElement(el);
        const validated = CaptureSchema.parse(rawCapture);
        onCaptureComplete(validated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Element serialization error: ${message}`);
      }
    },
    onCancel: () => {
      setStatus('Element picking cancelled.');
    },
  });
});

copyFigmaBtn?.addEventListener('click', async () => {
  if (!latestCapture) return;
  setStatus('Copying capture to Figma clipboard...');
  try {
    await copyToFigmaClipboard(latestCapture);
    setStatus('Copied to clipboard! Press Cmd+V in Figma to paste.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Clipboard error: ${message}`);
  }
});

dlJsonBtn?.addEventListener('click', () => {
  if (!latestCapture) return;
  const jsonBlob = new Blob([JSON.stringify(latestCapture, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(jsonBlob, 'capture.json');
  setStatus('Downloaded capture.json');
});

dlSketchBtn?.addEventListener('click', async () => {
  if (!latestCapture) return;
  setStatus('Generating .sketch file...');
  try {
    const sketchBlob = await modelToSketch(latestCapture);
    triggerDownload(sketchBlob, 'capture.sketch');
    setStatus('Downloaded capture.sketch');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Sketch export error: ${message}`);
  }
});

dlSvgBtn?.addEventListener('click', () => {
  if (!latestCapture) return;
  setStatus('Generating .svg file...');
  try {
    const svgString = modelToSvg(latestCapture);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
    triggerDownload(svgBlob, 'capture.svg');
    setStatus('Downloaded capture.svg');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`SVG export error: ${message}`);
  }
});
