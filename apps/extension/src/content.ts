import {
  serializeDocument,
  serializeElement,
  replicateDocument,
  startElementPicker,
  type SerializeOptions,
} from '@capture-kit/serializer';

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: SerializeOptions) => Promise<unknown>;
  __captureKitSerializeWidths?: (widths: number[], opts?: SerializeOptions) => Promise<unknown[]>;
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

async function serializeAtWidthInIframe(targetWidth: number, opts?: SerializeOptions): Promise<unknown> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed!important;left:-20000px!important;top:0!important;width:${targetWidth}px!important;height:900px!important;border:0!important;visibility:hidden!important;pointer-events:none!important;z-index:-9999!important;`;
  document.documentElement.appendChild(iframe);
  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error('Could not create viewport iframe');
    const headHtml = document.head ? document.head.innerHTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : '';
    const bodyHtml = document.body ? document.body.innerHTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : '';
    const htmlAttrs = Array.from(document.documentElement.attributes)
      .map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
      .join(' ');
    const bodyAttrs = document.body
      ? Array.from(document.body.attributes)
          .map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
          .join(' ')
      : '';
    idoc.open();
    idoc.write(`<!DOCTYPE html><html ${htmlAttrs}><head><base href="${location.href}">${headHtml}</head><body ${bodyAttrs}>${bodyHtml}</body></html>`);
    idoc.close();
    await new Promise<void>((resolve) => {
      const done = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      if (idoc.readyState === 'complete') setTimeout(done, 120);
      else {
        iframe.addEventListener('load', () => setTimeout(done, 120), { once: true });
        setTimeout(done, 400);
      }
    });
    const cap = await serializeDocument(idoc, { ...opts, fastMode: true, baseURI: location.href });
    cap.url = location.href;
    cap.frame.width = targetWidth;
    cap.frame.baseURI = location.href;
    return cap;
  } finally {
    iframe.remove();
  }
}

customWindow.__captureKitSerializeWidths = async (widths: number[], opts?: SerializeOptions): Promise<unknown[]> => {
  const uniqueWidths = [...new Set(widths.filter((w) => Number.isFinite(w) && w >= 240))];
  const currentW = window.innerWidth || document.documentElement.clientWidth || 1280;
  const results: unknown[] = [];
  for (const w of uniqueWidths) {
    if (Math.abs(w - currentW) <= 4) {
      const cap = await serializeDocument(document, { ...opts, fastMode: true });
      cap.frame.width = w;
      results.push(cap);
    } else {
      results.push(await serializeAtWidthInIframe(w, opts));
    }
  }
  return results;
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

