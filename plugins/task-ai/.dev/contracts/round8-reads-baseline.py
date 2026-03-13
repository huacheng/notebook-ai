#!/usr/bin/env python3
"""Round 8: check Reads lists must include .convergence-baseline.md for four-file anchored review.

D1-R8a: post-exec Reads must mention convergence-baseline
D1-R8b: pre-merge Reads must mention convergence-baseline
"""
import sys, re
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

check_text = (TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md').read_text()
lines = check_text.split('\n')

# Find Reads lines by locating the nearest preceding ### header
post_exec_reads = ''
pre_merge_reads = ''
for i, line in enumerate(lines):
    if line.startswith('**Reads:**') and i > 0:
        # Find nearest ### header above this line
        for j in range(i-1, max(0, i-10), -1):
            if lines[j].startswith('### '):
                if 'post-exec' in lines[j]:
                    post_exec_reads = line
                elif 'pre-merge' in lines[j]:
                    pre_merge_reads = line
                break

if 'convergence-baseline' in post_exec_reads:
    emit_pass('D1-R8a: post-exec Reads includes .convergence-baseline.md')
else:
    emit_fail('D1-R8a: post-exec Reads missing .convergence-baseline.md (four-file anchored review)')

if 'convergence-baseline' in pre_merge_reads:
    emit_pass('D1-R8b: pre-merge Reads includes .convergence-baseline.md')
else:
    emit_fail('D1-R8b: pre-merge Reads missing .convergence-baseline.md (four-file anchored review)')

sys.exit(summary())
