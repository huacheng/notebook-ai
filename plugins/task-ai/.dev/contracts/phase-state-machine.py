#!/usr/bin/env python3
"""L2: Verify phase field transitions are consistent across plan/check/exec SKILL.md"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    find_skills, extract_section, strip_code_blocks, parse_md_table,
    emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

# Phase sub-states expected: "", "needs-plan", "needs-check"
EXPECTED_PHASES = {'', 'needs-plan', 'needs-check'}

# Collect phase mentions from relevant skills
phase_setters: dict[str, set[str]] = {}  # skill -> set of phase values set
phase_consumers: dict[str, set[str]] = {}  # skill -> set of phase values consumed/checked

for skill_file in find_skills():
    skill_name = skill_file.parent.name
    content = strip_code_blocks(skill_file.read_text())

    # Look for phase-related mentions
    phase_mentions: set[str] = set()

    for line in content.split('\n'):
        line_lower = line.lower()
        # Look for phase value mentions
        for phase in ['needs-plan', 'needs-check']:
            if phase in line_lower or f'`{phase}`' in line:
                phase_mentions.add(phase)

        # Look for "phase" field setting patterns
        if 'phase' in line_lower:
            if 'set' in line_lower or '→' in line or '->' in line or 'write' in line_lower or 'update' in line_lower:
                phase_setters.setdefault(skill_name, set()).update(phase_mentions)
            if 'check' in line_lower or 'read' in line_lower or 'if' in line_lower or 'when' in line_lower:
                phase_consumers.setdefault(skill_name, set()).update(phase_mentions)

    # Any mention counts for tracking
    if phase_mentions:
        phase_setters.setdefault(skill_name, set()).update(phase_mentions)
        phase_consumers.setdefault(skill_name, set()).update(phase_mentions)

# Verify consistency: every phase value set must be consumed somewhere
all_set_phases: set[str] = set()
all_consumed_phases: set[str] = set()

for phases in phase_setters.values():
    all_set_phases.update(phases)
for phases in phase_consumers.values():
    all_consumed_phases.update(phases)

# Check that phase values are within expected set
for phase_val in all_set_phases | all_consumed_phases:
    if phase_val in EXPECTED_PHASES:
        emit_pass(f'phase: value "{phase_val}" is valid')
    else:
        emit_warn(f'phase: unexpected value "{phase_val}"')

# Check that key skills (plan, check, exec) participate in phase management
key_skills = ['plan', 'check', 'exec']
for skill in key_skills:
    if skill in phase_setters or skill in phase_consumers:
        emit_pass(f'phase: {skill} participates in phase management')
    else:
        emit_warn(f'phase: {skill} does not mention phase sub-states')

# Check phase value balance: every set value should be consumed
for phase_val in all_set_phases:
    if phase_val in all_consumed_phases:
        emit_pass(f'phase: "{phase_val}" is both set and consumed')
    else:
        emit_warn(f'phase: "{phase_val}" is set but never consumed')

for phase_val in all_consumed_phases:
    if phase_val not in all_set_phases:
        emit_warn(f'phase: "{phase_val}" is consumed but never set')

sys.exit(summary())
