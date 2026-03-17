// ─────────────────────────────────────────────
//  snapshot/source-locator.ts
//  Extract line number + code snippet dari source file
//  Support: .html, .jsx, .tsx
// ─────────────────────────────────────────────

import type { SourceLocation } from "../types";

// ── Helper: konversi char index → line/column ─────────────────────────────

export function indexToLineCol(
	source: string,
	index: number,
): { line: number; column: number } {
	const before = source.slice(0, index);
	const lines = before.split("\n");
	return {
		line: lines.length,
		column: (lines[lines.length - 1]?.length ?? 0) + 1,
	};
}

// ── Helper: ambil context lines (before + line + after) ───────────────────

export function extractContext(
	lines: string[],
	lineNumber: number, // 1-based
	contextSize = 2,
): { before: string[]; line: string; after: string[] } {
	const idx = lineNumber - 1;
	const before = lines.slice(Math.max(0, idx - contextSize), idx);
	const line = lines[idx] ?? "";
	const after = lines.slice(idx + 1, idx + 1 + contextSize);
	return { before, line, after };
}

// ── Build SourceLocation dari source string + char index ─────────────────

export function buildSourceLocation(
	source: string,
	charIndex: number,
): SourceLocation {
	const { line, column } = indexToLineCol(source, charIndex);
	const lines = source.split("\n");
	const context = extractContext(lines, line);

	return {
		line,
		column,
		snippet: context.line.trim(),
		context,
	};
}

// ─────────────────────────────────────────────────────────────────────────
//  JSX / TSX SCANNER
//  Regex-based — tidak perlu full AST parser
//  Cukup untuk menemukan elemen dan locator attributes-nya
// ─────────────────────────────────────────────────────────────────────────

export interface JSXElement {
	tagName: string;
	attributes: Record<string, string>;
	lineNumber: number;
	column: number;
	snippet: string;
	context: { before: string[]; line: string; after: string[] };
}

// Regex untuk match JSX opening tag
// Contoh: <button id="loginbtn" className="btn" onClick={...}>
// Atau:   <Button data-testid="submit" disabled>
const JSX_TAG_REGEX = /<([A-Za-z][A-Za-z0-9.]*)\s([^>]*?)(\/>|>)/gs;

// Regex untuk extract satu attribute
// Supports: id="val"  id='val'  id={expr}  disabled  aria-label="val"
const ATTR_REGEX =
	/([a-zA-Z_][a-zA-Z0-9_\-:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}))?/g;

const TRACKED_ATTRS = new Set([
	"id",
	"name",
	"data-testid",
	"data-testId",
	"data-cy",
	"data-automation-id",
	"aria-label",
	"role",
	"type",
	"href",
	"placeholder",
	"className",
	"class",
]);

export function parseJSX(source: string): JSXElement[] {
	const lines: string[] = source.split("\n");
	const results: JSXElement[] = [];

	// Reset regex state
	JSX_TAG_REGEX.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = JSX_TAG_REGEX.exec(source)) !== null) {
		const tagName = match[1];
		const attrStr = match[2] ?? "";
		const charIndex = match.index;

		// Parse attributes
		const attributes: Record<string, string> = {};
		ATTR_REGEX.lastIndex = 0;
		let attrMatch: RegExpExecArray | null;

		while ((attrMatch = ATTR_REGEX.exec(attrStr)) !== null) {
			const attrName = attrMatch[1];
			if (!attrName || !TRACKED_ATTRS.has(attrName)) continue;

			// Value: double-quote, single-quote, JSX expression, atau boolean (no value)
			const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "true";
			attributes[attrName] = value;
		}

		// Skip kalau tidak ada tracked attribute
		if (Object.keys(attributes).length === 0) continue;

		const { line, column } = indexToLineCol(source, charIndex);
		const context = extractContext(lines, line);

		results.push({
			tagName: tagName.toLowerCase(),
			attributes,
			lineNumber: line,
			column,
			snippet: context.line.trim(),
			context,
		});
	}

	return results;
}

// ── Build lookup map: domPath/fingerprint → sourceLocation ────────────────
//  Digunakan oleh diff engine untuk attach sourceLocation ke ElementDiff

export function buildJSXLocationMap(
	source: string,
): Map<string, SourceLocation> {
	const map = new Map<string, SourceLocation>();
	const elements = parseJSX(source);

	for (const el of elements) {
		// Key: tagName + id (atau data-testid) — cukup untuk match ke NormalizedNode
		const id =
			el.attributes["id"] ??
			el.attributes["data-testid"] ??
			el.attributes["data-cy"];
		const className = el.attributes["className"] ?? el.attributes["class"];

		const loc: SourceLocation = {
			line: el.lineNumber,
			column: el.column,
			snippet: el.snippet,
			context: el.context,
		};

		if (id) map.set(`${el.tagName}#${id}`, loc);
		if (className) map.set(`${el.tagName}.${className.split(" ")[0]}`, loc);

		// Fallback key: tagName + line number
		map.set(`${el.tagName}:L${el.lineNumber}`, loc);
	}

	return map;
}

// ── Detect file type ──────────────────────────────────────────────────────

export type FileType = "html" | "jsx" | "tsx" | "unknown";

export function detectFileType(filename: string): FileType {
	const ext = filename.toLowerCase().split(".").pop();
	if (ext === "html" || ext === "htm") return "html";
	if (ext === "jsx") return "jsx";
	if (ext === "tsx") return "tsx";
	return "unknown";
}
