// ─────────────────────────────────────────────
//  tests/similarity.test.ts
// ─────────────────────────────────────────────

import { stringSimilarity, jaccardSimilarity, computeSimilarity } from '../src/diff/similarity';
import type { NormalizedNode } from '../src/types';

// Helper: buat minimal NormalizedNode untuk testing
function makeNode(overrides: Partial<NormalizedNode>): NormalizedNode {
  return {
    tagName: 'button',
    textContent: 'Login',
    attributes: {},
    locators: { classNames: [], id: 'loginbtn', type: 'submit' },
    domPath: 'body > main > form > button:nth-of-type(1)',
    xpath: '/body/main/form/button[1]',
    depth: 4,
    siblingIndex: 0,
    fingerprint: 'abc123',
    children: [],
    ...overrides,
  };
}

describe('stringSimilarity', () => {
  test('identical strings return 1', () => {
    expect(stringSimilarity('Login', 'Login')).toBe(1);
  });

  test('empty strings return 1', () => {
    expect(stringSimilarity('', '')).toBe(1);
  });

  test('one empty returns 0', () => {
    expect(stringSimilarity('Login', '')).toBe(0);
  });

  test('loginbtn vs loginBtn — case insensitive, should be very high', () => {
    const score = stringSimilarity('loginbtn', 'loginBtn');
    expect(score).toBeGreaterThan(0.85);
  });

  test('completely different strings return low score', () => {
    const score = stringSimilarity('loginbtn', 'submitForm');
    expect(score).toBeLessThan(0.5);
  });
});

describe('jaccardSimilarity', () => {
  test('identical paths return 1', () => {
    const path = 'body > main > form > button:nth-of-type(1)';
    expect(jaccardSimilarity(path, path)).toBe(1);
  });

  test('one segment change = high similarity', () => {
    const a = 'body > main > form > button:nth-of-type(1)';
    const b = 'body > main > form > button:nth-of-type(2)';
    const score = jaccardSimilarity(a, b);
    expect(score).toBeGreaterThan(0.5);
  });
});

describe('computeSimilarity — loginbtn vs loginBtn scenario', () => {
  const baseline = makeNode({
    locators: { classNames: ['btn', 'btn-primary'], id: 'loginbtn', type: 'submit' },
  });

  const current = makeNode({
    locators: { classNames: ['btn', 'btn-primary'], id: 'loginBtn', type: 'submit' },
  });

  test('score should be >= 0.75 (same element)', () => {
    const { score } = computeSimilarity(baseline, current);
    expect(score).toBeGreaterThanOrEqual(0.75);
  });

  test('score should be high because all other signals match', () => {
    const { score, signals } = computeSimilarity(baseline, current);
    expect(signals.textContent).toBe(1);      // same text "Login"
    expect(signals.tagAndType).toBeGreaterThan(0.8); // same tag + type
    expect(score).toBeGreaterThan(0.85);
  });
});

describe('computeSimilarity — completely different elements', () => {
  const baseline = makeNode({
    tagName: 'button',
    textContent: 'Login',
    domPath: 'body > main > form > button:nth-of-type(1)',
    locators: { classNames: [], id: 'loginbtn' },
  });

  const current = makeNode({
    tagName: 'input',
    textContent: '',
    domPath: 'body > header > nav > input:nth-of-type(1)',
    locators: { classNames: [], id: 'search-input', type: 'text', placeholder: 'Search...' },
  });

  test('score should be < 0.75 (different element)', () => {
    const { score } = computeSimilarity(baseline, current);
    expect(score).toBeLessThan(0.75);
  });
});
