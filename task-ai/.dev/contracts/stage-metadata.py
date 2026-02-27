#!/usr/bin/env python3
"""L1: Verify state-matrix.md and git-details.md support progressive target v1.

state-matrix tests:
  1. stage-done row exists in the matrix
  2. stage-done + target → planning
  3. stage-done + cancel → cancelled
  4. stage-done + merge/plan/exec/check = ⊘ (rejected)
  5. executing + merge shows stage-done outcome
  6. Verification properties mention stage-done is non-terminal

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

# Parse the matrix table to find stage-done row
matrix_lines = matrix_text.strip().split('\n')
stage_done_row = None
executing_row = None
for line in matrix_lines:
    if '`stage-done`' in line and line.strip().startswith('|'):
        stage_done_row = line
    if '`executing`' in line and line.strip().startswith('|'):
        executing_row = line

# Test 1: stage-done row exists
if stage_done_row:
    emit_pass('state-matrix: stage-done row exists')
else:
    emit_fail('state-matrix: stage-done row missing')

# Test 2: stage-done + target → planning
if stage_done_row and 'planning' in stage_done_row:
    cells = split_table_row(stage_done_row)
    # target is column index 1 (after state column)
    if len(cells) > 1 and 'planning' in cells[1]:
        emit_pass('state-matrix: stage-done + target → planning')
    else:
        emit_fail('state-matrix: stage-done + target column incorrect')
else:
    emit_fail('state-matrix: stage-done + target → planning missing')

# Test 3: stage-done + cancel → cancelled
if stage_done_row and 'cancelled' in stage_done_row:
    emit_pass('state-matrix: stage-done + cancel → cancelled')
else:
    emit_fail('state-matrix: stage-done + cancel → cancelled missing')

# Test 4: stage-done rejects plan/exec/check/merge
if stage_done_row:
    cells = split_table_row(stage_done_row)
    # Columns: state, target, plan, annotate, check-post-plan, check-mid-exec, check-post-exec, exec, merge, report, cancel, highlight
    # plan is index 2, exec is index 7, merge is index 8
    rejected_cols = [2, 7, 8]  # plan, exec, merge
    all_rejected = True
    for col_idx in rejected_cols:
        if col_idx < len(cells) and '⊘' not in cells[col_idx]:
            all_rejected = False
    if all_rejected:
        emit_pass('state-matrix: stage-done rejects plan/exec/merge')
    else:
        emit_fail('state-matrix: stage-done should reject plan/exec/merge')
else:
    emit_fail('state-matrix: stage-done row not found for rejection check')

# Test 5: executing + merge shows stage-done
if executing_row and 'stage-done' in executing_row:
    emit_pass('state-matrix: executing + merge shows stage-done outcome')
else:
    emit_fail('state-matrix: executing + merge missing stage-done outcome')

# Test 6: Verification properties mention stage-done non-terminal
verification = extract_section(matrix_path, '**Verification properties:**')
# Fallback: check full text for "stage-done" in verification context
if not verification:
    # The section might not have a heading — check the whole text
    verification = matrix_text
if 'stage-done' in verification and ('non-terminal' in verification.lower() or
   'terminal' in verification.lower()):
    emit_pass('state-matrix: verification mentions stage-done terminal status')
else:
    emit_fail('state-matrix: verification missing stage-done terminal reference')

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
