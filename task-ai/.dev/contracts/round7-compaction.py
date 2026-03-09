#!/usr/bin/env python3
"""Round 7: Signal abolition verification (v2).

F19: auto.sh should NOT have signal recovery block (v2: signal abolished, compaction is in-memory)
F20: auto/SKILL.md should document compaction frequency limit (in-memory, not in signal)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

auto_sh = (TASK_AI_ROOT / 'skills' / 'auto' / 'scripts' / 'auto.sh').read_text()
auto_skill = (TASK_AI_ROOT / 'skills' / 'auto' / 'SKILL.md').read_text()

# F19: No signal recovery block (v2: signal abolished)
if 'SIGNAL_RECOVERY' not in auto_sh and '.auto-signal' not in auto_sh:
    emit_pass('F19: auto.sh has no signal recovery (v2: signal abolished)')
else:
    emit_fail('F19: auto.sh still has signal recovery — should be removed in v2')

# F20: Compaction frequency limit documented in SKILL.md
if 'compaction' in auto_skill.lower() and ('3' in auto_skill or 'limit' in auto_skill.lower()):
    emit_pass('F20: auto/SKILL.md documents compaction frequency limit')
else:
    emit_fail('F20: auto/SKILL.md missing compaction frequency limit documentation')

sys.exit(summary())
