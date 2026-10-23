import { CaptureSchema, type Capture } from '@capture-kit/model';

interface CaptureResponse {
  success: boolean;
  capture?: Capture;
  error?: string;
}

interface WindowWithCaptureKit {
  __captureKitSerialize?: () => Promise<unknown>;
}

async function handleCapture(): Promise<Capture> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found to capture');
  }

  // Inject serializer content script
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });

  // Run the injected serializer
  const [execResult] = await chrome.scripting.executeScript<unknown>({
    target: { tabId: tab.id },
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

  // Validate against model schema
  const validatedCapture = CaptureSchema.parse(execResult.result);

  // Encode JSON model to base64 data URL for chrome.downloads
  const jsonString = JSON.stringify(validatedCapture, null, 2);
  const encodedData = btoa(unescape(encodeURIComponent(jsonString)));
  const dataUrl = `data:application/json;base64,${encodedData}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: 'capture.json',
    saveAs: true,
  });

  return validatedCapture;
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: CaptureResponse) => void
  ) => {
    if (
      message &&
      typeof message === 'object' &&
      'action' in message &&
      message.action === 'capture'
    ) {
      handleCapture().then(
        (capture) => {
          sendResponse({ success: true, capture });
        },
        (error: unknown) => {
          const messageText =
            error instanceof Error ? error.message : String(error);
          sendResponse({ success: false, error: messageText });
        }
      );
      return true;
    }
    return false;
  }
);
