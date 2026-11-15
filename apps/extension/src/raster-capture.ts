export interface RasterBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RasterCaptureItem {
  key: string;
  box: RasterBox;
}

export interface RasterCaptureResult {
  key: string;
  success: boolean;
  reason?: 'off_screen' | 'raster_too_large' | 'capture_failed';
  mimeType?: string;
  base64?: string;
}

export interface PageViewportInfo {
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  prevX: number;
  prevY: number;
  dpr: number;
}

export interface RasterCanvasContext {
  drawImage: (...args: unknown[]) => void;
}

export interface RasterCanvas {
  width: number;
  height: number;
  getContext: (type: '2d') => RasterCanvasContext | null;
  convertToBlob: (opts: { type: string }) => Promise<Blob>;
}

export interface RasterBitmap {
  width: number;
  height: number;
  close: () => void;
}

export interface RasterCaptureDeps {
  getPageInfoAndHideOverlays: (tabId: number) => Promise<PageViewportInfo | null>;
  scrollTo: (tabId: number, x: number, y: number) => Promise<{ scrollX: number; scrollY: number } | null>;
  restoreOverlaysAndScroll: (tabId: number, prevX: number, prevY: number) => Promise<void>;
  captureVisibleTab: (windowId: number) => Promise<string>;
  decodeBitmap: (dataUrl: string) => Promise<RasterBitmap>;
  createCanvas: (w: number, h: number) => RasterCanvas;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  minIntervalMs?: number;
  maxTiles?: number;
  settleMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 510;
const DEFAULT_MAX_TILES = 4;
const DEFAULT_SETTLE_MS = 60;

let lastShotAt = 0;
let queueTail: Promise<unknown> = Promise.resolve();

export function resetRasterCaptureQueueForTest(): void {
  lastShotAt = 0;
  queueTail = Promise.resolve();
}

function enqueueRateLimitedShot<T>(
  minIntervalMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  fn: () => Promise<T>
): Promise<T> {
  const run = queueTail.then(async () => {
    const elapsed = now() - lastShotAt;
    if (lastShotAt > 0 && elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed);
    }
    lastShotAt = now();
    return fn();
  });
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isBoxInsideDocument(box: RasterBox, scrollWidth: number, scrollHeight: number): boolean {
  if (!(box.w > 0 && box.h > 0)) return false;
  if (box.x + box.w <= 0 || box.y + box.h <= 0) return false;
  if (box.x >= scrollWidth || box.y >= scrollHeight) return false;
  return true;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Capture multiple element bounding boxes using rate-limited, viewport-batched
 * screenshots, tiling elements larger than the viewport (up to maxTiles) and
 * hiding fixed/sticky overlays while shooting.
 */
export async function captureElementRects(
  deps: RasterCaptureDeps,
  tabId: number,
  windowId: number,
  items: RasterCaptureItem[]
): Promise<RasterCaptureResult[]> {
  if (items.length === 0) return [];
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const maxTiles = deps.maxTiles ?? DEFAULT_MAX_TILES;
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;

  const info = await deps.getPageInfoAndHideOverlays(tabId);
  if (!info || info.innerWidth <= 0 || info.innerHeight <= 0) {
    return items.map((item) => ({ key: item.key, success: false, reason: 'capture_failed' }));
  }

  const results = new Map<string, RasterCaptureResult>();
  const vw = info.innerWidth;
  const vh = info.innerHeight;
  const maxScrollX = Math.max(0, info.scrollWidth - vw);
  const maxScrollY = Math.max(0, info.scrollHeight - vh);
  const dpr = Math.max(1, info.dpr || 1);

  interface TileJob {
    item: RasterCaptureItem;
    tileX: number;
    tileY: number;
    tileW: number;
    tileH: number;
    destX: number;
    destY: number;
  }
  const singleItems: RasterCaptureItem[] = [];
  const multiItemTiles = new Map<string, { item: RasterCaptureItem; tiles: TileJob[] }>();

  for (const item of items) {
    if (!isBoxInsideDocument(item.box, info.scrollWidth, info.scrollHeight)) {
      results.set(item.key, { key: item.key, success: false, reason: 'off_screen' });
      continue;
    }
    const clampedW = Math.min(item.box.w, Math.max(1, info.scrollWidth - Math.max(0, item.box.x)));
    const clampedH = Math.min(item.box.h, Math.max(1, info.scrollHeight - Math.max(0, item.box.y)));
    const clampedBox: RasterBox = {
      x: Math.max(0, item.box.x),
      y: Math.max(0, item.box.y),
      w: clampedW,
      h: clampedH,
    };
    const tilesX = Math.ceil(clampedBox.w / vw);
    const tilesY = Math.ceil(clampedBox.h / vh);
    if (tilesX * tilesY > maxTiles) {
      results.set(item.key, { key: item.key, success: false, reason: 'raster_too_large' });
      continue;
    }
    if (tilesX === 1 && tilesY === 1) {
      singleItems.push({ key: item.key, box: clampedBox });
    } else {
      const tiles: TileJob[] = [];
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const ox = tx * vw;
          const oy = ty * vh;
          tiles.push({
            item: { key: item.key, box: clampedBox },
            tileX: clampedBox.x + ox,
            tileY: clampedBox.y + oy,
            tileW: Math.min(vw, clampedBox.w - ox),
            tileH: Math.min(vh, clampedBox.h - oy),
            destX: ox,
            destY: oy,
          });
        }
      }
      multiItemTiles.set(item.key, { item: { key: item.key, box: clampedBox }, tiles });
    }
  }

  // Group single-tile boxes that fit in the same viewport into one screenshot.
  interface ShotGroup {
    vx: number;
    vy: number;
    slices: Array<{
      key: string;
      box: RasterBox;
      destX: number;
      destY: number;
      canvasW: number;
      canvasH: number;
    }>;
  }

  const shotGroups: ShotGroup[] = [];
  const remaining = [...singleItems].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  while (remaining.length > 0) {
    const anchor = remaining.shift()!;
    const vx = Math.min(maxScrollX, Math.max(0, Math.floor(anchor.box.x)));
    const vy = Math.min(maxScrollY, Math.max(0, Math.floor(anchor.box.y)));
    const group: ShotGroup = {
      vx,
      vy,
      slices: [{
        key: anchor.key,
        box: anchor.box,
        destX: 0,
        destY: 0,
        canvasW: anchor.box.w,
        canvasH: anchor.box.h,
      }],
    };
    for (let i = remaining.length - 1; i >= 0; i--) {
      const cand = remaining[i];
      if (
        cand.box.x >= vx &&
        cand.box.y >= vy &&
        cand.box.x + cand.box.w <= vx + vw &&
        cand.box.y + cand.box.h <= vy + vh
      ) {
        group.slices.push({
          key: cand.key,
          box: cand.box,
          destX: 0,
          destY: 0,
          canvasW: cand.box.w,
          canvasH: cand.box.h,
        });
        remaining.splice(i, 1);
      }
    }
    shotGroups.push(group);
  }

  for (const entry of multiItemTiles.values()) {
    for (const tile of entry.tiles) {
      shotGroups.push({
        vx: Math.min(maxScrollX, Math.max(0, Math.floor(tile.tileX))),
        vy: Math.min(maxScrollY, Math.max(0, Math.floor(tile.tileY))),
        slices: [{
          key: entry.item.key,
          box: { x: tile.tileX, y: tile.tileY, w: tile.tileW, h: tile.tileH },
          destX: tile.destX,
          destY: tile.destY,
          canvasW: entry.item.box.w,
          canvasH: entry.item.box.h,
        }],
      });
    }
  }

  const stitchCanvases = new Map<string, RasterCanvas>();

  try {
    for (const group of shotGroups) {
      const scrolled = await deps.scrollTo(tabId, group.vx, group.vy);
      if (!scrolled) continue;
      if (settleMs > 0) await deps.sleep(settleMs);
      const dataUrl = await enqueueRateLimitedShot(minIntervalMs, deps.now, deps.sleep, () =>
        deps.captureVisibleTab(windowId)
      );
      const bitmap = await deps.decodeBitmap(dataUrl);
      try {
        for (const slice of group.slices) {
          const sx = Math.max(0, Math.round((slice.box.x - scrolled.scrollX) * dpr));
          const sy = Math.max(0, Math.round((slice.box.y - scrolled.scrollY) * dpr));
          const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(slice.box.w * dpr)));
          const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(slice.box.h * dpr)));
          let canvas = stitchCanvases.get(slice.key);
          if (!canvas) {
            canvas = deps.createCanvas(
              Math.max(1, Math.round(slice.canvasW * dpr)),
              Math.max(1, Math.round(slice.canvasH * dpr))
            );
            stitchCanvases.set(slice.key, canvas);
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(
            bitmap,
            sx,
            sy,
            sw,
            sh,
            Math.round(slice.destX * dpr),
            Math.round(slice.destY * dpr),
            sw,
            sh
          );
        }
      } finally {
        bitmap.close();
      }
    }

    for (const [key, canvas] of stitchCanvases) {
      try {
        const outBlob = await canvas.convertToBlob({ type: 'image/png' });
        const base64 = await blobToBase64(outBlob);
        results.set(key, { key, success: true, mimeType: 'image/png', base64 });
      } catch {
        results.set(key, { key, success: false, reason: 'capture_failed' });
      }
    }
  } finally {
    await deps.restoreOverlaysAndScroll(tabId, info.prevX, info.prevY).catch(() => undefined);
  }

  return items.map((item) => results.get(item.key) ?? { key: item.key, success: false, reason: 'capture_failed' });
}
