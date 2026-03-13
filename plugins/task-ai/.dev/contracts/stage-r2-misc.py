#!/usr/bin/env python3
"""L1: Verify round-2 review fixes — init.sh, docs, tests.

Checks:
  #9:  init.sh comment accurately describes tr -d behavior (no "except" claim)
  #10: init.sh TITLE sanitization handles ANSI escape residue
  #11: init.sh grep uses -F or -qF for fixed-string matching
  #14: progressive-target.md lifecycle diagram notes simplification
  #15: highlight §3.5 context budget has priority rationale
  #17: highlight step 2 mentions priority-ordered reading
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

# --- #9: init.sh comment accuracy ---
init_sh = (TASK_AI_ROOT / 'skills' / 'init' / 'scripts' / 'init.sh').read_text()
# The comment should NOT say "except newline/tab" since tr -d [:cntrl:] strips all
lines_before_tr = ''
for i, line in enumerate(init_sh.split('\n')):
    if 'tr -d' in line:
        # Get the comment line(s) before it
        lines_before_tr = '\n'.join(init_sh.split('\n')[max(0,i-2):i+1])
        break
if 'except' in lines_before_tr.lower():
    emit_fail('init.sh: comment inaccurately says "except" for control char stripping')
else:
    emit_pass('init.sh: comment accurately describes control char stripping')

# --- #10: init.sh ANSI escape handling ---
# Should have some form of ANSI stripping (sed to remove ESC sequences or similar)
if 'sed' in init_sh and ('\\x1b' in init_sh or '\\033' in init_sh or '\\e' in init_sh or 'ESC' in init_sh) or \
   'ansi' in init_sh.lower():
    emit_pass('init.sh: TITLE sanitization handles ANSI escape sequences')
else:
    emit_fail('init.sh: TITLE sanitization missing ANSI escape handling')

# --- #11: init.sh grep -F ---
if 'grep -qF' in init_sh or 'grep -F' in init_sh:
    emit_pass('init.sh: grep uses -F for fixed-string matching')
else:
    emit_fail('init.sh: grep missing -F flag for fixed-string matching')

# --- #14: progressive-target.md notes simplification ---
prog_target = (TASK_AI_ROOT / 'commands' / 'references' / 'progressive-target.md').read_text()
if 'simplified' in prog_target.lower() or 'full loop' in prog_target.lower() or \
   'auto/SKILL.md' in prog_target:
    emit_pass('progressive-target.md: lifecycle diagram notes simplification')
else:
    emit_fail('progressive-target.md: lifecycle diagram missing simplification note')

# --- #15: highlight context budget rationale ---
highlight_35 = extract_section(
    TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md',
    '### §3.5 scope=complete — Comprehensive Distillation'
)
budget_area = highlight_35[highlight_35.lower().find('context budget'):] if 'context budget' in highlight_35.lower() else ''
if 'rationale' in budget_area.lower() or 'reason' in budget_area.lower() or \
   'outcome' in budget_area.lower() or 'distillation' in budget_area.lower():
    emit_pass('highlight: context budget priority has rationale')
else:
    emit_fail('highlight: context budget priority missing rationale')

# --- #17: highlight step 2 priority-ordered reading ---
highlight_steps = extract_section(
    TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md', '#### Complete Execution Steps'
)
if 'priority' in highlight_steps.lower() or 'budget' in highlight_steps.lower():
    emit_pass('highlight: execution step 2 mentions priority-ordered/budget-aware reading')
else:
    emit_fail('highlight: execution step 2 missing priority-ordered reading mention')

sys.exit(summary())
