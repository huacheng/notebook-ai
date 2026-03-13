#!/usr/bin/env python3
"""L3: Verify signal next values in SKILL.md match auto routing table"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    find_skills, extract_section, strip_code_blocks, parse_md_table,
    emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

# Collect all (step, result, next) tuples from individual SKILL.md files
skill_signals: list[dict] = []  # [{skill, result, next}]

for skill_file in find_skills():
    skill_name = skill_file.parent.name
    signal_section = extract_section(skill_file, '## .auto-signal')
    if not signal_section.strip():
        continue

    content = strip_code_blocks(signal_section)

    # Parse table if present
    tables_text = []
    current_lines: list[str] = []
    for line in content.split('\n'):
        if line.strip().startswith('|'):
            current_lines.append(line)
        elif current_lines:
            if len(current_lines) >= 3:
                tables_text.append('\n'.join(current_lines))
            current_lines = []
    if current_lines and len(current_lines) >= 3:
        tables_text.append('\n'.join(current_lines))

    for table_text in tables_text:
        rows = parse_md_table(table_text)
        for row in rows:
            result_val = None
            next_val = None
            for key, val in row.items():
                key_lower = key.lower().strip()
                val_clean = val.strip().strip('`')
                if 'result' in key_lower:
                    result_val = val_clean
                elif 'next' in key_lower:
                    next_val = val_clean
            if result_val and next_val:
                skill_signals.append({
                    'skill': skill_name,
                    'result': result_val,
                    'next': next_val
                })

    # Also parse JSON examples
    for m in re.finditer(r'"result"\s*:\s*"([^"]+)"', signal_section):
        result_val = m.group(1)
        # Find corresponding next
        remaining = signal_section[m.end():]
        nm = re.search(r'"next"\s*:\s*"([^"]+)"', remaining)
        if nm:
            next_val = nm.group(1)
            skill_signals.append({
                'skill': skill_name,
                'result': result_val,
                'next': next_val
            })

# Collect routing table from auto/SKILL.md
auto_skill = TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md'
routing_entries: list[dict] = []

if auto_skill.exists():
    # Try multiple section name patterns
    for heading in ['### Result-Based Routing', '## Result-Based Routing',
                    '### Routing', '## Signal Routing']:
        routing_section = extract_section(auto_skill, heading)
        if routing_section.strip():
            break

    if routing_section.strip():
        content = strip_code_blocks(routing_section)
        # Parse routing table
        current_lines = []
        for line in content.split('\n'):
            if line.strip().startswith('|'):
                current_lines.append(line)
            elif current_lines:
                if len(current_lines) >= 3:
                    rows = parse_md_table('\n'.join(current_lines))
                    for row in rows:
                        step_val = None
                        result_val = None
                        next_val = None
                        for key, val in row.items():
                            key_lower = key.lower().strip()
                            val_clean = val.strip().strip('`')
                            if 'step' in key_lower or 'current' in key_lower:
                                step_val = val_clean
                            elif 'result' in key_lower:
                                result_val = val_clean
                            elif 'next' in key_lower or 'route' in key_lower:
                                next_val = val_clean
                        if step_val and result_val and next_val:
                            routing_entries.append({
                                'step': step_val,
                                'result': result_val,
                                'next': next_val
                            })
                current_lines = []
        if current_lines and len(current_lines) >= 3:
            rows = parse_md_table('\n'.join(current_lines))
            for row in rows:
                step_val = None
                result_val = None
                next_val = None
                for key, val in row.items():
                    key_lower = key.lower().strip()
                    val_clean = val.strip().strip('`')
                    if 'step' in key_lower or 'current' in key_lower:
                        step_val = val_clean
                    elif 'result' in key_lower:
                        result_val = val_clean
                    elif 'next' in key_lower or 'route' in key_lower:
                        next_val = val_clean
                if step_val and result_val and next_val:
                    routing_entries.append({
                        'step': step_val,
                        'result': result_val,
                        'next': next_val
                    })

if not routing_entries:
    emit_warn('signal-routing: no routing table found in auto/SKILL.md')
else:
    emit_pass(f'signal-routing: found {len(routing_entries)} routing entries')

    # Build routing lookup: (step, result) -> next
    routing_lookup: dict[tuple[str, str], str] = {}
    for entry in routing_entries:
        routing_lookup[(entry['step'], entry['result'])] = entry['next']

    # Cross-validate: each SKILL.md signal should have matching routing entry
    for sig in skill_signals:
        key = (sig['skill'], sig['result'])
        if key in routing_lookup:
            if routing_lookup[key] == sig['next'] or '<caller>' in routing_lookup[key]:
                emit_pass(f'{sig["skill"]}: result "{sig["result"]}" → next "{sig["next"]}" matches routing')
            else:
                emit_fail(f'{sig["skill"]}: result "{sig["result"]}" → next "{sig["next"]}" but routing says "{routing_lookup[key]}"')
        else:
            # Routing might use partial match or wildcard
            emit_warn(f'{sig["skill"]}: result "{sig["result"]}" has no explicit routing entry')

sys.exit(summary())
