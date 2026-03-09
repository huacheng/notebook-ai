#!/usr/bin/env python3
"""Round 6: Evolving transition ownership + four-file anchored review.

Tests:
  1. auto Phase 4 ACCEPT path explicitly writes stage.history (not just status→evolving)
  2. merge accepts evolving as valid prerequisite (for post-auto deliverables copy)
  3. check uses four-file anchored review (target + baseline + plan vs deliverables)
  4. auto three-file section updated to four-file
  5. plan mentions .convergence-baseline.md as input alongside .target.md
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()
merge_text = (TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md').read_text()
check_text = (TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md').read_text()
plan_text = (TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md').read_text()

# Test 1: auto Phase 4 ACCEPT path writes stage.history
phase4_section = extract_section(TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Detailed Phase Flow')
if not phase4_section:
    phase4_section = auto_text
# Look for stage.history writing in the ACCEPT path (not ROLLBACK)
# Need to find mention of stage.history near "evolving" in non-ROLLBACK context
accept_evolving_area = ''
lines = auto_text.split('\n')
for i, line in enumerate(lines):
    if 'convergence > previous' in line or 'ACCEPT' in line and 'evolving' in line:
        accept_evolving_area += '\n'.join(lines[max(0,i-2):i+10])
has_history_write = 'stage.history' in accept_evolving_area or 'stage_history' in accept_evolving_area
if has_history_write:
    emit_pass('auto: Phase 4 ACCEPT path writes stage.history')
else:
    emit_fail('auto: Phase 4 ACCEPT path does NOT write stage.history — will be lost without merge')

# Test 2: merge accepts evolving status
prereq_section = extract_section(TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '## Prerequisites')
if 'evolving' in prereq_section:
    emit_pass('merge: accepts evolving as valid prerequisite')
else:
    emit_fail('merge: only accepts executing — cannot run after auto sets evolving')

# Test 3: check uses four-file anchored review
if 'four-file' in check_text.lower() or 'Four-File' in check_text:
    emit_pass('check: uses four-file anchored review')
else:
    emit_fail('check: still uses three-file anchored review (missing .convergence-baseline.md)')

# Test 4: auto references four-file anchored review
if 'four-file' in auto_text.lower() or 'Four-File' in auto_text:
    emit_pass('auto: references four-file anchored review')
else:
    emit_fail('auto: still references three-file anchored review')

# Test 5: plan explicitly positions convergence-baseline as primary input
# Check if step listing mentions baseline alongside target
plan_steps = extract_section(TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md', '## Execution Steps')
baseline_step = '.convergence-baseline.md' in plan_steps
target_step = '.target.md' in plan_steps
if baseline_step and target_step:
    emit_pass('plan: Execution Steps reference both .target.md and .convergence-baseline.md')
else:
    missing = []
    if not target_step: missing.append('.target.md')
    if not baseline_step: missing.append('.convergence-baseline.md')
    emit_fail(f'plan: Execution Steps missing: {", ".join(missing)}')

sys.exit(summary())
