import { serializeDocument } from "@capture-kit/serializer";

// Injected on demand via chrome.scripting.executeScript. Runs the serializer
// in the page's isolated world and sends the model back to the service worker.
void serializeDocument(document).then(
  (capture) => chrome.runtime.sendMessage({ type: "capture-result", capture }),
  (err: unknown) => chrome.runtime.sendMessage({ type: "capture-error", error: String(err) }),
);
