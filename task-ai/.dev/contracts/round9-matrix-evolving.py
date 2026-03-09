#!/usr/bin/env python3
"""Round 9: state-matrix.md consistency with merge accepting evolving.

D1-R11a: evolving row, merge column must not be ⊘
D1-R11b: check post-exec ACCEPT should not reference 'signal'
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

matrix = (TASK_AI_ROOT / 'commands' / 'references' / 'state-matrix.md').read_text()
lines = matrix.split('\n')

# Find evolving row
evolving_row = ''
for line in lines:
    if line.startswith('| `evolving`'):
        evolving_row = line
        break

if evolving_row:
    # Split by | to get columns — merge is column 9 (0-indexed: state, target, plan, annotate, check-pp, check-me, check-pe, exec, merge, ...)
    cols = [c.strip() for c in evolving_row.split('|')]
    # Header: State, target, plan, annotate, check post-plan, check mid-exec, check post-exec, exec, merge, report, cancel, highlight
    # cols[0] is empty (before first |), cols[1] is state, cols[9] is merge
    merge_col = cols[9] if len(cols) > 9 else ''
    if merge_col == '⊘':
        emit_fail('D1-R11a: state-matrix.md evolving row rejects merge (⊘) — should allow')
    else:
        emit_pass('D1-R11a: state-matrix.md evolving row allows merge')
else:
    emit_fail('D1-R11a: evolving row not found in state-matrix.md')

# Check post-exec ACCEPT — should not say 'signal'
executing_row = ''
for line in lines:
    if line.startswith('| `executing`'):
        executing_row = line
        break

if executing_row:
    cols = [c.strip() for c in executing_row.split('|')]
    # check post-exec is column 7
    check_pe_col = cols[7] if len(cols) > 7 else ''
    if 'signal' in check_pe_col:
        emit_fail('D1-R11b: state-matrix.md check post-exec ACCEPT still references signal (v2 abolished)')
    else:
        emit_pass('D1-R11b: state-matrix.md check post-exec no signal reference')
else:
    emit_fail('D1-R11b: executing row not found')

sys.exit(summary())
