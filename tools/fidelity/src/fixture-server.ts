import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makeTestPng(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 4;
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      raw[p] = border ? 24 : Math.round((x / width) * 220 + 20);
      raw[p + 1] = border ? 56 : Math.round((y / height) * 180 + 40);
      raw[p + 2] = border ? 96 : 190;
      raw[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const XORIGIN_PNG = makeTestPng(180, 110);
const XORIGIN_FRAME_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:linear-gradient(135deg,#1b3b5a,#2d6a8e);color:#fff;font:14px/1.4 Arial,sans-serif;padding:14px}
h3{font-size:16px;margin-bottom:6px}
.badge{display:inline-block;background:#f4a261;color:#1b263b;padding:2px 8px;border-radius:4px;font-weight:bold;font-size:12px}
</style></head><body><h3>Cross-origin frame</h3><span class="badge">Port B</span></body></html>`;

export interface FixtureServers {
  primaryBaseUrl: string;
  crossOriginBaseUrl: string;
  close(): Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Invalid server address'));
      resolve(addr.port);
    });
  });
}

export async function startFixtureServers(fixturesDir: string): Promise<FixtureServers> {
  const primary = createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0].replace(/^\/+/, '');
    const filePath = join(fixturesDir, reqPath);
    if (!reqPath || reqPath.includes('..') || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mime = ext === 'html' ? 'text/html; charset=utf-8' : ext === 'png' ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  });

  // Intentionally omits Access-Control-Allow-Origin so browser fetches hit CORS.
  const crossOrigin = createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    if (reqPath === '/xorigin.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(XORIGIN_PNG);
      return;
    }
    if (reqPath === '/xorigin-frame.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(XORIGIN_FRAME_HTML);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const [portA, portB] = await Promise.all([listen(primary), listen(crossOrigin)]);
  return {
    primaryBaseUrl: `http://127.0.0.1:${portA}`,
    crossOriginBaseUrl: `http://127.0.0.1:${portB}`,
    close: async () => {
      await Promise.all([
        new Promise<void>((r) => primary.close(() => r())),
        new Promise<void>((r) => crossOrigin.close(() => r())),
      ]);
    },
  };
}
