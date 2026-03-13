#!/usr/bin/env python3
"""L3: Verify SKILL.md '§' references point to existing sections in protocol files"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    find_skills, find_references, strip_code_blocks,
    emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

# Build a map of protocol file headings
protocol_files = {}
protocol_headings: dict[str, set[str]] = {}  # filename -> set of heading texts

# Check commands/references/ for protocol files
refs_dir = TASK_AI_ROOT / 'commands' / 'references'
if refs_dir.exists():
    for ref_file in refs_dir.glob('*.md'):
        content = ref_file.read_text()
        headings: set[str] = set()
        for line in content.split('\n'):
            m = re.match(r'^(#{1,6})\s+(.+)$', line)
            if m:
                heading_text = m.group(2).strip()
                headings.add(heading_text)
                # Also add without trailing punctuation
                headings.add(heading_text.rstrip('.,:;'))
        protocol_files[ref_file.name] = ref_file
        protocol_headings[ref_file.name] = headings

# Also include skills/*/SKILL.md as referenceable files
skills_dir = TASK_AI_ROOT / 'skills'
if skills_dir.exists():
    for skill_md in skills_dir.glob('*/SKILL.md'):
        ref_key = f'{skill_md.parent.name}/SKILL.md'
        content = skill_md.read_text()
        headings = set()
        for line in content.split('\n'):
            m = re.match(r'^(#{1,6})\s+(.+)$', line)
            if m:
                heading_text = m.group(2).strip()
                headings.add(heading_text)
                headings.add(heading_text.rstrip('.,:;'))
        protocol_files[ref_key] = skill_md
        protocol_headings[ref_key] = headings

# Scan all SKILL.md files for § references
# Pattern: See `file` §section_id — captures file and section reference
see_file_pattern = re.compile(r'[Ss]ee\s+`([^`]+)`\s+§\s*([^§\n\|`]+?)(?:\s*[`|\n]|$)')
# Pattern: See protocol §section or See §section (no specific file)
see_protocol_pattern = re.compile(r'[Ss]ee\s+(?:protocol\s+)?§\s*([^§\n\|`]+?)(?:\s*[`|\n]|$)')


def match_section(section_ref: str, headings: set[str]) -> bool:
    """Check if a section reference matches any heading.

    Handles both named sections ("Cross-Impact Assessment") and
    numbered step references ("3.3" matching heading "§3.3 scope=...").
    """
    section_ref = section_ref.rstrip(')')
    # Direct match
    if section_ref in headings:
        return True
    # Numbered step reference: §3.3 should match heading containing "§3.3"
    num_match = re.match(r'^(\d+\.\d+)', section_ref)
    if num_match:
        step_num = num_match.group(1)
        prefix = f'§{step_num}'
        return any(prefix in h for h in headings)
    return False


found_refs = 0

for skill_file in find_skills():
    skill_name = skill_file.parent.name
    content = strip_code_blocks(skill_file.read_text())

    for line in content.split('\n'):
        # Pattern 1: See `file` § Section
        for m in see_file_pattern.finditer(line):
            ref_file = m.group(1).strip()
            section = m.group(2).strip()
            found_refs += 1

            if ref_file in protocol_headings:
                if match_section(section, protocol_headings[ref_file]):
                    emit_pass(f'{skill_name}: § ref "{ref_file} §{section[:30]}" found')
                else:
                    emit_fail(f'{skill_name}: § ref "{section[:60]}" NOT found in {ref_file}')
            else:
                emit_fail(f'{skill_name}: protocol file "{ref_file}" not found')

        # Pattern 2: See protocol § Section (no specific file)
        for m in see_protocol_pattern.finditer(line):
            if see_file_pattern.search(line):
                continue  # Already handled
            section = m.group(1).strip().rstrip(')')
            found_refs += 1

            # Search all protocol files AND current SKILL.md for this section
            found_in_any = False
            for fname, headings in protocol_headings.items():
                if match_section(section, headings):
                    found_in_any = True
                    break

            if found_in_any:
                emit_pass(f'{skill_name}: § ref "{section[:40]}" found in protocols')
            else:
                emit_fail(f'{skill_name}: § ref "{section[:60]}" NOT found in any protocol')

if found_refs == 0:
    emit_warn('protocol-compliance: no § references found (protocol not yet integrated)')
else:
    emit_pass(f'protocol-compliance: checked {found_refs} § references')

sys.exit(summary())
