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

// The page just loaded these files, so its HTTP cache usually has them; the
// background worker's cache is separate and would refetch every one over the
// network. Returns null (caller falls back) when CORS or anything else blocks it.
async function fetchFromPage(url: string, as: 'text' | 'data-url'): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    if (as === 'text') return await res.text();
    const blob = await res.blob();
    if (blob.size > 15 * 1024 * 1024) return null;
    // <img> refuses SVG served as octet-stream (S3 and friends).
    const typed = /\.svg(\?|#|$)/i.test(url) && blob.type !== 'image/svg+xml' ? new Blob([blob], { type: 'image/svg+xml' }) : blob;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(typed);
    });
  } catch {
    return null;
  }
}

customWindow.__captureKitReplica = () =>
  replicateDocument(document, {
    // Page cache first; the background has host permissions, so CORS can't block it there.
    fetch: async (url, as) =>
      (await fetchFromPage(url, as)) ??
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

