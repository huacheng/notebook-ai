#!/usr/bin/env python3
"""L1: Verify stage field documentation consistency across task-ai.

Tests:
  1. task-ai.md master doc contains stage field definition
  2. task-ai.md contains stage-done in status state machine
  3. init/SKILL.md .index.json schema includes stage field
  4. expected-states.json includes stage-done
  5. state.py VALID_STATUSES includes stage-done
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, load_fixture, summary, TASK_AI_ROOT

# --- Test 1: task-ai.md contains stage field ---
master_doc = (TASK_AI_ROOT / 'commands' / 'task-ai.md').read_text()
if '"stage"' in master_doc and 'stage.current' in master_doc and 'stage.total' in master_doc:
    emit_pass('task-ai.md: stage field documented')
else:
    emit_fail('task-ai.md: stage field not documented')

# --- Test 2: task-ai.md status table has stage-done ---
if 'stage-done' in master_doc:
    emit_pass('task-ai.md: stage-done in status state machine')
else:
    emit_fail('task-ai.md: stage-done missing from status state machine')

# --- Test 3: init/SKILL.md has stage in schema ---
init_skill = (TASK_AI_ROOT / 'skills' / 'init' / 'SKILL.md').read_text()
if '"stage"' in init_skill and '"current": 1' in init_skill and '"total": 1' in init_skill:
    emit_pass('init/SKILL.md: stage field in .index.json schema')
else:
    emit_fail('init/SKILL.md: stage field missing from .index.json schema')

# --- Test 4: expected-states.json has stage-done ---
expected = load_fixture('expected-states.json')
if 'stage-done' in expected['states']:
    emit_pass('expected-states.json: stage-done in states')
else:
    emit_fail('expected-states.json: stage-done missing')

# Check transitions
transitions_from_stage_done = [t for t in expected['transitions'] if t['from'] == 'stage-done']
transitions_to_stage_done = [t for t in expected['transitions'] if t['to'] == 'stage-done']

if len(transitions_from_stage_done) >= 2:  # -> planning, -> cancelled
    emit_pass(f'expected-states.json: {len(transitions_from_stage_done)} transitions FROM stage-done')
else:
    emit_fail(f'expected-states.json: only {len(transitions_from_stage_done)} transitions FROM stage-done (need >= 2)')

if len(transitions_to_stage_done) >= 1:  # executing -> stage-done
    emit_pass(f'expected-states.json: {len(transitions_to_stage_done)} transitions TO stage-done')
else:
    emit_fail(f'expected-states.json: no transitions TO stage-done')

# --- Test 5: state.py VALID_STATUSES ---
sys.path.insert(0, str(TASK_AI_ROOT / 'core'))
from state import VALID_STATUSES
if 'stage-done' in VALID_STATUSES:
    emit_pass('state.py: stage-done in VALID_STATUSES')
else:
    emit_fail('state.py: stage-done not in VALID_STATUSES')

# --- Test 6: Default handling documented ---
if 'default handling' in master_doc.lower() or 'Default handling' in master_doc:
    emit_pass('task-ai.md: stage default handling rule documented')
else:
    emit_fail('task-ai.md: stage default handling rule missing')

sys.exit(summary())
