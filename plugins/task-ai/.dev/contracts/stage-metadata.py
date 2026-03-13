#!/usr/bin/env python3
"""L1: Verify state-matrix.md and git-details.md support progressive evolution.

state-matrix tests:
  1. evolving row exists in the matrix
  2. evolving + target → planning
  3. evolving + cancel → cancelled
  4. evolving rejects plan/exec/merge (⊘)
  5. executing + merge shows evolving outcome
  6. satisfied + target → planning (non-terminal)

git-details tests:
  7. Commit type table includes 'target' type with stage subject
  8. Commit examples include stage commit message
  9. Commit type table includes 'merge' type with stage subject
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, split_table_row, summary, TASK_AI_ROOT

# --- STATE-MATRIX ---
matrix_path = TASK_AI_ROOT / 'commands' / 'references' / 'state-matrix.md'
matrix_text = matrix_path.read_text()

# Parse the matrix table to find evolving row
matrix_lines = matrix_text.strip().split('\n')
evolving_row = None
executing_row = None
satisfied_row = None
for line in matrix_lines:
    if '`evolving`' in line and line.strip().startswith('|'):
        evolving_row = line
    if '`executing`' in line and line.strip().startswith('|'):
        executing_row = line
    if '`satisfied`' in line and line.strip().startswith('|'):
        satisfied_row = line

# Test 1: evolving row exists
if evolving_row:
    emit_pass('state-matrix: evolving row exists')
else:
    emit_fail('state-matrix: evolving row missing')

# Test 2: evolving + target → planning
if evolving_row and 'planning' in evolving_row:
    cells = split_table_row(evolving_row)
    # target is column index 1 (after state column)
    if len(cells) > 1 and 'planning' in cells[1]:
        emit_pass('state-matrix: evolving + target → planning')
    else:
        emit_fail('state-matrix: evolving + target column incorrect')
else:
    emit_fail('state-matrix: evolving + target → planning missing')

# Test 3: evolving + cancel → cancelled
if evolving_row and 'cancelled' in evolving_row:
    emit_pass('state-matrix: evolving + cancel → cancelled')
else:
    emit_fail('state-matrix: evolving + cancel → cancelled missing')

# Test 4: evolving rejects plan/exec/merge
if evolving_row:
    cells = split_table_row(evolving_row)
    # Columns: state, target, plan, annotate, check-post-plan, check-mid-exec, check-post-exec, exec, merge, report, cancel, highlight
    # plan is index 2, exec is index 7, merge is index 8
    rejected_cols = [2, 7, 8]  # plan, exec, merge
    all_rejected = True
    for col_idx in rejected_cols:
        if col_idx < len(cells) and '⊘' not in cells[col_idx]:
            all_rejected = False
    if all_rejected:
        emit_pass('state-matrix: evolving rejects plan/exec/merge')
    else:
        emit_fail('state-matrix: evolving should reject plan/exec/merge')
else:
    emit_fail('state-matrix: evolving row not found for rejection check')

# Test 5: executing + merge shows evolving
if executing_row and 'evolving' in executing_row:
    emit_pass('state-matrix: executing + merge shows evolving outcome')
else:
    emit_fail('state-matrix: executing + merge missing evolving outcome')

# Test 6: satisfied + target → planning (non-terminal)
if satisfied_row and 'planning' in satisfied_row:
    cells = split_table_row(satisfied_row)
    if len(cells) > 1 and 'planning' in cells[1]:
        emit_pass('state-matrix: satisfied + target → planning (non-terminal)')
    else:
        emit_fail('state-matrix: satisfied + target column incorrect')
else:
    emit_fail('state-matrix: satisfied + target → planning missing')

# --- GIT-DETAILS ---
git_path = TASK_AI_ROOT / 'commands' / 'references' / 'git-details.md'
git_text = git_path.read_text()

# Test 7: Commit type table includes target stage subject
git_table = extract_section(git_path, '## Commit Message Convention')
if 'target' in git_table and 'stage' in git_table:
    emit_pass('git-details: commit type table includes target stage reference')
else:
    emit_fail('git-details: commit type table missing target stage reference')

# Test 8: Commit examples include stage commit message
git_examples = extract_section(git_path, '## Commit Message Examples')
if 'stage' in git_examples:
    emit_pass('git-details: commit examples include stage message')
else:
    emit_fail('git-details: commit examples missing stage message')

# Test 9: Commit type table includes merge stage subject
if 'merge' in git_table and 'stage' in git_table:
    emit_pass('git-details: commit type table includes merge stage reference')
else:
    emit_fail('git-details: commit type table missing merge stage reference')

sys.exit(summary())
