#!/usr/bin/env python3
import sys
import os

MAX_FILE_SIZE = 1_048_576  # 1 MB safety limit (D2)

def detect_stage(target_md_path):
    """Detect the current O-stage in .target.md and print one of:
    O1, O2, O3, PENDING:O1, PENDING:O2, PENDING:O3, or COMPLETE."""
    if not os.path.exists(target_md_path):
        print(f"ERROR: file {target_md_path} not found", file=sys.stderr)
        sys.exit(1)

    # D2: Check file size before reading to prevent memory exhaustion
    try:
        file_size = os.path.getsize(target_md_path)
        if file_size > MAX_FILE_SIZE:
            print(f"ERROR: file too large ({file_size} bytes > {MAX_FILE_SIZE})", file=sys.stderr)
            sys.exit(1)
    except OSError as e:
        print(f"ERROR: cannot stat {target_md_path}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(target_md_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except (OSError, UnicodeDecodeError) as e:
        print(f"ERROR: cannot read {target_md_path}: {e}", file=sys.stderr)
        sys.exit(1)

    has_ri = '## Research Insights' in content
    has_o1 = '### O1:' in content
    has_o2 = '### O2:' in content
    has_o3 = '### O3:' in content

    def get_proposed_in_section(text, start_marker, next_marker=None):
        if start_marker not in text:
            return False
        section = text.split(start_marker, 1)[1]
        if next_marker and next_marker in section:
            section = section.split(next_marker, 1)[0]
        return '[PROPOSED]' in section

    if not has_ri or not has_o1:
        print('O1')
    elif get_proposed_in_section(content, '### O1:', '### O2:' if has_o2 else None):
        print('PENDING:O1')
    elif not has_o2:
        print('O2')
    elif get_proposed_in_section(content, '### O2:', '### O3:' if has_o3 else None):
        print('PENDING:O2')
    elif not has_o3:
        print('O3')
    elif get_proposed_in_section(content, '### O3:'):
        print('PENDING:O3')
    else:
        print('COMPLETE')

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: detect_stage.py <target_md_path>", file=sys.stderr)
        sys.exit(1)
    detect_stage(sys.argv[1])
