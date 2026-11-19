import type { Capture } from "@capture-kit/model";

/**
 * Placeholder for the Figma destination (Phase 3).
 *
 * The plan: build the Figma clipboard payload (the internal paste JSON that
 * the Figma web app accepts) so users can paste a capture directly onto a
 * Figma canvas. Shape is intentionally unknown until Phase 3 research.
 */
export type FigmaClipboardPayload = unknown;

export function modelToFigmaClipboard(_capture: Capture): FigmaClipboardPayload {
  throw new Error("figma destination: not implemented (Phase 3)");
}
