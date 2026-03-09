#!/usr/bin/env python3
"""
Adaptive audit round budget calculator for task-ai auto mode.

Usage:
    # Compute budget from git diff stats
    python3 audit_budget.py compute --files 18 --lines 450 --dirs 7 --type software

    # Compute budget from git diff output (auto-parse)
    python3 audit_budget.py from-diff <git-diff-stat-output-file>

    # Check early termination condition
    python3 audit_budget.py should-stop --round 4 --max 10 --consecutive-pass 2

Formula:
    max_rounds = clamp(
        ceil(files/5) + ceil(lines/200) + ceil(dirs/3) + type_bonus,
        2, 10
    )

Early termination:
    - 2 consecutive PASS (zero fixes) → stop
    - All gates PASS on round 1 AND files ≤ 3 → stop after round 1
    - max_rounds reached → stop
"""

import json
import math
import re
import sys

# Type bonus: extra rounds for complex task types
TYPE_BONUS = {
    "software": 1,
}

MAX_ROUNDS = 10
MIN_ROUNDS = 2
CONSECUTIVE_PASS_LIMIT = 2


def compute_budget(files: int, lines: int, dirs: int, task_type: str) -> dict:
    """
    Compute adaptive audit round budget.

    Args:
        files: number of distinct files changed
        lines: total lines changed (insertions + deletions)
        dirs: number of distinct directories touched
        task_type: task type string (may be pipe-separated hybrid)

    Returns dict with:
        - max_rounds: int (2-10)
        - files_component: contribution from file count
        - lines_component: contribution from line count
        - dirs_component: contribution from directory count
        - type_bonus: bonus from task type
        - raw_total: pre-clamp total
        - early_stop_rules: applicable early termination rules
    """
    files_component = math.ceil(files / 5) if files > 0 else 0
    lines_component = math.ceil(lines / 200) if lines > 0 else 0
    dirs_component = math.ceil(dirs / 3) if dirs > 0 else 0

    # Type bonus: check each segment of pipe-separated type
    type_bonus = 0
    segments = [s.strip() for s in task_type.split("|")] if task_type else []
    for segment in segments:
        # Check exact match first, then prefix match
        if segment in TYPE_BONUS:
            type_bonus = max(type_bonus, TYPE_BONUS[segment])
        else:
            for key, bonus in TYPE_BONUS.items():
                if key in segment or segment in key:
                    type_bonus = max(type_bonus, bonus)
    # Hybrid types (A|B) get +1 bonus
    if len(segments) > 1:
        type_bonus += 1

    raw_total = files_component + lines_component + dirs_component + type_bonus
    max_rounds = max(MIN_ROUNDS, min(MAX_ROUNDS, raw_total))

    early_stop_rules = [
        f"{CONSECUTIVE_PASS_LIMIT} consecutive PASS (zero fixes) → stop",
        f"max_rounds ({max_rounds}) reached → stop",
    ]
    if files <= 3:
        early_stop_rules.append("All gates PASS on round 1 AND files ≤ 3 → stop after round 1")

    return {
        "max_rounds": max_rounds,
        "files_component": files_component,
        "lines_component": lines_component,
        "dirs_component": dirs_component,
        "type_bonus": type_bonus,
        "raw_total": raw_total,
        "early_stop_rules": early_stop_rules,
    }


def should_stop(current_round: int, max_rounds: int, consecutive_pass: int,
                files: int = 0, round1_all_pass: bool = False) -> dict:
    """
    Check whether the audit loop should terminate.

    Returns dict with:
        - stop: bool
        - reason: str (why stopping, or "continue")
    """
    if current_round >= max_rounds:
        return {"stop": True, "reason": f"max_rounds ({max_rounds}) reached"}

    if consecutive_pass >= CONSECUTIVE_PASS_LIMIT:
        return {
            "stop": True,
            "reason": f"{consecutive_pass} consecutive PASS — diminishing returns",
        }

    if current_round == 1 and round1_all_pass and files <= 3:
        return {
            "stop": True,
            "reason": f"trivial change ({files} files), all gates PASS on round 1",
        }

    return {"stop": False, "reason": "continue"}


def parse_diff_stat(text: str) -> dict:
    """
    Parse `git diff --stat` output to extract files, lines, dirs.

    Expected format (last line):
        N files changed, M insertions(+), K deletions(-)

    Or per-file lines:
        path/to/file.ext | 42 ++++----
    """
    files = 0
    lines = 0
    dirs = set()

    for line in text.strip().splitlines():
        # Summary line: "18 files changed, 300 insertions(+), 150 deletions(-)"
        m = re.match(
            r'\s*(\d+)\s+files?\s+changed'
            r'(?:,\s*(\d+)\s+insertions?\(\+\))?'
            r'(?:,\s*(\d+)\s+deletions?\(-\))?',
            line.strip()
        )
        if m:
            files = int(m.group(1))
            ins = int(m.group(2)) if m.group(2) else 0
            dels = int(m.group(3)) if m.group(3) else 0
            lines = ins + dels
            continue

        # Per-file line: " src/foo/bar.ts | 42 +++---"
        m = re.match(r'\s*(.+?)\s*\|\s*(\d+)', line.strip())
        if m:
            filepath = m.group(1).strip()
            parts = filepath.replace("\\", "/").split("/")
            if len(parts) > 1:
                dirs.add("/".join(parts[:-1]))

    return {"files": files, "lines": lines, "dirs": len(dirs)}


def main():
    if len(sys.argv) < 2:
        print("Usage: audit_budget.py <command> [args...]", file=sys.stderr)
        print("Commands: compute, from-diff, should-stop", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "compute":
        import argparse
        parser = argparse.ArgumentParser(prog="audit_budget.py compute")
        parser.add_argument("--files", type=int, required=True)
        parser.add_argument("--lines", type=int, required=True)
        parser.add_argument("--dirs", type=int, required=True)
        parser.add_argument("--type", type=str, default="")
        # Skip "compute" in argv
        args = parser.parse_args(sys.argv[2:])
        result = compute_budget(args.files, args.lines, args.dirs, args.type)
        print(json.dumps(result, indent=2))

    elif cmd == "from-diff":
        if len(sys.argv) < 3 or sys.argv[2] == "-":
            # Read from stdin
            text = sys.stdin.read()
        else:
            from pathlib import Path
            try:
                text = Path(sys.argv[2]).read_text(encoding="utf-8")
            except FileNotFoundError:
                print(json.dumps({"error": f"File not found: {sys.argv[2]}"}))
                sys.exit(1)

        stats = parse_diff_stat(text)
        # Optional --type argument
        task_type = ""
        for i, arg in enumerate(sys.argv[3:], 3):
            if arg == "--type" and i + 1 < len(sys.argv):
                task_type = sys.argv[i + 1]
                break

        result = compute_budget(stats["files"], stats["lines"], stats["dirs"], task_type)
        result["parsed_stats"] = stats
        print(json.dumps(result, indent=2))

    elif cmd == "should-stop":
        import argparse
        parser = argparse.ArgumentParser(prog="audit_budget.py should-stop")
        parser.add_argument("--round", type=int, required=True)
        parser.add_argument("--max", type=int, required=True)
        parser.add_argument("--consecutive-pass", type=int, required=True)
        parser.add_argument("--files", type=int, default=0)
        parser.add_argument("--round1-all-pass", action="store_true")
        args = parser.parse_args(sys.argv[2:])
        result = should_stop(args.round, args.max, args.consecutive_pass,
                             args.files, args.round1_all_pass)
        print(json.dumps(result, indent=2))

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
