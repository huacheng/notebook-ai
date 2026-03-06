#!/usr/bin/env bash
# Signal writer utilities for .auto-signal
# Provides functions to read/write extended signal fields

# Write or update check_score in .auto-signal
# Usage: write_check_score <signal_file> <overall> <d1> <d2> <d3> <d4> <d5> <d6>
write_check_score() {
    local signal_file="$1"
    local overall="$2" d1="$3" d2="$4" d3="$5" d4="$6" d5="$7" d6="$8"

    if [[ ! -f "$signal_file" ]]; then
        echo "[WARN] Signal file not found: $signal_file" >&2
        return 1
    fi

    # D2: Pass values as arguments to python, not inline interpolation
    python3 - "$signal_file" "$overall" "$d1" "$d2" "$d3" "$d4" "$d5" "$d6" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
signal_file = sys.argv[1]
try:
    overall, d1, d2, d3, d4, d5, d6 = [float(x) for x in sys.argv[2:9]]
except (ValueError, IndexError) as e:
    print(f"[ERROR] Invalid score arguments: {e}", file=sys.stderr)
    sys.exit(1)
# D3: Validate score ranges (0.0-1.0) per SKILL.md §Signal Validation
for name, val in [('overall', overall), ('d1', d1), ('d2', d2), ('d3', d3), ('d4', d4), ('d5', d5), ('d6', d6)]:
    if not (0.0 <= val <= 1.0):
        print(f"[ERROR] Score {name}={val} out of range [0.0, 1.0]", file=sys.stderr)
        sys.exit(1)
try:
    with open(signal_file, 'r') as f:
        signal = json.load(f)
except (json.JSONDecodeError, ValueError) as e:
    print(f"[ERROR] Corrupted signal file: {e}", file=sys.stderr)
    sys.exit(1)
signal['check_score'] = {
    'overall': overall, 'd1_correctness': d1, 'd2_security': d2,
    'd3_reliability': d3, 'd4_performance': d4, 'd5_architecture': d5,
    'd6_maintainability': d6,
}
# D1: Update timestamp on every signal modification
signal['timestamp'] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
# D3: Atomic write via temp file + rename
tmp = signal_file + '.tmp'
with open(tmp, 'w') as f:
    json.dump(signal, f, indent=2)
os.rename(tmp, signal_file)
PYEOF
}

# Write phase and phase_progress to .auto-signal
# Usage: write_phase <signal_file> <phase> <progress>
write_phase() {
    local signal_file="$1"
    local phase="$2"
    local progress="$3"

    if [[ ! -f "$signal_file" ]]; then
        echo "[WARN] Signal file not found: $signal_file" >&2
        return 1
    fi

    # D3: Validate phase is an allowed value (per SKILL.md §Signal Validation)
    local valid_phases="target planning execution finalization"
    if [[ ! " $valid_phases " =~ " $phase " ]]; then
        echo "[ERROR] Invalid phase: $phase (allowed: $valid_phases)" >&2
        return 1
    fi

    # D2: Pass values as arguments to python, not inline interpolation
    python3 - "$signal_file" "$phase" "$progress" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
signal_file, phase = sys.argv[1], sys.argv[2]
try:
    progress = float(sys.argv[3])
except ValueError:
    print(f"[ERROR] Invalid progress value: {sys.argv[3]}", file=sys.stderr)
    sys.exit(1)
# D3: Validate progress range (0.0-1.0) per SKILL.md §Signal Validation
if not (0.0 <= progress <= 1.0):
    print(f"[ERROR] Progress {progress} out of range [0.0, 1.0]", file=sys.stderr)
    sys.exit(1)
try:
    with open(signal_file, 'r') as f:
        signal = json.load(f)
except (json.JSONDecodeError, ValueError) as e:
    print(f"[ERROR] Corrupted signal file: {e}", file=sys.stderr)
    sys.exit(1)
signal['phase'] = phase
signal['phase_progress'] = progress
# D1: Update timestamp on every signal modification
signal['timestamp'] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = signal_file + '.tmp'
with open(tmp, 'w') as f:
    json.dump(signal, f, indent=2)
os.rename(tmp, signal_file)
PYEOF
}

# Increment retry_count in .auto-signal
# Usage: increment_retry <signal_file>
increment_retry() {
    local signal_file="$1"

    if [[ ! -f "$signal_file" ]]; then
        echo "[WARN] Signal file not found: $signal_file" >&2
        return 1
    fi

    python3 - "$signal_file" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
signal_file = sys.argv[1]
try:
    with open(signal_file, 'r') as f:
        signal = json.load(f)
except (json.JSONDecodeError, ValueError) as e:
    print(f"[ERROR] Corrupted signal file: {e}", file=sys.stderr)
    sys.exit(1)
signal['retry_count'] = signal.get('retry_count', 0) + 1
# D1: Update timestamp on every signal modification
signal['timestamp'] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = signal_file + '.tmp'
with open(tmp, 'w') as f:
    json.dump(signal, f, indent=2)
os.rename(tmp, signal_file)
PYEOF
}

# Append delegation failure to .auto-signal
# Usage: append_delegation_failure <signal_file> <cmd@iterN>
append_delegation_failure() {
    local signal_file="$1"
    local failure="$2"

    if [[ ! -f "$signal_file" ]]; then
        echo "[WARN] Signal file not found: $signal_file" >&2
        return 1
    fi

    # D2: Validate failure format matches expected pattern cmd@iterN
    if [[ ! "$failure" =~ ^[a-z][-a-z]*@iter[0-9]+$ ]]; then
        echo "[ERROR] Invalid delegation failure format: $failure (expected: cmd@iterN)" >&2
        return 1
    fi

    # D2: Pass failure string as argument, not inline interpolation
    python3 - "$signal_file" "$failure" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
signal_file, failure = sys.argv[1], sys.argv[2]
try:
    with open(signal_file, 'r') as f:
        signal = json.load(f)
except (json.JSONDecodeError, ValueError) as e:
    print(f"[ERROR] Corrupted signal file: {e}", file=sys.stderr)
    sys.exit(1)
failures = signal.get('delegation_failures', [])
if failure not in failures:
    failures.append(failure)
signal['delegation_failures'] = failures
# D1: Update timestamp on every signal modification
signal['timestamp'] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = signal_file + '.tmp'
with open(tmp, 'w') as f:
    json.dump(signal, f, indent=2)
os.rename(tmp, signal_file)
PYEOF
}
