import {
  serializeDocument,
  serializeElement,
  replicateDocument,
  startElementPicker,
} from '@capture-kit/serializer';

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: { scrollStitch?: boolean }) => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
  __captureKitReplica?: () => Promise<string>;
}

const customWindow = window as unknown as WindowWithCaptureKit;

customWindow.__captureKitSerialize = async (opts?: { scrollStitch?: boolean }): Promise<unknown> => {
  return await serializeDocument(document, opts);
};

customWindow.__captureKitReplica = () =>
  replicateDocument(document, {
    // The background fetches: it has host permissions, so CORS can't block fonts or CSS.
    fetch: (url, as) =>
      chrome.runtime.sendMessage({ action: 'fetch-asset', url, as }).then(
        (r) => (r as { data?: string | null } | undefined)?.data ?? null,
        () => null
      ),
    shadowRootOf: (el) => chrome.dom?.openOrClosedShadowRoot(el) ?? null,
  });

customWindow.__captureKitPickElement = async (): Promise<unknown> => {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();

  startElementPicker(document, {
    onSelect: async (el: Element) => {
      try {
        const capture = await serializeElement(el);
        resolve(capture);
      } catch (err: unknown) {
        reject(err);
      }
    },
    onCancel: () => {
      reject(new Error('Element selection cancelled'));
    },
  });

  return promise;
};
