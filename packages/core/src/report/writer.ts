// ─────────────────────────────────────────────
//  report/writer.ts
//  Tulis LocatorReport ke disk (HTML, JSON, console)
// ─────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import type { LocatorReport, GuardConfig, OutputFormat } from '../types';
import { formatConsole, formatHTML, formatJSON } from './generator';

export class ReportWriter {
  private outputDir: string;

  constructor(config: Pick<GuardConfig, 'outputDir'>) {
    this.outputDir = config.outputDir;
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  write(report: LocatorReport, formats: OutputFormat[] = ['console', 'html']): void {
    const slug = report.featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const timestamp = new Date(report.generatedAt)
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    for (const format of formats) {
      switch (format) {
        case 'console':
          console.log(formatConsole(report));
          break;

        case 'html': {
          const filename = `${slug}-${timestamp}.html`;
          const filepath = path.join(this.outputDir, filename);
          fs.writeFileSync(filepath, formatHTML(report), 'utf-8');
          console.log(`[LocatorGuard] HTML report: ${filepath}`);
          break;
        }

        case 'json': {
          const filename = `${slug}-${timestamp}.json`;
          const filepath = path.join(this.outputDir, filename);
          fs.writeFileSync(filepath, formatJSON(report), 'utf-8');
          console.log(`[LocatorGuard] JSON report: ${filepath}`);
          break;
        }

        case 'junit': {
          const filename = `${slug}-${timestamp}.junit.xml`;
          const filepath = path.join(this.outputDir, filename);
          fs.writeFileSync(filepath, formatJUnit(report), 'utf-8');
          console.log(`[LocatorGuard] JUnit report: ${filepath}`);
          break;
        }
      }
    }
  }
}

// ── JUnit XML formatter (untuk CI/CD integration) ─────────────────────────

function formatJUnit(report: LocatorReport): string {
  const testcases = report.diffs
    .filter(d => d.verdict === 'locator_changed' || d.verdict === 'removed')
    .map(diff => {
      const isFailure = diff.verdict === 'removed' ||
        diff.locatorChanges.some(c => c.severity === 'critical' || c.severity === 'high');

      const message = diff.locatorChanges
        .map(c => `${c.attribute}: '${c.previous}' → '${c.current}'`)
        .join('; ');

      if (isFailure) {
        return `    <testcase name="${escapeXML(diff.elementLabel)}" classname="${escapeXML(report.featureName)}">
      <failure message="${escapeXML(message)}" type="LocatorChanged">
        Confidence: ${diff.confidenceScore}%
        ${message}
      </failure>
    </testcase>`;
      } else {
        return `    <testcase name="${escapeXML(diff.elementLabel)}" classname="${escapeXML(report.featureName)}">
      <system-out>${escapeXML(message)}</system-out>
    </testcase>`;
      }
    }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="LocatorGuard: ${escapeXML(report.featureName)}"
             tests="${report.changedCount}"
             failures="${report.diffs.filter(d => d.verdict === 'removed').length}"
             warnings="${report.changedCount}"
             timestamp="${new Date(report.generatedAt).toISOString()}">
${testcases}
  </testsuite>
</testsuites>`;
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
