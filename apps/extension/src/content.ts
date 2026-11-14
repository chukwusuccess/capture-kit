import {
  serializeDocument,
  serializeElement,
  replicateDocument,
  startElementPicker,
  type SerializeOptions,
} from '@capture-kit/serializer';

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: SerializeOptions) => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
  __captureKitCancelPick?: () => void;
  __captureKitReplica?: () => Promise<string>;
}

const customWindow = window as unknown as WindowWithCaptureKit;
let cancelPick: (() => void) | undefined;
customWindow.__captureKitCancelPick = () => cancelPick?.();

customWindow.__captureKitSerialize = async (opts?: SerializeOptions): Promise<unknown> => {
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
    shadowRootOf: (el) => {
      try {
        return chrome.dom?.openOrClosedShadowRoot(el) ?? null;
      } catch {
        return el.shadowRoot; // throws on non-HTML (SVG) elements
      }
    },
  });

customWindow.__captureKitPickElement = async (): Promise<unknown> => {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  let cleanup: (() => void) | undefined;
  const cancel = (): void => {
    cleanup?.();
    if (cancelPick === cancel) cancelPick = undefined;
    reject(new Error('Element selection cancelled'));
  };

  cleanup = startElementPicker(document, {
    onSelect: async (el: Element) => {
      if (cancelPick === cancel) cancelPick = undefined;
      try {
        resolve(await serializeElement(el));
      } catch (err: unknown) {
        reject(err);
      }
    },
    onCancel: () => {
      if (cancelPick === cancel) cancelPick = undefined;
      reject(new Error('Element selection cancelled'));
    },
  });
  cancelPick = cancel;
  return promise;
};

