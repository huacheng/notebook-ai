#!/usr/bin/env python3
"""L2: Verify test-strategy-by-type.md exists and is referenced consistently."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

REF_FILE = TASK_AI_ROOT / 'commands' / 'references' / 'test-strategy-by-type.md'
AUDIT_FILE = TASK_AI_ROOT / 'skills' / 'check' / 'references' / 'six-dimension-audit.md'
PLAN_SKILL = TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md'
VERIFY_SKILL = TASK_AI_ROOT / 'skills' / 'verify' / 'SKILL.md'
REF_INDEX = TASK_AI_ROOT / 'REFERENCE-INDEX.md'

# T1: test-strategy-by-type.md exists
if REF_FILE.exists():
    emit_pass('T1: test-strategy-by-type.md exists')
else:
    emit_fail('T1: test-strategy-by-type.md does not exist')

# T2: contains Strategy Matrix with required task-type rows
if REF_FILE.exists():
    content = REF_FILE.read_text()
    required_types = ['software', 'ai-skill', 'documentation', 'data-pipeline']
    has_table = '## Strategy Matrix' in content
    has_rows = all(t in content for t in required_types)
    if has_table and has_rows:
        emit_pass('T2: Strategy Matrix contains all required task-type rows')
    else:
        missing = [t for t in required_types if t not in content]
        emit_fail(f'T2: Strategy Matrix missing table={not has_table} rows={missing}')
else:
    emit_fail('T2: Strategy Matrix — file does not exist')

# T3: contains Test Classification Rules with required categories
if REF_FILE.exists():
    content = REF_FILE.read_text()
    required_cats = ['Runtime code', 'Spec text', 'Fixture data']
    has_table = '## Test Classification Rules' in content
    has_rows = all(c in content for c in required_cats)
    if has_table and has_rows:
        emit_pass('T3: Test Classification Rules contains all required categories')
    else:
        missing = [c for c in required_cats if c not in content]
        emit_fail(f'T3: Classification Rules missing table={not has_table} rows={missing}')
else:
    emit_fail('T3: Test Classification Rules — file does not exist')

# T4: plan/SKILL.md references test-strategy-by-type.md (not check/SKILL.md)
if PLAN_SKILL.exists():
    plan_text = PLAN_SKILL.read_text()
    refs_new = 'test-strategy-by-type.md' in plan_text
    refs_old = 'check/SKILL.md' in plan_text and 'Task-Type-Aware' in plan_text
    if refs_new and not refs_old:
        emit_pass('T4: plan/SKILL.md references test-strategy-by-type.md')
    elif refs_old:
        emit_fail('T4: plan/SKILL.md still references check/SKILL.md Task-Type-Aware')
    else:
        emit_fail('T4: plan/SKILL.md does not reference test-strategy-by-type.md')
else:
    emit_fail('T4: plan/SKILL.md not found')

# T5: six-dimension-audit.md Regression Test Protocol references
#     test-strategy-by-type.md (table not inlined)
if AUDIT_FILE.exists():
    audit_text = AUDIT_FILE.read_text()
    refs_new = 'test-strategy-by-type.md' in audit_text
    # Check that the inline Strategy Matrix table is removed:
    # the old table had column headers "Code/Script Fix" and "Spec/SKILL.md Fix"
    has_inline_matrix = 'Code/Script Fix' in audit_text and 'Spec/SKILL.md Fix' in audit_text
    if refs_new and not has_inline_matrix:
        emit_pass('T5: six-dimension-audit.md references shared file, inline table removed')
    elif not refs_new:
        emit_fail('T5: six-dimension-audit.md does not reference test-strategy-by-type.md')
    else:
        emit_fail('T5: six-dimension-audit.md still has inline Strategy Matrix table')
else:
    emit_fail('T5: six-dimension-audit.md not found')

# T6: REFERENCE-INDEX.md contains test-strategy-by-type.md entry
if REF_INDEX.exists():
    idx_text = REF_INDEX.read_text()
    if 'test-strategy-by-type.md' in idx_text:
        emit_pass('T6: REFERENCE-INDEX.md contains test-strategy-by-type.md entry')
    else:
        emit_fail('T6: REFERENCE-INDEX.md missing test-strategy-by-type.md entry')
else:
    emit_fail('T6: REFERENCE-INDEX.md not found')

# T7: verify/SKILL.md contains test-strategy-by-type.md reference
if VERIFY_SKILL.exists():
    verify_text = VERIFY_SKILL.read_text()
    if 'test-strategy-by-type.md' in verify_text:
        emit_pass('T7: verify/SKILL.md references test-strategy-by-type.md')
    else:
        emit_fail('T7: verify/SKILL.md does not reference test-strategy-by-type.md')
else:
    emit_fail('T7: verify/SKILL.md not found')

sys.exit(summary())
