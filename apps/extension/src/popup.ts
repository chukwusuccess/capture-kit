import type { Capture } from '@capture-kit/model';
import { copyToFigmaClipboard } from '@capture-kit/destination-figma';
import { modelToSketch } from '@capture-kit/destination-sketch';
import { modelToSvg } from '@capture-kit/destination-svg';
import { modelToHtml } from '@capture-kit/destination-html';

interface CaptureMessageResponse {
  success: boolean;
  capture?: Capture;
  error?: string;
}

let latestCapture: Capture | null = null;

const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement | null;
const pickBtn = document.getElementById('pick-btn') as HTMLButtonElement | null;
const figmaBtn = document.getElementById('figma-btn') as HTMLButtonElement | null;
const statusEl = document.getElementById('status') as HTMLDivElement | null;
const optScrollStitch = document.getElementById('opt-scroll-stitch') as HTMLInputElement | null;
const optFormat = document.getElementById('opt-format') as HTMLSelectElement | null;

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
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

// Load persistent settings
if (chrome.storage?.local) {
  chrome.storage.local.get(['scrollStitch', 'format']).then((data) => {
    if (optScrollStitch && typeof data.scrollStitch === 'boolean') {
      optScrollStitch.checked = data.scrollStitch;
    }
    if (optFormat && typeof data.format === 'string') {
      optFormat.value = data.format;
    }
  });

  optScrollStitch?.addEventListener('change', () => {
    chrome.storage.local.set({ scrollStitch: optScrollStitch.checked });
  });

  optFormat?.addEventListener('change', () => {
    chrome.storage.local.set({ format: optFormat.value });
  });
}

async function exportToSelectedFormat(capture: Capture): Promise<void> {
  const format = optFormat?.value ?? 'json';

  if (format === 'figma') {
    await copyToFigmaClipboard(capture);
    setStatus('Copied vector elements to clipboard! Press Cmd+V in Figma.');
    return;
  }

  if (format === 'sketch') {
    setStatus('Exporting to .sketch archive...');
    const blob = await modelToSketch(capture);
    triggerDownload(blob, 'capture.sketch');
    setStatus('Downloaded capture.sketch');
    return;
  }

  if (format === 'svg') {
    const svgStr = modelToSvg(capture);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    triggerDownload(blob, 'capture.svg');
    setStatus('Downloaded capture.svg');
    return;
  }

  if (format === 'html') {
    const htmlStr = modelToHtml(capture);
    const blob = new Blob([htmlStr], { type: 'text/html' });
    triggerDownload(blob, 'capture.html');
    setStatus('Downloaded capture.html');
    return;
  }

  // Default json
  setStatus(`Downloaded capture.json (${capture.nodes.length} nodes)`);
}

async function handleResponse(response: CaptureMessageResponse | undefined): Promise<void> {
  if (response && response.success && response.capture) {
    latestCapture = response.capture;
    if (figmaBtn) figmaBtn.disabled = false;
    await exportToSelectedFormat(response.capture);
  } else {
    setStatus(`Error: ${response?.error ?? 'Operation failed'}`);
  }
}

if (captureBtn) {
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    setStatus('Capturing tab...');

    try {
      const scrollStitch = optScrollStitch?.checked ?? false;
      const response = (await chrome.runtime.sendMessage({
        action: 'capture',
        scrollStitch,
      })) as CaptureMessageResponse | undefined;

      await handleResponse(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`);
    } finally {
      captureBtn.disabled = false;
    }
  });
}

if (pickBtn) {
  pickBtn.addEventListener('click', async () => {
    pickBtn.disabled = true;
    setStatus('Click an element on the page to capture it...');

    try {
      const response = (await chrome.runtime.sendMessage({
        action: 'pick',
      })) as CaptureMessageResponse | undefined;

      await handleResponse(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`);
    } finally {
      pickBtn.disabled = false;
    }
  });
}

if (figmaBtn) {
  figmaBtn.addEventListener('click', async () => {
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
}
