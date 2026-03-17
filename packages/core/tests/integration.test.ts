// ─────────────────────────────────────────────
//  tests/integration.test.ts
//  Full scenario: baseline → perubahan → detect
// ─────────────────────────────────────────────

import { parseHTML, buildIndex } from '../src/snapshot/normalizer';
import { diffSnapshots } from '../src/diff/engine';
import { generateReport, formatConsole } from '../src/report/generator';
import type { DOMSnapshot } from '../src/types';

// ── HTML fixtures ─────────────────────────────────────────────────────────

const BASELINE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <main>
    <h1>Login</h1>
    <form id="login-form">
      <input id="username" name="username" type="text" placeholder="Username" />
      <input id="password" name="password" type="password" placeholder="Password" />
      <button id="loginbtn" name="submit-login" type="submit" class="btn btn-primary">Login</button>
    </form>
  </main>
</body>
</html>
`;

// Developer tidak sengaja ubah casing id
const CURRENT_HTML_ID_CHANGED = `
<!DOCTYPE html>
<html>
<body>
  <main>
    <h1>Login</h1>
    <form id="login-form">
      <input id="username" name="username" type="text" placeholder="Username" />
      <input id="password" name="password" type="password" placeholder="Password" />
      <button id="loginBtn" name="submit-login" type="submit" class="btn btn-primary">Login</button>
    </form>
  </main>
</body>
</html>
`;

// Developer tambah data-testid (ini perubahan positif, tapi tetap perlu dideteksi)
const CURRENT_HTML_CLASS_CHANGED = `
<!DOCTYPE html>
<html>
<body>
  <main>
    <h1>Login</h1>
    <form id="login-form">
      <input id="username" name="username" type="text" placeholder="Username" />
      <input id="password" name="password" type="password" placeholder="Password" />
      <button id="loginbtn" type="submit" class="btn btn-success" data-testid="login-button">Login</button>
    </form>
  </main>
</body>
</html>
`;

function makeSnapshot(html: string, featureName: string): DOMSnapshot {
  const tree = parseHTML(html);
  if (!tree) throw new Error('Parse failed');
  return {
    featureName,
    url: '/login',
    timestamp: Date.now(),
    guardVersion: '0.1.0',
    tree,
    index: buildIndex(tree),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Scenario 1: id casing change (loginbtn → loginBtn)', () => {
  const baseline = makeSnapshot(BASELINE_HTML, 'Login');
  const current = makeSnapshot(CURRENT_HTML_ID_CHANGED, 'Login');

  const diffs = diffSnapshots(baseline, current);
  const report = generateReport(baseline, current, diffs);

  test('should detect 1 locator change', () => {
    expect(report.changedCount).toBe(1);
  });

  test('report status should be warning (not error)', () => {
    expect(report.status).toBe('warning');
  });

  test('the changed element should be the login button', () => {
    const changed = diffs.find(d => d.verdict === 'locator_changed');
    expect(changed).toBeDefined();
    expect(changed?.baselineNode?.tagName).toBe('button');
    expect(changed?.baselineNode?.textContent).toBe('Login');
  });

  test('confidence should be high (>= 85%)', () => {
    const changed = diffs.find(d => d.verdict === 'locator_changed');
    expect(changed?.confidenceScore).toBeGreaterThanOrEqual(85);
  });

  test('locator change should identify the id attribute', () => {
    const changed = diffs.find(d => d.verdict === 'locator_changed');
    const idChange = changed?.locatorChanges.find(c => c.attribute === 'id');
    expect(idChange?.previous).toBe('loginbtn');
    expect(idChange?.current).toBe('loginBtn');
    expect(idChange?.severity).toBe('high');
  });

  test('console report should not throw', () => {
    expect(() => formatConsole(report)).not.toThrow();
  });
});

describe('Scenario 2: class change + new data-testid added', () => {
  const baseline = makeSnapshot(BASELINE_HTML, 'Login');
  const current = makeSnapshot(CURRENT_HTML_CLASS_CHANGED, 'Login');

  const diffs = diffSnapshots(baseline, current);
  const report = generateReport(baseline, current, diffs);

  test('should detect class change', () => {
    const classChange = diffs
      .filter(d => d.verdict === 'locator_changed')
      .flatMap(d => d.locatorChanges)
      .find(c => c.attribute === 'class');
    expect(classChange).toBeDefined();
    expect(classChange?.removedValues).toContain('btn-primary');
    expect(classChange?.addedValues).toContain('btn-success');
  });
});

describe('Scenario 3: no changes', () => {
  const baseline = makeSnapshot(BASELINE_HTML, 'Login');
  const current = makeSnapshot(BASELINE_HTML, 'Login');

  const diffs = diffSnapshots(baseline, current);
  const report = generateReport(baseline, current, diffs);

  test('report should be clean', () => {
    expect(report.status).toBe('clean');
    expect(report.changedCount).toBe(0);
  });
});
