import type { Capture } from "@capture-kit/model";

/**
 * MV3 service worker. Receives "capture" from the popup, injects the content
 * script into the active tab; the content script replies with "capture-result"
 * which we download as capture.json.
 *
 * Note: MV3 service workers have no URL.createObjectURL, so the download uses
 * a data: URL. Fine for JSON models in Phase 0; revisit if captures get huge.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "capture") {
    void captureActiveTab().then(
      () => sendResponse({ ok: true }),
      (err: unknown) => sendResponse({ ok: false, error: String(err) }),
    );
    return true; // keep the channel open for the async response
  }

  if (msg?.type === "capture-result") {
    void downloadCapture(msg.capture as Capture, sender.tab?.title ?? "page");
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function captureActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("no active tab");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
}

async function downloadCapture(capture: Capture, tabTitle: string): Promise<void> {
  await chrome.storage.local.set({ lastCapture: capture });
  const json = JSON.stringify(capture, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  await chrome.downloads.download({ url, filename: "capture.json", saveAs: false });
  void tabTitle;
}
