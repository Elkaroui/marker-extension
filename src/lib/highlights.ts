import { normalizeColor, withAlpha } from './palette';
import type { HighlightAnchor, StoredHighlight } from './types';

export const HIGHLIGHT_ATTR = 'data-marker-highlight-id';
export const ROOT_ID = 'marker-extension-root';
export const HIGHLIGHT_TAG = 'marker-highlight';
const STYLE_ID = 'marker-highlight-styles';

type HighlightRegistry = {
  clear(): void;
  set(name: string, value: object): void;
};

type HighlightConstructor = new (range: Range) => object;

const liveRanges = new Map<string, Range>();

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface TextSlice {
  node: Text;
  start: number;
  end: number;
}

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

function isElement(node: Node | null): node is HTMLElement {
  return !!node && node.nodeType === Node.ELEMENT_NODE;
}

function getHighlightRegistry(): HighlightRegistry | null {
  const cssWithHighlights = CSS as typeof CSS & { highlights?: HighlightRegistry };
  return cssWithHighlights.highlights ?? null;
}

function getHighlightConstructor(): HighlightConstructor | null {
  const ctor = globalThis.Highlight as unknown;
  if (typeof ctor === 'function') {
    return ctor as HighlightConstructor;
  }

  return null;
}

function supportsCustomHighlights(): boolean {
  return !!getHighlightRegistry() && !!getHighlightConstructor();
}

function getHighlightName(id: string): string {
  return `marker-${id.replace(/[^a-z0-9_-]/gi, '')}`;
}

function ensureStyleElement(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (style) {
    return style;
  }

  style = document.createElement('style');
  style.id = STYLE_ID;
  (document.head ?? document.documentElement).append(style);
  return style;
}

function updateCustomHighlightStyles(highlights: StoredHighlight[]): void {
  const style = ensureStyleElement();
  style.textContent = highlights
    .map((highlight) => {
      const name = getHighlightName(highlight.id);
      return `::highlight(${name}) { background-color: ${withAlpha(highlight.color, '99')}; color: inherit; }`;
    })
    .join('\n');
}

function clearCustomHighlightStyles(): void {
  const style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (style) {
    style.textContent = '';
  }
}

function shouldSkipNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }

  if (!node.textContent?.trim()) {
    return true;
  }

  if (parent.closest(`#${ROOT_ID}`)) {
    return true;
  }

  if (parent.closest(`[${HIGHLIGHT_ATTR}]`)) {
    return true;
  }

  if (parent.closest('script, style, noscript, textarea')) {
    return true;
  }

  if (parent.closest('[contenteditable="true"]')) {
    return true;
  }

  return false;
}

function getTextNodes(root: Node = document.body): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipNode(node as Text)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  return nodes;
}

function buildTextSegments(nodes: Text[]): { text: string; segments: TextSegment[] } {
  let cursor = 0;
  let text = '';
  const segments = nodes.map((node) => {
    const value = node.textContent ?? '';
    const segment = {
      node,
      start: cursor,
      end: cursor + value.length,
    };

    text += value;
    cursor += value.length;
    return segment;
  });

  return { text, segments };
}

function boundaryContext(range: Range, side: 'prefix' | 'suffix', size = 36): string {
  const context = document.createRange();
  context.selectNodeContents(document.body);

  if (side === 'prefix') {
    context.setEnd(range.startContainer, range.startOffset);
    return context.toString().slice(-size);
  }

  context.setStart(range.endContainer, range.endOffset);
  return context.toString().slice(0, size);
}

function getNodeXPath(node: Node): string {
  if (node === document.body) {
    return '/html/body';
  }

  const segments: string[] = [];
  let current: Node | null = node;

  while (current && current !== document.body) {
    const parent: Node | null = current.parentNode;
    if (!parent) {
      break;
    }

    const childNodes = Array.from(parent.childNodes) as Node[];

    if (current.nodeType === Node.TEXT_NODE) {
      const textNodes = childNodes.filter(
        (child) => child.nodeType === Node.TEXT_NODE,
      );
      const index = textNodes.indexOf(current) + 1;
      segments.unshift(`text()[${index}]`);
    } else if (isElement(current)) {
      const tag = current.tagName.toLowerCase();
      const currentTagName = current.tagName;
      const siblings = childNodes.filter(
        (child) => isElement(child) && child.tagName === currentTagName,
      );
      const index = siblings.indexOf(current) + 1;
      segments.unshift(`${tag}[${index}]`);
    }

    current = parent;
  }

  return `/html/body/${segments.join('/')}`;
}

function resolveXPath(path: string): Node | null {
  return document.evaluate(
    path,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue;
}

function locatePosition(segments: TextSegment[], offset: number): { node: Text; offset: number } | null {
  if (!segments.length) {
    return null;
  }

  if (offset >= segments[segments.length - 1].end) {
    const last = segments[segments.length - 1];
    return { node: last.node, offset: last.node.textContent?.length ?? 0 };
  }

  const segment = segments.find((entry) => offset >= entry.start && offset < entry.end);
  if (!segment) {
    return null;
  }

  return {
    node: segment.node,
    offset: offset - segment.start,
  };
}

function buildRangeFromOffsets(
  segments: TextSegment[],
  startOffset: number,
  endOffset: number,
): Range | null {
  const start = locatePosition(segments, startOffset);
  const end = locatePosition(segments, Math.max(endOffset - 1, startOffset));
  if (!start || !end) {
    return null;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function findRangeFromTextQuote(anchor: HighlightAnchor): Range | null {
  const { text, segments } = buildTextSegments(getTextNodes());
  if (!anchor.text || !text.includes(anchor.text)) {
    return null;
  }

  let searchStart = 0;
  let bestMatch: { start: number; score: number } | null = null;

  while (searchStart < text.length) {
    const index = text.indexOf(anchor.text, searchStart);
    if (index === -1) {
      break;
    }

    const prefixMatches =
      !anchor.prefix || text.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix;
    const suffixStart = index + anchor.text.length;
    const suffixMatches =
      !anchor.suffix || text.slice(suffixStart, suffixStart + anchor.suffix.length) === anchor.suffix;
    const score = Number(prefixMatches) + Number(suffixMatches);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { start: index, score };
      if (score === 2) {
        break;
      }
    }

    searchStart = index + anchor.text.length;
  }

  if (!bestMatch) {
    return null;
  }

  return buildRangeFromOffsets(
    segments,
    bestMatch.start,
    bestMatch.start + anchor.text.length,
  );
}

function getStoredRange(highlight: StoredHighlight): Range | null {
  const startNode = resolveXPath(highlight.startXPath);
  const endNode = resolveXPath(highlight.endXPath);

  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, highlight.startOffset);
      range.setEnd(endNode, highlight.endOffset);
      if (range.toString() === highlight.text) {
        return range;
      }
    } catch {
      // Fall through to quote matching.
    }
  }

  return findRangeFromTextQuote(highlight);
}

function getSlicesForRange(range: Range): TextSlice[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;

  if (!root) {
    return [];
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text;
      if (shouldSkipNode(text)) {
        return NodeFilter.FILTER_REJECT;
      }

      return range.intersectsNode(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const slices: TextSlice[] = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const content = node.textContent ?? '';
    let start = 0;
    let end = content.length;

    if (node === range.startContainer) {
      start = range.startOffset;
    }

    if (node === range.endContainer) {
      end = range.endOffset;
    }

    if (end > start) {
      slices.push({ node, start, end });
    }

    current = walker.nextNode();
  }

  if (slices.length === 0 && isText(range.startContainer) && range.startContainer === range.endContainer) {
    return [
      {
        node: range.startContainer,
        start: range.startOffset,
        end: range.endOffset,
      },
    ];
  }

  return slices;
}

function wrapSlice(slice: TextSlice, highlight: StoredHighlight): void {
  const originalNode = slice.node;
  const originalLength = originalNode.textContent?.length ?? 0;

  if (!originalNode.parentNode || slice.start === slice.end || slice.end > originalLength) {
    return;
  }

  let target = originalNode;
  if (slice.start > 0) {
    target = originalNode.splitText(slice.start);
  }

  const selectedLength = slice.end - slice.start;
  if (selectedLength < target.length) {
    target.splitText(selectedLength);
  }

  const wrapper = document.createElement(HIGHLIGHT_TAG);
  wrapper.setAttribute(HIGHLIGHT_ATTR, highlight.id);
  wrapper.dataset.markerColor = normalizeColor(highlight.color);
  wrapper.style.all = 'unset';
  wrapper.style.display = 'inline';
  wrapper.style.font = 'inherit';
  wrapper.style.color = 'inherit';
  wrapper.style.lineHeight = 'inherit';
  wrapper.style.letterSpacing = 'inherit';
  wrapper.style.textTransform = 'inherit';
  wrapper.style.textDecoration = 'inherit';
  wrapper.style.whiteSpace = 'inherit';
  wrapper.style.verticalAlign = 'baseline';
  wrapper.style.cursor = 'pointer';
  wrapper.style.borderRadius = '0.35em';
  wrapper.style.paddingInline = '0.08em';
  wrapper.style.marginInline = '0.02em';
  wrapper.style.background = `linear-gradient(135deg, ${withAlpha(highlight.color, 'cc')}, ${withAlpha(highlight.color, '99')})`;
  wrapper.style.boxShadow = `0 0 0 1px ${withAlpha(highlight.color, 'aa')}`;
  wrapper.style.boxDecorationBreak = 'clone';
  wrapper.style.setProperty('-webkit-box-decoration-break', 'clone');

  const parent = target.parentNode;
  if (!parent) {
    return;
  }

  parent.replaceChild(wrapper, target);
  wrapper.append(target);
}

function unwrap(span: HTMLElement): void {
  const parent = span.parentNode;
  if (!parent) {
    return;
  }

  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }

  parent.removeChild(span);
  parent.normalize();
}

export function createHighlightFromRange(range: Range, color: string, url: string): StoredHighlight {
  return {
    id: crypto.randomUUID(),
    color: normalizeColor(color),
    url,
    createdAt: Date.now(),
    startXPath: getNodeXPath(range.startContainer),
    startOffset: range.startOffset,
    endXPath: getNodeXPath(range.endContainer),
    endOffset: range.endOffset,
    text: range.toString(),
    prefix: boundaryContext(range, 'prefix'),
    suffix: boundaryContext(range, 'suffix'),
  };
}

export function clearRenderedHighlights(): void {
  if (supportsCustomHighlights()) {
    getHighlightRegistry()?.clear();
    liveRanges.clear();
    clearCustomHighlightStyles();
    return;
  }

  document.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTR}]`).forEach(unwrap);
}

function renderHighlight(highlight: StoredHighlight): number {
  const range = getStoredRange(highlight);
  if (!range || !range.toString().trim()) {
    return 0;
  }

  const slices = getSlicesForRange(range);
  if (!slices.length) {
    return 0;
  }

  slices
    .slice()
    .reverse()
    .forEach((slice) => wrapSlice(slice, highlight));
  return 1;
}

export function renderMissingHighlights(highlights: StoredHighlight[]): number {
  if (supportsCustomHighlights()) {
    return renderStoredHighlights(highlights);
  }

  let rendered = 0;
  for (const highlight of highlights) {
    if (document.querySelector(`[${HIGHLIGHT_ATTR}="${highlight.id}"]`)) {
      continue;
    }

    rendered += renderHighlight(highlight);
  }

  return rendered;
}

export function renderStoredHighlights(highlights: StoredHighlight[]): number {
  if (supportsCustomHighlights()) {
    const registry = getHighlightRegistry();
    const HighlightCtor = getHighlightConstructor();
    if (!registry || !HighlightCtor) {
      return 0;
    }

    registry.clear();
    liveRanges.clear();
    updateCustomHighlightStyles(highlights);

    let rendered = 0;
    for (const highlight of highlights) {
      const range = getStoredRange(highlight);
      if (!range || !range.toString().trim()) {
        continue;
      }

      liveRanges.set(highlight.id, range);
      registry.set(getHighlightName(highlight.id), new HighlightCtor(range));
      rendered += 1;
    }

    return rendered;
  }

  clearRenderedHighlights();

  let rendered = 0;
  for (const highlight of highlights) {
    rendered += renderHighlight(highlight);
  }

  return rendered;
}

export function getHighlightIdFromPoint(x: number, y: number): string | null {
  if (supportsCustomHighlights()) {
    const position = document.caretPositionFromPoint?.(x, y);
    if (position) {
      for (const [id, range] of liveRanges) {
        try {
          if (range.isPointInRange(position.offsetNode, position.offset)) {
            return id;
          }
        } catch {
          // Ignore invalid points.
        }
      }
    }

    const caretRange = document.caretRangeFromPoint?.(x, y);
    if (caretRange) {
      for (const [id, range] of liveRanges) {
        try {
          if (range.isPointInRange(caretRange.startContainer, caretRange.startOffset)) {
            return id;
          }
        } catch {
          // Ignore invalid points.
        }
      }
    }

    return null;
  }

  const element = document.elementFromPoint(x, y);
  return element?.closest<HTMLElement>(`[${HIGHLIGHT_ATTR}]`)?.getAttribute(HIGHLIGHT_ATTR) ?? null;
}

export function rangeIsHighlightable(range: Range): boolean {
  const text = range.toString().replace(/\s+/g, ' ').trim();
  if (!text) {
    return false;
  }

  const startElement = isElement(range.startContainer)
    ? range.startContainer
    : range.startContainer.parentElement;

  if (startElement?.closest(`#${ROOT_ID}`)) {
    return false;
  }

  if (startElement?.closest('input, textarea, [contenteditable="true"]')) {
    return false;
  }

  if (startElement?.closest(`[${HIGHLIGHT_ATTR}]`)) {
    return false;
  }

  return true;
}
