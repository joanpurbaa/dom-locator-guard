// ─────────────────────────────────────────────
//  @dom-locator-guard/cypress
//  Plugin untuk Cypress — dua bagian:
//  1. setupNodeEvents  → task handlers (Node.js side)
//  2. commands         → cy.guardSnapshot() (browser side)
// ─────────────────────────────────────────────

import type { GuardConfig, LocatorReport, NormalizedNode, DOMSnapshot } from '@dom-locator-guard/core';
import {
  LocatorGuard,
  SnapshotStore,
  diffSnapshots,
  generateReport,
  buildIndex,
  DEFAULT_CONFIG,
} from '@dom-locator-guard/core';

// ─────────────────────────────────────────────────────────────────────────
//  PART 1: Node.js plugin — tambahkan ke cypress.config.ts
//
//  import { defineConfig } from 'cypress';
//  import { locatorGuardPlugin } from '@dom-locator-guard/cypress';
//
//  export default defineConfig({
//    e2e: {
//      setupNodeEvents(on, config) {
//        locatorGuardPlugin(on, config);
//        return config;
//      }
//    }
//  });
// ─────────────────────────────────────────────────────────────────────────

export interface CypressPluginOptions {
  config?: Partial<GuardConfig>;
}

// Singleton guard instance (persists across tasks in one run)
let _guard: LocatorGuard | null = null;
let _collectedReports: LocatorReport[] = [];

function getGuard(options: CypressPluginOptions = {}): LocatorGuard {
  if (!_guard) {
    _guard = new LocatorGuard(options.config ?? {});
  }
  return _guard;
}

export function locatorGuardPlugin(
  on: Cypress.PluginEvents,
  _config: Cypress.PluginConfigOptions,
  options: CypressPluginOptions = {}
): void {
  const guard = getGuard(options);

  on('task', {
    // ── compareSnapshot: dipanggil dari cy.task setelah guardSnapshot ───
    async 'locatorGuard:compare'(snapshot: DOMSnapshot): Promise<LocatorReport | null> {
      const report = await guard.compareSnapshot(snapshot);
      if (report) {
        _collectedReports.push(report);
      }
      return report;
    },

    // ── updateBaseline: force update baseline ────────────────────────
    'locatorGuard:updateBaseline'(snapshot: DOMSnapshot): null {
      guard.updateBaseline(snapshot);
      return null;
    },

    // ── getReports: ambil semua reports dari run ini ─────────────────
    'locatorGuard:getReports'(): LocatorReport[] {
      return _collectedReports;
    },

    // ── reset: clear state antar test runs ──────────────────────────
    'locatorGuard:reset'(): null {
      _collectedReports = [];
      return null;
    },

    // ── log: pass log message ke Node console ───────────────────────
    'locatorGuard:log'(message: string): null {
      console.log(`[LocatorGuard] ${message}`);
      return null;
    },
  });

  // Print summary setelah semua test selesai
  on('after:run', () => {
    if (_collectedReports.length > 0) {
      const totalChanges = _collectedReports.reduce((sum, r) => sum + r.changedCount, 0);
      console.log(`\n╔══════════════════════════════════════════╗`);
      console.log(`║  DOM LOCATOR GUARD — Run Summary         ║`);
      console.log(`╠══════════════════════════════════════════╣`);
      console.log(`║  Pages with changes : ${String(_collectedReports.length).padEnd(18)}║`);
      console.log(`║  Total locator diffs: ${String(totalChanges).padEnd(18)}║`);
      console.log(`╚══════════════════════════════════════════╝\n`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  PART 2: Browser-side commands — tambahkan ke cypress/support/e2e.ts
//
//  import '@dom-locator-guard/cypress/commands';
//
//  Atau jika pakai TypeScript, tambahkan ke tsconfig.json:
//  "types": ["@dom-locator-guard/cypress"]
// ─────────────────────────────────────────────────────────────────────────

// Script yang diinjeksikan ke browser untuk capture DOM
export const BROWSER_CAPTURE_SCRIPT = `
(function captureDOM() {
  const SKIP = new Set(['SCRIPT','STYLE','META','HEAD','LINK','NOSCRIPT','TEMPLATE']);

  function getCSSPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur.tagName !== 'HTML') {
      const tag = cur.tagName.toLowerCase();
      const siblings = Array.from(cur.parentElement?.children ?? [])
        .filter(s => s.tagName === cur.tagName);
      const idx = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')' : '';
      parts.unshift(tag + idx);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function getDepth(el) {
    let d = 0, c = el.parentElement;
    while (c) { d++; c = c.parentElement; }
    return d;
  }

  function fingerprint(tag, text, path) {
    const s = tag + '|' + text.slice(0, 50) + '|' + path;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash << 5) - hash + s.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  function normalize(el) {
    if (SKIP.has(el.tagName)) return null;
    const tag = el.tagName.toLowerCase();
    const attrs = {};
    Array.from(el.attributes).forEach(a => attrs[a.name] = a.value);

    const text = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .filter(Boolean).join(' ');

    const domPath = getCSSPath(el);
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

    return {
      tagName: tag,
      textContent: text,
      attributes: attrs,
      locators,
      domPath,
      xpath: '',
      depth: getDepth(el),
      siblingIndex: 0,
      fingerprint: fingerprint(tag, text, domPath),
      visualPosition: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      children: Array.from(el.children).map(normalize).filter(Boolean),
    };
  }

  return normalize(document.body);
})()
`;

// ── Cypress commands definition (untuk diload di support/e2e.ts) ──────────

export function registerCypressCommands(): void {
  // Tipe-safe command registration
  // Pastikan file ini di-import di cypress/support/e2e.ts

  Cypress.Commands.add('guardSnapshot' as never, (featureName: string) => {
    // Capture DOM di browser
    cy.window().then(win => {
      const tree = win.eval(BROWSER_CAPTURE_SCRIPT) as NormalizedNode;
      const snapshot: DOMSnapshot = {
        featureName,
        url: win.location.href,
        timestamp: Date.now(),
        guardVersion: '0.1.0',
        tree,
        index: buildIndex(tree),
      };

      // Kirim ke Node.js side via task
      cy.task('locatorGuard:compare', snapshot, { log: false }).then((report) => {
        if (report) {
          const r = report as LocatorReport;
          if (r.changedCount > 0) {
            Cypress.log({
              name: '⚠ LocatorGuard',
              message: `${r.changedCount} locator change(s) on ${featureName}`,
              consoleProps: () => ({
                Feature: featureName,
                Changes: r.changedCount,
                Report: r,
              }),
            });
          } else {
            Cypress.log({
              name: '✓ LocatorGuard',
              message: `All locators stable on ${featureName}`,
            });
          }
        }
      });
    });
  });

  Cypress.Commands.add('guardUpdateBaseline' as never, (featureName: string) => {
    cy.window().then(win => {
      const tree = win.eval(BROWSER_CAPTURE_SCRIPT) as NormalizedNode;
      const snapshot: DOMSnapshot = {
        featureName,
        url: win.location.href,
        timestamp: Date.now(),
        guardVersion: '0.1.0',
        tree,
        index: buildIndex(tree),
      };
      cy.task('locatorGuard:updateBaseline', snapshot, { log: false });
      cy.log(`[LocatorGuard] Baseline updated for: ${featureName}`);
    });
  });
}

// ── TypeScript declarations untuk custom commands ─────────────────────────

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Capture DOM snapshot dan compare ke baseline.
       * Logs a warning jika ada locator changes, tapi test tetap berjalan.
       * @param featureName - Nama fitur, e.g. 'login', 'checkout'
       */
      guardSnapshot(featureName: string): Chainable<void>;

      /**
       * Force update baseline dengan snapshot DOM terbaru.
       * Gunakan ini setelah perubahan yang disengaja oleh developer.
       */
      guardUpdateBaseline(featureName: string): Chainable<void>;
    }
  }
}

export {};
