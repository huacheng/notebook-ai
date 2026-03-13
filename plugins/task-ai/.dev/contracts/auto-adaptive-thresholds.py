#!/usr/bin/env python3
"""L1: Verify auto sub-command adaptive threshold design.

Checks:
  A1: auto/SKILL.md reads .type-profile.md for adaptive thresholds (not purely hardcoded)
  A2: auto/SKILL.md has post-loop learning step (writes execution metrics back)
  A3: type-profiling.md .type-profile.md structure includes Auto Adaptation section
  A4: auto/SKILL.md mentions fallback defaults when .type-profile.md lacks adaptation data
  A5: auto/SKILL.md context window threshold is adaptive (not fixed 82%)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

auto_text = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()
profiling_text = (TASK_AI_ROOT / 'skills' / 'plan' / 'references' / 'type-profiling.md').read_text()

# --- A1: auto reads .type-profile.md for adaptive thresholds ---
threshold_section = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Threshold & Retry Limits'
) or extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '### Threshold & Retry Limits — Adaptive'
)
if '.type-profile.md' in threshold_section or 'adaptive' in threshold_section.lower():
    emit_pass('auto: threshold section references .type-profile.md or adaptive')
else:
    emit_fail('auto: threshold section is purely hardcoded, no .type-profile.md reference')

# --- A2: auto has post-loop learning step ---
if ('post-loop learning' in auto_text.lower() or
    'execution metrics' in auto_text.lower() or
    'write.*type-profile' in auto_text.lower() or
    'update .type-profile' in auto_text.lower()):
    emit_pass('auto: has post-loop learning / execution metrics writeback')
else:
    emit_fail('auto: missing post-loop learning step (no execution metrics writeback)')

# --- A3: type-profiling.md includes Auto Adaptation section ---
if '## Auto Adaptation' in profiling_text or '### Auto Adaptation' in profiling_text:
    emit_pass('type-profiling: .type-profile.md structure includes Auto Adaptation section')
else:
    emit_fail('type-profiling: .type-profile.md structure missing Auto Adaptation section')

# --- A4: auto mentions fallback defaults ---
if ('fallback' in auto_text.lower() and 'default' in auto_text.lower() and
    '.type-profile' in auto_text):
    emit_pass('auto: mentions fallback defaults when .type-profile.md unavailable')
else:
    emit_fail('auto: missing fallback defaults for when .type-profile.md unavailable')

# --- A5: context window threshold is adaptive ---
cwm_section = extract_section(
    TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md', '## Context Window Management & Quota Handling'
)
if ('adaptive' in cwm_section.lower() or '.type-profile' in cwm_section or
    'task complexity' in cwm_section.lower()):
    emit_pass('auto: context window threshold is adaptive')
else:
    emit_fail('auto: context window threshold is fixed (not adaptive)')

sys.exit(summary())
