// ─────────────────────────────────────────────
//  snapshot/normalizer.ts
//  Parse raw HTML → NormalizedNode tree
//  Digunakan oleh: browser-side capture + offline HTML file parsing
// ─────────────────────────────────────────────

import * as htmlparser2 from 'htmlparser2';
import { DomHandler, Element, Text, Node } from 'domhandler';
import { createHash } from 'crypto';
import type { NormalizedNode, TrackedLocators, BoundingBox } from '../types';

// ── Attribute keys yang diekstrak sebagai locators ────────────────────────

const LOCATOR_ATTR_MAP: Record<string, keyof TrackedLocators> = {
  'id': 'id',
  'name': 'name',
  'data-testid': 'dataTestId',
  'data-testId': 'dataTestid',
  'data-cy': 'dataCy',
  'data-automation-id': 'dataAutomationId',
  'aria-label': 'ariaLabel',
  'role': 'role',
  'type': 'type',
  'href': 'href',
  'placeholder': 'placeholder',
};

// ── Helper: bangun CSS path dari root ─────────────────────────────────────

function buildDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Node | null = el;

  while (current && current.type === 'tag') {
    const elem = current as Element;
    const tag = elem.name.toLowerCase();

    // Hitung posisi di antara sibling yang sama tagnya
    const siblings = (elem.parent as Element | null)?.children ?? [];
    const sameTagSiblings = siblings.filter(
      (s): s is Element => s.type === 'tag' && (s as Element).name === elem.name
    );

    let selector = tag;
    if (sameTagSiblings.length > 1) {
      const index = sameTagSiblings.indexOf(elem) + 1;
      selector = `${tag}:nth-of-type(${index})`;
    }

    parts.unshift(selector);
    current = elem.parent ?? null;
  }

  return parts.join(' > ');
}

// ── Helper: bangun XPath ──────────────────────────────────────────────────

function buildXPath(el: Element): string {
  const parts: string[] = [];
  let current: Node | null = el;

  while (current && current.type === 'tag') {
    const elem = current as Element;
    const tag = elem.name.toLowerCase();
    const siblings = (elem.parent as Element | null)?.children ?? [];
    const sameTag = siblings.filter(
      (s): s is Element => s.type === 'tag' && (s as Element).name === elem.name
    );
    const idx = sameTag.length > 1 ? `[${sameTag.indexOf(elem) + 1}]` : '';
    parts.unshift(`${tag}${idx}`);
    current = elem.parent ?? null;
  }

  return '/' + parts.join('/');
}

// ── Helper: extract text content (non-recursive, direct text children) ───

function getDirectText(el: Element): string {
  return el.children
    .filter((c): c is Text => c.type === 'text')
    .map(c => c.data.trim())
    .filter(Boolean)
    .join(' ');
}

// ── Helper: fingerprint dari stable properties ────────────────────────────

function computeFingerprint(tagName: string, textContent: string, domPath: string): string {
  return createHash('sha256')
    .update(`${tagName}::${textContent}::${domPath}`)
    .digest('hex')
    .slice(0, 16); // 16 hex chars = cukup untuk lookup key
}

// ── Helper: hitung depth dari root ───────────────────────────────────────

function getDepth(el: Element): number {
  let depth = 0;
  let current: Node | null = el.parent;
  while (current) {
    depth++;
    current = (current as Element).parent ?? null;
  }
  return depth;
}

// ── Helper: sibling index (hanya sesama tagName) ──────────────────────────

function getSiblingIndex(el: Element): number {
  const siblings = (el.parent as Element | null)?.children ?? [];
  const sameTag = siblings.filter(
    (s): s is Element => s.type === 'tag' && (s as Element).name === el.name
  );
  return sameTag.indexOf(el);
}

// ── SKIP tags yang tidak relevan untuk locator tracking ───────────────────

const SKIP_TAGS = new Set([
  'script', 'style', 'meta', 'head', 'link',
  'noscript', 'template', 'svg', 'path', 'defs',
]);

// ── Core: normalize satu element ─────────────────────────────────────────

export function normalizeElement(
  el: Element,
  visualPosition?: BoundingBox
): NormalizedNode {
  const tagName = el.name.toLowerCase();
  const textContent = getDirectText(el).trim();
  const attributes: Record<string, string> = {};

  // Collect all attributes
  for (const [k, v] of Object.entries(el.attribs ?? {})) {
    attributes[k] = v ?? '';
  }

  // Extract tracked locators
  const locators: TrackedLocators = { classNames: [] };

  for (const [attrName, locatorKey] of Object.entries(LOCATOR_ATTR_MAP)) {
    const val = attributes[attrName];
    if (val !== undefined && val !== '') {
      (locators as unknown as Record<string, unknown>)[locatorKey] = val;
    }
  }

  // Class list
  const classAttr = attributes['class'] ?? '';
  locators.classNames = classAttr
    .split(/\s+/)
    .map(c => c.trim())
    .filter(Boolean);

  const domPath = buildDomPath(el);
  const xpath = buildXPath(el);
  const depth = getDepth(el);
  const siblingIndex = getSiblingIndex(el);
  const fingerprint = computeFingerprint(tagName, textContent, domPath);

  // Recurse into children
  const children: NormalizedNode[] = [];
  for (const child of el.children) {
    if (child.type === 'tag') {
      const childEl = child as Element;
      if (!SKIP_TAGS.has(childEl.name.toLowerCase())) {
        children.push(normalizeElement(childEl));
      }
    }
  }

  return {
    tagName,
    textContent,
    attributes,
    locators,
    domPath,
    xpath,
    depth,
    siblingIndex,
    fingerprint,
    visualPosition,
    children,
  };
}

// ── Public: parse HTML string → NormalizedNode ────────────────────────────

export function parseHTML(html: string): NormalizedNode | null {
  let root: NormalizedNode | null = null;

  const handler = new DomHandler((err, dom) => {
    if (err) return;

    // Find <body> or fallback to first element
    function findBody(nodes: Node[]): Element | null {
      for (const node of nodes) {
        if (node.type === 'tag') {
          const el = node as Element;
          if (el.name === 'body') return el;
          const found = findBody(el.children);
          if (found) return found;
        }
      }
      return null;
    }

    const bodyEl = findBody(dom);
    if (bodyEl) {
      root = normalizeElement(bodyEl);
    }
  });

  const parser = new htmlparser2.Parser(handler);
  parser.write(html);
  parser.end();

  return root;
}

// ── Public: build flat index dari tree ────────────────────────────────────

export function buildIndex(node: NormalizedNode): Record<string, NormalizedNode> {
  const index: Record<string, NormalizedNode> = {};

  function traverse(n: NormalizedNode) {
    index[n.fingerprint] = n;
    // Juga index by domPath for secondary lookup
    index[`path:${n.domPath}`] = n;
    for (const child of n.children) traverse(child);
  }

  traverse(node);
  return index;
}

// ── Public: flatten tree jadi array ──────────────────────────────────────

export function flattenTree(node: NormalizedNode): NormalizedNode[] {
  const result: NormalizedNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  return result;
}
