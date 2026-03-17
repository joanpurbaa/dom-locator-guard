// ─────────────────────────────────────────────
//  index.ts — Public API for @dom-locator-guard/core
// ─────────────────────────────────────────────

export * from './types';
export { parseHTML, buildIndex, flattenTree, normalizeElement } from './snapshot/normalizer';
export { SnapshotStore } from './snapshot/store';
export { diffSnapshots } from './diff/engine';
export { computeSimilarity, stringSimilarity, explainScore } from './diff/similarity';
export { generateReport, formatConsole, formatHTML, formatJSON } from './report/generator';
export { ReportWriter } from './report/writer';

// ── LocatorGuard — orchestrator class ────────────────────────────────────

import type { GuardConfig, DOMSnapshot, LocatorReport, OutputFormat } from './types';
import { DEFAULT_CONFIG } from './types';
import { SnapshotStore } from './snapshot/store';
import { parseHTML } from './snapshot/normalizer';
import { diffSnapshots } from './diff/engine';
import { generateReport } from './report/generator';
import { ReportWriter } from './report/writer';

export class LocatorGuard {
  private config: GuardConfig;
  private store: SnapshotStore;
  private writer: ReportWriter;

  constructor(config: Partial<GuardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new SnapshotStore(this.config);
    this.writer = new ReportWriter(this.config);
  }

  /**
   * Capture snapshot dari HTML string dan compare ke baseline.
   * Jika belum ada baseline, simpan sebagai baseline baru.
   * Return null jika ini adalah baseline run pertama.
   */
  async compareHTML(
    html: string,
    featureName: string,
    url: string = ''
  ): Promise<LocatorReport | null> {
    const tree = parseHTML(html);
    if (!tree) throw new Error(`[LocatorGuard] Failed to parse HTML for: ${featureName}`);

    const current = this.store.createFromNode(tree, featureName, url);

    return this.compareSnapshot(current);
  }

  /**
   * Compare snapshot yang sudah dibuat (misal dari Playwright capture).
   */
  async compareSnapshot(current: DOMSnapshot): Promise<LocatorReport | null> {
    const baseline = this.store.loadBaseline(current.featureName);

    if (!baseline) {
      // First run — simpan sebagai baseline
      this.store.saveBaseline(current);
      console.log(`[LocatorGuard] Baseline created for: ${current.featureName}`);
      return null;
    }

    const diffs = diffSnapshots(baseline, current, this.config);
    const report = generateReport(baseline, current, diffs);

    this.writer.write(report, this.config.outputFormats);

    return report;
  }

  /**
   * Update baseline dengan snapshot terbaru (setelah perubahan disengaja).
   */
  updateBaseline(snapshot: DOMSnapshot): void {
    this.store.saveBaseline(snapshot);
    console.log(`[LocatorGuard] Baseline updated for: ${snapshot.featureName}`);
  }

  /**
   * Cek apakah ada locator changes yang perlu diperhatikan.
   */
  hasChanges(report: LocatorReport): boolean {
    return report.changedCount > 0 || report.removedCount > 0;
  }

  get snapshotStore(): SnapshotStore {
    return this.store;
  }
}
