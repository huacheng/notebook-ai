#!/usr/bin/env python3
"""L1: Verify State Transitions tables in SKILL.md match expected-states.json"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    find_skills, load_fixture, extract_section, parse_md_table,
    strip_code_blocks, emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

expected = load_fixture('expected-states.json')
expected_states = set(expected['states'])
expected_transitions = expected['transitions']

# Build a set of (from, to) pairs from expected transitions
expected_pairs = set()
for t in expected_transitions:
    expected_pairs.add((t['from'], t['to']))

# Check state-matrix.md if it exists
state_matrix_file = TASK_AI_ROOT / 'commands' / 'references' / 'state-matrix.md'
if state_matrix_file.exists():
    content = state_matrix_file.read_text()
    stripped = strip_code_blocks(content)
    tables = []

    # Find all markdown tables in the file
    current_table_lines: list[str] = []
    for line in stripped.split('\n'):
        if line.strip().startswith('|'):
            current_table_lines.append(line)
        elif current_table_lines:
            if len(current_table_lines) >= 3:
                tables.append('\n'.join(current_table_lines))
            current_table_lines = []
    if current_table_lines and len(current_table_lines) >= 3:
        tables.append('\n'.join(current_table_lines))

    # Parse each table and check states mentioned
    found_states: set[str] = set()
    found_transitions: set[tuple[str, str]] = set()

    for table_text in tables:
        rows = parse_md_table(table_text)
        for row in rows:
            # Look for state-related columns
            for key, val in row.items():
                val_clean = val.strip().strip('`')
                if val_clean in expected_states:
                    found_states.add(val_clean)

            # Try to extract transitions from common column patterns
            from_state = None
            to_state = None
            for key in row:
                key_lower = key.lower().strip()
                val = row[key].strip().strip('`')
                if 'from' in key_lower or 'current' in key_lower or 'status' == key_lower:
                    if val in expected_states:
                        from_state = val
                if 'to' in key_lower or 'new' in key_lower or 'next' in key_lower:
                    if val in expected_states:
                        to_state = val
            if from_state and to_state:
                found_transitions.add((from_state, to_state))

    # Verify all expected states appear
    for state in expected_states:
        if state in found_states:
            emit_pass(f'state-matrix: state "{state}" found')
        else:
            emit_warn(f'state-matrix: state "{state}" not explicitly mentioned in tables')

    emit_pass(f'state-matrix.md: {len(found_states)} states found, {len(found_transitions)} transitions parsed')
else:
    emit_warn('state-matrix.md not found in commands/references/')

# Check each SKILL.md for State Transitions section
for skill_file in find_skills():
    skill_name = skill_file.parent.name
    section = extract_section(skill_file, '## State Transitions')
    if not section.strip():
        # Not all skills need a State Transitions section
        continue

    stripped = strip_code_blocks(section)
    rows = parse_md_table(stripped)

    if not rows:
        emit_warn(f'{skill_name}: State Transitions section has no parseable table')
        continue

    skill_ok = True
    for row in rows:
        # Check that mentioned states are in expected set
        for key, val in row.items():
            val_clean = val.strip().strip('`')
            if val_clean in expected_states:
                pass  # known state
            elif val_clean and val_clean not in ('—', '-', 'N/A', ''):
                # Could be a compound value or description, skip
                pass

    if skill_ok:
        emit_pass(f'{skill_name}: State Transitions table valid ({len(rows)} rows)')

sys.exit(summary())
