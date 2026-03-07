#!/usr/bin/env python3
"""L1: Verify report adoption tracking loop + read injection rules evolution.

Report adoption tracking:
  R1: plan/SKILL.md records adopted experience sources
  R2: highlight/SKILL.md scope=complete updates adoption count on source experiences
  R3: report/SKILL.md Lessons Learned includes adoption summary

Read injection rules evolution:
  I1: read/SKILL.md sanitization step references evolving-rules / dynamic merge
  I2: injection-rules.md identifies itself as seed/baseline with evolution note
  I3: read/SKILL.md describes merge priority (evolved > seed)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

plan_text = (TASK_AI_ROOT / 'skills' / 'plan' / 'SKILL.md').read_text()
highlight_text = (TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md').read_text()
report_text = (TASK_AI_ROOT / 'skills' / 'report' / 'SKILL.md').read_text()
read_text = (TASK_AI_ROOT / 'skills' / 'read' / 'SKILL.md').read_text()
injection_text = (TASK_AI_ROOT / 'skills' / 'library' / 'references' / 'injection-rules.md').read_text()

# --- R1: plan records adopted experience sources ---
if ('adopted' in plan_text.lower() and 'experience' in plan_text.lower()):
    emit_pass('plan: records adopted experience sources')
else:
    emit_fail('plan: missing adopted experience source tracking')

# --- R2: highlight scope=complete updates adoption count ---
complete_section = extract_section(
    TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md',
    '### §3.5 scope=complete — Comprehensive Distillation'
) or extract_section(
    TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md', '### scope=complete'
)
if 'adoption' in complete_section.lower() or 'adopted' in complete_section.lower():
    emit_pass('highlight: scope=complete tracks adoption')
else:
    emit_fail('highlight: scope=complete missing adoption tracking')

# --- R3: report Lessons Learned includes adoption summary ---
if ('adoption' in report_text.lower() or
    ('adopted' in report_text.lower() and 'lesson' in report_text.lower())):
    emit_pass('report: Lessons Learned includes adoption summary')
else:
    emit_fail('report: Lessons Learned missing adoption summary')

# --- I1: read sanitization references evolving-rules ---
if ('evolving-rules' in read_text or 'evolving rules' in read_text.lower() or
    'dynamic' in read_text.lower() and 'rule' in read_text.lower()):
    emit_pass('read: sanitization references evolving-rules')
else:
    emit_fail('read: sanitization step has no evolving-rules reference')

# --- I2: injection-rules.md identifies as seed/baseline ---
if ('seed' in injection_text.lower() or 'baseline' in injection_text.lower()):
    emit_pass('injection-rules: identifies as seed/baseline')
else:
    emit_fail('injection-rules: not identified as seed/baseline')

# --- I3: read describes merge priority (evolved > seed) ---
if (('merge' in read_text.lower() or 'override' in read_text.lower() or
     'precedence' in read_text.lower()) and
    ('evolving' in read_text.lower() or 'active' in read_text.lower())):
    emit_pass('read: describes merge priority for evolved rules')
else:
    emit_fail('read: missing merge priority description for evolved rules')

sys.exit(summary())
