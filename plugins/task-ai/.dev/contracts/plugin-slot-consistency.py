#!/usr/bin/env python3
"""L2: Verify plugin-delegation.md Capability Slot Table matches Integration Summary"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    strip_code_blocks, extract_section,
    emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

PLUGIN_FILE = TASK_AI_ROOT / 'skills' / 'auto' / 'references' / 'plugin-delegation.md'

if not PLUGIN_FILE.exists():
    emit_fail('plugin-delegation.md not found')
    sys.exit(summary())

content = PLUGIN_FILE.read_text()
stripped = strip_code_blocks(content)

# --- Parse Capability Slot Table ---
# Find lines in the "## Capability Slot Table" section
slot_section = extract_section(PLUGIN_FILE, '## Capability Slot Table')
slot_names: set[str] = set()
wildcard_slots: set[str] = set()

for line in slot_section.splitlines():
    line = line.strip()
    if not line.startswith('|') or line.startswith('|--') or line.startswith('| Slot'):
        continue
    # Skip separator rows
    if re.match(r'^\|[\s-]+\|', line):
        continue
    cols = [c.strip() for c in line.split('|')]
    # cols[0] is empty (before first |), cols[1] is slot name
    if len(cols) >= 2:
        slot = cols[1].strip('` ')
        if slot and slot != 'Slot':
            if '*' in slot:
                wildcard_slots.add(slot)
            else:
                slot_names.add(slot)

if slot_names:
    emit_pass(f'slot-table: {len(slot_names)} named slots found: {", ".join(sorted(slot_names))}')
else:
    emit_fail('slot-table: no named slots found in Capability Slot Table')

# --- Parse Integration Summary ---
summary_section = extract_section(PLUGIN_FILE, '## Integration Summary')
summary_slots: set[str] = set()

for line in summary_section.splitlines():
    line = line.strip()
    if not line.startswith('|') or line.startswith('|--') or line.startswith('| Skill'):
        continue
    if re.match(r'^\|[\s-]+\|', line):
        continue
    cols = [c.strip() for c in line.split('|')]
    # cols[3] is the Slot(s) column
    if len(cols) >= 4:
        slot_col = cols[3].strip('` ')
        if slot_col and slot_col != 'Slot(s)':
            # Split comma-separated slots and handle backtick-wrapped names
            for s in re.split(r'[,]', slot_col):
                s = s.strip().strip('`').strip()
                if s:
                    summary_slots.add(s)

if summary_slots:
    emit_pass(f'integration-summary: {len(summary_slots)} slot references found: {", ".join(sorted(summary_slots))}')
else:
    emit_fail('integration-summary: no slot references found')

# --- Cross-check: every summary slot exists in slot table (or is wildcard) ---
for ss in sorted(summary_slots):
    if ss in slot_names:
        emit_pass(f'consistency: summary slot "{ss}" defined in slot table')
    elif any(ss.startswith(ws.replace('*', '')) for ws in wildcard_slots):
        emit_pass(f'consistency: summary slot "{ss}" matches wildcard pattern')
    else:
        emit_fail(f'consistency: summary slot "{ss}" in Integration Summary but NOT in Capability Slot Table')

# --- Cross-check: named slots that don't appear in summary (warn) ---
for sn in sorted(slot_names):
    if sn in summary_slots:
        pass  # already checked above
    else:
        emit_warn(f'consistency: slot "{sn}" defined in table but not referenced in Integration Summary')

# --- Verify Level 1 named slot count text ---
level1_section = extract_section(PLUGIN_FILE, '### Level 1: Seed Slot Check')
count_match = re.search(r'(\d+)\s+named\s+slots', level1_section)
if count_match:
    stated_count = int(count_match.group(1))
    actual_count = len(slot_names)
    if stated_count == actual_count:
        emit_pass(f'level-1-text: "{stated_count} named slots" matches actual count')
    else:
        emit_fail(f'level-1-text: states "{stated_count} named slots" but table has {actual_count}')
else:
    emit_warn('level-1-text: no "N named slots" pattern found in Level 1 section')

# --- Verify alias declarations ---
# Check that any declared aliases (e.g., "tdd is accepted as alias for vh-verification")
alias_pattern = re.compile(r'`(\w[\w-]*)`\s+is\s+accepted\s+as\s+an?\s+alias\s+for\s+`(\w[\w-]*)`')
for m in alias_pattern.finditer(stripped):
    alias_name = m.group(1)
    target_name = m.group(2)
    if target_name in slot_names:
        emit_pass(f'alias: "{alias_name}" → "{target_name}" (target exists in slot table)')
    else:
        emit_fail(f'alias: "{alias_name}" → "{target_name}" but "{target_name}" NOT in slot table')

sys.exit(summary())
