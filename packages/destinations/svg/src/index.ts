import type { Capture, Rgba } from "@capture-kit/model";

/**
 * model -> SVG string. Phase 0 scope: rects/frames as <rect>, text as <text>.
 * Images render as <image> when the asset is inlined (data URI), else a gray
 * placeholder rect. Strokes are supported; shadows are dropped.
 * TODO(phase-2): text wrapping (SVG needs manual line breaks), stroke align.
 */
export function modelToSvg(capture: Capture): string {
  const { width, height } = capture.frame;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  for (const node of capture.nodes) {
    if (node.type === "text" && node.text) {
      const t = node.text;
      const anchor = t.align === "center" ? "middle" : t.align === "right" ? "end" : "start";
      const tx = t.align === "center" ? node.box.x + node.box.w / 2 : t.align === "right" ? node.box.x + node.box.w : node.box.x;
      const baseline = node.box.y + t.fontSize; // top of box + ascent approximation
      const content = escapeXml(t.content);
      parts.push(
        `<text x="${r(tx)}" y="${r(baseline)}" font-family="${escapeXml(t.fontFamily)}" font-size="${t.fontSize}" font-weight="${t.fontWeight}" letter-spacing="${t.letterSpacing}" text-anchor="${anchor}" fill="${rgba(t.color)}" opacity="${node.style.opacity}">${content}</text>`,
      );
      continue;
    }

    if (node.type === "image") {
      const asset = node.assetRef ? capture.assets[node.assetRef] : undefined;
      if (asset) {
        parts.push(
          `<image x="${r(node.box.x)}" y="${r(node.box.y)}" width="${r(node.box.w)}" height="${r(node.box.h)}" href="data:${asset.mimeType};base64,${asset.base64}"/>`,
        );
      } else {
        parts.push(rectEl(node.box.x, node.box.y, node.box.w, node.box.h, "#dddddd", node.style.radius, node.style.opacity));
      }
      continue;
    }

    // rect, and frames that carry a fill
    const solid = node.style.fills.find((f) => f.type === "solid");
    const fill = solid && solid.type === "solid" ? rgba(solid.color) : null;
    if (!fill) continue;
    const stroke = node.style.strokes[0];
    const strokeAttr = stroke
      ? ` stroke="${rgba(stroke.color)}" stroke-width="${stroke.width}"`
      : "";
    parts.push(
      `<rect x="${r(node.box.x)}" y="${r(node.box.y)}" width="${r(node.box.w)}" height="${r(node.box.h)}" rx="${node.style.radius.topLeft}" ry="${node.style.radius.topLeft}" fill="${fill}" opacity="${node.style.opacity}"${strokeAttr}/>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function rectEl(x: number, y: number, w: number, h: number, fill: string, radius: { topLeft: number }, opacity: number): string {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${radius.topLeft}" ry="${radius.topLeft}" fill="${fill}" opacity="${opacity}"/>`;
}

function rgba(c: Rgba): string {
  return c.a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}
