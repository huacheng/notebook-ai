#!/usr/bin/env python3
"""Round 3: Cross-file consistency fixes.

Tests:
  D1-4R: progressive-target.md convergence table has no NEEDS_FIX intermediate
  D1-8: check skips convergence direction gate for first stage (empty history)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

# D1-4R: progressive-target.md convergence trend should NOT have NEEDS_FIX
section = extract_section(
    TASK_AI_ROOT / 'commands' / 'references' / 'progressive-target.md',
    '### Convergence Trend & Direction Gate'
)
if section and 'NEEDS_FIX' not in section:
    emit_pass('D1-4R: progressive-target.md convergence trend has no NEEDS_FIX intermediate')
elif not section:
    emit_fail('D1-4R: Could not extract Convergence Trend section')
else:
    emit_fail('D1-4R: progressive-target.md has NEEDS_FIX in convergence trend — inconsistent with check dual gate')

# D1-8: check should skip convergence gate for first stage, not just set previous=0.0
check_text = (TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md').read_text()
# Look for explicit first-stage skip logic in convergence steps
has_skip_first = ('first stage' in check_text.lower() and 'skip' in check_text.lower() and
                  'convergence' in check_text.lower())
# Alternative: look in step 10k/10n area
convergence_steps = extract_section(TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md', '## Convergence Evaluation')
has_first_stage_skip = ('first stage' in convergence_steps.lower() and
                        ('skip' in convergence_steps.lower() or 'direction gate' in convergence_steps.lower()))
if has_first_stage_skip:
    emit_pass('D1-8: check convergence evaluation skips direction gate for first stage')
else:
    emit_fail('D1-8: check convergence evaluation does not explicitly skip direction gate for first stage')

sys.exit(summary())
