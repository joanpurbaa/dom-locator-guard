// ─────────────────────────────────────────────
//  diff/similarity.ts
//  Similarity scoring antara dua NormalizedNode
//  Menentukan apakah dua elemen "sama secara fungsional"
// ─────────────────────────────────────────────

import { distance } from 'fastest-levenshtein';
import type {
  NormalizedNode,
  SimilaritySignals,
  BoundingBox,
} from '../types';

// ── String similarity (0-1) via normalized Levenshtein ───────────────────

export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const dist = distance(a.toLowerCase(), b.toLowerCase());
  return 1 - dist / maxLen;
}

// ── Jaccard similarity untuk token-based comparison (CSS paths) ──────────

export function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1;

  // Tokenize by ' > ' (CSS path separator)
  const setA = new Set(a.split(' > '));
  const setB = new Set(b.split(' > '));

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 1;
  return intersection.size / union.size;
}

// ── Visual proximity score (0-1) ─────────────────────────────────────────
//  Score tinggi = posisi visual hampir sama
//  Threshold: elemen dianggap "sama posisi" jika dalam radius 20px

export function visualProximityScore(
  a?: BoundingBox,
  b?: BoundingBox
): number {
  // Tidak ada data visual = neutral score 0.5
  if (!a || !b) return 0.5;

  const dX = Math.abs(a.x - b.x);
  const dY = Math.abs(a.y - b.y);
  const dW = Math.abs(a.width - b.width);
  const dH = Math.abs(a.height - b.height);

  // Normalize ke range 0-1 dengan threshold 100px
  const posScore = Math.max(0, 1 - (dX + dY) / 200);
  const sizeScore = Math.max(0, 1 - (dW + dH) / 200);

  // Posisi lebih penting dari ukuran
  return posScore * 0.7 + sizeScore * 0.3;
}

// ── DOM path depth similarity ─────────────────────────────────────────────
//  Dua elemen di depth yang sama dan path yang mirip = kemungkinan sama

export function pathSimilarity(pathA: string, pathB: string): number {
  if (pathA === pathB) return 1;

  // Pisahkan per segment
  const segsA = pathA.split(' > ');
  const segsB = pathB.split(' > ');

  // Kedalaman yang sama = lebih mirip
  const depthScore = segsA.length === segsB.length ? 0.3 : 0;

  // Segment terakhir (elemen itu sendiri) sangat penting
  const lastA = segsA[segsA.length - 1] ?? '';
  const lastB = segsB[segsB.length - 1] ?? '';
  const lastScore = stringSimilarity(lastA, lastB) * 0.4;

  // Sisa segments
  const restA = segsA.slice(0, -1).join(' > ');
  const restB = segsB.slice(0, -1).join(' > ');
  const restScore = jaccardSimilarity(restA, restB) * 0.3;

  return depthScore + lastScore + restScore;
}

// ── WEIGHTS per signal ────────────────────────────────────────────────────

const WEIGHTS = {
  domPath: 0.30,
  textContent: 0.25,
  tagAndType: 0.20,
  visualPosition: 0.15,
  ariaRole: 0.10,
} as const;

// ── Main: compute similarity antara dua node ──────────────────────────────

export function computeSimilarity(
  baseline: NormalizedNode,
  current: NormalizedNode
): { score: number; signals: SimilaritySignals } {
  const signals: SimilaritySignals = {
    // DOM path similarity
    domPath: pathSimilarity(baseline.domPath, current.domPath),

    // Text content
    textContent: stringSimilarity(baseline.textContent, current.textContent),

    // Tag name sama + type attribute sama
    tagAndType: (() => {
      const tagMatch = baseline.tagName === current.tagName ? 0.6 : 0;
      const typeMatch =
        (baseline.locators.type ?? '') === (current.locators.type ?? '') ? 0.4 : 0;
      return tagMatch + typeMatch;
    })(),

    // Visual position
    visualPosition: visualProximityScore(
      baseline.visualPosition,
      current.visualPosition
    ),

    // ARIA role
    ariaRole:
      (baseline.locators.role ?? '') === (current.locators.role ?? '') ? 1 : 0,
  };

  // Weighted sum
  const score =
    signals.domPath * WEIGHTS.domPath +
    signals.textContent * WEIGHTS.textContent +
    signals.tagAndType * WEIGHTS.tagAndType +
    signals.visualPosition * WEIGHTS.visualPosition +
    signals.ariaRole * WEIGHTS.ariaRole;

  return { score, signals };
}

// ── Explain score dalam bahasa manusia ───────────────────────────────────

export function explainScore(signals: SimilaritySignals): string[] {
  const reasons: string[] = [];

  if (signals.domPath >= 0.8) reasons.push('Same DOM position');
  else if (signals.domPath >= 0.5) reasons.push('Similar DOM position');
  else reasons.push('Different DOM position');

  if (signals.textContent >= 0.9) reasons.push('Identical text content');
  else if (signals.textContent >= 0.6) reasons.push('Similar text content');
  else if (signals.textContent < 0.3) reasons.push('Different text content');

  if (signals.tagAndType >= 0.9) reasons.push('Same element type');
  else if (signals.tagAndType < 0.5) reasons.push('Different element type');

  if (signals.visualPosition >= 0.8) reasons.push('Same visual position');
  else if (signals.visualPosition === 0.5) reasons.push('No visual data available');
  else reasons.push('Different visual position');

  if (signals.ariaRole === 1) reasons.push('Same ARIA role');

  return reasons;
}
