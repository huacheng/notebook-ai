#!/usr/bin/env python3
"""Round 9: ROLLBACK first-stage guard must abort before decrement.

D3-R13: First-stage guard must come BEFORE git reset and decrement,
        and must explicitly abort (not just skip git reset).
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()

# Find ROLLBACK Routing section
lines = auto_text.split('\n')
in_rollback = False
rollback_steps = []
for line in lines:
    if 'ROLLBACK Routing' in line or 'When check returns ROLLBACK' in line:
        in_rollback = True
    if in_rollback:
        rollback_steps.append(line)
    if in_rollback and line.strip().startswith('> **Safety'):
        break

rollback_text = '\n'.join(rollback_steps)

# The first-stage guard must be a numbered step BEFORE git reset
guard_pos = -1
reset_pos = -1
decrement_pos = -1
for i, line in enumerate(rollback_steps):
    if 'first-stage guard' in line.lower() or 'First-stage guard' in line:
        guard_pos = i
    if 'git reset' in line.lower() or 'Git rollback' in line:
        if guard_pos < 0:  # only count if it's not the guard line itself
            reset_pos = i
        elif i != guard_pos:
            reset_pos = i
    if 'decrement' in line.lower() or 'Decrement' in line:
        decrement_pos = i

if guard_pos > 0 and reset_pos > 0 and guard_pos < reset_pos:
    emit_pass('D3-R13: first-stage guard comes before git reset')
else:
    emit_fail(f'D3-R13: first-stage guard position ({guard_pos}) not before git reset ({reset_pos})')

# Guard must say "abort" or "skip steps" — not just "skip git reset"
if 'abort' in rollback_text.lower() or 'skip steps' in rollback_text.lower():
    emit_pass('D3-R13b: first-stage guard aborts entire ROLLBACK flow (not just git reset)')
else:
    emit_fail('D3-R13b: first-stage guard only skips git reset, does not abort ROLLBACK flow')

sys.exit(summary())
