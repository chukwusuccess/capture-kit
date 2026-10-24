// Pixel-identical page snapshot: the live DOM plus the CSS Chrome actually
// parsed (CSS-in-JS insertRule output included), every asset inlined, as one
// self-contained HTML file. No page script survives — the frozen state does.

export interface ReplicaOptions {
  /** Fetch a URL as text or as a data: URL; null on failure. The extension
   *  routes this through its background worker so CORS can't block it. */
  fetch: (url: string, as: 'text' | 'data-url') => Promise<string | null>;
  /** Shadow root of an element, closed ones included where the host allows. */
  shadowRootOf?: (el: Element) => ShadowRoot | null;
}

// Deferred work is spliced in by placeholder: \u0001n\u0001 for CSS text,
// \u0002n\u0002 for inlined assets (falls back to the absolute URL).
interface Ctx {
  opts: ReplicaOptions;
  base: string;
  css: Promise<string>[];
  assets: string[];
  pending: Map<string, Promise<string | null>>;
}

const FETCH_LIMIT = 6;
let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= FETCH_LIMIT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function asset(ctx: Ctx, url: string): string {
  if (!/^https?:/i.test(url)) return url;
  if (!ctx.pending.has(url)) ctx.pending.set(url, limited(() => ctx.opts.fetch(url, 'data-url')));
  return `\u0002${ctx.assets.push(url) - 1}\u0002`;
}

function rewriteCss(ctx: Ctx, css: string, base: string): string {
  return css
    .replace(/@import\s+(['"])(.*?)\1/g, '@import url($1$2$1)')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, _q: string, raw: string) => {
      const u = raw.trim();
      if (!u || u.startsWith('#') || u.startsWith('data:') || u.startsWith('\u0002')) return m;
      return `url("${asset(ctx, absolute(u, base))}")`;
    })
    // Custom elements never get defined in a script-free replica.
    .replace(/:not\(:defined\)/g, ':not(*)')
    .replace(/:defined/g, ':is(*)');
}

function wrapImport(rule: CSSImportRule, css: string): string {
  const media = rule.media?.mediaText;
  if (media && media !== 'all') css = `@media ${media} {\n${css}\n}`;
  const supports = (rule as CSSImportRule & { supportsText?: string | null }).supportsText;
  if (supports) css = `@supports ${supports} {\n${css}\n}`;
  const layer = (rule as CSSImportRule & { layerName?: string | null }).layerName;
  if (layer != null) css = `@layer ${layer} {\n${css}\n}`;
  return css;
}

async function sheetCss(ctx: Ctx, sheet: CSSStyleSheet): Promise<string> {
  if (sheet.disabled) return '';
  const base = sheet.href ?? ctx.base;
  let rules: CSSRuleList | null = null;
  try {
    rules = sheet.cssRules;
  } catch {
    // Cross-origin sheet: the CSSOM is locked, so take the source text.
  }
  let css = '';
  if (rules) {
    const parts: string[] = [];
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) parts.push(wrapImport(rule, await sheetCss(ctx, rule.styleSheet)));
      } else {
        parts.push(rewriteCss(ctx, rule.cssText, base));
      }
    }
    css = parts.join('\n');
  } else if (sheet.href) {
    css = rewriteCss(ctx, (await limited(() => ctx.opts.fetch(sheet.href!, 'text'))) ?? '', base);
  }
  const media = sheet.media?.mediaText;
  return media && media !== 'all' ? `@media ${media} {\n${css}\n}` : css;
}

function styleTag(ctx: Ctx, sheets: CSSStyleSheet[]): string {
  if (!sheets.length) return '';
  const text = Promise.all(sheets.map((s) => sheetCss(ctx, s))).then((all) =>
    all.join('\n').replace(/<\/style/gi, '<\\/style')
  );
  return `<style>\u0001${ctx.css.push(text) - 1}\u0001</style>`;
}
