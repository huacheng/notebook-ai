#!/usr/bin/env python3
"""Round 2: Signal validation whitelist consistency.

F8: auto/SKILL.md result whitelist must include 'satisfied'
F9: auto/SKILL.md phase whitelist should NOT include 'satisfied' (it's a status, not a phase)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()

# Find the signal validation table
lines = auto_text.split('\n')

result_line = ''
phase_line = ''
for line in lines:
    if '`result`' in line and 'Whitelist' in line:
        result_line = line
    if '`phase`' in line and 'Whitelist' in line:
        phase_line = line

# F8: result whitelist must include 'satisfied'
if 'satisfied' in result_line:
    emit_pass('F8: result whitelist includes satisfied')
else:
    emit_fail('F8: result whitelist missing satisfied')

# F9: phase whitelist should NOT include 'satisfied'
# (satisfied is a status that maps to finalization phase)
if 'satisfied' in phase_line:
    emit_fail('F9: phase whitelist incorrectly includes satisfied (should only have finalization)')
else:
    emit_pass('F9: phase whitelist does not include satisfied')

sys.exit(summary())
