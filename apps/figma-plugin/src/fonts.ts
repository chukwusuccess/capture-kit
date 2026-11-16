import type { Capture, Node } from '@capture-kit/model';
import { formatFontSubstitutionSummary, nativeTextAlignment, resolveFigmaFontChoice } from '@capture-kit/destination-figma/native';
import type { PaintImporter, Warn } from './paints.js';
export class FontImporter {
  private loaded = new Map<string, Promise<void>>();
  private availableNames: FontName[];
  readonly substitutions = new Map<string, string>();

  constructor(fonts: Font[], private paints: PaintImporter, private warn: Warn, private captureFonts?: Capture['fonts']) {
    this.availableNames = fonts.map((f) => f.fontName);
  }

  getSubstitutionsSummary(): string | null {
    return formatFontSubstitutionSummary(this.substitutions);
  }

  private async resolve(familyList: string, weight: string | number, italic: boolean, nodeId: string): Promise<FontName> {
    const res = resolveFigmaFontChoice(this.availableNames, familyList, weight, italic, this.captureFonts);
    const font = res.font;
    if (res.reason === 'nearest-weight') {
      this.warn('native-font-style-fallback', `Requested ${weight}${italic ? ' italic' : ''} in '${res.requestedFamily}'; using nearest style '${font.style}'.`, nodeId);
    } else if (res.reason !== 'exact') {
      const targetLabel = `${font.family} ${font.style}`;
      this.substitutions.set(res.requestedFamily, font.family);
      this.warn('native-font-family-fallback', `Font '${res.requestedFamily}' is unavailable (${res.reason}). Substituted '${targetLabel}'.`, nodeId);
    }
    const key = `${font.family}\u0000${font.style}`;
    let loading = this.loaded.get(key);
    if (!loading) {
      loading = figma.loadFontAsync(font);
      this.loaded.set(key, loading);
    }
    await loading;
    return font;
  }

  async apply(target: TextNode, source: Node): Promise<void> {
    const text = source.text!;
    const font = await this.resolve(text.fontFamily, text.fontWeight, text.italic ?? false, source.id);
    // A newly created TextNode may use a different default font. Load that font
    // as well before replacing its text/font, per the Figma text editing API.
    if (target.fontName !== figma.mixed) await figma.loadFontAsync(target.fontName);
    target.fontName = font;
    target.fontSize = Math.max(0.01, text.fontSize);
    target.characters = text.content;
    target.textAutoResize = 'NONE';
    target.textAlignHorizontal = nativeTextAlignment(text.align);
    const color = this.paints.color(text.color, source.id);
    target.fills = color ? [color] : [];
    if (text.lineHeight === 'normal') target.lineHeight = { unit: 'AUTO' };
    else {
      const height = Number.parseFloat(String(text.lineHeight));
      if (Number.isFinite(height) && height > 0) target.lineHeight = { unit: String(text.lineHeight).endsWith('%') ? 'PERCENT' : 'PIXELS', value: height };
      else this.warn('native-line-height', 'Unsupported line height; using Figma automatic line height.', source.id);
    }
    const spacing = Number.parseFloat(String(text.letterSpacing));
    if (Number.isFinite(spacing)) target.letterSpacing = { unit: String(text.letterSpacing).endsWith('%') ? 'PERCENT' : 'PIXELS', value: spacing };
    if (text.decoration?.includes('underline')) target.textDecoration = 'UNDERLINE';
    else if (text.decoration?.includes('line-through')) target.textDecoration = 'STRIKETHROUGH';
    if (text.textTransform === 'uppercase') target.textCase = 'UPPER';
    else if (text.textTransform === 'lowercase') target.textCase = 'LOWER';
    else if (text.textTransform === 'capitalize') target.textCase = 'TITLE';
    const unsupported = [
      text.wordSpacing && text.wordSpacing !== 'normal' && Number.parseFloat(String(text.wordSpacing)) !== 0 ? 'word spacing' : '',
      text.textStroke ? 'text stroke' : '', text.textShadow && text.textShadow !== 'none' ? 'text shadow' : '',
      text.writingMode && text.writingMode !== 'horizontal-tb' ? 'vertical writing' : '',
      text.direction === 'rtl' ? 'explicit RTL direction' : '',
      text.overflow && text.overflow !== 'clip' ? 'text overflow' : '',
    ].filter(Boolean);
    if (unsupported.length) this.warn('native-text-css', `Not reproduced: ${unsupported.join(', ')}. Text remains editable within captured bounds.`, source.id);
    if (!text.runs?.length) return;
    if (text.runs.map((run) => run.text).join('') !== text.content) {
      this.warn('native-text-run-mismatch', 'Text runs do not match the captured content. Kept the content with its base typography.', source.id);
      return;
    }
    if (text.runs.some((run) => run.x !== undefined || run.y !== undefined || run.w !== undefined)) this.warn('native-text-run-position', 'Inline run positions are reflowed by Figma rather than individually positioned.', source.id);
    let start = 0;
    for (const run of text.runs) {
      const end = start + run.text.length;
      if (end > start) {
        const runFont = await this.resolve(run.fontFamily ?? text.fontFamily, run.fontWeight ?? text.fontWeight, run.italic ?? text.italic ?? false, source.id);
        target.setRangeFontName(start, end, runFont);
        target.setRangeFontSize(start, end, Math.max(0.01, run.fontSize ?? text.fontSize));
        const paint = this.paints.color(run.color ?? text.color, source.id);
        if (paint) target.setRangeFills(start, end, [paint]);
        if (run.underline) target.setRangeTextDecoration(start, end, 'UNDERLINE');
      }
      start = end;
    }
  }
}
