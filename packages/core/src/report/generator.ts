// ─────────────────────────────────────────────
//  report/generator.ts
//  Build LocatorReport dari diff results
// ─────────────────────────────────────────────

import { randomUUID } from "crypto";
import type {
	ElementDiff,
	LocatorReport,
	DOMSnapshot,
	ReportStatus,
} from "../types";
import { explainScore } from "../diff/similarity";

export function generateReport(
	baseline: DOMSnapshot,
	current: DOMSnapshot,
	diffs: ElementDiff[],
): LocatorReport {
	const locatorChanged = diffs.filter((d) => d.verdict === "locator_changed");
	const removed = diffs.filter((d) => d.verdict === "removed");
	const added = diffs.filter((d) => d.verdict === "added");

	// Status: error jika ada 'critical' severity, warning jika ada perubahan
	let status: ReportStatus = "clean";
	if (locatorChanged.length > 0 || removed.length > 0) {
		const hasCritical = locatorChanged.some((d) =>
			d.locatorChanges.some((c) => c.severity === "critical"),
		);
		status = hasCritical ? "error" : "warning";
	}

	const summary = buildSummary(
		locatorChanged.length,
		added.length,
		removed.length,
		current.featureName,
	);

	return {
		runId: randomUUID(),
		featureName: current.featureName,
		pageUrl: current.url,
		generatedAt: Date.now(),
		status,
		totalElements: diffs.length + /* unchanged elements are not in diffs */ 0,
		changedCount: locatorChanged.length,
		addedCount: added.length,
		removedCount: removed.length,
		diffs,
		summary,
		meta: {
			baselineTimestamp: baseline.timestamp,
			currentTimestamp: current.timestamp,
			baselineUrl: baseline.url,
			currentUrl: current.url,
			guardVersion: current.guardVersion,
		},
	};
}

function buildSummary(
	changed: number,
	added: number,
	removed: number,
	feature: string,
): string {
	if (changed === 0 && removed === 0 && added === 0) {
		return `✓ [${feature}] All locators stable — no changes detected`;
	}
	const parts: string[] = [];
	if (changed > 0) parts.push(`${changed} locator change(s)`);
	if (added > 0) parts.push(`${added} new element(s)`);
	if (removed > 0) parts.push(`${removed} removed element(s)`);
	return `⚠ [${feature}] ${parts.join(", ")} detected`;
}

// ── Console formatter ─────────────────────────────────────────────────────

export function formatConsole(report: LocatorReport): string {
	const lines: string[] = [];
	const sep = "─".repeat(60);

	lines.push("");
	lines.push("╔" + "═".repeat(58) + "╗");
	lines.push("║" + "  DOM LOCATOR GUARD — CHANGE REPORT".padEnd(58) + "║");
	lines.push("╠" + "═".repeat(58) + "╣");
	lines.push(`║  Feature   : ${report.featureName}`.padEnd(59) + "║");
	lines.push(`║  Page      : ${report.pageUrl}`.padEnd(59) + "║");
	lines.push(
		`║  Status    : ${report.status === "clean" ? "✓ Clean" : report.status === "warning" ? "⚠ Warning" : "✗ Error"}`.padEnd(
			59,
		) + "║",
	);
	lines.push(
		`║  Changes   : ${report.changedCount} locator(s)  +${report.addedCount} added  -${report.removedCount} removed`.padEnd(
			59,
		) + "║",
	);
	lines.push("╠" + "═".repeat(58) + "╣");

	const locatorChanges = report.diffs.filter(
		(d) => d.verdict === "locator_changed",
	);

	if (locatorChanges.length === 0) {
		lines.push("║" + "  ✓ No locator changes detected.".padEnd(58) + "║");
	} else {
		for (const diff of locatorChanges) {
			lines.push("║");
			lines.push(`║  ELEMENT: ${diff.elementLabel}`);
			lines.push(`║  ${"─".repeat(50)}`);

			// Tampilkan line number dan snippet kalau ada
			if (diff.sourceLocation) {
				const loc = diff.sourceLocation;
				lines.push(`║  📍 Line ${loc.line}, Column ${loc.column}`);
				lines.push("║");
				const startLine = loc.line - loc.context.before.length;
				for (let i = 0; i < loc.context.before.length; i++) {
					const ln = String(startLine + i).padStart(4);
					lines.push(`║  ${ln} │  ${loc.context.before[i]}`);
				}
				lines.push(
					`║  ${String(loc.line).padStart(4)} │► ${loc.context.line}  ← berubah`,
				);
				for (let i = 0; i < loc.context.after.length; i++) {
					const ln = String(loc.line + 1 + i).padStart(4);
					lines.push(`║  ${ln} │  ${loc.context.after[i]}`);
				}
				lines.push("║");
			}

			lines.push(`║  Confidence : ${diff.confidenceScore}%`);

			for (const change of diff.locatorChanges) {
				lines.push(`║`);
				lines.push(
					`║  [${change.severity.toUpperCase()}] Attribute: ${change.attribute}`,
				);
				lines.push(`║    Previous : ${change.previous ?? "(none)"}`);
				lines.push(`║    Current  : ${change.current ?? "(none)"}`);
			}

			lines.push("║");
			lines.push("║  WHY SAME ELEMENT:");
			const reasons = explainScore(diff.signals);
			for (const r of reasons) {
				lines.push(`║    ✓ ${r}`);
			}

			if (diff.suggestedLocator) {
				lines.push("║");
				lines.push(`║  ACTION:`);
				lines.push(`║    ${diff.suggestedLocator.selector}`);
				lines.push(`║    ${diff.suggestedLocator.reason}`);
			}

			lines.push("║");
			lines.push("╠" + "═".repeat(58) + "╣");
		}
	}

	lines.push("╚" + "═".repeat(58) + "╝");
	lines.push("");

	return lines.join("\n");
}

// ── HTML formatter ────────────────────────────────────────────────────────

export function formatHTML(report: LocatorReport): string {
	const statusColor: Record<string, string> = {
		clean: "#16a34a",
		warning: "#d97706",
		error: "#dc2626",
	};
	const statusIcon = { clean: "✓", warning: "⚠", error: "✗" };

	const changesHTML = report.diffs
		.filter((d) => d.verdict === "locator_changed")
		.map((diff) => {
			const changesRows = diff.locatorChanges
				.map(
					(change) => `
        <tr>
          <td><span class="badge badge-${change.severity}">${change.severity.toUpperCase()}</span></td>
          <td><code>${change.attribute}</code></td>
          <td><code class="old">${change.previous ?? "—"}</code></td>
          <td><code class="new">${change.current ?? "—"}</code></td>
        </tr>
      `,
				)
				.join("");

			const reasons = explainScore(diff.signals);

			const snippetHTML = diff.sourceLocation
				? (() => {
						const loc = diff.sourceLocation;
						const startLine = loc.line - loc.context.before.length;
						const beforeLines = loc.context.before
							.map((l, i) => {
								const ln = startLine + i;
								return `<div class="code-line"><span class="line-num">${ln}</span><span class="line-code">${escapeHTML(l)}</span></div>`;
							})
							.join("");
						const changedLine = `<div class="code-line changed"><span class="line-num">${loc.line}</span><span class="line-code">${escapeHTML(loc.context.line)}</span><span class="changed-marker">← berubah</span></div>`;
						const afterLines = loc.context.after
							.map((l, i) => {
								const ln = loc.line + 1 + i;
								return `<div class="code-line"><span class="line-num">${ln}</span><span class="line-code">${escapeHTML(l)}</span></div>`;
							})
							.join("");
						return `<div class="code-snippet">
          <div class="code-header">📍 Line ${loc.line}, Col ${loc.column}</div>
          <div class="code-body">${beforeLines}${changedLine}${afterLines}</div>
        </div>`;
					})()
				: "";

			return `
      <div class="element-card">
        <div class="element-header">
          <span class="element-label">${escapeHTML(diff.elementLabel)}</span>
          <span class="confidence">${diff.confidenceScore}% confidence</span>
        </div>
        ${snippetHTML}
        <table class="changes-table">
          <thead><tr><th>Severity</th><th>Attribute</th><th>Previous</th><th>Current</th></tr></thead>
          <tbody>${changesRows}</tbody>
        </table>
        <div class="reasons">
          <strong>Why same element:</strong>
          <ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
        </div>
        ${
									diff.suggestedLocator
										? `
        <div class="suggestion">
          <strong>Suggested locator:</strong>
          <code>${escapeHTML(diff.suggestedLocator.selector)}</code>
          <p>${escapeHTML(diff.suggestedLocator.reason)}</p>
        </div>`
										: ""
								}
      </div>`;
		})
		.join("");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Locator Guard Report — ${escapeHTML(report.featureName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #f8fafc; color: #1e293b; padding: 2rem; }
  .header { background: #1e293b; color: #f8fafc; border-radius: 12px;
            padding: 1.5rem 2rem; margin-bottom: 1.5rem; }
  .header h1 { font-size: 1.1rem; font-weight: 600; opacity: 0.7; margin-bottom: 0.5rem; }
  .header h2 { font-size: 1.6rem; font-weight: 700; }
  .meta { display: flex; gap: 2rem; margin-top: 1rem; font-size: 0.85rem; opacity: 0.65; }
  .status-bar { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
  .stat { background: white; border-radius: 10px; padding: 1rem 1.5rem;
          border: 1px solid #e2e8f0; flex: 1; text-align: center; }
  .stat .num { font-size: 2rem; font-weight: 700; }
  .stat .label { font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; }
  .element-card { background: white; border-radius: 10px; padding: 1.5rem;
                  border: 1px solid #e2e8f0; margin-bottom: 1rem; }
  .element-header { display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .element-label { font-weight: 600; font-family: monospace; font-size: 0.95rem; }
  .confidence { background: #f0fdf4; color: #16a34a; padding: 0.25rem 0.75rem;
                border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
  .changes-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin-bottom: 1rem; }
  .changes-table th { background: #f8fafc; padding: 0.5rem 0.75rem; text-align: left;
                      font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  .changes-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
  .badge-critical { background: #fee2e2; color: #991b1b; }
  .badge-high { background: #fef3c7; color: #92400e; }
  .badge-medium { background: #e0f2fe; color: #075985; }
  .badge-low { background: #f0fdf4; color: #166534; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.875rem;
         background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; }
  code.old { background: #fee2e2; color: #991b1b; text-decoration: line-through; }
  code.new { background: #dcfce7; color: #166534; }
  .reasons { margin: 0.75rem 0; font-size: 0.875rem; }
  .reasons ul { list-style: none; margin-top: 0.4rem; }
  .reasons li::before { content: "✓ "; color: #16a34a; font-weight: bold; }
  .suggestion { background: #f0f9ff; border-radius: 8px; padding: 0.75rem 1rem;
                margin-top: 0.75rem; font-size: 0.875rem; }
  .suggestion code { background: #dbeafe; color: #1d4ed8; }
  .suggestion p { color: #475569; margin-top: 0.25rem; font-size: 0.8rem; }
  .code-snippet { margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
  .code-header { background: #1e293b; color: #94a3b8; padding: 6px 12px; font-size: 11px; font-family: monospace; }
  .code-body { background: #0f172a; padding: 4px 0; }
  .code-line { display: flex; align-items: baseline; gap: 12px; padding: 2px 12px; font-family: 'SF Mono','Fira Code',monospace; font-size: 12px; }
  .code-line.changed { background: rgba(245,166,35,0.15); border-left: 3px solid #f5a623; }
  .line-num { color: #475569; min-width: 28px; text-align: right; flex-shrink: 0; }
  .line-code { color: #e2e8f0; white-space: pre; }
  .changed-marker { color: #f5a623; font-size: 11px; margin-left: 12px; }
  .clean { color: ${statusColor.clean}; }
  .warning { color: ${statusColor.warning}; }
  .error { color: ${statusColor.error}; }
  .empty-state { text-align: center; padding: 3rem; color: #64748b; }
  .empty-state .icon { font-size: 3rem; margin-bottom: 1rem; }
</style>
</head>
<body>
  <div class="header">
    <h1>DOM Locator Guard — Change Report</h1>
    <h2 class="${report.status}">${statusIcon[report.status]} ${escapeHTML(report.featureName)}</h2>
    <div class="meta">
      <span>Page: ${escapeHTML(report.pageUrl)}</span>
      <span>Run: ${new Date(report.generatedAt).toLocaleString()}</span>
      <span>Baseline: ${new Date(report.meta.baselineTimestamp).toLocaleString()}</span>
    </div>
  </div>

  <div class="status-bar">
    <div class="stat">
      <div class="num warning">${report.changedCount}</div>
      <div class="label">Locator changes</div>
    </div>
    <div class="stat">
      <div class="num" style="color:#6366f1">${report.addedCount}</div>
      <div class="label">New elements</div>
    </div>
    <div class="stat">
      <div class="num error">${report.removedCount}</div>
      <div class="label">Removed elements</div>
    </div>
  </div>

  ${changesHTML || `<div class="empty-state"><div class="icon">✓</div><p>All locators are stable. No changes detected.</p></div>`}

</body>
</html>`;
}

function escapeHTML(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// ── JSON formatter ────────────────────────────────────────────────────────

export function formatJSON(report: LocatorReport): string {
	return JSON.stringify(report, null, 2);
}
