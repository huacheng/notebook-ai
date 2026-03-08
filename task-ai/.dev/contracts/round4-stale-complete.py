#!/usr/bin/env python3
"""Round 4: Stale 'complete' status references in specs.

F13: depends-on-format.md should use 'satisfied' not 'complete'
F14: merge/SKILL.md should use 'satisfied' not 'complete' for dependency requirement
F15: task-ai.md should use 'satisfied' not 'complete' for depends_on note
F16: verify/SKILL.md should not reference 'complete' as terminal status
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

depends_text = (TASK_AI_ROOT / 'commands' / 'references' / 'depends-on-format.md').read_text()
merge_text = (TASK_AI_ROOT / 'skills' / 'merge' / 'SKILL.md').read_text()
taskai_text = (TASK_AI_ROOT / 'commands' / 'task-ai.md').read_text()
verify_text = (TASK_AI_ROOT / 'skills' / 'verify' / 'SKILL.md').read_text()

# F13: depends-on-format.md — require 'satisfied' not 'complete'
if 'require `complete`' in depends_text or "requires status `complete`" in depends_text:
    emit_fail('F13: depends-on-format.md still uses complete as required status')
else:
    emit_pass('F13: depends-on-format.md uses satisfied')

# F14: merge/SKILL.md — dependency gate text
if "require `complete`" in merge_text or "string → `complete`" in merge_text:
    emit_fail('F14: merge/SKILL.md still uses complete for dependency requirement')
else:
    emit_pass('F14: merge/SKILL.md uses satisfied for dependency requirement')

# F15: task-ai.md — depends_on note
if "(require `complete`)" in taskai_text or "require `complete`" in taskai_text:
    emit_fail('F15: task-ai.md still uses complete for depends_on')
else:
    emit_pass('F15: task-ai.md uses satisfied for depends_on')

# F16: verify/SKILL.md — terminal status
if '`complete` or `cancelled`' in verify_text or '`complete`' in verify_text:
    emit_fail('F16: verify/SKILL.md still references complete as terminal status')
else:
    emit_pass('F16: verify/SKILL.md correctly identifies only cancelled as terminal')

sys.exit(summary())
