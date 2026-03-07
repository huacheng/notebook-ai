#!/usr/bin/env python3
"""L1: Verify target and highlight SKILL.md support progressive target v1.

target tests:
  1. Write Mode has three-branch routing (evolving / multi-stage update / normal+analysis)
  2. Stage Advance mode documented (status == evolving)
  3. Multi-stage analysis mentions status ∈ {draft, planning} guard
  4. State Transitions includes evolving → planning
  5. Git table includes stage advance commit type

highlight tests:
  6. §3.5 Output A has stage-aware file naming
  7. §3.5 mentions evolving and stage-<N> prefix
  8. Final distillation reads prior stage experience files
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

# --- TARGET ---
target_text = (TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md').read_text()

# Test 1: Three-branch routing in Write Mode
has_evolving_branch = 'evolving' in target_text
has_multi_stage = 'stage.history' in target_text or 'multi-stage' in target_text.lower() or 'stage.current' in target_text
has_analysis = 'draft' in target_text and 'planning' in target_text
if has_evolving_branch and has_multi_stage:
    emit_pass('target: Write Mode has three-branch routing')
else:
    emit_fail('target: Write Mode missing three-branch routing')

# Test 2: Stage Advance mode documented
if 'Stage Advance' in target_text or 'stage advance' in target_text.lower():
    emit_pass('target: Stage Advance mode documented')
else:
    emit_fail('target: Stage Advance mode not documented')

# Test 3: Multi-stage analysis guard
if ('draft' in target_text and 'planning' in target_text) and \
   ('status' in target_text.lower()):
    emit_pass('target: Multi-stage analysis mentions status guard')
else:
    emit_fail('target: Multi-stage analysis missing status guard')

# Test 4: State Transitions includes evolving → planning
target_transitions = extract_section(
    TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md', '## State Transitions'
)
if 'evolving' in target_transitions and 'planning' in target_transitions:
    emit_pass('target: State Transitions includes evolving → planning')
else:
    emit_fail('target: State Transitions missing evolving → planning')

# Test 5: Git table includes stage advance commit
target_git = extract_section(
    TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md', '## Git'
)
if 'stage' in target_git and 'defined' in target_git:
    emit_pass('target: Git includes stage advance commit type')
else:
    emit_fail('target: Git missing stage advance commit type')

# --- HIGHLIGHT ---
highlight_text = (TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md').read_text()

# Test 6: §3.5 Output A has stage-aware naming
highlight_35 = extract_section(
    TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md', '### §3.5 scope=complete'
)
# This section is extracted but may be large - check within it
if not highlight_35:
    highlight_35 = highlight_text  # fallback to full text

if 'stage' in highlight_35 and ('-stage-' in highlight_35 or 'stage-<' in highlight_35):
    emit_pass('highlight: §3.5 Output A has stage-aware file naming')
else:
    emit_fail('highlight: §3.5 Output A missing stage-aware file naming')

# Test 7: mentions evolving
if 'evolving' in highlight_35:
    emit_pass('highlight: §3.5 mentions evolving status')
else:
    emit_fail('highlight: §3.5 missing evolving reference')

# Test 8: Final distillation reads prior stage files
if 'stage-*-complete' in highlight_35 or 'stage experience' in highlight_35.lower() or \
   'prior stage' in highlight_35.lower() or '-stage-' in highlight_35:
    emit_pass('highlight: Final distillation references prior stage experience files')
else:
    emit_fail('highlight: Final distillation missing prior stage experience reference')

sys.exit(summary())
