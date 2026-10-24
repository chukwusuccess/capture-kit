import assert from 'node:assert';
import { CaptureSchema } from '@capture-kit/model';
import { serializeDocument, serializeElement, startElementPicker, triggerPageScroll } from './src/index.js';

interface MockComputedStyle {
  display: string;
  visibility: string;
  backgroundColor: string;
  backgroundImage: string;
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

  querySelectorAll(_sel: string): MockElement[] {
    return [];
  }

  classList = { add(_cls: string): void {}, contains(_cls: string): boolean { return false; } };
  contains(_el: unknown): boolean {
    return false;
  }
  dAttr = '';
  pointsAttr = '';
  getAttribute(attr: string): string | null {
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
    createElement: (tag: string) => {
      const el = new MockElement(tag);
      el.ownerDocument = doc as unknown as Document;
      return el;
    },
    getElementById: () => null,
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
      scrollTo: (_x: number, y: number) => {
        scrolledPositions.push(y);
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
  return { doc, body, styleMap, scrolledPositions };
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
  assert.strictEqual(svgNode.type, 'image');
  assert.ok(svgNode.assetRef, 'SVG node missing assetRef');
  const svgAsset = validated.assets[svgNode.assetRef];
  assert.ok(svgAsset, 'SVG asset not registered');
  assert.strictEqual(svgAsset.mimeType, 'image/svg+xml');

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

  console.log('packages/serializer accuracy tests passed: all scenarios verified');
}

runSerializerAccuracyTests().catch((err) => {
  console.error('packages/serializer test failure:', err);
  process.exit(1);
});
