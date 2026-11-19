import { z } from "zod";

/**
 * The neutral capture model. Everything in capture-kit hangs off this:
 * the serializer produces it, every destination consumes it.
 * Destinations must treat this as read-only input.
 */

export const rgbaSchema = z.object({
  /** 0-255 */
  r: z.number().min(0).max(255),
  g: z.number().min(0).max(255),
  b: z.number().min(0).max(255),
  /** 0-1 */
  a: z.number().min(0).max(1),
});
export type Rgba = z.infer<typeof rgbaSchema>;

export const boxSchema = z.object({
  /** Absolute to the frame origin. */
  x: z.number(),
  y: z.number(),
  w: z.number().min(0),
  h: z.number().min(0),
});
export type Box = z.infer<typeof boxSchema>;

export const solidFillSchema = z.object({
  type: z.literal("solid"),
  color: rgbaSchema,
});
export const imageFillSchema = z.object({
  type: z.literal("image"),
  assetRef: z.string(),
});
export const fillSchema = z.discriminatedUnion("type", [solidFillSchema, imageFillSchema]);
export type Fill = z.infer<typeof fillSchema>;

export const strokeSchema = z.object({
  color: rgbaSchema,
  width: z.number().min(0),
});
export type Stroke = z.infer<typeof strokeSchema>;

export const cornerRadiusSchema = z.object({
  topLeft: z.number().min(0),
  topRight: z.number().min(0),
  bottomRight: z.number().min(0),
  bottomLeft: z.number().min(0),
});
export type CornerRadius = z.infer<typeof cornerRadiusSchema>;

export const shadowSchema = z.object({
  color: rgbaSchema,
  offsetX: z.number(),
  offsetY: z.number(),
  blur: z.number().min(0),
  spread: z.number().min(0),
  inset: z.boolean(),
});
export type Shadow = z.infer<typeof shadowSchema>;

export const styleSchema = z.object({
  fills: z.array(fillSchema),
  strokes: z.array(strokeSchema),
  opacity: z.number().min(0).max(1),
  radius: cornerRadiusSchema,
  shadows: z.array(shadowSchema),
});
export type Style = z.infer<typeof styleSchema>;

export const textAlignSchema = z.enum(["left", "center", "right", "justify"]);
export type TextAlign = z.infer<typeof textAlignSchema>;

export const textPropsSchema = z.object({
  content: z.string(),
  fontFamily: z.string(),
  fontSize: z.number().min(0),
  fontWeight: z.number(),
  /** Absolute pixels. */
  lineHeight: z.number().min(0),
  /** Absolute pixels. */
  letterSpacing: z.number(),
  align: textAlignSchema,
  color: rgbaSchema,
});
export type TextProps = z.infer<typeof textPropsSchema>;

export const nodeTypeSchema = z.enum(["frame", "text", "rect", "image"]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const captureNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  /** Ordering within a parent is array order (paint order). */
  type: nodeTypeSchema,
  box: boxSchema,
  style: styleSchema,
  text: textPropsSchema.optional(),
  assetRef: z.string().optional(),
});
/** Named CaptureNode to avoid clashing with the DOM `Node` type. */
export type CaptureNode = z.infer<typeof captureNodeSchema>;

export const frameSchema = z.object({
  width: z.number().min(0),
  height: z.number().min(0),
  baseURI: z.string(),
});
export type Frame = z.infer<typeof frameSchema>;

export const assetSchema = z.object({
  kind: z.enum(["image", "font"]),
  mimeType: z.string(),
  base64: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;

export const fontSchema = z.object({
  family: z.string(),
  weight: z.number(),
  /** Asset ref to an inlined font file, when available. */
  assetRef: z.string().optional(),
});
export type Font = z.infer<typeof fontSchema>;

export const MODEL_VERSION = 1;

export const captureSchema = z.object({
  url: z.string(),
  version: z.number().int(),
  frame: frameSchema,
  /** Flat list in paint order; parent/child expressed via parentId. */
  nodes: z.array(captureNodeSchema),
  assets: z.record(assetSchema),
  fonts: z.array(fontSchema),
  /** Optional alternate frames (e.g. responsive breakpoints) — reserved. */
  alternatives: z.array(frameSchema).optional(),
});
export type Capture = z.infer<typeof captureSchema>;

export function createEmptyCapture(url: string, frame: Frame): Capture {
  return {
    url,
    version: MODEL_VERSION,
    frame,
    nodes: [],
    assets: {},
    fonts: [],
  };
}
