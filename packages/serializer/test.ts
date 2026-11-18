import assert from 'node:assert';
import { CaptureSchema } from '@capture-kit/model';
import { arrayBufferToBase64, doesFontFaceCover, extractSvgPaths, normalizeCssColor, parseBoxShadow, reconcileMissingFonts, serializeDocument, serializeElement, startElementPicker, transcodeForDestinations, triggerPageScroll, waitForImages } from './src/index.js';

interface MockComputedStyle {
  display: string;
  visibility: string;
  backgroundColor: string;
  backgroundImage: string;
  backgroundClip?: string;
  webkitBackgroundClip?: string;
  webkitTextFillColor?: string;
  opacity: string;
  borderTopWidth: string;
  borderTopStyle: string;
  borderTopColor: string;
  borderRightWidth: string;
  borderRightStyle: string;
  borderRightColor: string;
  borderBottomWidth: string;
  borderBottomStyle: string;
  borderBottomColor: string;
  borderLeftWidth: string;
  borderLeftStyle: string;
  borderLeftColor: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  boxShadow: string;
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  color: string;
  content?: string;
  position?: string;
  top?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
}

const defaultStyle: MockComputedStyle = {
  display: 'block',
  visibility: 'visible',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  opacity: '1',
  borderTopWidth: '0px',
  borderTopStyle: 'none',
  borderTopColor: 'transparent',
  borderRightWidth: '0px',
  borderRightStyle: 'none',
  borderRightColor: 'transparent',
  borderBottomWidth: '0px',
  borderBottomStyle: 'none',
  borderBottomColor: 'transparent',
  borderLeftWidth: '0px',
  borderLeftStyle: 'none',
  borderLeftColor: 'transparent',
  borderTopLeftRadius: '0px',
  borderTopRightRadius: '0px',
  borderBottomRightRadius: '0px',
  borderBottomLeftRadius: '0px',
  boxShadow: 'none',
  fontSize: '16px',
  fontWeight: '400',
  fontFamily: 'Helvetica',
  lineHeight: '20px',
  letterSpacing: '0px',
  textAlign: 'left',
  color: 'rgba(0, 0, 0, 1)',
};

class MockNode {
  nodeType: number;
  textContent: string | null;
  parentNode: MockElement | null = null;

  constructor(nodeType: number, textContent: string | null = null) {
    this.nodeType = nodeType;
    this.textContent = textContent;
  }
}

class MockElement extends MockNode {
  tagName: string;
  children: MockElement[] = [];
  childNodes: MockNode[] = [];
  styleOverrides: Partial<MockComputedStyle> = {};
  pseudoOverrides?: Record<string, Partial<MockComputedStyle>>;
  style: Record<string, string> = {};
  id = '';
  rect = { left: 0, top: 0, width: 100, height: 40 };
  outerHTML = '';
  value = '';
  placeholder = '';
  src = '';
  currentSrc = '';
  complete = true;
  naturalWidth = 100;
  decode?: () => Promise<void>;
  ownerDocument: Document = null as unknown as Document;
  contentDocument?: unknown;
  toDataURL?: () => string;
  width = 100;
  height = 40;

  constructor(tagName: string, rect?: { left: number; top: number; width: number; height: number }) {
    super(1 /* ELEMENT_NODE */);
    this.tagName = tagName.toUpperCase();
    if (rect) this.rect = rect;
  }

  get parentElement(): MockElement | null {
    return this.parentNode;
  }

  get firstElementChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  get nextElementSibling(): MockElement | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    return idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1] : null;
  }

  appendChild<T extends MockNode>(child: T): T {
    child.parentNode = this;
    if (child instanceof MockElement) {
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
    }
    this.childNodes.push(child);
    return child;
  }
  removeChild<T extends MockNode>(child: T): T {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    if (child instanceof MockElement) {
      this.children = this.children.filter((c) => c !== child);
    }
    return child;
  }

  querySelectorAll(sel: string): MockElement[] {
    const tags = new Set(
      sel
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[a-z0-9-]+$/.test(s))
    );
    const result: MockElement[] = [];
    for (const child of this.children) {
      if (tags.has(child.tagName.toLowerCase())) result.push(child);
      result.push(...child.querySelectorAll(sel));
    }
    return result;
  }

  classList = { add(_cls: string): void {}, contains(_cls: string): boolean { return false; } };
  contains(el: unknown): boolean {
    if (el === this) return true;
    return this.children.some((c) => c.contains(el));
  }
  attrs = new Map<string, string>();
  dAttr = '';
  pointsAttr = '';
  setAttribute(attr: string, val: string): void {
    this.attrs.set(attr, val);
    if (attr === 'id') this.id = val;
    if (attr === 'd') this.dAttr = val;
    if (attr === 'points') this.pointsAttr = val;
  }
  getAttribute(attr: string): string | null {
    if (this.attrs.has(attr)) return this.attrs.get(attr)!;
    if (attr === 'src') return this.src;
    if (attr === 'd') return this.dAttr || null;
    if (attr === 'points') return this.pointsAttr || null;
    if (attr === 'x' || attr === 'y') return '0';
    if (attr === 'width') return String(this.rect.width);
    if (attr === 'height') return String(this.rect.height);
    if (attr === 'cx' || attr === 'cy') return '12';
    if (attr === 'r') return '10';
    return null;
  }

  getBoundingClientRect() {
    return {
      left: this.rect.left,
      top: this.rect.top,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
      width: this.rect.width,
      height: this.rect.height,
      x: this.rect.left,
      y: this.rect.top,
      toJSON: () => {},
    };
  }
}

function createMockDocument() {
  const body = new MockElement('body', { left: 0, top: 0, width: 1200, height: 800 });
  const html = new MockElement('html', { left: 0, top: 0, width: 1200, height: 800 });
  html.appendChild(body);

  const styleMap = new Map<MockElement, MockComputedStyle>();

  const scrolledPositions: number[] = [];
  const listeners = new Map<string, Array<EventListener>>();
  const doc = {
    documentElement: html,
    body,
    baseURI: 'https://example.com/demo',
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    createElement: (tag: string) => {
      const el = new MockElement(tag);
      el.ownerDocument = doc as unknown as Document;
      return el;
    },
    getElementById: (id: string) => {
      function findById(root: MockElement): MockElement | null {
        if (root.id === id) return root;
        for (const child of root.children) {
          const found = findById(child);
          if (found) return found;
        }
        return null;
      }
      return findById(html);
    },
    addEventListener: (type: string, fn: EventListener) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
    elementFromPoint: () => null,
    defaultView: {
      location: { href: 'https://example.com/demo', origin: 'https://example.com' },
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1200,
      innerHeight: 800,
      scrollTo: (x: number, y: number) => {
        scrolledPositions.push(y);
        doc.defaultView.scrollX = x;
        doc.defaultView.scrollY = y;
      },
      getComputedStyle: (el: MockElement, pseudo?: string): MockComputedStyle => {
        if (pseudo && el.pseudoOverrides?.[pseudo]) {
          return { ...defaultStyle, ...el.pseudoOverrides[pseudo] };
        }
        return styleMap.get(el) ?? { ...defaultStyle, ...el.styleOverrides };
      },
    },
    createTreeWalker: (root: MockElement) => {
      const all: MockElement[] = [];
      function collect(el: MockElement) {
        all.push(el);
        for (const child of el.children) {
          collect(child);
        }
      }
      collect(root);
      let idx = 0;
      return {
        currentNode: all[0] ?? null,
        nextNode: () => {
          idx++;
          return all[idx] ?? null;
        },
      };
    },
    createRange: () => {
      return {
        selectNodeContents: () => {},
        getBoundingClientRect: () => ({
          left: 10,
          top: 15,
          right: 90,
          bottom: 35,
          width: 80,
          height: 20,
          x: 10,
          y: 15,
          toJSON: () => {},
        }),
      };
    },
    fonts: {
      forEach: (cb: (f: { family: string; weight: string; style: string }) => void) => {
        cb({ family: 'MockHeadingFont', weight: '700', style: 'normal' });
      },
    },
  };
  html.ownerDocument = doc as unknown as Document;
  body.ownerDocument = doc as unknown as Document;
  Object.assign(doc.defaultView, { document: doc });
  return { doc, body, styleMap, scrolledPositions, listeners };
}

async function runSerializerAccuracyTests() {
  // Node test env has no XMLSerializer: serialize mocks from outerHTML.
  (globalThis as Record<string, unknown>).XMLSerializer = class {
    serializeToString(el: { outerHTML?: string }): string {
      return el.outerHTML ?? '<svg/>';
    }
  };
  const { doc, body, scrolledPositions } = createMockDocument();


  // 1. Container with background + text
  const card = new MockElement('div', { left: 20, top: 20, width: 300, height: 150 });
  card.styleOverrides = {
    backgroundColor: 'rgba(255, 255, 255, 1)',
    borderTopLeftRadius: '8px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'rgba(200, 200, 200, 1)',
  };
  card.pseudoOverrides = {
    '::before': {
      content: '"BULLET"',
      color: 'rgba(239, 68, 68, 1)',
      fontSize: '12px',
    },
  };
  const cardText = new MockNode(3 /* TEXT_NODE */, 'Card Header Text');
  card.appendChild(cardText);
  body.appendChild(card);

  // 2. Inline SVG element
  const svgEl = new MockElement('svg', { left: 40, top: 40, width: 24, height: 24 });
  const svgPath = new MockElement('path');
  svgPath.dAttr = 'M0 0h24v24H0z';
  svgEl.querySelectorAll = () => [svgPath];
  svgEl.outerHTML = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
  body.appendChild(svgEl);
  // Canvas element (WebGL/2D)
  const canvasEl = new MockElement('canvas', { left: 400, top: 40, width: 120, height: 80 });
  canvasEl.width = 120;
  canvasEl.height = 80;
  canvasEl.toDataURL = () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  body.appendChild(canvasEl);


  // 3. CSS background-image with data URI
  const banner = new MockElement('div', { left: 20, top: 200, width: 400, height: 100 });
  banner.styleOverrides = {
    backgroundImage:
      'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")',
  };
  body.appendChild(banner);

  // 4. Form input with value
  const inputEl = new MockElement('input', { left: 20, top: 320, width: 200, height: 36 });
  inputEl.value = 'User Input Text';
  inputEl.styleOverrides = {
    backgroundColor: 'rgba(240, 240, 240, 1)',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'rgba(100, 100, 100, 1)',
  };
  body.appendChild(inputEl);

  // 5. Same-origin iframe
  const iframeEl = new MockElement('iframe', { left: 50, top: 500, width: 300, height: 200 });
  const iframeMockDoc = createMockDocument();
  const iframeChild = new MockElement('div', { left: 10, top: 15, width: 100, height: 30 });
  const iframeChildText = new MockNode(3 /* TEXT_NODE */, 'Iframe Embedded Content');
  iframeChild.appendChild(iframeChildText);
  iframeMockDoc.body.appendChild(iframeChild);
  iframeEl.contentDocument = iframeMockDoc.doc;
  body.appendChild(iframeEl);

  // Run serializer
  const capture = await serializeDocument(doc as unknown as Document);

  // Schema assertion
  const validated = CaptureSchema.parse(capture);
  assert.ok(validated, 'Capture failed schema validation');

  // Verify container + text separation on Card
  const cardNode = validated.nodes.find((n) => n.box.x === 20 && n.box.y === 20);
  assert.ok(cardNode, 'Card container node not found');
  assert.strictEqual(cardNode.type, 'rect');
  assert.strictEqual(cardNode.style.fills[0]?.color, 'rgba(255, 255, 255, 1)');
  assert.strictEqual(cardNode.style.radius.topLeft, 8);

  const cardTextNode = validated.nodes.find(
    (n) => n.parentId === cardNode.id && n.text?.content === 'Card Header Text'
  );
  assert.ok(cardTextNode, 'Card child text node not found');
  assert.strictEqual(cardTextNode.type, 'text');
  // Verify ::before pseudo-element
  const beforeNode = validated.nodes.find(
    (n) => n.parentId === cardNode.id && n.text?.content === 'BULLET'
  );
  assert.ok(beforeNode, '::before pseudo-element node not found');
  assert.strictEqual(beforeNode.text?.color, 'rgba(239, 68, 68, 1)');

  // Verify inline SVG
  const svgNode = validated.nodes.find((n) => n.box.x === 40 && n.box.y === 40);
  assert.ok(svgNode, 'SVG node not found');
  assert.strictEqual(svgNode.type, 'vector');
  assert.ok(svgNode.vectorPaths && svgNode.vectorPaths.length > 0, 'SVG node missing vectorPaths');
  assert.strictEqual(svgNode.vectorPaths[0].d, 'M0 0h24v24H0z');

  // Verify Canvas snapshotting
  const canvasNode = validated.nodes.find((n) => n.box.x === 400 && n.box.y === 40);
  assert.ok(canvasNode, 'Canvas node not found');
  assert.strictEqual(canvasNode.type, 'image');
  assert.ok(canvasNode.assetRef, 'Canvas node missing assetRef');
  assert.ok(validated.assets[canvasNode.assetRef], 'Canvas snapshot asset not found');

  // Verify CSS background-image
  const bannerNode = validated.nodes.find((n) => n.box.x === 20 && n.box.y === 200);
  assert.ok(bannerNode, 'Banner node with bg image not found');
  const imageFill = bannerNode.style.fills.find((f) => f.type === 'image');
  assert.ok(imageFill, 'Image fill not found on banner');
  assert.ok(imageFill.assetRef, 'Image fill missing assetRef');
  assert.ok(validated.assets[imageFill.assetRef], 'Background image asset not found in assets registry');

  // Verify Form input
  const inputNode = validated.nodes.find((n) => n.box.x === 20 && n.box.y === 320 && n.type === 'rect');
  assert.ok(inputNode, 'Input container node not found');
  const inputTextNode = validated.nodes.find(
    (n) => n.parentId === inputNode.id && n.text?.content === 'User Input Text'
  );
  assert.ok(inputTextNode, 'Input text node not found');

  // Verify same-origin iframe traversal
  const iframeNode = validated.nodes.find((n) => n.box.x === 50 && n.box.y === 500 && n.type === 'frame');
  assert.ok(iframeNode, 'Iframe container node not found');
  const iframeTextNode = validated.nodes.find(
    (n) => n.text?.content === 'Iframe Embedded Content'
  );
  assert.ok(iframeTextNode, 'Iframe child text node not found');
  assert.strictEqual(iframeTextNode.box.x, 60, 'Iframe child x offset mismatch (50 + 10 = 60)');
  assert.strictEqual(iframeTextNode.box.y, 515, 'Iframe child y offset mismatch (500 + 15 = 515)');

  // Verify serializeElement on isolated component
  const elCapture = await serializeElement(card as unknown as Element);
  assert.strictEqual(elCapture.frame.width, 300, 'Element capture width mismatch');
  assert.strictEqual(elCapture.frame.height, 150, 'Element capture height mismatch');
  const relativeCard = elCapture.nodes.find((n) => n.box.x === 0 && n.box.y === 0);
  assert.ok(relativeCard, 'Element capture root node should be normalized to (0, 0)');

  // Verify startElementPicker lifecycle
  const cleanupPicker = startElementPicker(doc as unknown as Document, {
    onSelect: () => {},
    onCancel: () => {},
  });
  assert.strictEqual(typeof cleanupPicker, 'function');
  cleanupPicker();

  // Verify full-page scroll stitching trigger
  await triggerPageScroll(doc.defaultView as unknown as Window & typeof globalThis, {
    step: 400,
    delayMs: 0,
  });
  assert.ok(scrolledPositions.length > 0, 'No scroll operations recorded');
  assert.strictEqual(scrolledPositions[scrolledPositions.length - 1], 0, 'Did not scroll back to top');

  // Verify web font extraction
  const mockFont = validated.fonts.find((f) => f.family === 'MockHeadingFont');
  assert.ok(mockFont, 'Web font MockHeadingFont not found in capture.fonts');
  assert.strictEqual(mockFont.weight, '700');

  // Timings are observation only: same nodes, each stage reported once.
  const seenStages: string[] = [];
  const timed = await serializeDocument(doc as unknown as Document, {
    onTiming: (stage) => seenStages.push(stage),
  });
  assert.deepStrictEqual(timed.nodes, capture.nodes, 'onTiming changed the serialized nodes');
  assert.deepStrictEqual(Object.keys(timed.timings?.stages ?? {}).sort(), [...seenStages].sort());
  assert.strictEqual(new Set(seenStages).size, seenStages.length, 'a stage was reported twice');
  for (const stage of ['scroll', 'waitImages', 'walk', 'freezeTransforms', 'nodes', 'text', 'assets', 'fonts', 'total']) {
    assert.ok(seenStages.includes(stage), `missing timing stage: ${stage}`);
  }

  console.log('packages/serializer accuracy tests passed: all scenarios verified');
}

async function runReadinessTests() {
  // Newly revealed image decoding grows the document beyond its first height.
  {
    const { doc, body } = createMockDocument();
    let pageHeight = 1200;
    let revealed = false;
    let decoded = false;
    Object.defineProperty(doc.documentElement, 'scrollHeight', { get: () => pageHeight });
    const scroll = doc.defaultView.scrollTo;
    doc.defaultView.scrollX = 17;
    doc.defaultView.scrollY = 123;
    doc.defaultView.scrollTo = (x, y) => {
      scroll(x, y);
      if (!revealed && y >= 400) {
        revealed = true;
        const image = new MockElement('img', { left: 0, top: 500, width: 100, height: 100 });
        image.complete = false;
        image.src = 'data:image/png;base64,YQ==';
        image.getBoundingClientRect = () => ({
          left: 0, top: 500 - doc.defaultView.scrollY, right: 100,
          bottom: 600 - doc.defaultView.scrollY, width: 100, height: 100,
          x: 0, y: 500 - doc.defaultView.scrollY, toJSON: () => {},
        });
        image.decode = async () => {
          decoded = true;
          image.complete = true;
          pageHeight = 2400;
        };
        body.appendChild(image);
      }
    };
    const capture = await serializeDocument(doc as unknown as Document, {
      scrollStitch: true,
      scrollOptions: { step: 400, delayMs: 0, maxPasses: 20 },
    });
    assert.ok(decoded, 'Scroll readiness must decode newly revealed images');
    assert.strictEqual(capture.frame.height, 2400, 'Growing pages must be remeasured');
    assert.strictEqual(doc.defaultView.scrollX, 17, 'Original horizontal scroll must be restored');
    assert.strictEqual(doc.defaultView.scrollY, 123, 'Original vertical scroll must be restored');
    assert.ok(!capture.diagnostics?.some((d) => d.code.startsWith('scroll_')));
  }


  // A timed-out FontFaceSet promise is only waited once; a new readiness
  // promise after lazy content appears still gets its own bounded wait.
  {
    const { doc } = createMockDocument();
    let firstWaits = 0;
    let secondWaits = 0;
    const neverReady = (waited: () => void) => ({
      then(_resolve: (value: FontFaceSet) => void, _reject: (reason: unknown) => void) {
        waited();
      },
    }) as unknown as Promise<FontFaceSet>;
    const first = neverReady(() => firstWaits++);
    const second = neverReady(() => secondWaits++);
    let ready: Promise<FontFaceSet> = first;
    Object.defineProperty(doc.fonts, 'ready', { get: () => ready });
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 1600 });
    const scroll = doc.defaultView.scrollTo;
    doc.defaultView.scrollTo = (x, y) => {
      scroll(x, y);
      if (y >= 400) ready = second;
    };
    const capture = await serializeDocument(doc as unknown as Document, {
      scrollStitch: true,
      fontTimeoutMs: 1,
      scrollOptions: { step: 400, delayMs: 0, maxPasses: 8 },
    });
    assert.strictEqual(firstWaits, 1, 'An unchanged timed-out font promise must not be awaited again');
    assert.strictEqual(secondWaits, 1, 'A changed font readiness promise must be awaited');
    assert.ok(capture.diagnostics?.some((diagnostic) => diagnostic.code === 'fonts_timeout'));
  }

  // An infinite feed has an explicit completion boundary and a visible warning.
  {
    const { doc } = createMockDocument();
    let pageHeight = 1200;
    Object.defineProperty(doc.documentElement, 'scrollHeight', { get: () => pageHeight });
    const scroll = doc.defaultView.scrollTo;
    doc.defaultView.scrollTo = (x, y) => {
      scroll(x, y);
      if (y >= pageHeight - doc.defaultView.innerHeight) pageHeight += 400;
    };
    const capture = await serializeDocument(doc as unknown as Document, {
      scrollStitch: true,
      scrollOptions: { step: 400, delayMs: 0, maxPasses: 4 },
    });
    assert.ok(capture.diagnostics?.some((d) => d.code === 'scroll_pass_budget_exhausted'));
    assert.strictEqual(doc.defaultView.scrollY, 0);
    assert.ok(capture.frame.height < 4000, 'Infinite feeds must stop at the pass budget');
  }

  // Height and elapsed-time limits are independent explicit stop budgets.
  for (const [scrollOptions, code] of [
    [{ delayMs: 0, maxHeight: 1000 }, 'scroll_height_budget_exhausted'],
    [{ delayMs: 0, maxPasses: 0 }, 'scroll_pass_budget_exhausted'],
    [{ delayMs: 0, maxDurationMs: 0 }, 'scroll_time_budget_exhausted'],
  ] as const) {
    const { doc } = createMockDocument();
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 1200 });
    doc.defaultView.scrollY = 57;
    const capture = await serializeDocument(doc as unknown as Document, { scrollStitch: true, scrollOptions });
    assert.ok(capture.diagnostics?.some((d) => d.code === code), `Missing ${code}`);
    assert.strictEqual(doc.defaultView.scrollY, 57);
  }

  // A scroll failure must not strand the page at the last visited position.
  {
    const { doc } = createMockDocument();
    doc.defaultView.scrollX = 9;
    doc.defaultView.scrollY = 27;
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 1600 });
    const scroll = doc.defaultView.scrollTo;
    doc.defaultView.scrollTo = (x, y) => {
      scroll(x, y);
      if (y === 400) throw new Error('scroll failed');
    };
    await assert.rejects(triggerPageScroll(doc.defaultView as unknown as Window & typeof globalThis, {
      step: 400, delayMs: 0,
    }), /scroll failed/);
    assert.strictEqual(doc.defaultView.scrollX, 9);
    assert.strictEqual(doc.defaultView.scrollY, 27);
    const capture = await serializeDocument(doc as unknown as Document, {
      scrollStitch: true, scrollOptions: { step: 400, delayMs: 0 },
    });
    assert.ok(capture.diagnostics?.some((d) => d.code === 'scroll_failed'));
    assert.strictEqual(doc.defaultView.scrollX, 9);
    assert.strictEqual(doc.defaultView.scrollY, 27);
  }

  // More than 60 images are considered, without unbounded decode concurrency.
  {
    const { doc, body } = createMockDocument();
    let inFlight = 0;
    let peak = 0;
    for (let i = 0; i < 65; i++) {
      const image = new MockElement('img');
      image.complete = false;
      image.src = 'data:image/png;base64,YQ==';
      image.decode = async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
        image.complete = true;
      };
      body.appendChild(image);
    }
    const ready = await waitForImages(doc as unknown as Document, { concurrency: 3 });
    assert.strictEqual(ready, 65);
    assert.ok(peak <= 3, 'Image decode concurrency must be bounded');
    const limited = await serializeDocument(doc as unknown as Document, { imageOptions: { maxImages: 60 } });
    assert.ok(limited.diagnostics?.some((d) => d.code === 'image_budget_exhausted'));
  }

  // Timed-out browser decodes cannot be cancelled, so they retain their slots.
  {
    const { doc, body } = createMockDocument();
    let started = 0;
    const diagnostics: Array<{ code: string }> = [];
    for (let i = 0; i < 12; i++) {
      const image = new MockElement('img');
      image.src = `/slow-${i}.png`;
      image.complete = false;
      image.decode = () => {
        started++;
        return Promise.withResolvers<void>().promise;
      };
      body.appendChild(image);
    }
    const ready = await waitForImages(doc as unknown as Document, {
      concurrency: 2, timeoutMs: 1, totalTimeoutMs: 1000,
    }, (diagnostic) => diagnostics.push(diagnostic));
    assert.strictEqual(ready, 0);
    assert.strictEqual(started, 2, 'Timed-out decodes must not create unbounded pending work');
    assert.strictEqual(diagnostics.filter((d) => d.code === 'image_timeout').length, 2);
    assert.ok(diagnostics.some((d) => d.code === 'image_budget_exhausted'));
  }

  // Failed and timed-out readiness and unavailable canvas bytes survive schema parsing.
  {
    const { doc, body } = createMockDocument();
    const failed = new MockElement('img');
    failed.src = 'data:image/png;base64,YQ==';
    failed.complete = false;
    failed.decode = async () => { throw new Error('broken image'); };
    body.appendChild(failed);
    const slow = new MockElement('img');
    slow.src = 'data:image/png;base64,Yg==';
    slow.complete = false;
    slow.decode = () => Promise.withResolvers<void>().promise;
    body.appendChild(slow);
    const canvas = new MockElement('canvas');
    canvas.toDataURL = () => { throw new Error('tainted'); };
    body.appendChild(canvas);
    Object.assign(doc.fonts, { ready: Promise.withResolvers<void>().promise });
    const capture = CaptureSchema.parse(await serializeDocument(doc as unknown as Document, {
      imageOptions: { timeoutMs: 1, totalTimeoutMs: 50 },
      fontTimeoutMs: 0,
    }));
    assert.ok(capture.diagnostics?.some((d) => d.code === 'image_failed'));
    assert.ok(capture.diagnostics?.some((d) => d.code === 'image_timeout'));
    assert.ok(capture.diagnostics?.some((d) => d.code === 'fonts_timeout'));
    const canvasNode = capture.nodes.find((n) => n.type === 'image' && !n.assetRef);
    assert.ok(canvasNode);
    assert.ok(capture.diagnostics?.some((d) => d.code === 'canvas_unavailable' && d.nodeId === canvasNode.id));
  }

  // Asset HTTP failures, timeouts, and unavailable cross-origin bytes are reported.
  {
    const originalFetch = globalThis.fetch;
    try {
      const { doc, body } = createMockDocument();
      for (const source of ['/missing.png', '/stalled.png', 'https://other.example/image.png']) {
        const image = new MockElement('img');
        image.src = source;
        body.appendChild(image);
      }
      globalThis.fetch = async (input) => String(input).endsWith('/stalled.png')
        ? Promise.withResolvers<Response>().promise
        : new Response('', { status: 404 });
      const capture = CaptureSchema.parse(await serializeDocument(doc as unknown as Document, { assetTimeoutMs: 1 }));
      assert.ok(capture.diagnostics?.some((d) => d.code === 'asset_failed' && d.nodeId));
      assert.ok(capture.diagnostics?.some((d) => d.code === 'asset_timeout' && d.nodeId));
      assert.ok(capture.diagnostics?.some((d) => d.code === 'asset_unavailable' && d.message.includes('Cross-origin image')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Element capture waits for its own image and fonts before measuring its frame.
  {
    const { doc, body } = createMockDocument();
    const image = new MockElement('img');
    image.src = 'data:image/png;base64,YQ==';
    image.complete = false;
    image.decode = async () => { image.complete = true; image.rect.width = 240; };
    Object.assign(doc.fonts, { ready: Promise.resolve().then(() => { image.rect.height = 90; }) });
    body.appendChild(image);
    const capture = await serializeElement(image as unknown as Element);
    assert.strictEqual(capture.frame.width, 240);
    assert.strictEqual(capture.frame.height, 90);
  }

  // Skipped images emit one aggregated image_skipped diagnostic and idleMs exits stalled decodes early.
  {
    const { doc, body } = createMockDocument();
    const noSrc = new MockElement('img');
    const zeroSize = new MockElement('img');
    zeroSize.src = '/zero.png';
    zeroSize.rect = { left: 0, top: 0, width: 0, height: 0 };
    const lazyFar = new MockElement('img');
    lazyFar.src = '/lazy.png';
    (lazyFar as unknown as { loading: string }).loading = 'lazy';
    lazyFar.rect = { left: 0, top: 3000, width: 100, height: 100 };
    const stalled = new MockElement('img');
    stalled.src = '/stalled.png';
    stalled.complete = false;
    stalled.decode = () => Promise.withResolvers<void>().promise;
    body.appendChild(noSrc);
    body.appendChild(zeroSize);
    body.appendChild(lazyFar);
    body.appendChild(stalled);
    const diagnostics: Array<{ code: string; message: string }> = [];
    const t0 = Date.now();
    await waitForImages(doc as unknown as Document, { idleMs: 25, totalTimeoutMs: 2000 }, (d) => diagnostics.push(d));
    assert.ok(Date.now() - t0 < 500, 'idleMs should exit stalled decodes before totalTimeoutMs');
    const skipped = diagnostics.filter((d) => d.code === 'image_skipped');
    assert.strictEqual(skipped.length, 1);
    assert.ok(skipped[0].message.includes('2 images'));
  }

  // Lazy images (loading="lazy", data-src, data-srcset) are promoted to eager at capture start.
  {
    const { doc, body } = createMockDocument();
    const lazyImg = new MockElement('img');
    const attrs = new Map<string, string>([
      ['loading', 'lazy'],
      ['data-src', '/real.png'],
      ['data-srcset', '/real-2x.png 2x'],
    ]);
    lazyImg.getAttribute = (name: string) => attrs.get(name) ?? null;
    (lazyImg as unknown as { setAttribute: (k: string, v: string) => void }).setAttribute = (k: string, v: string) => {
      attrs.set(k, v);
      if (k === 'src') lazyImg.src = v;
    };
    (lazyImg as unknown as { loading: string }).loading = 'lazy';
    lazyImg.rect = { left: 0, top: 3000, width: 100, height: 100 };
    body.appendChild(lazyImg);
    await serializeDocument(doc as unknown as Document, { scrollStitch: false, imageOptions: { idleMs: 20 } });
    assert.strictEqual(attrs.get('loading'), 'eager');
    assert.strictEqual(attrs.get('src'), '/real.png');
    assert.strictEqual(attrs.get('srcset'), '/real-2x.png 2x');
  }

  // A page with nothing loading must not pay the stable-height idle floor.
  {
    const { doc, body } = createMockDocument();
    body.appendChild(new MockElement('img'));
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 1200 });
    const t0 = Date.now();
    await serializeDocument(doc as unknown as Document, { scrollStitch: false, imageOptions: { idleMs: 800 } });
    assert.ok(Date.now() - t0 < 400, `static page waited ${Date.now() - t0}ms for a height that cannot change`);
  }

  // Multi-line text runs use binary search over clientRects with O(lines * log chars) calls.
  {
    const { doc, body, styleMap } = createMockDocument();
    const p = new MockElement('p');
    const line1 = 'First wrapped line of text ';
    const line2 = 'Second wrapped line of text ';
    const line3 = 'Third wrapped line of text';
    const fullStr = line1 + line2 + line3;
    const textNode = { nodeType: 3, textContent: fullStr } as unknown as MockElement;
    p.appendChild(textNode);
    p.rect = { left: 10, top: 20, width: 200, height: 60 };
    styleMap.set(p, {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      fontSize: '16px',
      lineHeight: '20px',
      fontFamily: 'Inter',
      textAlign: 'left',
      color: 'rgb(0, 0, 0)',
    });
    body.appendChild(p);

    const b1 = line1.length;
    const b2 = line1.length + line2.length;
    let rectCalls = 0;
    (doc as unknown as Record<string, unknown>).createRange = () => {
      let start = 0;
      let end = fullStr.length;
      const lineRect = (li: number) => ({
        left: 10,
        top: 20 + li * 20,
        right: 190 - li * 10,
        bottom: 40 + li * 20,
        width: 180 - li * 10,
        height: 20,
      });
      return {
        selectNodeContents: () => { start = 0; end = fullStr.length; },
        setStart: (_n: unknown, s: number) => { start = s; },
        setEnd: (_n: unknown, e: number) => { end = e; },
        getClientRects: () => {
          rectCalls++;
          const out = [];
          if (start < b1 && end > 0) out.push(lineRect(0));
          if (start < b2 && end > b1) out.push(lineRect(1));
          if (end > b2) out.push(lineRect(2));
          return out;
        },
        getBoundingClientRect: () => lineRect(start < b1 ? 0 : start < b2 ? 1 : 2),
      };
    };

    const capture = await serializeDocument(doc as unknown as Document, { collectTimings: true });
    const tNode = capture.nodes.find((n) => n.type === 'text');
    assert.ok(tNode?.text?.runs, 'Multi-line text node should emit runs');
    assert.deepStrictEqual(tNode.text.runs, [
      { text: line1.trim(), x: 10, y: 20, w: 182 },
      { text: line2.trim(), x: 10, y: 40, w: 172 },
      { text: line3.trim(), x: 10, y: 60, w: 162 },
    ]);
    assert.ok((capture.timings?.counts.textCharsMeasured ?? Infinity) < fullStr.length * 0.35,
      `Expected binary search rect calls < 35% of ${fullStr.length}, got ${capture.timings?.counts.textCharsMeasured}`);
  }

  // Whitespace collapsing across adjacent/inline text nodes never injects extra spaces ("Examples ( 3 )" bug).
  {
    const { doc, body, styleMap } = createMockDocument();
    const div = new MockElement('div');
    div.rect = { left: 0, top: 0, width: 200, height: 24 };
    styleMap.set(div, {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      fontSize: '14px',
      lineHeight: '20px',
      fontFamily: 'Inter',
      textAlign: 'left',
      color: 'rgb(0, 0, 0)',
    });
    div.appendChild({ nodeType: 3, textContent: 'Examples   (\n  ' } as unknown as MockElement);
    div.appendChild({ nodeType: 3, textContent: '3' } as unknown as MockElement);
    div.appendChild({ nodeType: 3, textContent: ')' } as unknown as MockElement);
    body.appendChild(div);

    const capture = await serializeDocument(doc as unknown as Document);
    const tNode = capture.nodes.find((n) => n.type === 'text');
    assert.strictEqual(tNode?.text?.content, 'Examples ( 3)');

    const { doc: doc2, body: body2, styleMap: sm2 } = createMockDocument();
    const btn = new MockElement('button');
    btn.rect = { left: 0, top: 0, width: 140, height: 28 };
    sm2.set(btn, {
      display: 'inline-block',
      visibility: 'visible',
      opacity: '1',
      fontSize: '14px',
      lineHeight: '20px',
      fontFamily: 'Inter',
      textAlign: 'left',
      color: 'rgb(0, 0, 0)',
    });
    const span = new MockElement('span');
    span.rect = { left: 68, top: 4, width: 10, height: 18 };
    sm2.set(span, {
      display: 'inline',
      visibility: 'visible',
      opacity: '1',
      fontSize: '14px',
      lineHeight: '20px',
      fontFamily: 'Inter',
      textAlign: 'left',
      color: 'rgb(0, 0, 0)',
    });
    span.appendChild({ nodeType: 3, textContent: '3' } as unknown as MockElement);
    btn.appendChild({ nodeType: 3, textContent: 'Examples (' } as unknown as MockElement);
    btn.appendChild(span);
    btn.appendChild({ nodeType: 3, textContent: ')' } as unknown as MockElement);
    body2.appendChild(btn);

    const capture2 = await serializeDocument(doc2 as unknown as Document);
    const texts = capture2.nodes
      .filter((n) => n.type === 'text' && n.text)
      .map((n) => n.text!.content);
    assert.deepStrictEqual(texts, ['Examples (', ')', '3']);
  }

  // Chunked arrayBufferToBase64 matches Node Buffer.toString('base64') across 0 B, 1 B, 32 KB+1, and 3 MB.
  for (const size of [0, 1, 32 * 1024 + 1, 3 * 1024 * 1024]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const actual = await arrayBufferToBase64(bytes.buffer);
    const expected = Buffer.from(bytes).toString('base64');
    assert.strictEqual(actual, expected, `Base64 mismatch for ${size} bytes`);
  }

  // transcodeForDestinations: opaque WebP -> JPEG, transparent WebP -> PNG, oversize -> downscaled.
  {
    const g = globalThis as unknown as Record<string, unknown>;
    const prevCreateBitmap = g.createImageBitmap;
    const prevDoc = g.document;
    let mockBitmapSize = { width: 100, height: 80 };
    let mockHasAlpha = false;
    let lastCanvasSize = { width: 0, height: 0 };
    let lastToBlobMime = '';

    g.createImageBitmap = async () => ({
      width: mockBitmapSize.width,
      height: mockBitmapSize.height,
      close: () => {},
    });
    g.document = {
      createElement: (tag: string) => {
        if (tag !== 'canvas') return {};
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {
              lastCanvasSize = { width: canvas.width, height: canvas.height };
            },
            getImageData: (_x: number, _y: number, w: number, h: number) => {
              const data = new Uint8ClampedArray(w * h * 4);
              for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
              if (mockHasAlpha) data[3] = 128;
              return { data };
            },
          }),
          toBlob: (cb: (b: Blob | null) => void, mime = 'image/png') => {
            lastToBlobMime = mime;
            cb(new Blob([new Uint8Array([1, 2, 3])], { type: mime }));
          },
        };
        return canvas;
      },
    };

    try {
      const diags: unknown[] = [];
      const stats = { toJpeg: 0, toPng: 0, downscaled: 0 };

      mockBitmapSize = { width: 400, height: 300 };
      mockHasAlpha = false;
      const opaqueOut = await transcodeForDestinations(new Blob([new Uint8Array([9])], { type: 'image/webp' }), (d) => diags.push(d), 'n1', 1000, { maxWidth: 800, stats });
      assert.strictEqual(opaqueOut?.type, 'image/jpeg', 'Opaque WebP should transcode to JPEG');
      assert.strictEqual(lastToBlobMime, 'image/jpeg');

      mockHasAlpha = true;
      const alphaOut = await transcodeForDestinations(new Blob([new Uint8Array([9])], { type: 'image/webp' }), (d) => diags.push(d), 'n2', 1000, { maxWidth: 800, stats });
      assert.strictEqual(alphaOut?.type, 'image/png', 'Transparent WebP should transcode to PNG');

      mockBitmapSize = { width: 3200, height: 1600 };
      mockHasAlpha = false;
      const bigOut = await transcodeForDestinations(new Blob([new Uint8Array(150_000)], { type: 'image/jpeg' }), (d) => diags.push(d), 'n3', 1000, { maxWidth: 800, stats });
      assert.strictEqual(bigOut?.type, 'image/jpeg');
      assert.deepStrictEqual(lastCanvasSize, { width: 800, height: 400 }, 'Oversize image should be downscaled proportionally');
      assert.deepStrictEqual(stats, { toJpeg: 2, toPng: 1, downscaled: 1 });
      assert.strictEqual(diags.length, 0);
    } finally {
      g.createImageBitmap = prevCreateBitmap;
      g.document = prevDoc;
    }
  }
}

function runFontMatchingTests() {
  const variableFace = { family: 'Inter', weight: '1 1000', style: 'normal', embedded: true };
  assert.strictEqual(doesFontFaceCover(variableFace, 'Inter', 300, 'normal'), true, 'Variable 1..1000 should cover 300');
  assert.strictEqual(doesFontFaceCover(variableFace, '"Inter", sans-serif', '300', 'normal'), true, 'Quoted family stack should match');
  assert.strictEqual(doesFontFaceCover(variableFace, 'Inter', 300, 'italic'), false, 'Normal variable face should not cover italic');

  const exact300 = { family: 'Roboto', weight: '300', style: 'normal', embedded: true };
  assert.strictEqual(doesFontFaceCover(exact300, 'Roboto', 300, 'normal'), true, 'Exact 300 should cover 300');
  assert.strictEqual(doesFontFaceCover(exact300, 'Roboto', 400, 'normal'), false, 'Exact 300 should not cover 400');

  const normal700 = { family: 'Lato', weight: '700', style: 'normal', embedded: true };
  assert.strictEqual(doesFontFaceCover(normal700, 'Lato', 300, 'italic'), false, '700 normal should not cover 300 italic');

  const diags: Array<{ code: string; message: string; nodeId?: string }> = [];
  const fonts = [
    { family: 'Inter', weight: '1 1000', style: 'normal', embedded: true },
    { family: 'Lato', weight: '700', style: 'normal', embedded: true },
    { family: 'Missing Sans', weight: '400', style: 'normal', embedded: false },
  ];
  const nodes: any[] = [
    { id: 'n1', type: 'text', text: { fontFamily: 'Inter, sans-serif', fontWeight: 300, italic: false } },
    { id: 'n2', type: 'text', text: { fontFamily: 'Missing Sans, Arial, sans-serif', fontWeight: 400, italic: false } },
    { id: 'n3', type: 'text', text: { fontFamily: 'Missing Sans, Arial, sans-serif', fontWeight: 700, italic: false } },
    { id: 'n4', type: 'text', text: { fontFamily: 'Lato', fontWeight: 300, italic: true } },
  ];
  reconcileMissingFonts(nodes, fonts as any, (d) => diags.push(d));

  assert.strictEqual(diags.filter((d) => d.code === 'font_missing' && d.message.includes('Inter')).length, 0, 'Variable Inter covers 300');
  assert.strictEqual(diags.filter((d) => d.code === 'font_missing' && d.message.includes('Missing Sans')).length, 1, 'Missing family aggregated to 1 diagnostic');
  assert.strictEqual(diags.filter((d) => d.code === 'font_missing' && d.message.includes('Lato')).length, 1, 'Lato 300 italic missing reported once');

  const missingEntry = fonts.find((f) => f.family === 'Missing Sans') as any;
  assert.strictEqual(missingEntry.embedded, false);
  assert.strictEqual(missingEntry.fallbackStack, 'Missing Sans, Arial, sans-serif');

  const latoMissing = fonts.find((f) => f.family === 'Lato' && f.weight === '300' && f.style === 'italic') as any;
  assert.ok(latoMissing, 'Unmatched style/weight face recorded in capture.fonts');
  assert.strictEqual(latoMissing.embedded, false);
  assert.strictEqual(latoMissing.fallbackStack, 'Lato');
  console.log('✓ font matching & missing-font diagnostic tests passed');
}

async function runFastModeImageEmbeddingTests() {
  const originalFetch = globalThis.fetch;
  const imgBytes = Buffer.from('mock-cdn-image-bytes');
  const imgBase64 = imgBytes.toString('base64');
  const fetchCalls: string[] = [];
  const bridgeCalls: Array<{ action?: string; url?: string; maxWidth?: number }> = [];

  try {
    globalThis.fetch = async (input) => {
      fetchCalls.push(String(input));
      throw new TypeError('Failed to fetch (CORS)');
    };

    const { doc, body } = createMockDocument();
    Object.assign(doc.defaultView, {
      chrome: {
        runtime: {
          sendMessage: async (msg: { action?: string; url?: string; maxWidth?: number }) => {
            bridgeCalls.push(msg);
            if (msg.action === 'fetch-asset' && msg.url) {
              return { success: true, mimeType: 'image/png', base64: imgBase64 };
            }
            return { success: false };
          },
        },
      },
    });
    Object.assign(doc, {
      styleSheets: [
        {
          cssRules: [
            {
              type: 5,
              style: {
                fontFamily: 'Inter',
                fontWeight: '400',
                fontStyle: 'normal',
                src: 'url("https://cdn.example.com/inter.woff2") format("woff2")',
              },
              cssText: "@font-face { font-family: 'Inter'; src: url('https://cdn.example.com/inter.woff2'); }",
            },
          ],
        },
      ],
    });
    doc.fonts = {
      forEach: (cb: (f: { family: string; weight: string; style: string; status?: string }) => void) => {
        cb({ family: 'Inter', weight: '400', style: 'normal', status: 'loaded' });
      },
    };

    // 1. Cross-origin CDN <img>
    const cdnImg = new MockElement('img', { left: 0, top: 0, width: 200, height: 100 });
    cdnImg.src = 'https://cdn.example.com/hero.png';
    body.appendChild(cdnImg);

    // 2. Lazy <img> with 1x1 transparent GIF placeholder in src & currentSrc, real URL in data-src
    const gifPlaceholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const lazyDataSrcImg = new MockElement('img', { left: 0, top: 120, width: 160, height: 90 });
    lazyDataSrcImg.src = gifPlaceholder;
    lazyDataSrcImg.currentSrc = gifPlaceholder;
    const lazyAttrs = new Map<string, string>([
      ['src', gifPlaceholder],
      ['data-src', 'https://cdn.example.com/lazy-photo.jpg'],
    ]);
    lazyDataSrcImg.getAttribute = (name: string) => lazyAttrs.get(name) ?? null;
    body.appendChild(lazyDataSrcImg);

    // 3. Lazy <img> with SVG data-URI placeholder in src & currentSrc, real URLs in srcset
    const svgPlaceholder = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
    const lazySrcsetImg = new MockElement('img', { left: 0, top: 220, width: 180, height: 90 });
    lazySrcsetImg.src = svgPlaceholder;
    lazySrcsetImg.currentSrc = svgPlaceholder;
    const srcsetAttrs = new Map<string, string>([
      ['src', svgPlaceholder],
      ['srcset', 'https://cdn.example.com/lazy-1x.png 1x, https://cdn.example.com/lazy-2x.png 2x'],
    ]);
    lazySrcsetImg.getAttribute = (name: string) => srcsetAttrs.get(name) ?? null;
    body.appendChild(lazySrcsetImg);

    // 4. Cross-origin CSS background-image
    const bgDiv = new MockElement('div', { left: 0, top: 320, width: 300, height: 120 });
    bgDiv.styleOverrides = {
      backgroundImage: 'url("https://cdn.example.com/banner-bg.png")',
    };
    body.appendChild(bgDiv);

    // 5. Text node referencing Inter font
    const heading = new MockElement('p', { left: 0, top: 450, width: 200, height: 24 });
    heading.styleOverrides = { fontFamily: 'Inter, sans-serif' };
    heading.appendChild(new MockNode(3 /* TEXT_NODE */, 'Hello fastMode'));
    body.appendChild(heading);

    const capture = CaptureSchema.parse(await serializeDocument(doc as unknown as Document, { fastMode: true }));

    // WOFF2 font embedding must be skipped in fastMode
    assert.strictEqual(
      fetchCalls.some((u) => u.includes('inter.woff2')),
      false,
      'fastMode must skip WOFF2 font fetching'
    );
    assert.strictEqual(
      bridgeCalls.some((m) => m.url?.includes('inter.woff2')),
      false,
      'fastMode must skip WOFF2 font runtime bridge fetching'
    );
    assert.strictEqual(
      Object.values(capture.assets).some((a) => a.kind === 'font'),
      false,
      'fastMode must not embed font assets'
    );
    assert.strictEqual(capture.fonts.length, 0, 'fastMode must skip extractWebFonts');

    // All 4 image assets (including lazy-resolved URLs and background-image) must be embedded via fetch-asset fallback
    const expectedUrls = [
      'https://cdn.example.com/hero.png',
      'https://cdn.example.com/lazy-photo.jpg',
      'https://cdn.example.com/lazy-2x.png',
      'https://cdn.example.com/banner-bg.png',
    ];
    for (const expectedUrl of expectedUrls) {
      const call = bridgeCalls.find((m) => m.action === 'fetch-asset' && m.url === expectedUrl);
      assert.ok(call, `Expected fetch-asset fallback for ${expectedUrl}`);
      assert.ok(typeof call.maxWidth === 'number' && call.maxWidth > 0, `Expected maxWidth on fetch-asset for ${expectedUrl}`);
    }

    const imageNodes = capture.nodes.filter((n) => n.type === 'image');
    assert.strictEqual(imageNodes.length, 3, 'Expected 3 serialized image nodes');
    for (const imgNode of imageNodes) {
      assert.ok(imgNode.assetRef, `Image node ${imgNode.id} must have assetRef`);
      const embedded = capture.assets[imgNode.assetRef];
      assert.ok(embedded, `Missing embedded asset for ${imgNode.assetRef}`);
      assert.strictEqual(embedded.base64, imgBase64, 'Image must embed fetched CDN bytes, not placeholder GIF/SVG');
    }

    const bgNode = capture.nodes.find((n) => n.style.fills.some((f) => f.type === 'image'));
    assert.ok(bgNode, 'Expected div with embedded background-image fill');
    const bgFill = bgNode.style.fills.find((f) => f.type === 'image');
    assert.ok(bgFill?.assetRef && capture.assets[bgFill.assetRef]?.base64 === imgBase64,
      'Background image must embed fetched CDN bytes via fetch-asset fallback');

    console.log('✓ fastMode cross-origin & lazy image embedding tests passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runSpriteAndProPickerTests() {
  // 1. SVG sprite <use href="#..."> resolution
  {
    const { doc, body } = createMockDocument();

    // Hidden inline SVG sprite sheet with <symbol id="icon-star" viewBox="0 0 24 24">
    const spriteSheet = new MockElement('svg', { left: 0, top: 0, width: 0, height: 0 });
    spriteSheet.styleOverrides = { display: 'none' };
    const symbolEl = new MockElement('symbol', { left: 0, top: 0, width: 24, height: 24 });
    symbolEl.setAttribute('id', 'icon-star');
    symbolEl.setAttribute('viewBox', '0 0 24 24');
    const starPath = new MockElement('path');
    const starD = 'M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z';
    starPath.setAttribute('d', starD);
    starPath.setAttribute('fill', 'currentColor');
    symbolEl.appendChild(starPath);

    // Direct shape inside sprite sheet (<path id="icon-line">)
    const directShape = new MockElement('path');
    directShape.setAttribute('id', 'icon-line');
    directShape.setAttribute('d', 'M2 12L22 12');
    spriteSheet.appendChild(symbolEl);
    spriteSheet.appendChild(directShape);
    body.appendChild(spriteSheet);

    // Visible <svg><use href="#icon-star"></use></svg> (no viewBox on outer <svg>)
    const iconSvg = new MockElement('svg', { left: 10, top: 10, width: 24, height: 24 });
    iconSvg.styleOverrides = { color: 'rgba(16, 185, 129, 1)' };
    const useStar = new MockElement('use');
    useStar.setAttribute('href', '#icon-star');
    iconSvg.appendChild(useStar);
    iconSvg.outerHTML = '<svg><use href="#icon-star"></use></svg>';
    body.appendChild(iconSvg);

    // Visible <svg><use xlink:href="#icon-line"></use></svg> referencing a shape directly
    const lineSvg = new MockElement('svg', { left: 50, top: 10, width: 24, height: 24 });
    lineSvg.styleOverrides = { color: 'rgba(59, 130, 246, 1)' };
    lineSvg.setAttribute('fill', 'none');
    lineSvg.setAttribute('stroke', 'currentColor');
    const useLine = new MockElement('use');
    useLine.setAttribute('xlink:href', '#icon-line');
    lineSvg.appendChild(useLine);
    lineSvg.outerHTML = '<svg fill="none" stroke="currentColor"><use xlink:href="#icon-line"></use></svg>';
    body.appendChild(lineSvg);

    const capture = CaptureSchema.parse(await serializeDocument(doc as unknown as Document));

    const starNode = capture.nodes.find((n) => n.box.x === 10 && n.box.y === 10);
    assert.ok(starNode, 'Sprite <use href="#icon-star"> node not found');
    assert.strictEqual(starNode.type, 'vector');
    assert.ok(starNode.vectorPaths && starNode.vectorPaths.length >= 1, 'Sprite SVG missing vectorPaths');
    assert.strictEqual(starNode.vectorPaths[0].d, starD);
    assert.strictEqual(starNode.vectorPaths[0].fill, 'rgba(16, 185, 129, 1)');
    assert.deepStrictEqual(starNode.vectorViewBox, { width: 24, height: 24 });

    const lineNode = capture.nodes.find((n) => n.box.x === 50 && n.box.y === 10);
    assert.ok(lineNode, 'Sprite <use xlink:href="#icon-line"> node not found');
    assert.strictEqual(lineNode.type, 'vector');
    assert.ok(lineNode.vectorPaths && lineNode.vectorPaths.length >= 1);
    assert.strictEqual(lineNode.vectorPaths[0].d, 'M2 12L22 12');
    assert.strictEqual(lineNode.vectorPaths[0].fill, 'none');
    assert.strictEqual(lineNode.vectorPaths[0].stroke, 'rgba(59, 130, 246, 1)');
  }

  // 2. Pro startElementPicker: ArrowUp/ArrowDown + Shift+Click + Enter
  {
    const { doc, body, listeners } = createMockDocument();
    const parentCard = new MockElement('section', { left: 0, top: 0, width: 400, height: 200 });
    parentCard.setAttribute('class', 'hero-card primary');
    const childBtn = new MockElement('button', { left: 20, top: 20, width: 120, height: 40 });
    childBtn.setAttribute('class', 'cta-btn');
    const siblingSpan = new MockElement('span', { left: 160, top: 20, width: 80, height: 24 });
    siblingSpan.setAttribute('class', 'badge');
    parentCard.appendChild(childBtn);
    parentCard.appendChild(siblingSpan);
    body.appendChild(parentCard);

    let hoverTarget: MockElement = childBtn;
    doc.elementFromPoint = () => hoverTarget as unknown as never;

    let multiSelected: Element[] = [];
    let singleSelected: Element | null = null;
    let cancelled = false;

    const cleanup = startElementPicker(doc as unknown as Document, {
      onSelect: (el) => {
        singleSelected = el;
      },
      onMultiSelect: (els) => {
        multiSelected = els;
      },
      onCancel: () => {
        cancelled = true;
      },
    });

    const emit = (type: string, evt: Record<string, unknown>) => {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn(evt as unknown as Event);
      }
    };

    // Hover childBtn
    emit('mousemove', { clientX: 30, clientY: 30 });
    const badge = doc.getElementById('__capture_kit_picker_badge');
    assert.ok(badge, 'Picker badge not created');
    assert.strictEqual(badge.textContent, 'button.cta-btn · 120×40');

    // ArrowUp steps to parentCard
    let prevented = false;
    emit('keydown', { key: 'ArrowUp', preventDefault: () => { prevented = true; } });
    assert.strictEqual(prevented, true);
    assert.strictEqual(badge.textContent, 'section.hero-card · 400×200');

    // ArrowDown steps back to firstElementChild (childBtn)
    prevented = false;
    emit('keydown', { key: 'ArrowDown', preventDefault: () => { prevented = true; } });
    assert.strictEqual(prevented, true);
    assert.strictEqual(badge.textContent, 'button.cta-btn · 120×40');

    // Shift+Click selects childBtn without exiting
    emit('click', {
      shiftKey: true,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert.strictEqual(multiSelected.length, 0);
    assert.strictEqual(singleSelected, null);
    assert.strictEqual(badge.textContent, 'button.cta-btn · 120×40 (1 selected)');

    // Persistent green selection overlay should be added to body
    const greenOverlay = body.children.find(
      (c) => c.style.border === '2px solid #10b981' && c.style.background === 'rgba(16,185,129,0.12)'
    );
    assert.ok(greenOverlay, 'Persistent green selection overlay missing');

    // Hover siblingSpan and Shift+Click it too
    hoverTarget = siblingSpan;
    emit('mousemove', { clientX: 170, clientY: 30 });
    assert.strictEqual(badge.textContent, 'span.badge · 80×24 (1 selected)');
    emit('click', {
      shiftKey: true,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert.strictEqual(badge.textContent, 'span.badge · 80×24 (2 selected)');

    // Enter finishes multi-select and cleans up overlays
    emit('keydown', { key: 'Enter', preventDefault: () => {} });
    assert.strictEqual(multiSelected.length, 2);
    assert.strictEqual(multiSelected[0], childBtn);
    assert.strictEqual(multiSelected[1], siblingSpan);
    assert.strictEqual(doc.getElementById('__capture_kit_picker_overlay'), null, 'Main overlay not cleaned up');
    assert.strictEqual(
      body.children.some((c) => c.style.border === '2px solid #10b981'),
      false,
      'Green selection overlays not cleaned up'
    );
    assert.strictEqual(cancelled, false);
    cleanup();
  }

  console.log('✓ SVG sprite resolution & Pro element picker tests passed');
}

async function runAccuracyBeastTests() {
  // 1. parseBoxShadow multi-layer shadows + inset hairline borders (no 'px' unit color bug)
  {
    const shadowCss =
      '0px 10px 25px -5px rgba(15, 23, 42, 0.35), inset 0px 1px 0px 0px rgba(255, 255, 255, 0.15)';
    const parsed = parseBoxShadow(shadowCss);
    assert.strictEqual(parsed.length, 2, 'Expected 2 parsed box-shadow layers');
    assert.deepStrictEqual(parsed[0], {
      x: 0,
      y: 10,
      blur: 25,
      spread: -5,
      color: 'rgba(15, 23, 42, 0.35)',
    });
    assert.deepStrictEqual(parsed[1], {
      x: 0,
      y: 1,
      blur: 0,
      spread: 0,
      color: 'rgba(255, 255, 255, 0.15)',
      inset: true,
    });
  }

  // 2. -webkit-background-clip: text gradient text node + inline mixed-style text positioning
  {
    const { doc, body } = createMockDocument();

    const h1 = new MockElement('h1', { left: 40, top: 60, width: 500, height: 48 });
    h1.styleOverrides = {
      fontSize: '36px',
      lineHeight: '44px',
      fontWeight: '700',
      boxShadow:
        '0px 10px 25px -5px rgba(15, 23, 42, 0.35), inset 0px 1px 0px 0px rgba(255, 255, 255, 0.15)',
    };

    const leadText = new MockNode(3 /* TEXT_NODE */, 'Build ');
    const gradSpan = new MockElement('span', { left: 140, top: 60, width: 180, height: 48 });
    gradSpan.styleOverrides = {
      display: 'inline',
      backgroundImage: 'linear-gradient(90deg, rgba(236, 72, 153, 1) 0%, rgba(139, 92, 246, 1) 100%)',
      webkitBackgroundClip: 'text',
      webkitTextFillColor: 'transparent',
      color: 'rgba(0, 0, 0, 0)',
      fontSize: '36px',
      lineHeight: '44px',
      fontWeight: '700',
    };
    gradSpan.appendChild(new MockNode(3 /* TEXT_NODE */, '10x faster'));
    const tailText = new MockNode(3 /* TEXT_NODE */, ' with AI');

    h1.appendChild(leadText);
    h1.appendChild(gradSpan);
    h1.appendChild(tailText);
    body.appendChild(h1);

    const rectForNode = new Map<unknown, { left: number; top: number; width: number; height: number }>([
      [leadText, { left: 40, top: 62, width: 96, height: 44 }],
      [tailText, { left: 324, top: 62, width: 132, height: 44 }],
    ]);
    (doc as unknown as Record<string, unknown>).createRange = () => {
      let currentNode: unknown = null;
      return {
        selectNodeContents: (n: unknown) => {
          currentNode = n;
        },
        setStart: (n: unknown) => {
          currentNode = n;
        },
        setEnd: (n: unknown) => {
          currentNode = n;
        },
        getClientRects: () => {
          const r = rectForNode.get(currentNode) ?? { left: 140, top: 62, width: 180, height: 44 };
          return [
            {
              ...r,
              right: r.left + r.width,
              bottom: r.top + r.height,
              x: r.left,
              y: r.top,
              toJSON: () => {},
            },
          ];
        },
        getBoundingClientRect: () => {
          const r = rectForNode.get(currentNode) ?? { left: 140, top: 62, width: 180, height: 44 };
          return {
            ...r,
            right: r.left + r.width,
            bottom: r.top + r.height,
            x: r.left,
            y: r.top,
            toJSON: () => {},
          };
        },
      };
    };

    const capture = CaptureSchema.parse(await serializeDocument(doc as unknown as Document));

    const h1Node = capture.nodes.find((n) => n.box.x === 40 && n.box.y === 60 && n.type === 'frame');
    assert.ok(h1Node, 'H1 frame node not found');
    assert.strictEqual(h1Node.style.shadows.length, 2);
    assert.strictEqual(h1Node.style.shadows[0].color, 'rgba(15, 23, 42, 0.35)');
    assert.strictEqual(h1Node.style.shadows[1].color, 'rgba(255, 255, 255, 0.15)');
    assert.strictEqual(h1Node.style.shadows[1].inset, true);

    const buildTextNode = capture.nodes.find((n) => n.type === 'text' && n.text?.content === 'Build');
    const tailTextNode = capture.nodes.find((n) => n.type === 'text' && n.text?.content === 'with AI');
    assert.ok(buildTextNode && tailTextNode, 'Inline sibling text nodes not found');
    assert.strictEqual(buildTextNode.box.x, 40, 'Lead inline text node x mismatch');
    assert.strictEqual(tailTextNode.box.x, 324, 'Tail inline text node x must use Range clientRect, not contentBox.x');

    const gradContainer = capture.nodes.find((n) => n.box.x === 140 && n.box.y === 60 && n.type === 'rect');
    assert.ok(gradContainer, 'Gradient span container node not found');
    assert.strictEqual(gradContainer.style.fills.length, 0, 'Container fill must be stripped when background-clip: text');

    const gradTextNode = capture.nodes.find((n) => n.type === 'text' && n.text?.content === '10x faster');
    assert.ok(gradTextNode, 'Gradient text node not found');
    assert.strictEqual(gradTextNode.style.backgroundClip, 'text');
    assert.strictEqual(gradTextNode.style.fills.length, 1, 'Gradient fill must be preserved on text node');
    assert.strictEqual(gradTextNode.style.fills[0].type, 'gradient');
    assert.strictEqual(gradTextNode.text?.color, 'rgba(236, 72, 153, 1)', 'Text fallback color should use first gradient stop instead of transparent');
  }

  console.log('✓ Box-shadow multi-layer, gradient text & inline mixed-style text tests passed');
}

async function runAccuracyBeastRound2Tests() {
  // 1. Modern CSS color space normalization
  {
    const oklchRes = normalizeCssColor('oklch(0.65 0.22 260)');
    assert.ok(/^rgba\(\d+, \d+, \d+, 1\)$/.test(oklchRes), `Expected rgba for oklch, got ${oklchRes}`);
    const oklchPctAlpha = normalizeCssColor('oklch(65% 0.22 260deg / 0.5)');
    assert.ok(/^rgba\(\d+, \d+, \d+, 0\.5\)$/.test(oklchPctAlpha), `Expected 0.5 alpha for oklch, got ${oklchPctAlpha}`);

    const oklabRes = normalizeCssColor('oklab(0.6 -0.1 -0.1)');
    assert.ok(/^rgba\(\d+, \d+, \d+, 1\)$/.test(oklabRes), `Expected rgba for oklab, got ${oklabRes}`);

    assert.strictEqual(normalizeCssColor('hsl(120, 100%, 50%)'), 'rgba(0, 255, 0, 1)');
    assert.strictEqual(normalizeCssColor('hsl(240 100% 50% / 50%)'), 'rgba(0, 0, 255, 0.5)');

    assert.strictEqual(normalizeCssColor('color(display-p3 1 0 0)'), 'rgba(255, 0, 0, 1)');
    const p3Alpha = normalizeCssColor('color(display-p3 0.5 0.5 0.5 / 0.8)');
    assert.ok(/^rgba\(\d+, \d+, \d+, 0\.8\)$/.test(p3Alpha), `Expected 0.8 alpha for display-p3, got ${p3Alpha}`);

    assert.strictEqual(normalizeCssColor('rgb(10 20 30 / 0.4)'), 'rgba(10, 20, 30, 0.4)');
    assert.strictEqual(normalizeCssColor('transparent'), 'transparent');
    assert.strictEqual(normalizeCssColor('#ff00aa'), '#ff00aa');

    // Canvas fallback for color-mix(...)
    const mockCanvasDoc = {
      createElement: () => ({
        width: 1,
        height: 1,
        getContext: () => ({
          clearRect: () => {},
          fillRect: () => {},
          fillStyle: '',
          getImageData: () => ({ data: new Uint8ClampedArray([128, 64, 192, 255]) }),
        }),
      }),
    } as unknown as Document;
    assert.strictEqual(
      normalizeCssColor('color-mix(in srgb, red 50%, blue)', mockCanvasDoc),
      'rgba(128, 64, 192, 1)'
    );
  }

  // 2. Multi-stop SVG gradient preservation in extractSvgPaths
  {
    const { doc, body } = createMockDocument();
    const svg = doc.createElement('svg');
    const defs = doc.createElement('defs');
    const grad = doc.createElement('linearGradient');
    grad.setAttribute('id', 'logoGrad');
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%');
    grad.setAttribute('y2', '100%');

    const stop1 = doc.createElement('stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#ff0000');
    const stop2 = doc.createElement('stop');
    stop2.setAttribute('offset', '50%');
    stop2.setAttribute('stop-color', 'oklch(0.65 0.22 260)');
    const stop3 = doc.createElement('stop');
    stop3.setAttribute('offset', '100%');
    stop3.setAttribute('stop-color', '#0000ff');
    stop3.setAttribute('stop-opacity', '0.5');

    grad.appendChild(stop1);
    grad.appendChild(stop2);
    grad.appendChild(stop3);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const pathEl = doc.createElement('path');
    pathEl.setAttribute('d', 'M 0 0 L 24 24 Z');
    pathEl.setAttribute('fill', 'url(#logoGrad)');
    svg.appendChild(pathEl);
    body.appendChild(svg);

    const paths = extractSvgPaths(svg as unknown as Element);
    assert.strictEqual(paths.length, 1);
    assert.ok(paths[0].fillGradient, 'Expected fillGradient on SVG path');
    assert.strictEqual(paths[0].fillGradient?.type, 'gradient');
    assert.strictEqual(paths[0].fillGradient?.gradientType, 'linear');
    assert.strictEqual(paths[0].fillGradient?.angle, 135);
    assert.strictEqual(paths[0].fillGradient?.stops?.length, 3);
    assert.strictEqual(paths[0].fillGradient?.stops?.[0].color, '#ff0000');
    assert.strictEqual(paths[0].fillGradient?.stops?.[0].position, 0);
    assert.ok(paths[0].fillGradient?.stops?.[1].color.startsWith('rgba('), 'Expected normalized oklch stop color');
    assert.strictEqual(paths[0].fillGradient?.stops?.[1].position, 0.5);
    assert.strictEqual(paths[0].fillGradient?.stops?.[2].color, 'rgba(0, 0, 255, 0.5)');
    assert.strictEqual(paths[0].fillGradient?.stops?.[2].position, 1);
    assert.strictEqual(paths[0].fill, '#ff0000');
  }

  // 3. ::before pseudo-element with background-image gradient and bottom inset
  {
    const { doc, body } = createMockDocument();
    const card = doc.createElement('div');
    card.rect = { left: 50, top: 100, width: 200, height: 80 };
    card.pseudoOverrides = {
      '::before': {
        content: '""',
        display: 'block',
        position: 'absolute',
        bottom: '0px',
        left: '10px',
        width: '100px',
        height: '4px',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)',
      },
    };
    body.appendChild(card);

    const capture = CaptureSchema.parse(await serializeDocument(doc as unknown as Document));
    const pseudoRect = capture.nodes.find((n) => n.type === 'rect' && n.box.h === 4 && n.box.w === 100);
    assert.ok(pseudoRect, 'Expected ::before gradient rect node to be emitted');
    assert.strictEqual(pseudoRect.box.x, 60, '::before left inset should be parent.x + 10');
    assert.strictEqual(pseudoRect.box.y, 176, '::before bottom: 0px should place rect at parent.y + parent.h - 4');
    assert.strictEqual(pseudoRect.style.fills.length, 1);
    assert.strictEqual(pseudoRect.style.fills[0].type, 'gradient');
    assert.strictEqual(pseudoRect.style.fills[0].stops?.length, 2);
  }

  console.log('✓ Accuracy Beast Round 2 (colors, SVG gradients, ::before gradients & bottom inset) tests passed');
}

runSerializerAccuracyTests()
  .then(runReadinessTests)
  .then(runFontMatchingTests)
  .then(runFastModeImageEmbeddingTests)
  .then(runSpriteAndProPickerTests)
  .then(runAccuracyBeastTests)
  .then(runAccuracyBeastRound2Tests)
  .catch((err) => {
    console.error('packages/serializer test failure:', err);
    process.exit(1);
  });
