// ─────────────────────────────────────────────
//  @dom-locator-guard/playwright
//  Playwright fixture + page capture helper
// ─────────────────────────────────────────────

import { test as base, Page } from '@playwright/test';
import type { NormalizedNode, GuardConfig, LocatorReport, DOMSnapshot } from '@dom-locator-guard/core';
import {
  LocatorGuard,
  SnapshotStore,
  generateReport,
  diffSnapshots,
  buildIndex,
} from '@dom-locator-guard/core';

// ── Browser-side DOM capture script ──────────────────────────────────────
//  Ini diinjeksikan ke browser via page.evaluate()

const BROWSER_CAPTURE_SCRIPT = `
(function() {
  function getCSSPath(el) {
    const parts = [];
    let current = el;
    while (current && current.tagName) {
      const tag = current.tagName.toLowerCase();
      const sameTag = Array.from(current.parentElement?.children ?? [])
        .filter(s => s.tagName === current.tagName);
      const idx = sameTag.length > 1 ? ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')' : '';
      parts.unshift(tag + idx);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getXPath(el) {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      const tag = current.tagName.toLowerCase();
      const sameTag = Array.from(current.parentElement?.children ?? [])
        .filter(s => s.tagName === current.tagName);
      const idx = sameTag.length > 1 ? '[' + (sameTag.indexOf(current) + 1) + ']' : '';
      parts.unshift(tag + idx);
      current = current.parentElement;
    }
    return '/' + parts.join('/');
  }

  function getDepth(el) {
    let d = 0, c = el.parentElement;
    while (c) { d++; c = c.parentElement; }
    return d;
  }

  function getSiblingIndex(el) {
    const sameTag = Array.from(el.parentElement?.children ?? [])
      .filter(s => s.tagName === el.tagName);
    return sameTag.indexOf(el);
  }

  function computeFingerprint(tag, text, path) {
    // Simple fingerprint tanpa crypto — pakai btoa
    const str = tag + '::' + text + '::' + path;
    return btoa(encodeURIComponent(str)).slice(0, 16);
  }

  const SKIP = new Set(['SCRIPT','STYLE','META','HEAD','LINK','NOSCRIPT','TEMPLATE','SVG','PATH']);

  function normalize(el, depth) {
    if (SKIP.has(el.tagName)) return null;
    const tag = el.tagName.toLowerCase();
    const text = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');

    const attrs = {};
    Array.from(el.attributes).forEach(a => attrs[a.name] = a.value);

    const rect = el.getBoundingClientRect();
    const locators = {
      id: attrs.id || undefined,
      name: attrs.name || undefined,
      dataTestId: attrs['data-testid'] || undefined,
      dataCy: attrs['data-cy'] || undefined,
      dataAutomationId: attrs['data-automation-id'] || undefined,
      ariaLabel: attrs['aria-label'] || undefined,
      role: attrs.role || undefined,
      type: attrs.type || undefined,
      href: attrs.href || undefined,
      placeholder: attrs.placeholder || undefined,
      classNames: (attrs.class || '').split(/\\s+/).filter(Boolean),
    };

    const domPath = getCSSPath(el);
    const children = Array.from(el.children)
      .map(c => normalize(c, depth + 1))
      .filter(Boolean);

    return {
      tagName: tag,
      textContent: text,
      attributes: attrs,
      locators,
      domPath,
      xpath: getXPath(el),
      depth: getDepth(el),
      siblingIndex: getSiblingIndex(el),
      fingerprint: computeFingerprint(tag, text, domPath),
      visualPosition: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      children,
    };
  }

  return normalize(document.body, 0);
})()
`;

// ── Playwright DOM capture ────────────────────────────────────────────────

export async function capturePageSnapshot(
  page: Page,
  featureName: string
): Promise<DOMSnapshot> {
  const tree = await page.evaluate(BROWSER_CAPTURE_SCRIPT) as NormalizedNode;

  if (!tree) {
    throw new Error(`[LocatorGuard] Failed to capture DOM for: ${featureName}`);
  }

  return {
    featureName,
    url: page.url(),
    timestamp: Date.now(),
    guardVersion: '0.1.0',
    tree,
    index: buildIndex(tree),
  };
}

// ── Playwright fixture ────────────────────────────────────────────────────

export type LocatorGuardFixtures = {
  locatorGuard: PlaywrightLocatorGuard;
};

export interface PlaywrightGuardOptions {
  config?: Partial<GuardConfig>;
}

export class PlaywrightLocatorGuard {
  private guard: LocatorGuard;
  private page: Page;
  private pendingReports: LocatorReport[] = [];

  constructor(page: Page, config: Partial<GuardConfig> = {}) {
    this.page = page;
    this.guard = new LocatorGuard(config);
  }

  /**
   * Capture snapshot dari page saat ini dan compare ke baseline.
   * Jika ini run pertama, otomatis buat baseline.
   * PENTING: Test tetap berjalan meski ada locator change.
   */
  async check(featureName: string): Promise<LocatorReport | null> {
    const snapshot = await capturePageSnapshot(this.page, featureName);
    const report = await this.guard.compareSnapshot(snapshot);

    if (report && this.guard.hasChanges(report)) {
      this.pendingReports.push(report);
    }

    return report;
  }

  /**
   * Force update baseline dengan snapshot terbaru.
   * Gunakan ini setelah perubahan yang disengaja.
   */
  async updateBaseline(featureName: string): Promise<void> {
    const snapshot = await capturePageSnapshot(this.page, featureName);
    this.guard.updateBaseline(snapshot);
  }

  /**
   * Semua reports dari test run ini.
   */
  get reports(): LocatorReport[] {
    return this.pendingReports;
  }

  /**
   * Apakah ada locator change dalam run ini.
   */
  get hasChanges(): boolean {
    return this.pendingReports.length > 0;
  }
}

// ── Extend Playwright test dengan locatorGuard fixture ───────────────────

export function createGuardFixture(options: PlaywrightGuardOptions = {}) {
  return base.extend<LocatorGuardFixtures>({
    locatorGuard: async ({ page }, use) => {
      const guard = new PlaywrightLocatorGuard(page, options.config);
      await use(guard);

      // Setelah test selesai: print summary jika ada changes
      if (guard.hasChanges) {
        console.warn(
          `\n[LocatorGuard] ⚠ ${guard.reports.length} page(s) had locator changes. ` +
          `Check reports in ${options.config?.outputDir ?? './locator-guard-reports'}\n`
        );
      }
    },
  });
}

// Default export: test dengan guard fixture menggunakan default config
export const test = createGuardFixture();
export { expect } from '@playwright/test';
