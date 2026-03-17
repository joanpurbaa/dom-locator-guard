#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import {
	parseHTML,
	buildIndex,
	diffSnapshots,
	generateReport,
	formatConsole,
	formatHTML,
} from "./index";
import { detectFileType } from "./snapshot/source-locator";

const VERSION = "0.2.0";
const args = process.argv.slice(2);
const command = args[0];
const target = args[1];

const DLG_DIR = path.join(process.cwd(), ".dlg");
const BASELINE_DIR = path.join(DLG_DIR, "baselines");
const REPORTS_DIR = path.join(DLG_DIR, "reports");

fs.mkdirSync(BASELINE_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

function slugify(name: string) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
function featureName(file: string) {
	return path.basename(file, path.extname(file));
}

function makeSnapshot(source: string, feat: string, url: string) {
	const fileType = detectFileType(url);
	let html = source;
	if (fileType === "jsx" || fileType === "tsx") {
		html =
			"<body>" +
			source
				.replace(/className=/g, "class=")
				.replace(/\{[^}]*\}/g, '"__expr__"')
				.replace(/<>/g, "<div>")
				.replace(/<\/>/g, "</div>") +
			"</body>";
	}
	const tree = parseHTML(html, source);
	if (!tree) {
		console.error("Gagal parse: " + url);
		process.exit(1);
	}
	return {
		featureName: feat,
		url,
		timestamp: Date.now(),
		guardVersion: VERSION,
		tree,
		index: buildIndex(tree),
	};
}

// ── baseline ──────────────────────────────────────────────────────────────
function cmdBaseline(file: string) {
	const fp = path.resolve(process.cwd(), file);
	if (!fs.existsSync(fp)) {
		console.error(`❌ File tidak ditemukan: ${file}`);
		process.exit(1);
	}

	const feat = featureName(file);
	const snapshot = makeSnapshot(fs.readFileSync(fp, "utf-8"), feat, file);
	const savePath = path.join(BASELINE_DIR, `${slugify(feat)}.json`);

	if (fs.existsSync(savePath)) {
		fs.copyFileSync(
			savePath,
			savePath.replace(".json", `.backup-${Date.now()}.json`),
		);
		console.log(`  📦 Backup baseline lama tersimpan`);
	}

	fs.writeFileSync(savePath, JSON.stringify(snapshot, null, 2));
	console.log(`\n  ✅ Baseline tersimpan!`);
	console.log(`     File    : ${file}`);
	console.log(`     Feature : ${feat}`);
	console.log(`\n  Sekarang ubah ${file}, lalu jalankan:`);
	console.log(`     npx dlg check ${file}\n`);
}

// ── check ─────────────────────────────────────────────────────────────────
function cmdCheck(file: string) {
	const fp = path.resolve(process.cwd(), file);
	if (!fs.existsSync(fp)) {
		console.error(`❌ File tidak ditemukan: ${file}`);
		process.exit(1);
	}

	const feat = featureName(file);
	const baselinePath = path.join(BASELINE_DIR, `${slugify(feat)}.json`);

	if (!fs.existsSync(baselinePath)) {
		console.log(
			`\n  ℹ️  Belum ada baseline untuk "${feat}". Menyimpan sekarang...\n`,
		);
		cmdBaseline(file);
		return;
	}

	const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
	const current = makeSnapshot(fs.readFileSync(fp, "utf-8"), feat, file);
	const diffs = diffSnapshots(baseline, current);
	const report = generateReport(baseline, current, diffs);

	console.log(formatConsole(report));

	const htmlPath = path.join(REPORTS_DIR, `${slugify(feat)}.html`);
	const jsonPath = path.join(REPORTS_DIR, `${slugify(feat)}.json`);
	fs.writeFileSync(htmlPath, formatHTML(report));
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

	console.log(`  📁 Report → ${path.relative(process.cwd(), htmlPath)}`);

	if (report.changedCount > 0) {
		console.log(`\n  💡 Ada perubahan. Dua pilihan:`);
		console.log(`     1. Minta developer fix → jalankan check lagi`);
		console.log(`     2. Perubahan disengaja → npx dlg baseline ${file}\n`);
		process.exit(1);
	} else {
		process.exit(0);
	}
}

// ── report ────────────────────────────────────────────────────────────────
function cmdReport() {
	const files = fs.existsSync(REPORTS_DIR)
		? fs.readdirSync(REPORTS_DIR).filter((f: string) => f.endsWith(".json"))
		: [];

	if (!files.length) {
		console.log(`\n  ℹ️  Belum ada report. Jalankan: npx dlg check <file>\n`);
		return;
	}

	const reports = files
		.map((f: string) => {
			try {
				return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf-8"));
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.sort((a: any, b: any) => b.generatedAt - a.generatedAt);

	console.log(`\n  🛡  DOM Locator Guard — Report\n  ${"─".repeat(50)}`);

	for (const r of reports) {
		const status =
			r.status === "clean"
				? "✅ Clean"
				: r.status === "warning"
					? "⚠️  Warning"
					: "❌ Error";
		const time = new Date(r.generatedAt).toLocaleString("id-ID");
		console.log(`\n  ${status}  ${r.featureName}  —  ${time}`);

		for (const diff of r.diffs.filter(
			(d: any) => d.verdict === "locator_changed",
		)) {
			console.log(
				`\n    Elemen: ${diff.elementLabel}  (confidence ${diff.confidenceScore}%)`,
			);
			for (const c of diff.locatorChanges) {
				console.log(
					`    ${c.attribute.padEnd(14)}: "${c.previous}" → "${c.current}"  [${c.severity}]`,
				);
			}
			if (diff.suggestedLocator) {
				console.log(`    Saran           : ${diff.suggestedLocator.selector}`);
			}
		}
	}

	console.log(`\n  ${"─".repeat(50)}`);
	console.log(`  Total: ${reports.length} report di .dlg/reports/\n`);
}

// ── dashboard ─────────────────────────────────────────────────────────────
function cmdDashboard() {
	// Path ke server.js di dalam package yang terinstall
	// __dirname = node_modules/dom-locator-guard/dist/
	// naik satu level = node_modules/dom-locator-guard/
	const serverPath = path.join(__dirname, "..", "dashboard", "server.js");

	if (!fs.existsSync(serverPath)) {
		console.error(`❌ Dashboard server tidak ditemukan: ${serverPath}`);
		process.exit(1);
	}

	console.log(`\n  🛡  Membuka dashboard...`);
	console.log(`  Buka browser: http://localhost:3333\n`);

	// Jalankan server dengan REPORTS_DIR dari proyek user
	cp.fork(serverPath, [], {
		env: {
			...process.env,
			REPORTS_DIR: REPORTS_DIR,
			BASELINES_DIR: BASELINE_DIR,
		},
		stdio: "inherit",
	});
}

// ── router ────────────────────────────────────────────────────────────────
switch (command) {
	case "baseline":
		target
			? cmdBaseline(target)
			: (console.error("❌ Contoh: npx dlg baseline index.html"), process.exit(1));
		break;
	case "check":
		target
			? cmdCheck(target)
			: (console.error("❌ Contoh: npx dlg check index.html"), process.exit(1));
		break;
	case "report":
		cmdReport();
		break;
	case "dashboard":
		cmdDashboard();
		break;
	case "--version":
	case "-v":
		console.log(`dlg v${VERSION}`);
		break;
	default:
		console.log(`\n  🛡  dlg — DOM Locator Guard v${VERSION}\n`);
		console.log(`  npx dlg baseline <file>   Simpan baseline`);
		console.log(`  npx dlg check <file>      Cek perubahan locator`);
		console.log(`  npx dlg report            Lihat semua report`);
		console.log(`  npx dlg dashboard         Buka dashboard di browser\n`);
}
