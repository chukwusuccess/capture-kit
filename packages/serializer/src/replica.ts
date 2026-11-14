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
  deferred: Promise<string>[];
  assets: string[];
  pending: Map<string, Promise<string | null>>;
}

const FETCH_LIMIT = 24;
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
      // type check, not instanceof: iframe rules come from another realm.
      if (rule.type === 3) {
        const imp = rule as CSSImportRule;
        if (imp.styleSheet) parts.push(wrapImport(imp, await sheetCss(ctx, imp.styleSheet)));
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

function defer(ctx: Ctx, text: Promise<string>): string {
  return `\u0001${ctx.deferred.push(text) - 1}\u0001`;
}

function styleTag(ctx: Ctx, sheets: CSSStyleSheet[]): string {
  if (!sheets.length) return '';
  const text = Promise.all(sheets.map((s) => sheetCss(ctx, s))).then((all) =>
    all.join('\n').replace(/<\/style/gi, '<\\/style')
  );
  return `<style>${defer(ctx, text)}</style>`;
}

// ---- DOM ----

const XHTML = 'http://www.w3.org/1999/xhtml';
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'noscript', 'base']);
const LINK_DROP = /\b(preload|prefetch|modulepreload|preconnect|dns-prefetch|manifest)\b/i;
const URL_ATTRS = new Set(['href', 'src', 'poster', 'action', 'formaction', 'xlink:href', 'data', 'background']);
const KEYFRAME_META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (name: string, v: string): string => ` ${name}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;

/** URLs the page paints get inlined; links and frames stay absolute. */
function painted(tag: string, name: string, rel: string): boolean {
  if (name === 'poster') return true;
  if (name === 'src') return tag === 'img' || tag === 'input' || tag === 'embed';
  if (tag === 'image') return name === 'href' || name === 'xlink:href';
  return tag === 'link' && /\bicon\b/i.test(rel);
}

// Script-driven (Web Animations API) end states live in no stylesheet and no
// style attribute, so a framer-motion fade-in would replay as opacity 0. Bake
// the current computed value of every animated property instead.
function bakeScriptAnimations(doc: Document): Map<Element, string> {
  const baked = new Map<Element, string>();
  for (const anim of doc.getAnimations()) {
    if ('animationName' in anim || 'transitionProperty' in anim) continue; // CSS replays these
    const effect = anim.effect as KeyframeEffect | null;
    const el = effect?.target;
    if (!el || effect.pseudoElement) continue;
    const cs = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
    const props = new Set<string>();
    for (const kf of effect.getKeyframes()) for (const key of Object.keys(kf)) if (!KEYFRAME_META.has(key)) props.add(key);
    let decl = baked.get(el) ?? '';
    for (const key of props) {
      const prop = key === 'cssFloat' ? 'float' : key.startsWith('--') ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      decl += `;${prop}:${cs.getPropertyValue(prop)}`;
    }
    baked.set(el, decl);
  }
  return baked;
}

function kids(ctx: Ctx, parent: Node, baked: Map<Element, string>): string {
  let s = '';
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) s += escText(n.nodeValue ?? '');
    else if (n.nodeType === 1) s += element(ctx, n as Element, baked);
  }
  return s;
}

function element(ctx: Ctx, el: Element, baked: Map<Element, string>): string {
  const tag = el.localName;
  if (DROP.has(tag)) return '';
  if (tag === 'meta' && /^(content-security-policy|refresh)$/i.test(el.getAttribute('http-equiv') ?? '')) return '';
  const rel = tag === 'link' ? (el.getAttribute('rel') ?? '') : '';
  if (tag === 'style' || (tag === 'link' && /\bstylesheet\b/i.test(rel))) {
    const sheet = (el as HTMLStyleElement).sheet;
    return sheet ? styleTag(ctx, [sheet as CSSStyleSheet]) : '';
  }
  if (tag === 'link' && LINK_DROP.test(rel)) return '';
  if (tag === 'source' && el.parentElement?.localName === 'picture') return ''; // the img keeps the chosen one

  // Live state that attributes don't reflect; null drops the attribute.
  const set: Record<string, string | null> = {};
  if (tag === 'img') {
    const img = el as HTMLImageElement;
    const src = img.currentSrc || img.src;
    if (src) set.src = asset(ctx, src);
    set.srcset = set.sizes = set.loading = null;
  } else if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') set.checked = input.checked ? '' : null;
    else if (input.type !== 'password' && input.type !== 'file') set.value = input.value;
  } else if (tag === 'option') {
    set.selected = (el as HTMLOptionElement).selected ? '' : null;
  }
  let extraStyle = baked.get(el) ?? '';
  if (tag === 'canvas') {
    try {
      const data = (el as HTMLCanvasElement).toDataURL();
      extraStyle += `;background:url("${data}") 0 0/100% 100% no-repeat`;
    } catch {
      // ponytail: tainted canvas stays blank; a tab screenshot crop would fill it.
    }
  }
  if (extraStyle) set.style = rewriteCss(ctx, el.getAttribute('style') ?? '', ctx.base) + extraStyle;
  if (tag === 'iframe') {
    let child: Document | null = null;
    try {
      child = (el as HTMLIFrameElement).contentDocument;
    } catch {
      // cross-origin: keeps its live src
    }
    if (child?.documentElement) {
      set.src = null;
      set.srcdoc = defer(ctx, replicate(child, ctx.opts, ctx.pending).then((h) => h.replace(/&/g, '&amp;').replace(/"/g, '&quot;')));
    }
  }

  let attrs = '';
  for (const { name, value } of Array.from(el.attributes)) {
    if (/^on/i.test(name) || name in set) continue;
    let v = value;
    if (name === 'style') v = rewriteCss(ctx, v, ctx.base);
    else if (URL_ATTRS.has(name)) {
      if (/^\s*javascript:/i.test(v)) continue;
      if (!v.startsWith('#')) v = absolute(v, ctx.base); // #id refs (svg <use>) must stay local
      if (painted(tag, name, rel)) v = asset(ctx, v);
    }
    attrs += attr(name, v);
  }
  // srcdoc is already escaped; attr() would double it.
  for (const [name, v] of Object.entries(set)) if (v !== null) attrs += name === 'srcdoc' ? ` srcdoc="${v}"` : attr(name, v);

  if (el.namespaceURI === XHTML && VOID.has(tag)) return `<${tag}${attrs}>`;
  let inner = tag === 'head' ? '<meta charset="utf-8">' : '';
  const shadow = ctx.opts.shadowRootOf?.(el) ?? el.shadowRoot;
  if (shadow) {
    const focus = shadow.delegatesFocus ? ' shadowrootdelegatesfocus' : '';
    inner += `<template shadowrootmode="open"${focus}>${kids(ctx, shadow, baked)}${styleTag(ctx, [...shadow.adoptedStyleSheets])}</template>`;
  }
  if (tag === 'textarea') inner += escText((el as HTMLTextAreaElement).value);
  else if (tag === 'template') inner += kids(ctx, (el as HTMLTemplateElement).content, baked);
  else inner += kids(ctx, el, baked);
  // Adopted sheets cascade after every document sheet, so they go last.
  if (tag === 'body') inner += styleTag(ctx, [...el.ownerDocument.adoptedStyleSheets]);
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

async function replicate(doc: Document, opts: ReplicaOptions, pending: Ctx['pending']): Promise<string> {
  const ctx: Ctx = { opts, base: doc.baseURI, deferred: [], assets: [], pending };
  const dt = doc.doctype;
  // Same doctype as the original, or none: quirks mode changes layout.
  const doctype = dt
    ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ''}${dt.systemId ? `${dt.publicId ? '' : ' SYSTEM'} "${dt.systemId}"` : ''}>\n`
    : '';
  let html = doctype + element(ctx, doc.documentElement, bakeScriptAnimations(doc));
  const deferred = await Promise.all(ctx.deferred);
  html = html.replace(/\u0001(\d+)\u0001/g, (_, i: string) => deferred[Number(i)]);
  const data = await Promise.all(ctx.assets.map((u) => pending.get(u)!));
  return html.replace(/\u0002(\d+)\u0002/g, (_, i: string) => data[Number(i)] ?? ctx.assets[Number(i)]);
}

/** One self-contained HTML file that renders identically to `doc` right now. */
export function replicateDocument(doc: Document, opts: ReplicaOptions): Promise<string> {
  // ponytail: inner scroll positions (scrollLeft carousels) reset to 0; restoring needs a script.
  return replicate(doc, opts, new Map());
}
