// ─────────────────────────────────────────────
//  @dom-locator-guard/core — types.ts
//  Central type definitions for the entire tool
// ─────────────────────────────────────────────

// ── Locator attributes yang di-track ──────────────────────────────────────

export interface TrackedLocators {
  id?: string;
  name?: string;
  dataTestId?: string;       // data-testid
  dataTestid?: string;       // data-testId (alternate casing)
  dataCy?: string;           // data-cy (Cypress convention)
  dataAutomationId?: string; // data-automation-id
  ariaLabel?: string;        // aria-label
  role?: string;             // role attribute
  type?: string;             // input type, button type
  href?: string;             // for anchor tags
  placeholder?: string;      // for inputs
  classNames: string[];
}

export interface SourceLocation {
	line: number;
	column: number;
	snippet: string;
	context: {
		before: string[];
		line: string;
		after: string[];
	};
}

// ── Normalized DOM node ────────────────────────────────────────────────────

export interface NormalizedNode {
	/** Tag name in lowercase, e.g. "button", "input" */
	tagName: string;
	/** Trimmed innerText / textContent */
	textContent: string;
	/** All HTML attributes as key-value */
	attributes: Record<string, string>;
	/** Parsed locator-relevant attributes */
	locators: TrackedLocators;
	/** CSS selector path from root, e.g. "body > main > form > button:nth-child(1)" */
	domPath: string;
	/** Absolute XPath */
	xpath: string;
	/** Bounding box — populated when captured from live browser */
	visualPosition?: BoundingBox;
	/** Depth in DOM tree from body */
	depth: number;
	/** Index among siblings with same tagName */
	siblingIndex: number;
	/** SHA-256 hash of stable properties (tagName + textContent + domPath) */
	fingerprint: string;
	/** Recursive children */
	children: NormalizedNode[];
	suggestedLocator?: SuggestedLocator;
	sourceLocation?: SourceLocation;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Snapshot ───────────────────────────────────────────────────────────────

export interface DOMSnapshot {
  /** Human-readable name, e.g. "login-page" */
  featureName: string;
  /** Page URL at time of capture */
  url: string;
  /** Unix timestamp in ms */
  timestamp: number;
  /** Tool version that generated this snapshot */
  guardVersion: string;
  /** Root normalized node (usually <body>) */
  tree: NormalizedNode;
  /** Flat map of fingerprint → node for O(1) lookup */
  index: Record<string, NormalizedNode>;
}

// ── Diff / Change detection ────────────────────────────────────────────────

export type LocatorAttribute =
  | 'id'
  | 'name'
  | 'dataTestId'
  | 'dataCy'
  | 'dataAutomationId'
  | 'ariaLabel'
  | 'role'
  | 'type'
  | 'href'
  | 'placeholder'
  | 'class';

export type ChangeSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface LocatorChange {
  attribute: LocatorAttribute;
  previous: string | null;
  current: string | null;
  /** For 'class': which classes were removed */
  removedValues?: string[];
  /** For 'class': which classes were added */
  addedValues?: string[];
  severity: ChangeSeverity;
  /** Plain-English reason why this severity was assigned */
  severityReason: string;
}

export type ElementVerdict =
  | 'unchanged'      // locator + content sama persis
  | 'locator_changed' // elemen sama, tapi locator berubah
  | 'content_changed' // locator sama, tapi text/type berubah
  | 'added'           // element baru di current, tidak ada di baseline
  | 'removed'         // element ada di baseline, tidak ada di current

export interface SimilaritySignals {
  domPath: number;      // 0-1
  textContent: number;  // 0-1
  tagAndType: number;   // 0-1
  visualPosition: number; // 0-1 (0.5 jika tidak ada visual data)
  ariaRole: number;     // 0-1
}

export interface ElementDiff {
	/** Human-readable label dari textContent atau tagName */
	elementLabel: string;
	verdict: ElementVerdict;
	/** Confidence bahwa ini adalah elemen yang sama secara fungsional (0-100) */
	confidenceScore: number;
	signals: SimilaritySignals;
	/** Locator changes — hanya diisi jika verdict === 'locator_changed' */
	locatorChanges: LocatorChange[];
	baselineNode?: NormalizedNode;
	currentNode?: NormalizedNode;
	/** Suggested replacement locator */
	suggestedLocator?: SuggestedLocator;
	sourceLocation?: SourceLocation;
}

export interface SuggestedLocator {
  /** Locator selector yang disarankan sebagai pengganti */
  selector: string;
  /** Kenapa locator ini lebih stabil */
  reason: string;
  /** Priority: prefer data-testid > aria-label > role > id > class */
  priority: number;
}

// ── Report ─────────────────────────────────────────────────────────────────

export type ReportStatus = 'clean' | 'warning' | 'error';

export interface LocatorReport {
  /** Unique run ID */
  runId: string;
  featureName: string;
  pageUrl: string;
  generatedAt: number;
  status: ReportStatus;
  /** Total elements scanned */
  totalElements: number;
  /** Elements with locator changes */
  changedCount: number;
  /** Elements added (not in baseline) */
  addedCount: number;
  /** Elements removed from baseline */
  removedCount: number;
  diffs: ElementDiff[];
  /** Summary for console / Slack message */
  summary: string;
  /** Metadata: baseline timestamp, current timestamp */
  meta: ReportMeta;
}

export interface ReportMeta {
  baselineTimestamp: number;
  currentTimestamp: number;
  baselineUrl: string;
  currentUrl: string;
  guardVersion: string;
}

// ── Configuration ──────────────────────────────────────────────────────────

export interface GuardConfig {
  /**
   * Confidence threshold (0-1) — di atas ini dianggap elemen yang sama.
   * Default: 0.75
   */
  similarityThreshold: number;
  /**
   * Attributes yang di-track sebagai locator.
   * Default: semua TrackedLocators keys
   */
  trackedAttributes: LocatorAttribute[];
  /**
   * Selector CSS untuk elemen yang di-ignore (e.g. dynamic ads, timestamps).
   * Default: []
   */
  ignoreSelectors: string[];
  /**
   * Apakah melakukan self-healing otomatis ke test files.
   * Default: false
   */
  autoHeal: boolean;
  /**
   * Path ke test files untuk self-healing.
   * Default: []
   */
  testFilePaths: string[];
  /**
   * Format output report.
   * Default: ['console', 'html']
   */
  outputFormats: OutputFormat[];
  /**
   * Output directory untuk report files.
   * Default: './locator-guard-reports'
   */
  outputDir: string;
  /**
   * Directory untuk menyimpan baseline snapshots.
   * Default: './locator-guard-baselines'
   */
  baselineDir: string;
}

export type OutputFormat = 'console' | 'html' | 'json' | 'junit';

export const DEFAULT_CONFIG: GuardConfig = {
  similarityThreshold: 0.75,
  trackedAttributes: [
    'id', 'name', 'dataTestId', 'dataCy',
    'dataAutomationId', 'ariaLabel', 'role',
    'type', 'href', 'placeholder', 'class',
  ],
  ignoreSelectors: [],
  autoHeal: false,
  testFilePaths: [],
  outputFormats: ['console', 'html'],
  outputDir: './locator-guard-reports',
  baselineDir: './locator-guard-baselines',
};
