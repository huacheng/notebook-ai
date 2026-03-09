#!/usr/bin/env python3
"""
Convergence score calculator for task-ai progressive evolution model.

Usage:
    # Parse baseline and compute convergence from a coverage assessment file
    python3 convergence.py score <baseline.md> <coverage.md>

    # Parse baseline only (list R# items)
    python3 convergence.py parse <baseline.md>

    # Compare two convergence scores (direction gate)
    python3 convergence.py gate <current_score> <previous_score>

Coverage assessment file format (.analysis/*-convergence.md):
    | # | Requirement | Weight | Coverage | Rationale |
    |---|------------|--------|----------|-----------|
    | R1 | JWT auth   | 3      | 1.00     | Fully implemented |
    | R2 | Refresh    | 2      | 0.75     | Minor edge case |

Baseline file format (.convergence-baseline.md):
    | # | Requirement | Weight | Source |
    |---|------------|--------|--------|
    | R1 | JWT auth   | 3      | Objective |
"""

import json
import re
import sys
from pathlib import Path

WEIGHT_MAP = {"critical": 3, "important": 2, "optional": 1}
VALID_COVERAGE = {1.00, 0.75, 0.50, 0.25, 0.00}


def parse_baseline(path: str) -> list[dict]:
    """Parse .convergence-baseline.md into list of {id, requirement, weight, source}."""
    items = []
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        print(json.dumps({"error": f"Baseline file not found: {path}", "convergence": 0.0}))
        sys.exit(1)
    # Match table rows: | R<N> | text | weight | source |
    for line in text.splitlines():
        m = re.match(
            r'\|\s*(R\d+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|',
            line.strip()
        )
        if m:
            items.append({
                "id": m.group(1),
                "requirement": m.group(2).strip(),
                "weight": int(m.group(3)),
                "source": m.group(4).strip(),
            })
    return items


def parse_coverage(path: str) -> dict[str, float]:
    """Parse coverage assessment file into {R#: coverage_score}."""
    scores = {}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        print(json.dumps({"error": f"Coverage file not found: {path}", "convergence": 0.0}))
        sys.exit(1)
    for line in text.splitlines():
        # Match: | R<N> | text | weight | coverage | rationale |
        m = re.match(
            r'\|\s*(R\d+)\s*\|\s*.+?\s*\|\s*\d+\s*\|\s*([\d.]+)\s*\|',
            line.strip()
        )
        if m:
            rid = m.group(1)
            cov = float(m.group(2))
            if cov < 0.0 or cov > 1.0:
                print(f"Warning: {rid} coverage {cov} out of range [0,1], snapping", file=sys.stderr)
            # Snap to nearest valid coverage level
            cov = min(VALID_COVERAGE, key=lambda v: abs(v - cov))
            scores[rid] = cov
    return scores


def compute_convergence(baseline: list[dict], coverage: dict[str, float]) -> dict:
    """
    Compute convergence score.

    convergence = Σ(wᵢ × cᵢ) / Σ(wᵢ)

    Returns dict with:
      - convergence: float (0.0 - 1.0)
      - details: list of per-R# results
      - total_weight: sum of all weights
      - weighted_sum: sum of w*c
      - uncovered: list of R# IDs missing from coverage
    """
    total_weight = 0
    weighted_sum = 0.0
    details = []
    uncovered = []

    for item in baseline:
        rid = item["id"]
        w = item["weight"]
        total_weight += w

        if rid in coverage:
            c = coverage[rid]
        else:
            c = 0.0
            uncovered.append(rid)

        wc = w * c
        weighted_sum += wc
        details.append({
            "id": rid,
            "requirement": item["requirement"],
            "weight": w,
            "coverage": c,
            "weighted": round(wc, 2),
        })

    convergence = round(weighted_sum / total_weight, 4) if total_weight > 0 else 0.0

    return {
        "convergence": convergence,
        "total_weight": total_weight,
        "weighted_sum": round(weighted_sum, 2),
        "uncovered": uncovered,
        "details": details,
    }


def direction_gate(current: float, previous: float) -> dict:
    """
    Direction gate: convergence must increase for ACCEPT.

    Returns dict with:
      - passed: bool
      - current: float
      - previous: float
      - delta: float
      - verdict: "ACCEPT" or "ROLLBACK"
    """
    delta = round(current - previous, 4)
    passed = current > previous
    return {
        "passed": passed,
        "current": current,
        "previous": previous,
        "delta": delta,
        "verdict": "ACCEPT" if passed else "ROLLBACK",
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: convergence.py <command> [args...]", file=sys.stderr)
        print("Commands: score, parse, gate", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "parse":
        if len(sys.argv) < 3:
            print("Usage: convergence.py parse <baseline.md>", file=sys.stderr)
            sys.exit(1)
        items = parse_baseline(sys.argv[2])
        print(json.dumps(items, indent=2, ensure_ascii=False))

    elif cmd == "score":
        if len(sys.argv) < 4:
            print("Usage: convergence.py score <baseline.md> <coverage.md>", file=sys.stderr)
            sys.exit(1)
        baseline = parse_baseline(sys.argv[2])
        if not baseline:
            print(json.dumps({"error": "No R# items found in baseline", "convergence": 0.0}))
            sys.exit(1)
        coverage = parse_coverage(sys.argv[3])
        result = compute_convergence(baseline, coverage)
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "gate":
        if len(sys.argv) < 4:
            print("Usage: convergence.py gate <current_score> <previous_score>", file=sys.stderr)
            sys.exit(1)
        try:
            current = float(sys.argv[2])
            previous = float(sys.argv[3])
        except ValueError:
            print("Error: scores must be numeric", file=sys.stderr)
            sys.exit(1)
        result = direction_gate(current, previous)
        print(json.dumps(result, indent=2))

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
