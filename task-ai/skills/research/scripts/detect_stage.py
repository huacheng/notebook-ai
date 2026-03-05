#!/usr/bin/env python3
import sys
import os

def detect_stage(target_md_path):
    if not os.path.exists(target_md_path):
        print(f"ERROR: file {target_md_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(target_md_path, 'r', encoding='utf-8') as f:
        t = f.read()
    
    has_ri = '## Research Insights' in t
    has_o1 = '### O1:' in t
    has_o2 = '### O2:' in t
    has_o3 = '### O3:' in t

    def get_proposed_in_section(text, start_marker, next_marker=None):
        if start_marker not in text: return False
        section = text.split(start_marker)[1]
        if next_marker and next_marker in section:
            section = section.split(next_marker)[0]
        return '[PROPOSED]' in section

    if not has_ri or not has_o1:
        print('O1')
    elif get_proposed_in_section(t, '### O1:', '### O2:' if has_o2 else None):
        print('PENDING:O1')
    elif not has_o2:
        print('O2')
    elif get_proposed_in_section(t, '### O2:', '### O3:' if has_o3 else None):
        print('PENDING:O2')
    elif not has_o3:
        print('O3')
    elif get_proposed_in_section(t, '### O3:'):
        print('PENDING:O3')
    else:
        print('COMPLETE')

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: detect_stage.py <target_md_path>", file=sys.stderr)
        sys.exit(1)
    detect_stage(sys.argv[1])
