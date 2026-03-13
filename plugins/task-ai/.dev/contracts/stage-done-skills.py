#!/usr/bin/env python3
"""L1: Verify merge/auto/plan SKILL.md files support evolving (progressive evolution).

Tests:
  merge:
    1. Phase 3 mentions evolving branching
    2. State Transitions table includes executing -> evolving
    3. .auto-signal section absent (v2: signal abolished)
    4. Git table includes stage merge commit
  auto:
    5. State machine mentions evolving
    6. Entry Point table includes evolving row
    7. Result-Based Routing includes merge | evolving | highlight
    8. Signal Validation section absent (v2: signal abolished)
  plan:
    9. Execution Steps mention stage/ACTIVE awareness
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- MERGE ---
merge_text = (TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md').read_text()

# Test 1: Phase 3 evolving branching
if 'evolving' in merge_text and ('stage.history' in merge_text or 'stage.current' in merge_text):
    emit_pass('merge: Phase 3 mentions evolving branching')
else:
    emit_fail('merge: Phase 3 missing evolving branching')

# Test 2: State Transitions — executing -> evolving
from lib import extract_section
merge_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '## State Transitions'
)
if 'evolving' in merge_transitions:
    emit_pass('merge: State Transitions includes evolving')
else:
    emit_fail('merge: State Transitions missing evolving')

# Test 3: .auto-signal section must NOT exist (v2: signal abolished)
merge_signal = extract_section(
    TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '## .auto-signal'
)
if merge_signal.strip() == '':
    emit_pass('merge: .auto-signal section absent (v2: signal abolished)')
else:
    emit_fail('merge: .auto-signal section still present — should be removed in v2')

# Test 4: Git table includes stage merge commit
merge_git = extract_section(
    TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '## Git'
)
if 'stage' in merge_git and 'completed' in merge_git:
    emit_pass('merge: Git includes stage merge commit type')
else:
    emit_fail('merge: Git missing stage merge commit type')

# --- AUTO ---
auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()

# Test 5: State machine mentions evolving
auto_state_machine = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '## State Machine'
)
if 'evolving' in auto_state_machine:
    emit_pass('auto: State machine mentions evolving')
else:
    emit_fail('auto: State machine missing evolving')

# Test 6: Entry Point includes evolving
auto_entry = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Entry Point (Status-Based Routing)'
)
if 'evolving' in auto_entry:
    emit_pass('auto: Entry Point includes evolving')
else:
    emit_fail('auto: Entry Point missing evolving')

# Test 7: Result-Based Routing — check ACCEPT → highlight (v2: no merge in auto flow)
auto_routing = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Result-Based Routing'
)
if 'ACCEPT' in auto_routing and 'highlight' in auto_routing:
    emit_pass('auto: Result-Based Routing includes ACCEPT -> highlight')
else:
    emit_fail('auto: Result-Based Routing missing ACCEPT -> highlight')

# Test 8: Signal Validation section absent (v2: signal abolished)
auto_validation = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Signal Validation'
)
if auto_validation.strip() == '':
    emit_pass('auto: Signal Validation section absent (v2: signal abolished)')
else:
    emit_fail('auto: Signal Validation section still present — should be removed in v2')

# --- PLAN ---
plan_text = (TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md').read_text()

# Test 9: plan mentions stage awareness
if ('stage' in plan_text.lower() and 'ACTIVE' in plan_text) or \
   ('stage.history' in plan_text and 'ACTIVE' in plan_text):
    emit_pass('plan: Execution Steps mention stage/ACTIVE awareness')
else:
    emit_fail('plan: Execution Steps missing stage/ACTIVE awareness')

sys.exit(summary())
