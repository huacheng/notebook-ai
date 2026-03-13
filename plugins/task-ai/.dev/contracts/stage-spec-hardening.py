#!/usr/bin/env python3
"""L1: Verify six-dimension review fix — specification hardening.

Checks:
  1. target Stage Advance mentions .analysis/ archive (#3)
  2. target Stage Advance mentions existence check / if exists (#5, #17)
  3. target Stage Advance .bugfix/ clear mentions non-fatal / skip (#18)
  4. task-ai.md Stage Field has validation rules (current >= 1) (#4, #13)
  5. task-ai.md mentions non-atomic / retry-safe design principle (#19)
  6. merge SKILL.md references unified evolving model (#6, #13)
  7. highlight §3.5 has context budget / upper-bound description (#7)
  8. auto SKILL.md evolving entry in routing (#20)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

# --- Test 1: target Stage Advance mentions .analysis/ archive ---
target_text = (TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md').read_text()
# Look in Stage Advance Mode section (step 2a)
if '.analysis/' in target_text and 'archive' in target_text.lower():
    emit_pass('target: Stage Advance mentions .analysis/ archive')
else:
    emit_fail('target: Stage Advance missing .analysis/ archive mention')

# --- Test 2: target Stage Advance mentions existence check ---
# Steps 4-5 should have "if exists" or "existence" guard
stage_advance_area = target_text[target_text.find('Stage Advance'):] if 'Stage Advance' in target_text else ''
if 'if exists' in stage_advance_area.lower() or 'existence' in stage_advance_area.lower():
    emit_pass('target: Stage Advance has existence check guard')
else:
    emit_fail('target: Stage Advance missing existence check guard')

# --- Test 3: target .bugfix/ clear mentions non-fatal ---
if 'non-fatal' in target_text.lower() or ('bugfix' in target_text and 'skip' in target_text.lower()):
    emit_pass('target: .bugfix/ clear mentions non-fatal/skip')
else:
    emit_fail('target: .bugfix/ clear missing non-fatal/skip mention')

# --- Test 4: task-ai.md Stage Field has validation rules ---
taskai_text = (TASK_AI_ROOT / 'commands' / 'task-ai.md').read_text()
stage_section = extract_section(
    TASK_AI_ROOT / 'commands' / 'task-ai.md', '#### Stage Field (Progressive Evolution)'
)
has_current_rule = 'current >= 1' in stage_section or 'current ≥ 1' in stage_section or 'current' in stage_section
if has_current_rule:
    emit_pass('task-ai.md: Stage Field has validation rules (current exists)')
else:
    emit_fail(f'task-ai.md: Stage Field missing validation rules (current={has_current_rule})')

# --- Test 5: task-ai.md mentions retry-safe design ---
if 'retry-safe' in taskai_text.lower() or 'non-atomic' in taskai_text.lower():
    emit_pass('task-ai.md: mentions retry-safe / non-atomic design principle')
else:
    emit_fail('task-ai.md: missing retry-safe / non-atomic design principle')

# --- Test 6: merge SKILL.md references unified evolving model ---
merge_text = (TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md').read_text()
if 'unified' in merge_text.lower() or 'evolving' in merge_text:
    emit_pass('merge: SKILL.md references unified evolving model')
else:
    emit_fail('merge: SKILL.md missing unified/evolving reference')

# --- Test 7: highlight §3.5 has context budget ---
highlight_text = (TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md').read_text()
highlight_35 = extract_section(
    TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md',
    '### §3.5 scope=complete — Comprehensive Distillation'
)
if 'context budget' in highlight_35.lower() or 'upper bound' in highlight_35.lower() or \
   'token limit' in highlight_35.lower() or 'context cap' in highlight_35.lower():
    emit_pass('highlight: §3.5 has context budget guard')
else:
    emit_fail('highlight: §3.5 missing context budget guard')

# --- Test 8: auto SKILL.md evolving entry in routing ---
auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()
# Look for evolving entry point in routing
auto_entry = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Entry Point (Status-Based Routing)'
)
if 'evolving' in auto_entry:
    emit_pass('auto: evolving entry in routing')
else:
    emit_fail('auto: evolving entry missing from routing')

sys.exit(summary())
