#!/usr/bin/env python3
"""Round 4: Data ownership consistency.

Tests:
  D1-9: directory-convention.md attributes .convergence-baseline.md to target (not check)
  D1-10: check ACCEPT outcome does NOT claim to write stage.history (merge's job)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT, extract_section

# D1-9: directory-convention.md should attribute baseline to target
dir_conv = (TASK_AI_ROOT / 'commands' / 'references' / 'directory-convention.md').read_text()
# Find the line about convergence-baseline.md
baseline_lines = [l for l in dir_conv.split('\n') if 'convergence-baseline' in l]
has_target_attribution = any('target' in l.lower() for l in baseline_lines)
has_check_attribution = any('check 写入' in l or 'check writes' in l.lower() for l in baseline_lines)
if has_target_attribution and not has_check_attribution:
    emit_pass('D1-9: directory-convention.md attributes .convergence-baseline.md to target')
else:
    emit_fail('D1-9: directory-convention.md incorrectly attributes .convergence-baseline.md')

# D1-10: check ACCEPT outcome should not mention writing to stage.history
check_text = (TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md').read_text()
post_exec = extract_section(TASK_AI_ROOT / 'skills' / 'check' / 'SKILL.md', '### 3. post-exec')
# Find ACCEPT outcome row
accept_lines = [l for l in post_exec.split('\n') if 'ACCEPT' in l and '|' in l]
stage_history_in_accept = any('stage.history' in l for l in accept_lines)
if not stage_history_in_accept:
    emit_pass('D1-10: check ACCEPT outcome does not claim to write stage.history (merge handles)')
else:
    emit_fail('D1-10: check ACCEPT outcome incorrectly claims to write stage.history — merge\'s responsibility')

sys.exit(summary())
