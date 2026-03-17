// ─────────────────────────────────────────────
//  diff/engine.ts
//  Core diff logic: baseline vs current snapshot
// ─────────────────────────────────────────────

import type {
	DOMSnapshot,
	NormalizedNode,
	ElementDiff,
	LocatorChange,
	LocatorAttribute,
	ChangeSeverity,
	SuggestedLocator,
	GuardConfig,
	TrackedLocators,
} from "../types";
import { DEFAULT_CONFIG } from "../types";
import { computeSimilarity, explainScore } from "./similarity";
import { flattenTree } from "../snapshot/normalizer";

// ── Severity rules per attribute ─────────────────────────────────────────
//  id dan data-testid paling critical karena paling sering dijadikan selector

const SEVERITY_MAP: Record<string, ChangeSeverity> = {
	id: "high",
	name: "high",
	dataTestId: "critical",
	dataTestid: "critical",
	dataCy: "critical",
	dataAutomationId: "critical",
	ariaLabel: "medium",
	role: "medium",
	type: "medium",
	href: "low",
	placeholder: "low",
	class: "medium",
};

const SEVERITY_REASONS: Record<ChangeSeverity, string> = {
	critical:
		"Attribute ini paling sering digunakan sebagai primary locator di test automation",
	high: "Attribute ini sangat umum digunakan sebagai locator selector",
	medium:
		"Attribute ini kadang digunakan sebagai locator dan memengaruhi aksesibilitas",
	low: "Perubahan ini jarang memengaruhi test locator secara langsung",
};

// ── Detect locator changes antara dua node ────────────────────────────────

function detectLocatorChanges(
	baseline: TrackedLocators,
	current: TrackedLocators,
	trackedAttributes: LocatorAttribute[],
): LocatorChange[] {
	const changes: LocatorChange[] = [];

	// Check scalar attributes
	const scalarAttrs: Array<keyof TrackedLocators> = [
		"id",
		"name",
		"dataTestId",
		"dataTestid",
		"dataCy",
		"dataAutomationId",
		"ariaLabel",
		"role",
		"type",
		"href",
		"placeholder",
	];

	for (const attr of scalarAttrs) {
		if (!trackedAttributes.includes(attr as LocatorAttribute)) continue;

		const prev = baseline[attr] as string | undefined;
		const curr = current[attr] as string | undefined;

		if (prev !== curr) {
			const severity = SEVERITY_MAP[attr] ?? "low";
			changes.push({
				attribute: attr as LocatorAttribute,
				previous: prev ?? null,
				current: curr ?? null,
				severity,
				severityReason: SEVERITY_REASONS[severity],
			});
		}
	}

	// Check class changes
	if (trackedAttributes.includes("class")) {
		const removedClasses = baseline.classNames.filter(
			(c) => !current.classNames.includes(c),
		);
		const addedClasses = current.classNames.filter(
			(c) => !baseline.classNames.includes(c),
		);

		if (removedClasses.length > 0 || addedClasses.length > 0) {
			changes.push({
				attribute: "class",
				previous: baseline.classNames.join(" ") || null,
				current: current.classNames.join(" ") || null,
				removedValues: removedClasses,
				addedValues: addedClasses,
				severity: "medium",
				severityReason: SEVERITY_REASONS.medium,
			});
		}
	}

	return changes;
}

// ── Suggest locator yang lebih stabil ─────────────────────────────────────

function suggestLocator(
	node: NormalizedNode,
	changes?: LocatorChange[],
): SuggestedLocator | undefined {
	const l = node.locators;

	const idChange = changes?.find((c) => c.attribute === "id");
	if (idChange && idChange.current) {
		if (l.dataTestId) {
			return {
				selector: `[data-testid="${l.dataTestId}"]`,
				reason: `id berubah dari "${idChange.previous}" -> "${idChange.current}". Gunakan data-testid agar tidak terpengaruh perubahan id di masa depan.`,
				priority: 1,
			};
		}
		return {
			selector: `#${idChange.current}`,
			reason: `id berubah dari "${idChange.previous}" -> "${idChange.current}". Update test kamu dari #${idChange.previous} ke #${idChange.current}.`,
			priority: 5,
		};
	}

	const testIdChange = changes?.find((c) => c.attribute === "dataTestId");
	if (testIdChange && testIdChange.current) {
		return {
			selector: `[data-testid="${testIdChange.current}"]`,
			reason: `data-testid berubah dari "${testIdChange.previous}" -> "${testIdChange.current}". Update test kamu ke selector baru ini.`,
			priority: 1,
		};
	}

	if (l.dataTestId) {
		return {
			selector: `[data-testid="${l.dataTestId}"]`,
			reason: "data-testid adalah locator paling stabil",
			priority: 1,
		};
	}
	if (l.dataCy) {
		return {
			selector: `[data-cy="${l.dataCy}"]`,
			reason: "data-cy adalah locator khusus Cypress yang stabil",
			priority: 2,
		};
	}
	if (l.ariaLabel) {
		return {
			selector: `[aria-label="${l.ariaLabel}"]`,
			reason: "aria-label stabil dan meningkatkan aksesibilitas",
			priority: 3,
		};
	}
	if (l.id) {
		return {
			selector: `#${l.id}`,
			reason: `Gunakan id terbaru #${l.id}`,
			priority: 5,
		};
	}
	if (node.textContent && node.tagName === "button") {
		return {
			selector: `text="${node.textContent}"`,
			reason: "Text content bisa dipakai tapi rentan berubah",
			priority: 6,
		};
	}

	return undefined;
}

// ── Label untuk display di report ────────────────────────────────────────

function buildElementLabel(node: NormalizedNode): string {
	if (node.textContent) return `<${node.tagName}> "${node.textContent}"`;
	if (node.locators.ariaLabel)
		return `<${node.tagName}> [aria-label="${node.locators.ariaLabel}"]`;
	if (node.locators.id) return `<${node.tagName}#${node.locators.id}>`;
	if (node.locators.dataTestId)
		return `<${node.tagName}> [data-testid="${node.locators.dataTestId}"]`;
	return `<${node.tagName}> @ ${node.domPath.split(" > ").slice(-2).join(" > ")}`;
}

// ── Filter: hanya elements yang punya tracked locators ───────────────────

function hasTrackedLocators(node: NormalizedNode): boolean {
	const l = node.locators;
	return !!(
		l.id ||
		l.name ||
		l.dataTestId ||
		l.dataTestid ||
		l.dataCy ||
		l.dataAutomationId ||
		l.ariaLabel ||
		l.classNames.length > 0
	);
}

// ── Apakah node di-ignore berdasarkan selector pattern ───────────────────

function isIgnored(node: NormalizedNode, ignoreSelectors: string[]): boolean {
	for (const sel of ignoreSelectors) {
		// Simple: cek apakah domPath mengandung selector
		if (node.domPath.includes(sel)) return true;
		if (node.locators.classNames.some((c) => sel === `.${c}`)) return true;
		if (sel === `#${node.locators.id}`) return true;
	}
	return false;
}

// ── MAIN DIFF FUNCTION ────────────────────────────────────────────────────

export function diffSnapshots(
	baseline: DOMSnapshot,
	current: DOMSnapshot,
	config: Partial<GuardConfig> = {},
): ElementDiff[] {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const diffs: ElementDiff[] = [];

	// Flatten kedua tree jadi array — hanya elemen dengan tracked locators
	const baselineNodes = flattenTree(baseline.tree).filter(
		(n) => hasTrackedLocators(n) && !isIgnored(n, cfg.ignoreSelectors),
	);
	const currentNodes = flattenTree(current.tree).filter(
		(n) => hasTrackedLocators(n) && !isIgnored(n, cfg.ignoreSelectors),
	);

	// Track current nodes yang sudah di-match
	const matchedCurrentIndices = new Set<number>();

	// ── Pass 1: Untuk setiap baseline node, cari best match di current ─────
	for (const baseNode of baselineNodes) {
		let bestScore = -1;
		let bestIndex = -1;

		for (let i = 0; i < currentNodes.length; i++) {
			if (matchedCurrentIndices.has(i)) continue;

			// Fast skip: tag harus sama
			if (baseNode.tagName !== currentNodes[i].tagName) continue;

			const { score } = computeSimilarity(baseNode, currentNodes[i]);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}

		// ── Elemen ditemukan (di atas threshold) ──────────────────────────
		if (bestScore >= cfg.similarityThreshold && bestIndex !== -1) {
			const currentNode = currentNodes[bestIndex];
			matchedCurrentIndices.add(bestIndex);

			const { score, signals } = computeSimilarity(baseNode, currentNode);
			const locatorChanges = detectLocatorChanges(
				baseNode.locators,
				currentNode.locators,
				cfg.trackedAttributes,
			);

			if (locatorChanges.length > 0) {
				diffs.push({
					elementLabel: buildElementLabel(baseNode),
					verdict: "locator_changed",
					confidenceScore: Math.round(score * 100),
					signals,
					locatorChanges,
					baselineNode: baseNode,
					currentNode,
					suggestedLocator: suggestLocator(currentNode, locatorChanges),
					sourceLocation: currentNode.sourceLocation,
				});
			}
			// verdict 'unchanged' — tidak perlu masuk report
		} else {
			// ── Tidak ditemukan match = elemen dihapus ─────────────────────
			diffs.push({
				elementLabel: buildElementLabel(baseNode),
				verdict: "removed",
				confidenceScore: 0,
				signals: {
					domPath: 0,
					textContent: 0,
					tagAndType: 0,
					visualPosition: 0.5,
					ariaRole: 0,
				},
				locatorChanges: [],
				baselineNode: baseNode,
				suggestedLocator: undefined,
			});
		}
	}

	// ── Pass 2: Current nodes yang tidak ter-match = elemen baru ──────────
	for (let i = 0; i < currentNodes.length; i++) {
		if (!matchedCurrentIndices.has(i)) {
			const node = currentNodes[i];
			diffs.push({
				elementLabel: buildElementLabel(node),
				verdict: "added",
				confidenceScore: 0,
				signals: {
					domPath: 0,
					textContent: 0,
					tagAndType: 0,
					visualPosition: 0.5,
					ariaRole: 0,
				},
				locatorChanges: [],
				currentNode: node,
				suggestedLocator: suggestLocator(node),
			});
		}
	}

	return diffs;
}
