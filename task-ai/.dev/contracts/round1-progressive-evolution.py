#!/usr/bin/env python3
"""Round 1: Progressive Evolution consistency — no stale stage.total/completed/--finalize references.

F1: target/SKILL.md default stage schema uses history, not completed/total
F2: target/SKILL.md no stage.total condition
F3: target/SKILL.md no instruction to update stage.total
F4: auto/SKILL.md example signal has no total field
F5: auto/SKILL.md documentation says { current } not { current, total }
F6: auto/SKILL.md validation schema has no total field
F7: plan.sh no --finalize in usage comment
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

target_text = (TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md').read_text()
auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()
plan_sh = (TASK_AI_ROOT / 'skills' / 'plan' / 'scripts' / 'plan.sh').read_text()

# F1: target default stage schema should NOT contain "total" or "completed"
if 'total: 1' in target_text or 'completed: []' in target_text:
    emit_fail('F1: target/SKILL.md default stage schema still has total/completed')
else:
    emit_pass('F1: target/SKILL.md default stage schema uses history (no total)')

# F2: target should NOT have stage.total condition
if 'stage.total' in target_text:
    emit_fail('F2: target/SKILL.md still references stage.total')
else:
    emit_pass('F2: target/SKILL.md has no stage.total references')

# F3: target should NOT instruct updating stage.total
# Check for "update.*stage.total" or "propose stages.*stage.total"
import re
if re.search(r'stage\.total', target_text):
    emit_fail('F3: target/SKILL.md still instructs updating stage.total')
else:
    emit_pass('F3: target/SKILL.md no stage.total update instructions')

# F4: auto example signal should not have "total"
# Find the example signal JSON block
example_block = auto_text[auto_text.find('"stage":'):auto_text.find('"stage":') + 100] if '"stage":' in auto_text else ''
if '"total"' in example_block:
    emit_fail('F4: auto/SKILL.md example signal still has "total" field')
else:
    emit_pass('F4: auto/SKILL.md example signal has no "total" field')

# F5: auto documentation should say { current } not { current, total }
if '{ current, total }' in auto_text or '{current, total}' in auto_text:
    emit_fail('F5: auto/SKILL.md documentation says { current, total }')
else:
    emit_pass('F5: auto/SKILL.md documentation says { current } only')

# F6: auto validation schema for stage should not have total
# Look for the validation table row for stage
stage_validation_line = [l for l in auto_text.split('\n') if '`stage`' in l and 'Object' in l]
if stage_validation_line and 'total' in stage_validation_line[0]:
    emit_fail('F6: auto/SKILL.md validation schema for stage includes total')
else:
    emit_pass('F6: auto/SKILL.md validation schema for stage has no total')

# F7: plan.sh should not reference --finalize
if '--finalize' in plan_sh:
    emit_fail('F7: plan.sh still references --finalize in comments')
else:
    emit_pass('F7: plan.sh has no --finalize reference')

sys.exit(summary())
