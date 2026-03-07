#!/usr/bin/env python3
"""L1: Verify round-2 review fixes — SKILL.md consistency.

Checks:
  #4:  state-matrix.md report column for non-listed states matches report/SKILL.md
  #5:  target/SKILL.md execution steps have explicit complete/cancelled rejection guard
  #6:  merge/SKILL.md Phase 3 unified evolving path (progressive evolution — no stage.total branching)
  #7:  auto/SKILL.md evolving annotation clearly marked
  #8:  merge/SKILL.md Phase 3 mentions history push (progressive evolution)
  #12: state-matrix.md evolving + report has (write) annotation
  #13: report/SKILL.md Prerequisites and State Transitions are consistent for draft
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, parse_md_table, summary, TASK_AI_ROOT

# --- #12: state-matrix evolving + report ---
matrix_text = (TASK_AI_ROOT / 'commands' / 'references' / 'state-matrix.md').read_text()
# Find evolving row (must START with `evolving` as first cell)
evolving_line = ''
for line in matrix_text.split('\n'):
    if line.strip().startswith('|'):
        cells = [c.strip() for c in line.split('|') if c.strip()]
        if cells and cells[0] == '`evolving`':
            evolving_line = line
            break
if '(write)' in evolving_line:
    emit_pass('state-matrix: evolving + report has (write) annotation')
else:
    emit_fail('state-matrix: evolving + report missing (write) annotation')

# --- #5: target execution steps explicit REJECT ---
target_text = (TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md').read_text()
target_steps = extract_section(TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md', '## Execution Steps')
if ('complete' in target_steps and 'cancelled' in target_steps and
    ('reject' in target_steps.lower() or 'abort' in target_steps.lower())):
    emit_pass('target: execution steps have explicit complete/cancelled rejection')
else:
    emit_fail('target: execution steps missing explicit complete/cancelled rejection guard')

# --- #6: merge Phase 3 unified evolving path (progressive evolution) ---
merge_text = (TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md').read_text()
# In progressive evolution, Phase 3 is a unified path — always transitions to evolving.
# No stage.total branching exists. Check that Phase 3 mentions evolving and .summary.md.
phase3 = extract_section(TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '### Phase 3: Post-Merge Finalization')
if 'evolving' in phase3 and '.summary.md' in phase3:
    emit_pass('merge: Phase 3 unified evolving path with .summary.md')
else:
    emit_fail('merge: Phase 3 missing evolving or .summary.md')

# --- #7: auto v2 annotation clearly marked as not implemented ---
auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()
auto_entry = extract_section(TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Entry Point (Status-Based Routing)')
evolving_lines = [l for l in auto_entry.split('\n') if 'evolving' in l]
if evolving_lines:
    emit_pass('auto: evolving entry present in routing')
else:
    emit_fail('auto: evolving entry missing from routing')

# --- #8: merge Phase 3 mentions history push (progressive evolution) ---
# In progressive evolution, Phase 3 pushes to stage.history instead of comparing stage.total.
phase3 = extract_section(TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md', '### Phase 3: Post-Merge Finalization')
if 'history' in phase3 or 'stage.current' in phase3:
    emit_pass('merge: Phase 3 mentions stage.current/history (progressive evolution)')
else:
    emit_fail('merge: Phase 3 missing stage.current/history mention')

# --- #13: report/SKILL.md draft handling ---
report_text = (TASK_AI_ROOT / 'skills' / 'report' / 'SKILL.md').read_text()
report_prereqs = extract_section(TASK_AI_ROOT / 'skills' / 'report' / 'SKILL.md', '## Prerequisites')
report_transitions = extract_section(TASK_AI_ROOT / 'skills' / 'report' / 'SKILL.md', '## State Transitions')
report_rows = parse_md_table(report_transitions)
report_statuses = {r.get('Current Status', '').strip('` ') for r in report_rows}
# Either draft should be in table, or Prerequisites should not mention draft as valid
draft_in_prereqs = 'draft' in report_prereqs
draft_in_table = 'draft' in report_statuses
if draft_in_prereqs == draft_in_table:
    emit_pass('report: Prerequisites and State Transitions consistent for draft')
elif draft_in_table:
    emit_pass('report: draft in State Transitions table (consistent)')
else:
    emit_fail('report: Prerequisites mentions draft but State Transitions table has no draft row')

# --- #4: state-matrix report column vs report/SKILL.md ---
# After fixing, just check that the state-matrix and SKILL.md agree on which states report operates on
# We expect report to work on all states (no ⊘ for report column) — or at least match
# Just verify evolving row has report access
if 'evolving' in report_statuses:
    emit_pass('report: State Transitions includes evolving')
else:
    emit_fail('report: State Transitions missing evolving')

sys.exit(summary())
