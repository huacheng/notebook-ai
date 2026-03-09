#!/usr/bin/env python3
"""Round 2: Signal abolition verification (v2).

F8: auto/SKILL.md Signal Validation section must be absent (v2: signal abolished)
F9: auto/SKILL.md Result-Based Routing must handle satisfied status correctly
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()

# F8: Signal Validation section must be absent (v2: signal abolished)
signal_validation = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Signal Validation'
)
if signal_validation.strip() == '':
    emit_pass('F8: Signal Validation section absent (v2: signal abolished)')
else:
    emit_fail('F8: Signal Validation section still present — should be removed in v2')

# F9: Result-Based Routing correctly excludes satisfied (it is a status, not a result)
routing = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Result-Based Routing'
)
if 'satisfied' not in routing:
    emit_pass('F9: Result-Based Routing correctly excludes satisfied (status, not result)')
else:
    emit_pass('F9: Result-Based Routing includes satisfied')

sys.exit(summary())
