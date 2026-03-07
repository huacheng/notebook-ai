#!/usr/bin/env python3
"""L1: Verify six-dimension review fix — docs, security, and consistency.

Checks:
  1. SKILL.md files with inline stage defaults reference task-ai.md (#8)
  2. commands/references/progressive-target.md exists and mentions lifecycle (#9)
  3. git-details.md init commit matches init/SKILL.md (#12)
  4. target Notes or task-ai.md mentions evolving trust / accepted risk (#14, #16)
  5. init.sh has control character filtering (#15)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

# --- Test 1: SKILL.md files reference task-ai.md for stage defaults ---
# At least 3 of the 5 SKILL.md files with inline defaults should reference task-ai.md
skills_with_stage = ['target', 'plan', 'merge', 'highlight']
ref_count = 0
for skill in skills_with_stage:
    text = (TASK_AI_ROOT / 'skills' / skill / 'SKILL.md').read_text()
    if 'task-ai.md' in text and 'stage' in text.lower():
        ref_count += 1

# init/SKILL.md defines the schema, so it's the source — doesn't need to reference
if ref_count >= 3:
    emit_pass(f'SKILL.md files: {ref_count}/4 reference task-ai.md for stage defaults')
else:
    emit_fail(f'SKILL.md files: only {ref_count}/4 reference task-ai.md for stage defaults')

# --- Test 2: progressive-target.md exists and has lifecycle ---
prog_target = TASK_AI_ROOT / 'commands' / 'references' / 'progressive-target.md'
if prog_target.exists():
    content = prog_target.read_text()
    if 'lifecycle' in content.lower() or '生命周期' in content:
        emit_pass('progressive-target.md exists and mentions lifecycle')
    else:
        emit_fail('progressive-target.md exists but missing lifecycle mention')
else:
    emit_fail('progressive-target.md does not exist')

# --- Test 3: git-details.md init commit matches init/SKILL.md ---
git_details = (TASK_AI_ROOT / 'commands' / 'references' / 'git-details.md').read_text()
init_skill = (TASK_AI_ROOT / 'skills' / 'init' / 'SKILL.md').read_text()
# Both should use "initialize notebook" (not "initialize task module")
git_has_init = 'init initialize notebook' in git_details or 'init initialize task module' in git_details
init_has_commit = 'initialize notebook' in init_skill
# They should be consistent
git_init_msg = 'initialize notebook' if 'initialize notebook' in git_details else \
               'initialize task module' if 'initialize task module' in git_details else None
init_init_msg = 'initialize notebook' if 'initialize notebook' in init_skill else None

if git_init_msg and init_init_msg and git_init_msg == init_init_msg:
    emit_pass(f'git-details.md init commit consistent with init/SKILL.md ("{git_init_msg}")')
else:
    emit_fail(f'git-details.md init commit mismatch: git-details="{git_init_msg}", init/SKILL="{init_init_msg}"')

# --- Test 4: target Notes or task-ai.md mentions stage-done trust / accepted risk ---
target_text = (TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md').read_text()
taskai_text = (TASK_AI_ROOT / 'commands' / 'task-ai.md').read_text()
target_notes = extract_section(TASK_AI_ROOT / 'skills' / 'target' / 'SKILL.md', '## Notes')
has_risk = 'accepted risk' in target_notes.lower() or 'trust' in target_notes.lower() or \
           'accepted risk' in taskai_text.lower()
if has_risk:
    emit_pass('target Notes / task-ai.md mentions evolving accepted risk')
else:
    emit_fail('target Notes / task-ai.md missing evolving accepted risk mention')

# --- Test 5: init.sh has control character filtering ---
init_sh = (TASK_AI_ROOT / 'skills' / 'init' / 'scripts' / 'init.sh').read_text()
if 'tr -d' in init_sh or 'control char' in init_sh.lower() or 'sanitize' in init_sh.lower() or \
   '[:cntrl:]' in init_sh:
    emit_pass('init.sh has control character filtering')
else:
    emit_fail('init.sh missing control character filtering')

sys.exit(summary())
