#!/usr/bin/env python3
"""Round 1 D1 Correctness — verify 4 issues fixed in v2 design specs.

Tests:
  D1-1: ROLLBACK execution ownership — check renders verdict only, auto executes
        check step 10m should NOT contain 'git reset --hard' or 'trim stage.history'
  D1-2: First-stage convergence handling — check should define behavior when no previous convergence
  D1-3: Stale "signal" language removed from check ACCEPT outcome
  D1-4: progressive-target.md aligned with check dual gate (no NEEDS_FIX intermediate)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

check_text = (TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md').read_text()
progressive_text = (TASK_AI_ROOT / 'commands' / 'references' / 'progressive-target.md').read_text()

# D1-1: check step 10m should NOT execute git reset --hard (auto does that)
# Find the 10m sub-step content
lines = check_text.split('\n')
in_10m = False
step_10m_content = []
for line in lines:
    if '10m.' in line or '10m ' in line:
        in_10m = True
    elif in_10m and (line.strip().startswith('10n') or line.strip().startswith('- 10n')):
        break
    if in_10m:
        step_10m_content.append(line)
step_10m_text = '\n'.join(step_10m_content)

if 'git reset --hard' not in step_10m_text:
    emit_pass('D1-1: check step 10m does not execute git reset --hard (auto handles)')
else:
    emit_fail('D1-1: check step 10m still contains git reset --hard — should be auto\'s job')

# D1-2: First-stage convergence — should mention handling when no previous
convergence_section = extract_section(
    TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md', '## Convergence Evaluation'
)
if ('first' in convergence_section.lower() and 'stage' in convergence_section.lower() and
    ('0' in convergence_section or 'always' in convergence_section.lower() or 'pass' in convergence_section.lower())):
    emit_pass('D1-2: Convergence evaluation defines first-stage behavior')
else:
    emit_fail('D1-2: Convergence evaluation missing first-stage (no previous) handling')

# D1-3: check ACCEPT outcome should not say "signal"
# Find the post-exec outcomes table
post_exec = extract_section(
    TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md', '### 3. post-exec'
)
# Look for ACCEPT row
accept_lines = [l for l in post_exec.split('\n') if 'ACCEPT' in l and 'signal' in l.lower()]
if not accept_lines:
    emit_pass('D1-3: check ACCEPT outcome does not reference abolished signal mechanism')
else:
    emit_fail('D1-3: check ACCEPT outcome still references "signal" — should use routing language')

# D1-4: progressive-target.md should not have NEEDS_FIX intermediate for convergence
convergence_trend = extract_section(
    TASK_AI_ROOT / 'commands' / 'references' / 'progressive-target.md',
    '### Convergence Trend'
)
if 'NEEDS_FIX' not in convergence_trend:
    emit_pass('D1-4: progressive-target.md convergence trend aligned (no NEEDS_FIX intermediate)')
else:
    emit_fail('D1-4: progressive-target.md has NEEDS_FIX for convergence ≈ previous — inconsistent with check dual gate')

sys.exit(summary())
