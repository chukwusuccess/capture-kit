import {
  serializeDocument,
  serializeElement,
  replicateDocument,
  startElementPicker,
  type SerializeOptions,
} from '@capture-kit/serializer';
import { modelToFigma } from '@capture-kit/destination-figma';
import { modelToReact } from '@capture-kit/destination-react';
import { modelToMarkdown } from '@capture-kit/destination-markdown';
import { modelToHtml } from '@capture-kit/destination-html';
import { modelToSvg } from '@capture-kit/destination-svg';

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: SerializeOptions) => Promise<unknown>;
  __captureKitSerializeWidths?: (widths: number[], opts?: SerializeOptions) => Promise<unknown[]>;
  __captureKitPickElement?: () => Promise<unknown>;
  __captureKitPickAndCopy?: (opts?: { format?: string; includeDesignSystem?: boolean }) => Promise<unknown>;
  __captureKitCopyPageDirect?: (opts?: { format?: string; includeDesignSystem?: boolean }) => Promise<void>;
  __captureKitCountdown?: (seconds?: number) => Promise<void>;
  __captureKitToast?: (text: string, isError?: boolean) => void;
  __captureKitCancelPick?: () => void;
  __captureKitReplica?: () => Promise<string>;
}

const customWindow = window as unknown as WindowWithCaptureKit;
let cancelPick: (() => void) | undefined;
customWindow.__captureKitCancelPick = () => cancelPick?.();

customWindow.__captureKitSerialize = async (opts?: SerializeOptions): Promise<unknown> => {
  return await serializeDocument(document, opts);
};

function createViewportIframe(targetWidth: number): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed!important;left:-20000px!important;top:0!important;width:${targetWidth}px!important;height:900px!important;border:0!important;opacity:0.001!important;pointer-events:none!important;z-index:-9999!important;`;
  return iframe;
}

async function tryLoadLiveIframe(iframe: HTMLIFrameElement): Promise<Document | null> {
  try {
    const loaded = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 2000);
      iframe.addEventListener('load', () => finish(true), { once: true });
      iframe.addEventListener('error', () => finish(false), { once: true });
      iframe.src = location.href;
    });
    if (!loaded) return null;
    const doc = iframe.contentDocument;
    if (doc?.body && doc.body.children.length > 0) return doc;
    return null;
  } catch {
    return null;
  }
}

async function quickRevealIframe(win: Window | null | undefined, doc: Document): Promise<void> {
  if (!win) return;
  const maxH = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
  if (maxH <= 900) return;
  const stepCount = Math.min(12, Math.max(4, Math.ceil(maxH / 700)));
  for (let i = 1; i <= stepCount; i++) {
    win.scrollTo(0, Math.round((maxH * i) / stepCount));
    await new Promise<void>((r) => setTimeout(r, 220));
  }
  await new Promise<void>((r) => setTimeout(r, 350));
  win.scrollTo(0, 0);
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))));
}

async function serializeAtWidthInIframe(targetWidth: number, opts?: SerializeOptions): Promise<unknown> {
  let activeIframe: HTMLIFrameElement | null = null;
  try {
    const liveIframe = createViewportIframe(targetWidth);
    activeIframe = liveIframe;
    document.documentElement.appendChild(liveIframe);

    let docToSerialize = await tryLoadLiveIframe(liveIframe);
    if (docToSerialize) {
      liveIframe.contentWindow?.dispatchEvent(new Event('resize'));
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250)));
      });
      await quickRevealIframe(liveIframe.contentWindow, docToSerialize);
    } else {
      liveIframe.remove();
      const fallbackIframe = createViewportIframe(targetWidth);
      activeIframe = fallbackIframe;
      document.documentElement.appendChild(fallbackIframe);

      const idoc = fallbackIframe.contentDocument;
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
          fallbackIframe.addEventListener('load', () => setTimeout(done, 120), { once: true });
          setTimeout(done, 400);
        }
      });
      docToSerialize = idoc;
    }

    const useFast = opts?.scrollStitch ? false : (opts?.fastMode ?? true);
    const cap = await serializeDocument(docToSerialize, { ...opts, fastMode: useFast, baseURI: location.href });
    cap.url = location.href;
    cap.frame.width = targetWidth;
    cap.frame.baseURI = location.href;
    return cap;
  } finally {
    activeIframe?.remove();
  }
}

customWindow.__captureKitSerializeWidths = async (widths: number[], opts?: SerializeOptions): Promise<unknown[]> => {
  const uniqueWidths = [...new Set(widths.filter((w) => Number.isFinite(w) && w >= 240))];
  const currentW = window.innerWidth || document.documentElement.clientWidth || 1280;
  const results: unknown[] = [];
  const useFast = opts?.scrollStitch ? false : (opts?.fastMode ?? true);
  for (const w of uniqueWidths) {
    if (Math.abs(w - currentW) <= 4) {
      const cap = await serializeDocument(document, { ...opts, fastMode: useFast });
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

let toastHideTimer: ReturnType<typeof setTimeout> | undefined;
let toastRemoveTimer: ReturnType<typeof setTimeout> | undefined;

function showPageToast(text: string, isError = false): void {
  const root = document.body ?? document.documentElement;
  if (!root) return;
  const TOAST_ID = '__capture_kit_toast';
  document.getElementById(TOAST_ID)?.remove();
  if (toastHideTimer !== undefined) clearTimeout(toastHideTimer);
  if (toastRemoveTimer !== undefined) clearTimeout(toastRemoveTimer);

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  toast.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'z-index: 2147483647',
    `background: ${isError ? '#7f1d1d' : '#111827'}`,
    'color: #f8fafc',
    'padding: 10px 16px',
    'border-radius: 999px',
    'font: 600 13px/1.4 system-ui, sans-serif',
    'box-shadow: 0 10px 25px rgba(0,0,0,0.35)',
    `border: 1px solid ${isError ? 'rgba(248,113,113,0.45)' : 'rgba(255,255,255,0.12)'}`,
    'pointer-events: none',
    'opacity: 1',
    'transition: opacity 250ms ease',
  ].join('; ');
  root.appendChild(toast);

  toastHideTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toastRemoveTimer = setTimeout(() => {
      toast.remove();
    }, 260);
  }, 3200);
}

customWindow.__captureKitToast = showPageToast;

customWindow.__captureKitCountdown = async (seconds = 3): Promise<void> => {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return;
  for (let remaining = total; remaining >= 1; remaining--) {
    const msg =
      remaining === total
        ? `Capturing in ${remaining}s — open your menu or hover state now…`
        : `Capturing in ${remaining}s…`;
    showPageToast(msg);
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
  document.getElementById('__capture_kit_toast')?.remove();
  if (toastHideTimer !== undefined) {
    clearTimeout(toastHideTimer);
    toastHideTimer = undefined;
  }
  if (toastRemoveTimer !== undefined) {
    clearTimeout(toastRemoveTimer);
    toastRemoveTimer = undefined;
  }
};

async function copyTextInPage(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    (document.body ?? document.documentElement).appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return;
    throw err;
  }
}

type SerializedCapture = Awaited<ReturnType<typeof serializeElement>>;

function formatCapturesOutput(
  captures: SerializedCapture[],
  format: string,
  includeDesignSystem?: boolean,
  single = false
): string {
  switch (format) {
    case 'figma':
    case 'figma-native':
    case 'sketch':
      return modelToFigma(captures, { includeDesignSystem }).svg;
    case 'react':
      return captures.map((c) => modelToReact(c)).join('\n\n');
    case 'md':
      return captures.map((c) => modelToMarkdown(c)).join('\n\n---\n\n');
    case 'svg':
      return single && captures.length === 1 ? modelToSvg(captures[0]) : modelToFigma(captures).svg;
    case 'html':
      return captures.map((c) => modelToHtml(c)).join('\n\n');
    case 'json':
    default:
      return JSON.stringify(single && captures.length === 1 ? captures[0] : captures, null, 2);
  }
}

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

customWindow.__captureKitPickAndCopy = async (opts?: {
  format?: string;
  includeDesignSystem?: boolean;
}): Promise<unknown> => {
  cancelPick?.();
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  let cleanup: (() => void) | undefined;
  const cancel = (): void => {
    cleanup?.();
    if (cancelPick === cancel) cancelPick = undefined;
    showPageToast('Element selection cancelled');
    reject(new Error('Element selection cancelled'));
  };

  showPageToast('Click to copy · ↑/↓ parent/child · Shift+Click multi-select · Esc cancel');
  const pickerOpts: Parameters<typeof startElementPicker>[1] & {
    onMultiSelect?: (els: Element[]) => void;
  } = {
    onSelect: async (el: Element) => {
      if (cancelPick === cancel) cancelPick = undefined;
      try {
        const capture = await serializeElement(el, { fastMode: true });
        const format = opts?.format ?? 'figma';
        const output = formatCapturesOutput([capture], format, opts?.includeDesignSystem, true);
        await copyTextInPage(output);
        const copiedMsg =
          format === 'figma' || format === 'sketch' || format === 'figma-native'
            ? '✓ Copied element — press Cmd+V in Figma or Sketch!'
            : `✓ Copied element (${format.toUpperCase()}) — ready to paste!`;
        showPageToast(copiedMsg);
        resolve(capture);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showPageToast(`Failed to copy element: ${msg}`, true);
        reject(err);
      }
    },
    onMultiSelect: async (els: Element[]) => {
      if (cancelPick === cancel) cancelPick = undefined;
      try {
        const captures = await Promise.all(els.map((el) => serializeElement(el, { fastMode: true })));
        const format = opts?.format ?? 'figma';
        const output = formatCapturesOutput(captures, format, opts?.includeDesignSystem, false);
        await copyTextInPage(output);
        const copiedMsg =
          format === 'figma' || format === 'sketch' || format === 'figma-native'
            ? `✓ Copied ${captures.length} elements — press Cmd+V in Figma or Sketch!`
            : `✓ Copied ${captures.length} elements (${format.toUpperCase()}) — ready to paste!`;
        showPageToast(copiedMsg);
        resolve(captures);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showPageToast(`Failed to copy elements: ${msg}`, true);
        reject(err);
      }
    },
    onCancel: () => {
      if (cancelPick === cancel) cancelPick = undefined;
      showPageToast('Element selection cancelled');
      reject(new Error('Element selection cancelled'));
    },
  };
  cleanup = startElementPicker(document, pickerOpts);
  cancelPick = cancel;
  return promise;
};

customWindow.__captureKitCopyPageDirect = async (opts?: {
  format?: string;
  includeDesignSystem?: boolean;
}): Promise<void> => {
  showPageToast('Copying page…');
  try {
    const cap = await serializeDocument(document, { fastMode: true });
    const format = opts?.format ?? 'figma';
    const output = formatCapturesOutput([cap], format, opts?.includeDesignSystem, true);
    await copyTextInPage(output);
    const copiedMsg =
      format === 'figma' || format === 'sketch' || format === 'figma-native'
        ? '✓ Copied page — press Cmd+V in Figma or Sketch!'
        : `✓ Copied page (${format.toUpperCase()}) — ready to paste!`;
    showPageToast(copiedMsg);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showPageToast(`Failed to copy page: ${msg}`, true);
    throw err;
  }
};

