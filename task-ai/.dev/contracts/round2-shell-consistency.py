#!/usr/bin/env python3
"""Round 2: Shell script consistency with v2 SKILL.md specs.

Tests:
  D1-5: auto.sh has no syntax errors (bash -n)
  D1-6: auto.sh does NOT source signal-writer.sh or write .auto-signal (v2 abolished)
  D1-7: merge.sh stage.history entry includes commit and convergence fields
"""
import sys, subprocess
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

auto_sh = TASK_AI_ROOT / 'skills' / 'auto' / 'scripts' / 'auto.sh'
merge_sh = TASK_AI_ROOT / 'skills' / 'merge' / 'scripts' / 'merge.sh'

# D1-5: auto.sh syntax check
result = subprocess.run(['bash', '-n', str(auto_sh)], capture_output=True, text=True)
if result.returncode == 0:
    emit_pass('D1-5: auto.sh has no syntax errors')
else:
    emit_fail(f'D1-5: auto.sh syntax error: {result.stderr.strip()}')

# D1-6: auto.sh should not reference signal-writer.sh or SIGNAL_FILE
auto_text = auto_sh.read_text()
has_signal_writer = 'signal-writer.sh' in auto_text
has_signal_file = 'SIGNAL_FILE' in auto_text
if not has_signal_writer and not has_signal_file:
    emit_pass('D1-6: auto.sh does not reference signal-writer.sh or SIGNAL_FILE')
else:
    parts = []
    if has_signal_writer: parts.append('signal-writer.sh')
    if has_signal_file: parts.append('SIGNAL_FILE')
    emit_fail(f'D1-6: auto.sh still references {", ".join(parts)} — abolished in v2')

# D1-7: merge.sh stage.history entry includes commit and convergence
merge_text = merge_sh.read_text()
has_commit = 'commit' in merge_text and 'stage-history' in merge_text.lower().replace('_', '-')
has_convergence = 'convergence' in merge_text
if has_commit and has_convergence:
    emit_pass('D1-7: merge.sh stage.history entry includes commit and convergence fields')
else:
    missing = []
    if not has_commit: missing.append('commit')
    if not has_convergence: missing.append('convergence')
    emit_fail(f'D1-7: merge.sh stage.history entry missing: {", ".join(missing)}')

sys.exit(summary())
