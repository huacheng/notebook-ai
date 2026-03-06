#!/usr/bin/env python3
"""L1: Verify merge/auto/plan SKILL.md files support stage-done (progressive target v1).

Tests:
  merge:
    1. Phase 4 mentions stage-done branching
    2. State Transitions table includes executing -> stage-done
    3. .auto-signal table includes stage-done result
    4. Git table includes stage merge commit
  auto:
    5. Phase 4 diagram mentions stage-done
    6. Entry Point table includes stage-done row
    7. Result-Based Routing includes merge | stage-done | highlight
    8. Signal whitelist includes stage-done in result field
  plan:
    9. Execution Steps mention stage/ACTIVE awareness
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- MERGE ---
merge_text = (TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md').read_text()

# Test 1: Phase 3 stage-done branching
if 'stage-done' in merge_text and 'stage.current' in merge_text:
    emit_pass('merge: Phase 3 mentions stage-done branching')
else:
    emit_fail('merge: Phase 3 missing stage-done branching')

# Test 2: State Transitions — executing -> stage-done
# Look for stage-done in the State Transitions section
from lib import extract_section
merge_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '## State Transitions'
)
if 'stage-done' in merge_transitions:
    emit_pass('merge: State Transitions includes stage-done')
else:
    emit_fail('merge: State Transitions missing stage-done')

# Test 3: .auto-signal includes stage-done
merge_signal = extract_section(
    TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '## .auto-signal'
)
if 'stage-done' in merge_signal:
    emit_pass('merge: .auto-signal includes stage-done result')
else:
    emit_fail('merge: .auto-signal missing stage-done result')

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

# Test 5: Phase 4 diagram mentions stage-done
auto_state_machine = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '## State Machine'
)
if 'stage-done' in auto_state_machine:
    emit_pass('auto: Phase 4 diagram mentions stage-done')
else:
    emit_fail('auto: Phase 4 diagram missing stage-done')

# Test 6: Entry Point includes stage-done
auto_entry = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Entry Point (Status-Based Routing)'
)
if 'stage-done' in auto_entry:
    emit_pass('auto: Entry Point includes stage-done')
else:
    emit_fail('auto: Entry Point missing stage-done')

# Test 7: Result-Based Routing — merge | stage-done | highlight
auto_routing = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Result-Based Routing'
)
if 'stage-done' in auto_routing and 'highlight' in auto_routing:
    emit_pass('auto: Result-Based Routing includes merge stage-done -> highlight')
else:
    emit_fail('auto: Result-Based Routing missing merge stage-done -> highlight')

# Test 8: Signal whitelist includes stage-done
auto_validation = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Signal Validation'
)
if 'stage-done' in auto_validation:
    emit_pass('auto: Signal whitelist includes stage-done')
else:
    emit_fail('auto: Signal whitelist missing stage-done')

# --- PLAN ---
plan_text = (TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md').read_text()

# Test 9: plan mentions stage awareness
if ('stage' in plan_text.lower() and 'ACTIVE' in plan_text) or \
   ('stage.total' in plan_text and 'ACTIVE' in plan_text):
    emit_pass('plan: Execution Steps mention stage/ACTIVE awareness')
else:
    emit_fail('plan: Execution Steps missing stage/ACTIVE awareness')

sys.exit(summary())
