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
signal_file, overall, d1, d2, d3, d4, d5, d6 = sys.argv[1], *[float(x) for x in sys.argv[2:9]]
with open(signal_file, 'r') as f:
    signal = json.load(f)
signal['check_score'] = {
    'overall': overall, 'd1_correctness': d1, 'd2_security': d2,
    'd3_reliability': d3, 'd4_performance': d4, 'd5_architecture': d5,
    'd6_maintainability': d6,
}
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

    # D2: Pass values as arguments to python, not inline interpolation
    python3 - "$signal_file" "$phase" "$progress" <<'PYEOF'
import json, sys, os
signal_file, phase, progress = sys.argv[1], sys.argv[2], float(sys.argv[3])
with open(signal_file, 'r') as f:
    signal = json.load(f)
signal['phase'] = phase
signal['phase_progress'] = progress
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
signal_file = sys.argv[1]
with open(signal_file, 'r') as f:
    signal = json.load(f)
signal['retry_count'] = signal.get('retry_count', 0) + 1
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

    # D2: Pass failure string as argument, not inline interpolation
    python3 - "$signal_file" "$failure" <<'PYEOF'
import json, sys, os
signal_file, failure = sys.argv[1], sys.argv[2]
with open(signal_file, 'r') as f:
    signal = json.load(f)
failures = signal.get('delegation_failures', [])
if failure not in failures:
    failures.append(failure)
signal['delegation_failures'] = failures
tmp = signal_file + '.tmp'
with open(tmp, 'w') as f:
    json.dump(signal, f, indent=2)
os.rename(tmp, signal_file)
PYEOF
}
