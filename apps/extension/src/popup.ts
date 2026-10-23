import type { Capture } from '@capture-kit/model';
import { copyToFigmaClipboard } from '@capture-kit/destination-figma';

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

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function handleResponse(response: CaptureMessageResponse | undefined, defaultSuccess: string): void {
  if (response && response.success && response.capture) {
    latestCapture = response.capture;
    if (figmaBtn) figmaBtn.disabled = false;
    setStatus(`${defaultSuccess} (${response.capture.nodes.length} nodes)`);
  } else {
    setStatus(`Error: ${response?.error ?? 'Operation failed'}`);
  }
}

if (captureBtn) {
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    setStatus('Capturing entire tab...');

    try {
      const response = (await chrome.runtime.sendMessage({
        action: 'capture',
      })) as CaptureMessageResponse | undefined;

      handleResponse(response, 'Downloaded capture.json');
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

      handleResponse(response, 'Downloaded component-capture.json');
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
