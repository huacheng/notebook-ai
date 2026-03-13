#!/usr/bin/env python3
"""L2: Check .auto-signal field names — detect old tdd->vfp residual field names"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    find_skills, find_all_md, strip_code_blocks,
    emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

# Old field names that should be replaced
OLD_FIELD_NAMES = {
    'tdd_cycles_completed': 'vfp_cycles_completed',
}

# Expected current field names
EXPECTED_FIELDS = {
    'step', 'result', 'next', 'checkpoint',
    'iteration', 'compaction_count', 'vfp_cycles_completed', 'timestamp'
}

# Scan all .md files for old field name references
for md_file in find_all_md():
    rel_path = md_file.relative_to(TASK_AI_ROOT)

    # Skip .dev/ files
    if '.dev' in str(rel_path):
        continue

    content = strip_code_blocks(md_file.read_text())

    for old_name, new_name in OLD_FIELD_NAMES.items():
        if old_name in content:
            # Count occurrences
            count = content.count(old_name)
            emit_fail(f'{rel_path}: old field name "{old_name}" found ({count}x) — should be "{new_name}"')
        # Don't emit pass for each file (too noisy)

# Also verify that auto SKILL.md uses correct field names
auto_skill = TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md'
if auto_skill.exists():
    content = auto_skill.read_text()  # Include code blocks for JSON examples
    for old_name, new_name in OLD_FIELD_NAMES.items():
        if old_name in content:
            emit_fail(f'auto/SKILL.md: uses old field "{old_name}" — should be "{new_name}"')
        else:
            emit_pass(f'auto/SKILL.md: does not use old field "{old_name}"')

    # Check expected fields are documented
    for field in EXPECTED_FIELDS:
        if field in content:
            emit_pass(f'auto/SKILL.md: documents field "{field}"')
        elif field == 'vfp_cycles_completed':
            emit_fail(f'auto/SKILL.md: missing field "{field}" (VFP upgrade pending)')

# Check auto references
auto_refs_dir = TASK_AI_ROOT / 'skills' / 'auto' / 'references'
if auto_refs_dir.exists():
    for ref_file in auto_refs_dir.glob('*.md'):
        content = ref_file.read_text()
        for old_name, new_name in OLD_FIELD_NAMES.items():
            if old_name in content:
                emit_fail(f'auto/references/{ref_file.name}: old field "{old_name}" — should be "{new_name}"')

sys.exit(summary())
