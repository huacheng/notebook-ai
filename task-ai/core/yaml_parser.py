#!/usr/bin/env python3
"""
Unified YAML parser for task-ai rule system (stdlib only, Python >= 3.9).
Used by: rule-loader.sh, check.sh (audit-validate), evolve-rules.sh

Usage:
  yaml_parser.py parse <file.yaml>              # Parse single YAML file
  yaml_parser.py load-rules <domain> <dir>      # Load all rules from domain directory
  yaml_parser.py calculate-precision <rule.yaml> <test_dir>  # Calculate rule precision
"""

import sys
import os
import json
import re
from pathlib import Path

def parse_yaml_file(filepath: str) -> dict:
    """Parse a YAML file without external dependencies (PyYAML not guaranteed).

    Handles common YAML patterns:
    - key: value
    - key: "quoted value"
    - key: 'single quoted'
    - key: |  (multiline, captured as single line indicator)
    - enabled: true/false
    """
    result = {}
    current_key = None
    multiline_buffer = []
    in_multiline = False

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        return {"error": str(e)}

    for line in lines:
        stripped = line.rstrip()

        # Skip comments and empty lines
        if not stripped or stripped.startswith('#'):
            continue

        # Check for multiline continuation
        if in_multiline:
            if line.startswith('  ') or line.startswith('\t'):
                multiline_buffer.append(stripped)
                continue
            else:
                # End of multiline, save and process current line
                result[current_key] = '\n'.join(multiline_buffer)
                in_multiline = False
                multiline_buffer = []

        # Parse key: value
        # D1: Allow hyphens in YAML keys (e.g., case-insensitive, source-url)
        match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$', stripped)
        if match:
            key = match.group(1)
            value = match.group(2).strip()

            # Check for multiline indicator
            if value in ('|', '>', '|-', '>-'):
                current_key = key
                in_multiline = True
                multiline_buffer = []
                continue

            # Strip quotes and process escape sequences
            was_quoted = False
            if value.startswith('"') and value.endswith('"'):
                was_quoted = True
                value = value[1:-1]
                # Process YAML double-quote escape sequences
                value = value.replace('\\\\', '\x00')  # Temp placeholder
                value = value.replace('\\n', '\n')
                value = value.replace('\\t', '\t')
                value = value.replace('\\r', '\r')
                value = value.replace('\\"', '"')
                value = value.replace('\x00', '\\')  # Restore single backslash
            elif value.startswith("'") and value.endswith("'"):
                was_quoted = True
                # Single quotes: no escape processing (literal)
                value = value[1:-1]

            # D1: Only convert unquoted values to booleans (quoted "true" stays string)
            if not was_quoted:
                if value.lower() == 'true':
                    value = True
                elif value.lower() == 'false':
                    value = False

            result[key] = value

    # Handle final multiline
    if in_multiline and multiline_buffer:
        result[current_key] = '\n'.join(multiline_buffer)

    return result


def sanitize_pattern(pattern: str, rule_id: str) -> tuple[bool, str]:
    """Check if pattern is safe (no shell injection).

    Returns: (is_safe, reason)
    """
    dangerous_patterns = [
        r'\$\(',           # Command substitution $(...)
        r'`[^`]+`',        # Backtick command substitution
        r';\s*(curl|wget|bash|sh|rm|chmod|cat|nc|python|perl|ruby)',  # Command chaining
        r'\|\s*(bash|sh)',  # Piping to shell
        r'>\s*/dev/',       # Redirect to devices
    ]

    for dp in dangerous_patterns:
        if re.search(dp, pattern, re.IGNORECASE):
            return False, f"Dangerous pattern detected in {rule_id}"

    return True, "OK"


def load_rules_from_directory(domain: str, rules_dir: str) -> list[dict]:
    """Load all enabled rules from a domain directory."""
    rules = []
    rules_path = Path(rules_dir)

    if not rules_path.exists():
        return rules

    for yaml_file in sorted(rules_path.glob('*.yaml')) + sorted(rules_path.glob('*.yml')):
        parsed = parse_yaml_file(str(yaml_file))

        # Skip if error or disabled
        if 'error' in parsed:
            continue
        if parsed.get('enabled') is False:
            continue

        rule_id = parsed.get('id', '')
        if not rule_id:
            continue

        pattern = parsed.get('pattern', '')

        # For audit domain, pattern is optional
        if domain == 'audit':
            if not pattern or pattern in ('|', '>'):
                pattern = '__audit_rule__'
        else:
            # Skip empty or multiline-only patterns
            if not pattern or pattern in ('|', '>'):
                continue

            # Note: sanitize_pattern is NOT called here for active rules.
            # Security rules intentionally contain "dangerous" patterns because
            # their purpose is to DETECT those patterns. Sanitization should only
            # be applied to candidate rules during validation (check --checkpoint
            # audit-validate), not to already-activated rules.

        rules.append({
            'id': rule_id,
            'name': parsed.get('name', ''),
            'pattern': pattern,
            'case_insensitive': parsed.get('case_insensitive', False),
            'dimension': parsed.get('dimension', ''),
            'enabled': True,
            'file': str(yaml_file)
        })

    return rules


def calculate_precision(rule_file: str, test_dir: str) -> float:
    """Calculate precision using labeled positive/negative samples.

    Directory structure expected:
      test_dir/
      ├── positive/   # Files that SHOULD match (true positives)
      └── negative/   # Files that should NOT match (true negatives)

    Precision = TP / (TP + FP)
    Where:
      TP = positive samples that matched
      FP = negative samples that matched (false positives)

    Falls back to heuristic if no labeled samples exist.
    """
    parsed = parse_yaml_file(rule_file)
    pattern = parsed.get('pattern', '')
    # D1: Respect case_insensitive config from rule file
    case_insensitive = parsed.get('case_insensitive', False)
    re_flags = re.IGNORECASE if case_insensitive else 0

    if not pattern or pattern == '__audit_rule__':
        return 0.75  # Default for missing/audit patterns

    # D3: Validate regex pattern before using it in re.search
    try:
        re.compile(pattern)
    except re.error as e:
        print(f"[ERROR] Invalid regex pattern in {rule_file}: {e}", file=sys.stderr)
        return 0.0  # Invalid pattern gets worst score

    test_path = Path(test_dir)
    if not test_path.exists():
        return 0.75

    positive_dir = test_path / 'positive'
    negative_dir = test_path / 'negative'

    # Check if labeled corpus exists
    has_labeled_corpus = positive_dir.exists() or negative_dir.exists()

    if has_labeled_corpus:
        # True precision calculation with labeled samples
        true_positive = 0
        false_negative = 0
        false_positive = 0
        true_negative = 0

        # D4: Collect all files once, avoid repeated rglob per extension
        def collect_sample_files(sample_dir: Path) -> list:
            """Collect all sample files from directory (single traversal)."""
            files = []
            if sample_dir.exists():
                for f in sample_dir.rglob('*'):
                    if f.is_file() and f.suffix in ('.md', '.yaml', '.yml', '.txt', '.json'):
                        files.append(f)
            return files

        # Check positive samples (should match)
        for f in collect_sample_files(positive_dir):
            try:
                content = f.read_text(encoding='utf-8', errors='ignore')
                # D1: Use re_flags from rule config
                if re.search(pattern, content, re_flags):
                    true_positive += 1
                else:
                    false_negative += 1
            except Exception:
                pass

        # Check negative samples (should NOT match)
        for f in collect_sample_files(negative_dir):
            try:
                content = f.read_text(encoding='utf-8', errors='ignore')
                # D1: Use re_flags from rule config
                if re.search(pattern, content, re_flags):
                    false_positive += 1
                else:
                    true_negative += 1
            except Exception:
                pass

        # Calculate precision: TP / (TP + FP)
        if true_positive + false_positive == 0:
            # No matches at all - could be too narrow
            if true_positive == 0 and false_negative > 0:
                return 0.50  # Rule doesn't match any positive samples
            return 0.75  # No data to judge

        precision = true_positive / (true_positive + false_positive)

        # Also factor in recall for a more balanced score
        # Recall = TP / (TP + FN)
        if true_positive + false_negative > 0:
            recall = true_positive / (true_positive + false_negative)
            # F1 score as final metric
            if precision + recall > 0:
                f1 = 2 * (precision * recall) / (precision + recall)
                return round(f1, 2)

        return round(precision, 2)

    else:
        # Fallback: heuristic based on match ratio (legacy behavior)
        total_files = 0
        match_count = 0

        # D4: Single traversal instead of per-extension rglob
        for f in test_path.rglob('*'):
            if not f.is_file() or f.suffix not in ('.md', '.yaml', '.yml', '.txt', '.json'):
                continue
            total_files += 1
            try:
                content = f.read_text(encoding='utf-8', errors='ignore')
                # D1: Use re_flags from rule config
                if re.search(pattern, content, re_flags):
                    match_count += 1
            except Exception:
                pass

        if total_files == 0:
            return 0.75

        match_ratio = match_count / total_files

        if 0.10 <= match_ratio <= 0.30:
            return 0.85
        elif 0.30 < match_ratio <= 0.50:
            return 0.75
        elif match_ratio < 0.10:
            return 0.70
        else:  # > 0.50
            return 0.60


def main():
    if len(sys.argv) < 2:
        print("Usage: yaml_parser.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'parse':
        if len(sys.argv) < 3:
            print("Usage: yaml_parser.py parse <file.yaml>", file=sys.stderr)
            sys.exit(1)
        result = parse_yaml_file(sys.argv[2])
        print(json.dumps(result))

    elif cmd == 'load-rules':
        if len(sys.argv) < 4:
            print("Usage: yaml_parser.py load-rules <domain> <dir>", file=sys.stderr)
            sys.exit(1)
        rules = load_rules_from_directory(sys.argv[2], sys.argv[3])
        print(json.dumps(rules))

    elif cmd == 'calculate-precision':
        if len(sys.argv) < 4:
            print("Usage: yaml_parser.py calculate-precision <rule.yaml> <test_dir>", file=sys.stderr)
            sys.exit(1)
        precision = calculate_precision(sys.argv[2], sys.argv[3])
        print(f"{precision:.2f}")

    elif cmd == 'sanitize':
        if len(sys.argv) < 4:
            print("Usage: yaml_parser.py sanitize <pattern> <rule_id>", file=sys.stderr)
            sys.exit(1)
        is_safe, reason = sanitize_pattern(sys.argv[2], sys.argv[3])
        print(json.dumps({"safe": is_safe, "reason": reason}))

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
