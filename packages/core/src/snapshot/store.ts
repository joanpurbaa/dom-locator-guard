// ─────────────────────────────────────────────
//  snapshot/store.ts
//  Persist dan load DOMSnapshot ke/dari disk
// ─────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { DOMSnapshot, NormalizedNode, GuardConfig } from '../types';
import { parseHTML, buildIndex } from './normalizer';

const GUARD_VERSION = '0.1.0';

// ── Slug dari featureName untuk nama file ────────────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── SnapshotStore class ───────────────────────────────────────────────────

export class SnapshotStore {
  private baselineDir: string;

  constructor(config: Pick<GuardConfig, 'baselineDir'>) {
    this.baselineDir = config.baselineDir;
    fs.mkdirSync(this.baselineDir, { recursive: true });
  }

  // ── Buat DOMSnapshot dari HTML string ──────────────────────────────────

  createFromHTML(
    html: string,
    featureName: string,
    url: string
  ): DOMSnapshot {
    const { parseHTML: ph, buildIndex: bi } = require('./normalizer');
    const tree = parseHTML(html);
    if (!tree) {
      throw new Error(`[LocatorGuard] Failed to parse HTML for feature: ${featureName}`);
    }
    const index = buildIndex(tree);

    return {
      featureName,
      url,
      timestamp: Date.now(),
      guardVersion: GUARD_VERSION,
      tree,
      index,
    };
  }

  // ── Buat dari NormalizedNode langsung (dari browser capture) ───────────

  createFromNode(
    tree: NormalizedNode,
    featureName: string,
    url: string
  ): DOMSnapshot {
    const index = buildIndex(tree);
    return {
      featureName,
      url,
      timestamp: Date.now(),
      guardVersion: GUARD_VERSION,
      tree,
      index,
    };
  }

  // ── Simpan snapshot sebagai baseline ───────────────────────────────────

  saveBaseline(snapshot: DOMSnapshot): string {
    const filename = `${toSlug(snapshot.featureName)}.baseline.json`;
    const filePath = path.join(this.baselineDir, filename);

    // Backup jika sudah ada
    if (fs.existsSync(filePath)) {
      const backupPath = filePath.replace('.json', `.backup-${Date.now()}.json`);
      fs.copyFileSync(filePath, backupPath);
      console.log(`[LocatorGuard] Previous baseline backed up to: ${backupPath}`);
    }

    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`[LocatorGuard] Baseline saved: ${filePath}`);
    return filePath;
  }

  // ── Load baseline snapshot ─────────────────────────────────────────────

  loadBaseline(featureName: string): DOMSnapshot | null {
    const filename = `${toSlug(featureName)}.baseline.json`;
    const filePath = path.join(this.baselineDir, filename);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as DOMSnapshot;
    } catch (err) {
      console.error(`[LocatorGuard] Failed to load baseline for "${featureName}":`, err);
      return null;
    }
  }

  // ── Cek apakah baseline ada ────────────────────────────────────────────

  hasBaseline(featureName: string): boolean {
    const filename = `${toSlug(featureName)}.baseline.json`;
    return fs.existsSync(path.join(this.baselineDir, filename));
  }

  // ── List semua feature yang punya baseline ─────────────────────────────

  listBaselines(): string[] {
    const files = fs.readdirSync(this.baselineDir);
    return files
      .filter(f => f.endsWith('.baseline.json'))
      .map(f => f.replace('.baseline.json', ''));
  }

  // ── Hapus baseline ─────────────────────────────────────────────────────

  deleteBaseline(featureName: string): boolean {
    const filename = `${toSlug(featureName)}.baseline.json`;
    const filePath = path.join(this.baselineDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
