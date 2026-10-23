import { CaptureSchema, type Capture } from '@capture-kit/model';

interface CaptureResponse {
  success: boolean;
  capture?: Capture;
  error?: string;
}

interface WindowWithCaptureKit {
  __captureKitSerialize?: () => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
}

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found');
  }
  return tab.id;
}

async function downloadCapture(capture: Capture, filename = 'capture.json'): Promise<void> {
  const jsonString = JSON.stringify(capture, null, 2);
  const encodedData = btoa(unescape(encodeURIComponent(jsonString)));
  const dataUrl = `data:application/json;base64,${encodedData}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });
}

async function handleFullCapture(): Promise<Capture> {
  const tabId = await getActiveTabId();

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  const [execResult] = await chrome.scripting.executeScript<unknown>({
    target: { tabId },
    func: async () => {
      const customWindow = window as unknown as WindowWithCaptureKit;
      if (!customWindow.__captureKitSerialize) {
        throw new Error('Capture-kit serializer is not available on page');
      }
      return await customWindow.__captureKitSerialize();
    },
  });

  if (!execResult || execResult.result === undefined) {
    throw new Error('Serializer returned empty execution result');
  }

  const validatedCapture = CaptureSchema.parse(execResult.result);
  await downloadCapture(validatedCapture, 'capture.json');
  return validatedCapture;
}

async function handlePickCapture(): Promise<Capture> {
  const tabId = await getActiveTabId();

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  const [execResult] = await chrome.scripting.executeScript<unknown>({
    target: { tabId },
    func: async () => {
      const customWindow = window as unknown as WindowWithCaptureKit;
      if (!customWindow.__captureKitPickElement) {
        throw new Error('Capture-kit element picker is not available on page');
      }
      return await customWindow.__captureKitPickElement();
    },
  });

  if (!execResult || execResult.result === undefined) {
    throw new Error('Element picker returned empty execution result');
  }

  const validatedCapture = CaptureSchema.parse(execResult.result);
  await downloadCapture(validatedCapture, 'component-capture.json');
  return validatedCapture;
}
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: CaptureResponse) => void
  ) => {
    if (message && typeof message === 'object' && 'action' in message) {
      const action = message.action;
      if (action === 'capture') {
        handleFullCapture().then(
          (capture) => sendResponse({ success: true, capture }),
          (error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            sendResponse({ success: false, error: msg });
          }
        );
        return true;
      }

      if (action === 'pick') {
        handlePickCapture().then(
          (capture) => sendResponse({ success: true, capture }),
          (error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            sendResponse({ success: false, error: msg });
          }
        );
        return true;
      }
    }
    return false;
  }
);
