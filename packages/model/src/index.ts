import { z } from 'zod';

export const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().gte(0, 'Width must be non-negative'),
  h: z.number().gte(0, 'Height must be non-negative'),
});

export const GradientStopSchema = z.object({
  color: z.string(),
  position: z.number().min(0).max(1),
});

export const FillSchema = z.object({
  type: z.enum(['solid', 'image', 'gradient']).default('solid'),
  color: z.string().optional(),
  assetRef: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  gradientType: z.enum(['linear', 'radial']).optional(),
  angle: z.number().optional(),
  stops: z.array(GradientStopSchema).optional(),
  cx: z.number().min(0).max(1).optional(),
  cy: z.number().min(0).max(1).optional(),
});

export const StrokeSchema = z.object({
  color: z.string(),
  width: z.number().gte(0),
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  side: z.enum(['all', 'top', 'right', 'bottom', 'left']).optional(),
});

export const CornerRadiusSchema = z.object({
  topLeft: z.number().gte(0),
  topRight: z.number().gte(0),
  bottomRight: z.number().gte(0),
  bottomLeft: z.number().gte(0),
});

export const ShadowSchema = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number().gte(0),
  spread: z.number().optional(),
  color: z.string(),
  inset: z.boolean().optional(),
});
export const LayoutSchema = z.object({
  mode: z.enum(['none', 'horizontal', 'vertical', 'grid']).default('none'),
  gap: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
  justifyContent: z
    .enum(['start', 'center', 'end', 'between', 'around', 'evenly'])
    .optional(),
  alignItems: z
    .enum(['start', 'center', 'end', 'stretch', 'baseline'])
    .optional(),
  wrap: z.boolean().optional(),
});


export const StyleSchema = z.object({
  fills: z.array(FillSchema).default([]),
  strokes: z.array(StrokeSchema).default([]),
  opacity: z.number().min(0).max(1).default(1),
  radius: CornerRadiusSchema.default({
    topLeft: 0,
    topRight: 0,
    bottomRight: 0,
    bottomLeft: 0,
  }),
  shadows: z.array(ShadowSchema).default([]),
  clip: z.boolean().optional().default(false),
  clipPath: z.string().optional(),
  layout: LayoutSchema.optional(),
  // Pixel-fidelity fields: only present when they differ from the CSS default,
  // so captures stay small and older consumers ignore them.
  transform: z.string().optional(),
  transformOrigin: z.string().optional(),
  filter: z.string().optional(),
  backdropFilter: z.string().optional(),
  mixBlendMode: z.string().optional(),
  backgroundSize: z.string().optional(),
  backgroundPosition: z.string().optional(),
  backgroundRepeat: z.string().optional(),
  backgroundClip: z.string().optional(),
  // CSS mask-image (e.g. radial fade on glow washes): capture the raw value;
  // destinations render it as an SVG mask so masked nodes don't paint solid.
  maskImage: z.string().optional(),
  interactiveClasses: z.array(z.string()).optional(),
  hoverStyle: z.record(z.string(), z.string()).optional(),
});

export const TextRunSchema = z.object({
  text: z.string(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  color: z.string().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
});

export const TextPropsSchema = z.object({
  content: z.string(),
  fontFamily: z.string(),
  fontSize: z.number().gte(0),
  fontWeight: z.union([z.string(), z.number()]),
  lineHeight: z.union([z.string(), z.number()]),
  letterSpacing: z.union([z.string(), z.number()]),
  align: z.enum(['left', 'center', 'right', 'justify']),
  wordSpacing: z.union([z.string(), z.number()]).optional(),
  textStroke: z.string().optional(),
  writingMode: z.string().optional(),
  direction: z.string().optional(),
  color: z.string(),
  italic: z.boolean().optional(),
  decoration: z.string().optional(),
  textTransform: z.string().optional(),
  textShadow: z.string().optional(),
  overflow: z.string().optional(),
  runs: z.array(TextRunSchema).optional(),
});

export const AssetSchema = z.object({
  kind: z.enum(['image', 'font']),
  mimeType: z.string(),
  base64: z.string(),
});

export const FontSchema = z.object({
  family: z.string(),
  weight: z.union([z.string(), z.number()]).optional(),
  style: z.string().optional(),
  assetRef: z.string().optional(),
});

export const FrameSchema = z.object({
  width: z.number().gte(0),
  height: z.number().gte(0),
  baseURI: z.string(),
  background: z.string().optional(),
});

export const VectorPathSchema = z.object({
  d: z.string(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
});

export const VectorViewBoxSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const NodeSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  parentId: z.string().optional(),
  type: z.enum(['frame', 'text', 'rect', 'image', 'vector']),
  box: BoxSchema,
  style: StyleSchema,
  text: TextPropsSchema.optional(),
  assetRef: z.string().optional(),
  vectorPaths: z.array(VectorPathSchema).optional(),
  // Intrinsic svg viewBox size: lets destinations scale paths into box.
  vectorViewBox: VectorViewBoxSchema.optional(),
  objectFit: z.enum(['fill', 'contain', 'cover', 'none', 'scale-down']).optional(),
  objectPosition: z.string().optional(),
});

export const CaptureSchema = z.object({
  url: z.string(),
  version: z.string(),
  frame: FrameSchema,
  nodes: z.array(NodeSchema),
  assets: z.record(z.string(), AssetSchema),
  fonts: z.array(FontSchema),
  alternatives: z.array(FrameSchema).optional(),
});

export const SitePageCaptureSchema = z.object({
  url: z.string(),
  path: z.string(),
  title: z.string().optional(),
  capture: CaptureSchema,
});

export const SiteCaptureSchema = z.object({
  domain: z.string(),
  capturedAt: z.string(),
  pages: z.array(SitePageCaptureSchema),
});

export type Box = z.infer<typeof BoxSchema>;
export type GradientStop = z.infer<typeof GradientStopSchema>;
export type Fill = z.infer<typeof FillSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type CornerRadius = z.infer<typeof CornerRadiusSchema>;
export type Shadow = z.infer<typeof ShadowSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type TextRun = z.infer<typeof TextRunSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type TextProps = z.infer<typeof TextPropsSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Font = z.infer<typeof FontSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type VectorPath = z.infer<typeof VectorPathSchema>;
export type VectorViewBox = z.infer<typeof VectorViewBoxSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Capture = z.infer<typeof CaptureSchema>;
export type SitePageCapture = z.infer<typeof SitePageCaptureSchema>;
export type SiteCapture = z.infer<typeof SiteCaptureSchema>;

export function emptyCapture(opts: Partial<Capture> = {}): Capture {
  return {
    url: opts.url ?? 'about:blank',
    version: opts.version ?? '0.2.1',
    frame: opts.frame ?? {
      width: 1200,
      height: 800,
      baseURI: 'about:blank',
    },
    nodes: opts.nodes ?? [],
    assets: opts.assets ?? {},
    fonts: opts.fonts ?? [],
    ...(opts.alternatives ? { alternatives: opts.alternatives } : {}),
  };
}
