#!/usr/bin/env python3
"""L2: Regression tests for six-dimension audit round 2 — top 10 fix priorities."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

STATE_PY = TASK_AI_ROOT / 'core' / 'state.py'
SECURITY_SH = TASK_AI_ROOT / 'skills' / 'security' / 'scripts' / 'security.sh'
CHECK_SH = TASK_AI_ROOT / 'skills' / 'check' / 'scripts' / 'check.sh'
VERIFY_SH = TASK_AI_ROOT / 'skills' / 'verify' / 'scripts' / 'verify.sh'
PLAN_SH = TASK_AI_ROOT / 'skills' / 'plan' / 'scripts' / 'plan.sh'
ANNOTATE_TEST = TASK_AI_ROOT / '.dev' / 'contracts' / 'annotate-functional.sh'
LIB_PY = TASK_AI_ROOT / '.dev' / 'contracts' / 'lib.py'
VALIDATE_SH = TASK_AI_ROOT / '.dev' / 'validate.sh'
CONTRACTS_DIR = TASK_AI_ROOT / '.dev' / 'contracts'

# Mutating skill scripts that MUST have trap + lock
MUTATING_SCRIPTS = [
    TASK_AI_ROOT / 'skills' / s / 'scripts' / f'{s}.sh'
    for s in ('plan', 'exec', 'check', 'merge', 'research', 'verify', 'report', 'auto', 'target')
]

# Production scripts that should NOT depend on .dev/contracts/lib.sh
PROD_SCRIPTS = sorted((TASK_AI_ROOT / 'skills').rglob('scripts/*.sh'))

# Library python scripts that have duplicated parse_frontmatter
LIB_SCRIPTS_PY = [
    TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / f
    for f in ('audit-library.py', 'rebuild-index.py', 'rebuild-relations.py')
]

# ─── T1: D3-03 — Scripts using temp files must have trap for cleanup ───

t1_id = 'T1 (D3-03)'
t1_missing = []
for script in MUTATING_SCRIPTS:
    if not script.exists():
        continue
    text = script.read_text()
    # Only require trap if the script creates temporary files
    uses_tempfiles = 'mktemp' in text or 'TMP_FILE=' in text or 'LOCK_FILE=' in text
    if uses_tempfiles and 'trap ' not in text:
        t1_missing.append(script.name)

if not t1_missing:
    emit_pass(f'{t1_id}: scripts using temp files have trap for cleanup')
else:
    emit_fail(f'{t1_id}: scripts missing trap: {", ".join(t1_missing)}')

# ─── T2: D5-01 — Production scripts must NOT source .dev/contracts/lib.sh ───

t2_id = 'T2 (D5-01)'
t2_offenders = []
for script in PROD_SCRIPTS:
    if not script.exists():
        continue
    text = script.read_text()
    if '.dev/contracts/lib.sh' in text:
        t2_offenders.append(script.name)

if not t2_offenders:
    emit_pass(f'{t2_id}: no production script sources .dev/contracts/lib.sh')
else:
    emit_fail(f'{t2_id}: {len(t2_offenders)} scripts source .dev/contracts/lib.sh: {", ".join(t2_offenders)}')

# ─── T3: D2-02 — state.py must implement stale-lock recovery ───

t3_id = 'T3 (D2-02)'
if STATE_PY.exists():
    state_text = STATE_PY.read_text()
    # Stale lock recovery requires checking if PID is alive
    has_pid_check = 'os.kill' in state_text or 'kill -0' in state_text or 'signal.signal' in state_text
    has_stale_rename = '.lock.stale' in state_text or 'lock_stale' in state_text
    if has_pid_check or has_stale_rename:
        emit_pass(f'{t3_id}: state.py implements stale-lock recovery')
    else:
        emit_fail(f'{t3_id}: state.py has no stale-lock recovery (no PID check, no stale rename)')
else:
    emit_fail(f'{t3_id}: state.py not found')

# ─── T4: D3-01 — state.py read_state() must handle JSONDecodeError ───

t4_id = 'T4 (D3-01)'
if STATE_PY.exists():
    state_text = STATE_PY.read_text()
    if 'JSONDecodeError' in state_text or 'json.decoder.JSONDecodeError' in state_text:
        emit_pass(f'{t4_id}: state.py handles JSONDecodeError')
    else:
        emit_fail(f'{t4_id}: state.py read_state() has no JSONDecodeError handling')
else:
    emit_fail(f'{t4_id}: state.py not found')

# ─── T5: D5-03 — mkdir output dirs must come AFTER WORK_DIR guard ───

t5_id = 'T5 (D5-03)'
t5_bad = []
for script in [CHECK_SH, VERIFY_SH]:
    if not script.exists():
        continue
    text = script.read_text()
    lines = text.split('\n')
    mkdir_line = -1
    guard_line = -1
    for i, line in enumerate(lines):
        if 'mkdir -p' in line and ('ANALYSIS_DIR' in line or 'TEST_DIR' in line):
            mkdir_line = i
        if 'if [[ ! -d "$WORK_DIR" ]]' in line:
            guard_line = i
    if mkdir_line >= 0 and guard_line >= 0 and mkdir_line < guard_line:
        t5_bad.append(script.name)

if not t5_bad:
    emit_pass(f'{t5_id}: mkdir output dirs comes after WORK_DIR guard check')
else:
    emit_fail(f'{t5_id}: mkdir before guard in: {", ".join(t5_bad)}')

# ─── T6: D2-04 — security.sh audit_plan() must not have broken regex ───

t6_id = 'T6 (D2-04)'
if SECURITY_SH.exists():
    sec_text = SECURITY_SH.read_text()
    # The broken pattern: "curl | bash" (with spaces around pipe in ERE)
    # This matches "curl " OR " bash" instead of literal "curl | bash"
    has_broken = bool(re.search(r'curl \| bash', sec_text))
    # Correct pattern would escape the pipe or use \| or \s*\|\s*
    has_correct = bool(re.search(r'curl.*\\[|].*bash|curl\\s\*\\[|]\\s\*bash', sec_text))
    if not has_broken:
        emit_pass(f'{t6_id}: security.sh audit_plan() regex is correct')
    else:
        emit_fail(f'{t6_id}: security.sh audit_plan() has broken "curl | bash" regex (ERE alternation)')
else:
    emit_fail(f'{t6_id}: security.sh not found')

# ─── T7: D5-02 — All contract scripts must be registered in validate.sh ───

t7_id = 'T7 (D5-02)'
# Infrastructure files that are NOT contract tests
INFRA_FILES = {'lib.sh', 'lib.py', 'json_get.py'}

if VALIDATE_SH.exists() and CONTRACTS_DIR.exists():
    validate_text = VALIDATE_SH.read_text()
    all_contracts = set()
    for ext in ('*.sh', '*.py'):
        for p in CONTRACTS_DIR.glob(ext):
            if p.name not in INFRA_FILES:
                all_contracts.add(p.name)

    unregistered = sorted(c for c in all_contracts if c not in validate_text)
    if not unregistered:
        emit_pass(f'{t7_id}: all contract scripts are registered in validate.sh')
    else:
        emit_fail(f'{t7_id}: {len(unregistered)} unregistered contracts: {", ".join(unregistered[:5])}{"..." if len(unregistered) > 5 else ""}')
else:
    emit_fail(f'{t7_id}: validate.sh or contracts/ not found')

# ─── T8: D6-01 — annotate-functional.sh must not check stale strings ───

t8_id = 'T8 (D6-01)'
if ANNOTATE_TEST.exists():
    ann_text = ANNOTATE_TEST.read_text()
    has_stale = 'Frontend integration' in ann_text or '"TBD"' in ann_text or "'TBD'" in ann_text
    if not has_stale:
        emit_pass(f'{t8_id}: annotate-functional.sh does not check for stale strings')
    else:
        emit_fail(f'{t8_id}: annotate-functional.sh still checks for "Frontend integration" / "TBD"')
else:
    emit_fail(f'{t8_id}: annotate-functional.sh not found')

# ─── T9: D1-01 — state.py must support stage arguments in transition ───

t9_id = 'T9 (D1-01)'
if STATE_PY.exists():
    state_text = STATE_PY.read_text()
    has_stage = '--stage' in state_text
    if has_stage:
        emit_pass(f'{t9_id}: state.py transition has --stage argument')
    else:
        emit_fail(f'{t9_id}: state.py transition lacks --stage argument for multi-stage tasks')
else:
    emit_fail(f'{t9_id}: state.py not found')

# ─── T10: D6-03 — parse_frontmatter must be in shared lib.py ───

t10_id = 'T10 (D6-03)'
if LIB_PY.exists():
    lib_text = LIB_PY.read_text()
    has_shared = 'def parse_frontmatter' in lib_text
    if has_shared:
        # Also check that library scripts import from lib instead of defining locally
        all_local = []
        for s in LIB_SCRIPTS_PY:
            if s.exists() and 'def parse_frontmatter' in s.read_text():
                all_local.append(s.name)
        if not all_local:
            emit_pass(f'{t10_id}: parse_frontmatter is in shared lib.py and library scripts use it')
        else:
            emit_fail(f'{t10_id}: lib.py has parse_frontmatter but {", ".join(all_local)} still define local copies')
    else:
        emit_fail(f'{t10_id}: lib.py does not contain parse_frontmatter (still duplicated in library scripts)')
else:
    emit_fail(f'{t10_id}: lib.py not found')

sys.exit(summary())
