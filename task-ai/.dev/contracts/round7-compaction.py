#!/usr/bin/env python3
"""Round 7: auto.sh compaction_count must be incremented on signal recovery.

F19: auto.sh should increment COMPACTION when recovering from existing signal
F20: auto.sh should enforce compaction frequency limit (>= 3 → stop)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

auto_sh = (TASK_AI_ROOT / 'skills' / 'auto' / 'scripts' / 'auto.sh').read_text()

# F19: compaction increment on recovery
# Look for COMPACTION being incremented in the recovery block
recovery_block = auto_sh[auto_sh.find('SIGNAL_RECOVERY'):auto_sh.find('case "$STATUS"')]
if 'COMPACTION=$((' in recovery_block or '((COMPACTION' in recovery_block:
    emit_pass('F19: auto.sh increments COMPACTION on signal recovery')
else:
    emit_fail('F19: auto.sh does not increment COMPACTION on signal recovery')

# F20: compaction frequency limit
if 'COMPACTION" -ge' in auto_sh or 'COMPACTION" -gt' in auto_sh or 'compaction_frequency_limit' in auto_sh:
    emit_pass('F20: auto.sh has compaction frequency limit')
else:
    emit_fail('F20: auto.sh missing compaction frequency limit')

sys.exit(summary())
