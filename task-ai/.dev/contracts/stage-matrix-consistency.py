#!/usr/bin/env python3
"""L1: Cross-validate state-matrix.md against individual SKILL.md State Transitions.

Checks:
  1. Every transition in state-matrix for target matches target/SKILL.md
  2. Every transition in state-matrix for plan matches plan/SKILL.md
  3. Every transition in state-matrix for cancel matches cancel/SKILL.md
  4. Every transition in state-matrix for annotate matches annotate/SKILL.md
  5. state-matrix target column includes evolving → planning
  6. state-matrix cancel column includes evolving → cancelled
  7. state-matrix report column is available for evolving
"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, parse_md_table, extract_section, summary, TASK_AI_ROOT

# Parse state matrix
matrix_text = (TASK_AI_ROOT / 'commands' / 'references' / 'state-matrix.md').read_text()
matrix_lines = [l for l in matrix_text.split('\n') if l.strip().startswith('|')]

# Extract column headers
header_line = matrix_lines[0] if matrix_lines else ''
headers = [c.strip() for c in header_line.split('|') if c.strip()]

# Parse matrix rows
def parse_matrix():
    """Return dict: state -> dict: command -> cell_value"""
    rows = {}
    for line in matrix_lines[2:]:  # skip header + separator
        cells = [c.strip() for c in line.split('|') if c.strip()]
        if not cells:
            continue
        state = cells[0].strip('` ')
        row = {}
        for i, cell in enumerate(cells[1:], 1):
            if i < len(headers):
                row[headers[i]] = cell
        rows[state] = row
    return rows

matrix = parse_matrix()

# --- Test 1: state-matrix target matches target/SKILL.md ---
target_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md', '## State Transitions'
)
target_rows = parse_md_table(target_transitions)
target_reject_states = {r['Current Status'].strip('` ') for r in target_rows
                        if 'REJECT' in r.get('Result', '')}
target_transition_states = {r['Current Status'].strip('` ') for r in target_rows
                            if 'REJECT' not in r.get('Result', '')}

# Check that matrix reflects target transitions
matrix_target_col = {state: cell for state, row in matrix.items()
                     if 'target' in row for cell in [row['target']]}
mismatches = []
for state in target_reject_states:
    if state in matrix_target_col and '⊘' not in matrix_target_col[state]:
        mismatches.append(f'{state}: SKILL says REJECT but matrix says {matrix_target_col[state]}')
for state in target_transition_states:
    if state in matrix_target_col and '⊘' in matrix_target_col[state]:
        mismatches.append(f'{state}: SKILL has transition but matrix says ⊘')

if not mismatches:
    emit_pass('state-matrix target column consistent with target/SKILL.md')
else:
    emit_fail(f'state-matrix target inconsistencies: {"; ".join(mismatches)}')

# --- Test 2: state-matrix plan matches plan/SKILL.md ---
plan_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md', '## State Transitions'
)
plan_rows = parse_md_table(plan_transitions)
plan_reject_states = {r['Current Status'].strip('` ') for r in plan_rows
                      if 'REJECT' in r.get('After Plan', '')}

mismatches = []
for state in plan_reject_states:
    if state in matrix and 'plan' in matrix[state]:
        cell = matrix[state]['plan']
        if '⊘' not in cell:
            mismatches.append(f'{state}: plan SKILL says REJECT but matrix says {cell}')

if not mismatches:
    emit_pass('state-matrix plan column consistent with plan/SKILL.md')
else:
    emit_fail(f'state-matrix plan inconsistencies: {"; ".join(mismatches)}')

# --- Test 3: state-matrix cancel matches cancel/SKILL.md ---
cancel_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'cancel' / 'SKILL.md', '## State Transitions'
)
cancel_rows = parse_md_table(cancel_transitions)
cancel_states = {r['Current Status'].strip('` ') for r in cancel_rows
                 if 'cancelled' in r.get('After Cancel', '')}
cancel_reject = {r['Current Status'].strip('` ') for r in cancel_rows
                 if 'REJECT' in r.get('After Cancel', '')}

mismatches = []
for state in cancel_states:
    if state in matrix and 'cancel' in matrix[state]:
        cell = matrix[state]['cancel']
        if 'cancelled' not in cell and '⊘' in cell:
            mismatches.append(f'{state}: cancel SKILL transitions but matrix has ⊘')

if not mismatches:
    emit_pass('state-matrix cancel column consistent with cancel/SKILL.md')
else:
    emit_fail(f'state-matrix cancel inconsistencies: {"; ".join(mismatches)}')

# --- Test 4: state-matrix annotate matches annotate/SKILL.md ---
annotate_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'annotate' / 'SKILL.md', '## State Transitions'
)
annotate_rows = parse_md_table(annotate_transitions)
annotate_reject_states = {r['Current Status'].strip('` ') for r in annotate_rows
                          if 'REJECT' in r.get('After Annotate', '')}

mismatches = []
for state in annotate_reject_states:
    if state in matrix and 'annotate' in matrix[state]:
        cell = matrix[state]['annotate']
        if '⊘' not in cell:
            mismatches.append(f'{state}: annotate SKILL says REJECT but matrix says {cell}')

if not mismatches:
    emit_pass('state-matrix annotate column consistent with annotate/SKILL.md')
else:
    emit_fail(f'state-matrix annotate inconsistencies: {"; ".join(mismatches)}')

# --- Test 5: state-matrix target shows evolving → planning ---
if 'evolving' in matrix and 'target' in matrix['evolving']:
    cell = matrix['evolving']['target']
    if 'planning' in cell:
        emit_pass('state-matrix: evolving + target → planning')
    else:
        emit_fail(f'state-matrix: evolving + target cell = "{cell}", expected planning')
else:
    emit_fail('state-matrix: evolving row or target column not found')

# --- Test 6: state-matrix cancel shows evolving → cancelled ---
if 'evolving' in matrix and 'cancel' in matrix['evolving']:
    cell = matrix['evolving']['cancel']
    if 'cancelled' in cell:
        emit_pass('state-matrix: evolving + cancel → cancelled')
    else:
        emit_fail(f'state-matrix: evolving + cancel cell = "{cell}", expected cancelled')
else:
    emit_fail('state-matrix: evolving row or cancel column not found')

# --- Test 7: state-matrix report available for evolving ---
if 'evolving' in matrix and 'report' in matrix['evolving']:
    cell = matrix['evolving']['report']
    if '⊘' not in cell:
        emit_pass('state-matrix: evolving + report is available (not rejected)')
    else:
        emit_fail('state-matrix: evolving + report is rejected (should be available)')
else:
    emit_fail('state-matrix: evolving row or report column not found')

sys.exit(summary())
