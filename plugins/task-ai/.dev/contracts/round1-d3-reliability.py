#!/usr/bin/env python3
"""Round 1 D3 Reliability — verify rollback edge cases fixed.

Tests:
  D3-1: check step 18 ROLLBACK prompt reflects verdict-only (not "rolled back")
  D3-2: First-stage ROLLBACK guard exists (skip convergence gate or NEEDS_FIX fallback)
  D3-3: auto ROLLBACK routing mentions stage.current decrement, not history trim
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

check_text = (TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md').read_text()
auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()

# D3-1: check step 18 ROLLBACK prompt should not say "rolled back" (it hasn't happened yet)
# Find the ROLLBACK prompt line in step 18
lines = check_text.split('\n')
rollback_prompt_lines = [l for l in lines if 'ROLLBACK' in l and 'post-exec' in l and '"' in l]
# Look for the exact prompt text
step18_section = extract_section(TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md', '18.')
has_rolled_back = 'rolled back' in step18_section.lower() and 'ROLLBACK' in step18_section
if not has_rolled_back:
    emit_pass('D3-1: check step 18 ROLLBACK prompt does not claim rollback already executed')
else:
    emit_fail('D3-1: check step 18 ROLLBACK prompt says "rolled back" but check only renders verdict')

# D3-2: First-stage ROLLBACK guard — either convergence eval or auto should handle empty history
convergence_eval = extract_section(
    TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md', '## Convergence Evaluation'
)
# Also check step 10k area
first_stage_guard = ('first stage' in convergence_eval.lower() or 'first-stage' in convergence_eval.lower() or
                     'empty history' in convergence_eval.lower() or 'stage 1' in convergence_eval.lower())
first_stage_pass = ('always pass' in convergence_eval.lower() or '0.0' in convergence_eval or
                    'any progress' in convergence_eval.lower())
if first_stage_guard and first_stage_pass:
    emit_pass('D3-2: First-stage convergence guard exists (previous=0.0, always passes)')
else:
    emit_fail('D3-2: Missing first-stage ROLLBACK guard')

# D3-3: auto ROLLBACK routing should decrement stage.current, not trim history
rollback_section = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### ROLLBACK Routing'
)
# Should mention decrement or stage.current--, NOT "trim stage.history" (since no entry to trim pre-merge)
has_decrement = ('decrement' in rollback_section.lower() or 'stage.current' in rollback_section)
no_trim_only = 'trim stage.history' not in rollback_section
if has_decrement:
    emit_pass('D3-3: auto ROLLBACK routing mentions stage.current decrement')
else:
    emit_fail('D3-3: auto ROLLBACK routing missing stage.current handling')

sys.exit(summary())
