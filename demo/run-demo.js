// demo/run-demo.js
// ─────────────────────────────────────────────
// Script demo end-to-end:
//   1. Baca login.baseline.html  → simpan sebagai baseline
//   2. Baca login.current.html   → versi setelah developer refactor
//   3. Jalankan diff engine
//   4. Hasilkan report di demo/reports/
//   5. Print hasil ke console
//
// Jalankan dari root project:
//   node demo/run-demo.js
// ─────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

// Load dari dist (sudah di-build)
const {
  parseHTML,
  buildIndex,
  diffSnapshots,
  generateReport,
  formatConsole,
  formatHTML,
} = require('../packages/core/dist/index.js');

const DEMO_DIR    = __dirname;
const REPORTS_DIR = path.join(DEMO_DIR, 'reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ── 1. Baca dua versi HTML ────────────────────────────────────────────────

const baselineHTML = fs.readFileSync(
  path.join(DEMO_DIR, 'pages', 'login.baseline.html'), 'utf-8'
);
const currentHTML = fs.readFileSync(
  path.join(DEMO_DIR, 'pages', 'login.current.html'), 'utf-8'
);

console.log('\n🛡  DOM Locator Guard — Demo');
console.log('─'.repeat(50));
console.log('📄 Baseline : demo/pages/login.baseline.html');
console.log('📄 Current  : demo/pages/login.current.html');
console.log('─'.repeat(50));

// ── 2. Parse HTML → NormalizedNode ───────────────────────────────────────

const baselineTree = parseHTML(baselineHTML);
const currentTree  = parseHTML(currentHTML);

if (!baselineTree || !currentTree) {
  console.error('❌ Failed to parse HTML');
  process.exit(1);
}

// ── 3. Buat DOMSnapshot ───────────────────────────────────────────────────

const baseline = {
  featureName:  'Login Page',
  url:          '/login',
  timestamp:    Date.now() - 86400000, // kemarin = baseline
  guardVersion: '0.1.0',
  tree:         baselineTree,
  index:        buildIndex(baselineTree),
};

const current = {
  featureName:  'Login Page',
  url:          '/login',
  timestamp:    Date.now(),
  guardVersion: '0.1.0',
  tree:         currentTree,
  index:        buildIndex(currentTree),
};

// ── 4. Jalankan diff ──────────────────────────────────────────────────────

console.log('\n⚙️  Running diff engine...\n');
const diffs  = diffSnapshots(baseline, current, { similarityThreshold: 0.75 });
const report = generateReport(baseline, current, diffs);

// ── 5. Console output ─────────────────────────────────────────────────────

console.log(formatConsole(report));

// ── 6. Simpan HTML report ─────────────────────────────────────────────────

const htmlReport = formatHTML(report);
const htmlPath   = path.join(REPORTS_DIR, 'login-page-report.html');
fs.writeFileSync(htmlPath, htmlReport, 'utf-8');

// ── 7. Simpan JSON report (untuk dashboard) ───────────────────────────────

const jsonPath = path.join(REPORTS_DIR, 'login-page-report.json');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

// ── 8. Summary ────────────────────────────────────────────────────────────

console.log('─'.repeat(50));
console.log(`📊 Summary:`);
console.log(`   Status          : ${report.status.toUpperCase()}`);
console.log(`   Locator changes : ${report.changedCount}`);
console.log(`   Elements added  : ${report.addedCount}`);
console.log(`   Elements removed: ${report.removedCount}`);
console.log('─'.repeat(50));
console.log(`\n📁 Reports saved to:`);
console.log(`   HTML : ${htmlPath}`);
console.log(`   JSON : ${jsonPath}`);
console.log('\n💡 Buka dashboard untuk melihat report:');
console.log('   1. cd dashboard && node server.js');
console.log('   2. Buka http://localhost:3333\n');

// Exit code: 0 = clean, 1 = ada locator changes
process.exit(report.changedCount > 0 ? 1 : 0);
