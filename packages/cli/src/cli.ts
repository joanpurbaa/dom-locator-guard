#!/usr/bin/env node
// ─────────────────────────────────────────────
//  @dom-locator-guard/cli
//  Usage:
//    locator-guard compare --baseline ./baselines/login.json --current ./current/login.html
//    locator-guard snapshot --url http://localhost:3000/login --feature login
//    locator-guard update-baseline --feature login
//    locator-guard list
//    locator-guard diff --feature login --format html
// ─────────────────────────────────────────────

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  LocatorGuard,
  SnapshotStore,
  parseHTML,
  buildIndex,
  diffSnapshots,
  generateReport,
  formatConsole,
  formatHTML,
  formatJSON,
  DEFAULT_CONFIG,
} from '@dom-locator-guard/core';
import type { DOMSnapshot, GuardConfig } from '@dom-locator-guard/core';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('locator-guard')
  .description('DOM Locator Guard — detect unintended locator changes in HTML')
  .version(VERSION);

// ── Shared options ────────────────────────────────────────────────────────

function getConfig(opts: Record<string, string>): Partial<GuardConfig> {
  return {
    baselineDir: opts.baselineDir ?? DEFAULT_CONFIG.baselineDir,
    outputDir: opts.outputDir ?? DEFAULT_CONFIG.outputDir,
    outputFormats: (opts.format ? [opts.format] : ['console', 'html']) as GuardConfig['outputFormats'],
    similarityThreshold: opts.threshold ? parseFloat(opts.threshold) : DEFAULT_CONFIG.similarityThreshold,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  COMMAND: compare
//  Compare dua HTML file secara offline
//
//  locator-guard compare \
//    --baseline ./path/to/baseline.html \
//    --current  ./path/to/current.html  \
//    --feature  "Login Page"
// ─────────────────────────────────────────────────────────────────────────

program
  .command('compare')
  .description('Compare two HTML files and generate a locator change report')
  .requiredOption('-b, --baseline <path>', 'Path to baseline HTML or JSON snapshot')
  .requiredOption('-c, --current <path>',  'Path to current HTML file')
  .requiredOption('-f, --feature <name>',  'Feature name (e.g. "Login")')
  .option('--format <format>',     'Output format: console|html|json', 'console')
  .option('--output-dir <dir>',    'Directory for report files', './locator-guard-reports')
  .option('--threshold <number>',  'Similarity threshold 0-1', '0.75')
  .action(async (opts) => {
    const spinner = ora('Loading snapshots...').start();

    try {
      // Load baseline
      let baseline: DOMSnapshot;
      const baselinePath = path.resolve(opts.baseline);

      if (opts.baseline.endsWith('.json')) {
        baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
      } else {
        // HTML file
        const html = fs.readFileSync(baselinePath, 'utf-8');
        const tree = parseHTML(html);
        if (!tree) throw new Error('Failed to parse baseline HTML');
        baseline = {
          featureName: opts.feature,
          url: baselinePath,
          timestamp: fs.statSync(baselinePath).mtimeMs,
          guardVersion: VERSION,
          tree,
          index: buildIndex(tree),
        };
      }

      // Load current
      const currentPath = path.resolve(opts.current);
      const currentHtml = fs.readFileSync(currentPath, 'utf-8');
      const currentTree = parseHTML(currentHtml);
      if (!currentTree) throw new Error('Failed to parse current HTML');

      const current: DOMSnapshot = {
        featureName: opts.feature,
        url: currentPath,
        timestamp: Date.now(),
        guardVersion: VERSION,
        tree: currentTree,
        index: buildIndex(currentTree),
      };

      spinner.succeed('Snapshots loaded');

      const diffSpinner = ora('Running diff engine...').start();
      const config = getConfig(opts);
      const diffs = diffSnapshots(baseline, current, config);
      const report = generateReport(baseline, current, diffs);
      diffSpinner.succeed(`Diff complete — ${diffs.length} element(s) analyzed`);

      // Output
      const formats = opts.format.split(',') as GuardConfig['outputFormats'];
      const outputDir = opts.outputDir;
      fs.mkdirSync(outputDir, { recursive: true });

      for (const fmt of formats) {
        if (fmt === 'console') {
          console.log(formatConsole(report));
        } else if (fmt === 'html') {
          const filename = `${opts.feature.toLowerCase().replace(/\s+/g, '-')}-report.html`;
          const filepath = path.join(outputDir, filename);
          fs.writeFileSync(filepath, formatHTML(report));
          console.log(chalk.green(`\n✓ HTML report saved: ${filepath}`));
        } else if (fmt === 'json') {
          const filename = `${opts.feature.toLowerCase().replace(/\s+/g, '-')}-report.json`;
          const filepath = path.join(outputDir, filename);
          fs.writeFileSync(filepath, formatJSON(report));
          console.log(chalk.green(`\n✓ JSON report saved: ${filepath}`));
        }
      }

      // Exit code: 0 = clean/warning, 1 = critical errors
      const hasCritical = report.diffs.some(d =>
        d.locatorChanges.some(c => c.severity === 'critical')
      );
      process.exit(hasCritical ? 1 : 0);

    } catch (err) {
      spinner.fail('Error during comparison');
      console.error(chalk.red(String(err)));
      process.exit(2);
    }
  });

// ─────────────────────────────────────────────────────────────────────────
//  COMMAND: save-baseline
//  Simpan HTML file sebagai baseline snapshot
//
//  locator-guard save-baseline \
//    --input ./login.html \
//    --feature "Login Page"
// ─────────────────────────────────────────────────────────────────────────

program
  .command('save-baseline')
  .description('Save an HTML file as the baseline snapshot for a feature')
  .requiredOption('-i, --input <path>',    'Path to HTML file')
  .requiredOption('-f, --feature <name>',  'Feature name')
  .option('--baseline-dir <dir>',          'Baseline storage directory', './locator-guard-baselines')
  .action((opts) => {
    const spinner = ora('Saving baseline...').start();

    try {
      const html = fs.readFileSync(path.resolve(opts.input), 'utf-8');
      const tree = parseHTML(html);
      if (!tree) throw new Error('Failed to parse HTML');

      const snapshot: DOMSnapshot = {
        featureName: opts.feature,
        url: opts.input,
        timestamp: Date.now(),
        guardVersion: VERSION,
        tree,
        index: buildIndex(tree),
      };

      const store = new SnapshotStore({ baselineDir: opts.baselineDir });
      const savedPath = store.saveBaseline(snapshot);

      spinner.succeed(chalk.green(`Baseline saved: ${savedPath}`));
    } catch (err) {
      spinner.fail('Failed to save baseline');
      console.error(chalk.red(String(err)));
      process.exit(2);
    }
  });

// ─────────────────────────────────────────────────────────────────────────
//  COMMAND: list
//  List semua baseline yang tersimpan
// ─────────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all saved baseline snapshots')
  .option('--baseline-dir <dir>', 'Baseline storage directory', './locator-guard-baselines')
  .action((opts) => {
    const store = new SnapshotStore({ baselineDir: opts.baselineDir });
    const baselines = store.listBaselines();

    if (baselines.length === 0) {
      console.log(chalk.yellow('No baselines found in: ' + opts.baselineDir));
      return;
    }

    console.log(chalk.bold('\nSaved baselines:'));
    for (const name of baselines) {
      const snapshot = store.loadBaseline(name);
      const date = snapshot ? new Date(snapshot.timestamp).toLocaleString() : 'unknown';
      console.log(`  ${chalk.cyan('●')} ${name.padEnd(40)} ${chalk.gray(date)}`);
    }
    console.log('');
  });

// ─────────────────────────────────────────────────────────────────────────
//  COMMAND: diff (alias untuk compare menggunakan stored baselines)
//
//  locator-guard diff \
//    --feature login \
//    --current ./login-current.html \
//    --format html,json
// ─────────────────────────────────────────────────────────────────────────

program
  .command('diff')
  .description('Compare current HTML against stored baseline for a feature')
  .requiredOption('-f, --feature <name>', 'Feature name (must match saved baseline)')
  .requiredOption('-c, --current <path>', 'Path to current HTML file')
  .option('--baseline-dir <dir>',         'Baseline storage directory', './locator-guard-baselines')
  .option('--output-dir <dir>',           'Report output directory', './locator-guard-reports')
  .option('--format <formats>',           'Comma-separated: console,html,json', 'console,html')
  .option('--threshold <number>',         'Similarity threshold 0-1', '0.75')
  .action(async (opts) => {
    const spinner = ora(`Loading baseline for "${opts.feature}"...`).start();

    try {
      const store = new SnapshotStore({ baselineDir: opts.baselineDir });
      const baseline = store.loadBaseline(opts.feature);

      if (!baseline) {
        spinner.fail(chalk.red(`No baseline found for feature: "${opts.feature}"`));
        console.log(chalk.yellow(`Run: locator-guard save-baseline --input <file> --feature "${opts.feature}"`));
        process.exit(1);
      }

      spinner.succeed(`Baseline loaded (${new Date(baseline.timestamp).toLocaleDateString()})`);

      const html = fs.readFileSync(path.resolve(opts.current), 'utf-8');
      const currentTree = parseHTML(html);
      if (!currentTree) throw new Error('Failed to parse current HTML');

      const current: DOMSnapshot = {
        featureName: opts.feature,
        url: opts.current,
        timestamp: Date.now(),
        guardVersion: VERSION,
        tree: currentTree,
        index: buildIndex(currentTree),
      };

      const config = getConfig(opts);
      const diffs = diffSnapshots(baseline, current, config);
      const report = generateReport(baseline, current, diffs);

      const formats = opts.format.split(',') as GuardConfig['outputFormats'];
      fs.mkdirSync(opts.outputDir, { recursive: true });

      for (const fmt of formats) {
        if (fmt === 'console') {
          console.log(formatConsole(report));
        } else if (fmt === 'html') {
          const slug = opts.feature.toLowerCase().replace(/\s+/g, '-');
          const fp = path.join(opts.outputDir, `${slug}-report.html`);
          fs.writeFileSync(fp, formatHTML(report));
          console.log(chalk.green(`✓ HTML report: ${fp}`));
        } else if (fmt === 'json') {
          const slug = opts.feature.toLowerCase().replace(/\s+/g, '-');
          const fp = path.join(opts.outputDir, `${slug}-report.json`);
          fs.writeFileSync(fp, formatJSON(report));
          console.log(chalk.green(`✓ JSON report: ${fp}`));
        }
      }

      // Summary
      if (report.changedCount > 0) {
        console.log(chalk.yellow(`\n⚠  ${report.changedCount} locator change(s) detected. See report for details.\n`));
      } else {
        console.log(chalk.green(`\n✓  All locators stable.\n`));
      }

      process.exit(report.status === 'error' ? 1 : 0);

    } catch (err) {
      spinner.fail('Diff failed');
      console.error(chalk.red(String(err)));
      process.exit(2);
    }
  });

program.parse(process.argv);
