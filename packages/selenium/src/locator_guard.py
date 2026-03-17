"""
dom_locator_guard_selenium.py
─────────────────────────────────────────────
Python integration untuk Selenium WebDriver.

Install:
    pip install dom-locator-guard-python  # coming soon
    # atau copy file ini langsung ke project

Penggunaan:
    from dom_locator_guard_selenium import LocatorGuardListener, LocatorGuard

    guard = LocatorGuard(baseline_dir="./locator-guard-baselines")
    driver = guard.wrap(webdriver.Chrome())

    driver.get("http://localhost:3000/login")
    report = guard.check("login-page")  # capture + compare + report
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

# ── Data classes ──────────────────────────────────────────────────────────

@dataclass
class TrackedLocators:
    id: Optional[str] = None
    name: Optional[str] = None
    data_testid: Optional[str] = None
    data_cy: Optional[str] = None
    aria_label: Optional[str] = None
    role: Optional[str] = None
    type: Optional[str] = None
    href: Optional[str] = None
    placeholder: Optional[str] = None
    class_names: list[str] = field(default_factory=list)


@dataclass
class NormalizedNode:
    tag_name: str
    text_content: str
    attributes: dict
    locators: TrackedLocators
    dom_path: str
    depth: int
    sibling_index: int
    fingerprint: str
    children: list["NormalizedNode"] = field(default_factory=list)


@dataclass
class DOMSnapshot:
    feature_name: str
    url: str
    timestamp: int
    guard_version: str
    tree: NormalizedNode

    def to_dict(self):
        def node_to_dict(n: NormalizedNode) -> dict:
            return {
                "tagName": n.tag_name,
                "textContent": n.text_content,
                "attributes": n.attributes,
                "locators": {
                    "id": n.locators.id,
                    "name": n.locators.name,
                    "dataTestId": n.locators.data_testid,
                    "dataCy": n.locators.data_cy,
                    "ariaLabel": n.locators.aria_label,
                    "role": n.locators.role,
                    "type": n.locators.type,
                    "href": n.locators.href,
                    "placeholder": n.locators.placeholder,
                    "classNames": n.locators.class_names,
                },
                "domPath": n.dom_path,
                "depth": n.depth,
                "siblingIndex": n.sibling_index,
                "fingerprint": n.fingerprint,
                "children": [node_to_dict(c) for c in n.children],
            }

        return {
            "featureName": self.feature_name,
            "url": self.url,
            "timestamp": self.timestamp,
            "guardVersion": self.guard_version,
            "tree": node_to_dict(self.tree),
        }


# ── JavaScript yang diinjeksikan ke browser untuk capture DOM ─────────────

_CAPTURE_SCRIPT = """
(function() {
    const SKIP = new Set(['SCRIPT','STYLE','META','HEAD','LINK','NOSCRIPT','TEMPLATE']);

    function getCSSPath(el) {
        const parts = [];
        let cur = el;
        while (cur && cur.tagName && cur.tagName !== 'HTML') {
            const tag = cur.tagName.toLowerCase();
            const siblings = Array.from(cur.parentElement?.children ?? [])
                .filter(s => s.tagName === cur.tagName);
            const idx = siblings.length > 1
                ? ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')' : '';
            parts.unshift(tag + idx);
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    }

    function getDepth(el) {
        let d = 0, c = el.parentElement;
        while (c) { d++; c = c.parentElement; }
        return d;
    }

    function fingerprint(tag, text, path) {
        const s = tag + '|' + text.substring(0, 50) + '|' + path;
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = (hash << 5) - hash + s.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    function normalize(el) {
        if (SKIP.has(el.tagName)) return null;
        const tag = el.tagName.toLowerCase();
        const attrs = {};
        Array.from(el.attributes).forEach(a => attrs[a.name] = a.value);
        const text = Array.from(el.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim()).filter(Boolean).join(' ');
        const domPath = getCSSPath(el);

        return {
            tagName: tag,
            textContent: text,
            attributes: attrs,
            locators: {
                id: attrs.id || null,
                name: attrs.name || null,
                dataTestId: attrs['data-testid'] || null,
                dataCy: attrs['data-cy'] || null,
                ariaLabel: attrs['aria-label'] || null,
                role: attrs.role || null,
                type: attrs.type || null,
                href: attrs.href || null,
                placeholder: attrs.placeholder || null,
                classNames: (attrs.class || '').split(/\\s+/).filter(Boolean),
            },
            domPath,
            depth: getDepth(el),
            siblingIndex: 0,
            fingerprint: fingerprint(tag, text, domPath),
            children: Array.from(el.children).map(normalize).filter(Boolean),
        };
    }

    return normalize(document.body);
})()
"""


# ── DOM normalizer (Python-side, dari JS result) ─────────────────────────

def _dict_to_node(d: dict) -> NormalizedNode:
    loc = d.get("locators", {})
    locators = TrackedLocators(
        id=loc.get("id"),
        name=loc.get("name"),
        data_testid=loc.get("dataTestId"),
        data_cy=loc.get("dataCy"),
        aria_label=loc.get("ariaLabel"),
        role=loc.get("role"),
        type=loc.get("type"),
        href=loc.get("href"),
        placeholder=loc.get("placeholder"),
        class_names=loc.get("classNames", []),
    )
    return NormalizedNode(
        tag_name=d["tagName"],
        text_content=d.get("textContent", ""),
        attributes=d.get("attributes", {}),
        locators=locators,
        dom_path=d.get("domPath", ""),
        depth=d.get("depth", 0),
        sibling_index=d.get("siblingIndex", 0),
        fingerprint=d.get("fingerprint", ""),
        children=[_dict_to_node(c) for c in d.get("children", [])],
    )


# ── Similarity scoring (Python port) ─────────────────────────────────────

def _levenshtein(a: str, b: str) -> int:
    if a == b: return 0
    if not a: return len(b)
    if not b: return len(a)
    matrix = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1): matrix[i][0] = i
    for j in range(len(b) + 1): matrix[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i-1] == b[j-1] else 1
            matrix[i][j] = min(matrix[i-1][j]+1, matrix[i][j-1]+1, matrix[i-1][j-1]+cost)
    return matrix[-1][-1]


def _string_sim(a: str, b: str) -> float:
    a, b = (a or "").lower(), (b or "").lower()
    if a == b: return 1.0
    if not a or not b: return 0.0
    max_len = max(len(a), len(b))
    return 1.0 - _levenshtein(a, b) / max_len


def _path_sim(a: str, b: str) -> float:
    if a == b: return 1.0
    segs_a = a.split(" > ")
    segs_b = b.split(" > ")
    depth_score = 0.3 if len(segs_a) == len(segs_b) else 0
    last_score = _string_sim(segs_a[-1] if segs_a else "", segs_b[-1] if segs_b else "") * 0.4
    set_a = set(segs_a[:-1])
    set_b = set(segs_b[:-1])
    union = set_a | set_b
    inter = set_a & set_b
    jaccard = len(inter) / len(union) if union else 1.0
    return depth_score + last_score + jaccard * 0.3


def _similarity(baseline: NormalizedNode, current: NormalizedNode) -> float:
    path = _path_sim(baseline.dom_path, current.dom_path) * 0.30
    text = _string_sim(baseline.text_content, current.text_content) * 0.25
    tag = (0.6 if baseline.tag_name == current.tag_name else 0) * 0.20 / 0.6
    tag += (0.4 if baseline.locators.type == current.locators.type else 0) * 0.20 / 0.4
    role = (1.0 if baseline.locators.role == current.locators.role else 0) * 0.10
    return path + text + (tag * 0.20) + 0.075 + role  # visual = 0.5 * 0.15


# ── Diff engine (Python port) ─────────────────────────────────────────────

@dataclass
class LocatorChange:
    attribute: str
    previous: Optional[str]
    current: Optional[str]
    severity: str
    removed_values: list[str] = field(default_factory=list)
    added_values: list[str] = field(default_factory=list)


@dataclass
class ElementDiff:
    element_label: str
    verdict: str   # 'unchanged' | 'locator_changed' | 'added' | 'removed'
    confidence_score: int
    locator_changes: list[LocatorChange] = field(default_factory=list)


SEVERITY = {
    "data_testid": "critical", "data_cy": "critical",
    "id": "high", "name": "high",
    "aria_label": "medium", "role": "medium", "type": "medium",
    "href": "low", "placeholder": "low", "class_names": "medium",
}


def _detect_locator_changes(baseline: TrackedLocators, current: TrackedLocators) -> list[LocatorChange]:
    changes = []
    for attr in ["id", "name", "data_testid", "data_cy", "aria_label", "role", "type", "href", "placeholder"]:
        prev = getattr(baseline, attr)
        curr = getattr(current, attr)
        if prev != curr:
            changes.append(LocatorChange(
                attribute=attr,
                previous=prev,
                current=curr,
                severity=SEVERITY.get(attr, "low"),
            ))
    # Class diff
    removed = [c for c in baseline.class_names if c not in current.class_names]
    added = [c for c in current.class_names if c not in baseline.class_names]
    if removed or added:
        changes.append(LocatorChange(
            attribute="class",
            previous=" ".join(baseline.class_names) or None,
            current=" ".join(current.class_names) or None,
            severity="medium",
            removed_values=removed,
            added_values=added,
        ))
    return changes


def _has_tracked_locators(node: NormalizedNode) -> bool:
    l = node.locators
    return bool(l.id or l.name or l.data_testid or l.data_cy or l.aria_label or l.class_names)


def _flatten(node: NormalizedNode) -> list[NormalizedNode]:
    result = [node]
    for child in node.children:
        result.extend(_flatten(child))
    return result


def _label(node: NormalizedNode) -> str:
    if node.text_content:
        return f"<{node.tag_name}> \"{node.text_content}\""
    if node.locators.id:
        return f"<{node.tag_name}#{node.locators.id}>"
    return f"<{node.tag_name}>"


def diff_snapshots(baseline: DOMSnapshot, current: DOMSnapshot, threshold: float = 0.75) -> list[ElementDiff]:
    baseline_nodes = [n for n in _flatten(baseline.tree) if _has_tracked_locators(n)]
    current_nodes = [n for n in _flatten(current.tree) if _has_tracked_locators(n)]

    matched = set()
    diffs = []

    for base_node in baseline_nodes:
        best_score, best_idx = -1.0, -1
        for i, curr_node in enumerate(current_nodes):
            if i in matched: continue
            if base_node.tag_name != curr_node.tag_name: continue
            score = _similarity(base_node, curr_node)
            if score > best_score:
                best_score, best_idx = score, i

        if best_score >= threshold and best_idx != -1:
            matched.add(best_idx)
            curr_node = current_nodes[best_idx]
            changes = _detect_locator_changes(base_node.locators, curr_node.locators)
            if changes:
                diffs.append(ElementDiff(
                    element_label=_label(base_node),
                    verdict="locator_changed",
                    confidence_score=int(best_score * 100),
                    locator_changes=changes,
                ))
        else:
            diffs.append(ElementDiff(element_label=_label(base_node), verdict="removed", confidence_score=0))

    for i, node in enumerate(current_nodes):
        if i not in matched:
            diffs.append(ElementDiff(element_label=_label(node), verdict="added", confidence_score=0))

    return diffs


# ── LocatorGuard — main class ─────────────────────────────────────────────

class LocatorGuard:
    """
    Main class untuk integrasi dengan Selenium WebDriver.

    Contoh:
        guard = LocatorGuard()
        driver = webdriver.Chrome()

        driver.get("http://localhost:3000/login")
        report = guard.check(driver, "login-page")

        if report and report["changedCount"] > 0:
            print(f"⚠ {report['changedCount']} locator changes detected")
    """

    def __init__(
        self,
        baseline_dir: str = "./locator-guard-baselines",
        output_dir: str = "./locator-guard-reports",
        threshold: float = 0.75,
    ):
        self.baseline_dir = Path(baseline_dir)
        self.output_dir = Path(output_dir)
        self.threshold = threshold
        self.baseline_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _slug(self, name: str) -> str:
        import re
        return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    def capture(self, driver, feature_name: str) -> DOMSnapshot:
        """Capture DOM snapshot dari browser saat ini."""
        raw = driver.execute_script(_CAPTURE_SCRIPT)
        if not raw:
            raise RuntimeError(f"[LocatorGuard] Failed to capture DOM for: {feature_name}")
        tree = _dict_to_node(raw)
        return DOMSnapshot(
            feature_name=feature_name,
            url=driver.current_url,
            timestamp=int(time.time() * 1000),
            guard_version="0.1.0",
            tree=tree,
        )

    def save_baseline(self, snapshot: DOMSnapshot) -> str:
        """Simpan snapshot sebagai baseline."""
        path = self.baseline_dir / f"{self._slug(snapshot.feature_name)}.baseline.json"
        with open(path, "w") as f:
            json.dump(snapshot.to_dict(), f, indent=2)
        print(f"[LocatorGuard] Baseline saved: {path}")
        return str(path)

    def load_baseline(self, feature_name: str) -> Optional[DOMSnapshot]:
        """Load baseline snapshot dari disk."""
        path = self.baseline_dir / f"{self._slug(feature_name)}.baseline.json"
        if not path.exists():
            return None
        with open(path) as f:
            data = json.load(f)
        tree = _dict_to_node(data["tree"])
        return DOMSnapshot(
            feature_name=data["featureName"],
            url=data["url"],
            timestamp=data["timestamp"],
            guard_version=data["guardVersion"],
            tree=tree,
        )

    def check(self, driver, feature_name: str) -> Optional[dict]:
        """
        Capture + compare + report.
        Return report dict atau None jika ini adalah baseline run pertama.
        Test TIDAK gagal meski ada perubahan.
        """
        current = self.capture(driver, feature_name)
        baseline = self.load_baseline(feature_name)

        if not baseline:
            self.save_baseline(current)
            print(f"[LocatorGuard] Baseline created for: {feature_name}")
            return None

        diffs = diff_snapshots(baseline, current, self.threshold)
        changed = [d for d in diffs if d.verdict == "locator_changed"]
        removed = [d for d in diffs if d.verdict == "removed"]

        report = {
            "featureName": feature_name,
            "url": driver.current_url,
            "changedCount": len(changed),
            "removedCount": len(removed),
            "addedCount": len([d for d in diffs if d.verdict == "added"]),
            "diffs": [asdict(d) for d in diffs],
            "status": "clean" if not changed and not removed else "warning",
        }

        if changed:
            self._print_report(report)

        return report

    def _print_report(self, report: dict) -> None:
        print(f"\n{'═'*60}")
        print(f"  ⚠ LOCATOR GUARD — {report['featureName']}")
        print(f"{'═'*60}")
        for diff in report["diffs"]:
            if diff["verdict"] == "locator_changed":
                print(f"\n  Element: {diff['element_label']}")
                print(f"  Confidence: {diff['confidence_score']}%")
                for change in diff["locator_changes"]:
                    print(f"  [{change['severity'].upper()}] {change['attribute']}:")
                    print(f"    Previous: {change['previous']}")
                    print(f"    Current:  {change['current']}")
        print(f"\n{'═'*60}\n")
