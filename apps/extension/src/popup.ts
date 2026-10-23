interface CaptureMessageResponse {
  success: boolean;
  error?: string;
}

const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement | null;
const statusEl = document.getElementById('status') as HTMLDivElement | null;

if (captureBtn && statusEl) {
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    statusEl.textContent = 'Capturing current tab...';

    try {
      const response = (await chrome.runtime.sendMessage({
        action: 'capture',
      })) as CaptureMessageResponse | undefined;

      if (response && response.success) {
        statusEl.textContent = 'Capture completed: capture.json downloaded';
      } else {
        statusEl.textContent = `Error: ${response?.error ?? 'Capture failed'}`;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      statusEl.textContent = `Error: ${message}`;
    } finally {
      captureBtn.disabled = false;
    }
  });
}
