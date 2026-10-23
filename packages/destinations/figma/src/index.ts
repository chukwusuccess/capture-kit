import type { Capture } from '@capture-kit/model';

export interface FigmaExportOptions {
  pasteboardFormat?: 'clipboard' | 'file';
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
}

export function modelToFigma(_capture: Capture, _opts?: FigmaExportOptions): never {
  throw new Error('Figma destination is not implemented (Phase 3)');
}
