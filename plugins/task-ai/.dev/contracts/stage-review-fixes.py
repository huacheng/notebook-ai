#!/usr/bin/env python3
"""L1: Verify six-dimension review fix — SKILL.md State Transitions table completeness.

Checks:
  1. target State Transitions contains review, re-planning, blocked, complete, cancelled rows
  2. cancel State Transitions contains evolving row
  3. report State Transitions contains evolving row; Prerequisites mentions evolving
  4. plan State Transitions contains evolving REJECT row
  5. annotate State Transitions contains evolving REJECT row
  6. expected-states.json contains target-initiated draft→planning, review→re-planning, blocked→planning transitions
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, parse_md_table, load_fixture, summary, TASK_AI_ROOT

# --- Test 1: target State Transitions completeness ---
target_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md', '## State Transitions'
)
target_rows = parse_md_table(target_transitions)
target_statuses = {r.get('Current Status', '').strip('` ') for r in target_rows}

missing = {'review', 're-planning', 'blocked', 'satisfied', 'cancelled'} - target_statuses
if not missing:
    emit_pass('target: State Transitions has review/re-planning/blocked/satisfied/cancelled rows')
else:
    emit_fail(f'target: State Transitions missing rows for: {", ".join(sorted(missing))}')

# --- Test 2: cancel State Transitions has evolving ---
cancel_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'cancel' / 'SKILL.md', '## State Transitions'
)
cancel_rows = parse_md_table(cancel_transitions)
cancel_statuses = {r.get('Current Status', '').strip('` ') for r in cancel_rows}

if 'evolving' in cancel_statuses:
    emit_pass('cancel: State Transitions has evolving row')
else:
    emit_fail('cancel: State Transitions missing evolving row')

# --- Test 3: report State Transitions has evolving; Prerequisites mentions evolving ---
report_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'report' / 'SKILL.md', '## State Transitions'
)
report_rows = parse_md_table(report_transitions)
report_statuses = {r.get('Current Status', '').strip('` ') for r in report_rows}

report_prereqs = extract_section(
    TASK_AI_ROOT / 'skills' / 'report' / 'SKILL.md', '## Prerequisites'
)

if 'evolving' in report_statuses:
    emit_pass('report: State Transitions has evolving row')
else:
    emit_fail('report: State Transitions missing evolving row')

if 'evolving' in report_prereqs:
    emit_pass('report: Prerequisites mentions evolving')
else:
    emit_fail('report: Prerequisites missing evolving mention')

# --- Test 4: plan State Transitions has evolving REJECT ---
plan_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md', '## State Transitions'
)
plan_rows = parse_md_table(plan_transitions)
plan_stage_done = [r for r in plan_rows if r.get('Current Status', '').strip('` ') == 'evolving']

if plan_stage_done and 'REJECT' in plan_stage_done[0].get('After Plan', ''):
    emit_pass('plan: State Transitions has evolving REJECT row')
else:
    emit_fail('plan: State Transitions missing evolving REJECT row')

# --- Test 5: annotate State Transitions has evolving REJECT ---
# annotate uses "## State Transitions — Two-Dimensional" with sub-tables per layer.
# The evolving REJECT row is in the Requirement Layer sub-table.
annotate_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'annotate' / 'SKILL.md',
    '### Requirement Layer — `.target.md`'
)
annotate_rows = parse_md_table(annotate_transitions)
annotate_stage_done = [
    r for r in annotate_rows
    if 'evolving' in r.get('Current Status', '')
]

if annotate_stage_done and any(
    'REJECT' in v for v in annotate_stage_done[0].values()
):
    emit_pass('annotate: State Transitions has evolving REJECT row')
else:
    emit_fail('annotate: State Transitions missing evolving REJECT row')

# --- Test 6: expected-states.json has target-initiated transitions ---
states_data = load_fixture('expected-states.json')
transitions = states_data.get('transitions', [])

def has_transition(from_s, to_s, via_contains):
    return any(
        t['from'] == from_s and t['to'] == to_s and via_contains in t.get('via', '')
        for t in transitions
    )

# draft→planning via target
if has_transition('draft', 'planning', 'target'):
    emit_pass('expected-states: has draft→planning via target')
else:
    emit_fail('expected-states: missing draft→planning via target')

# review→re-planning via target
if has_transition('review', 're-planning', 'target'):
    emit_pass('expected-states: has review→re-planning via target')
else:
    emit_fail('expected-states: missing review→re-planning via target')

# blocked→planning via target
if has_transition('blocked', 'planning', 'target'):
    emit_pass('expected-states: has blocked→planning via target')
else:
    emit_fail('expected-states: missing blocked→planning via target')

sys.exit(summary())
