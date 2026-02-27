#!/usr/bin/env python3
"""L2: Verify state.py supports stage-done status for progressive target v1.

Tests:
  1. stage-done is in VALID_STATUSES
  2. stage-done is NOT a terminal state
  3. set status=stage-done succeeds on a valid .index.json
  4. transition --status stage-done succeeds
  5. stage-done -> planning transition succeeds (via target advance)
"""
import sys
import os
import json
import tempfile
import subprocess

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, load_fixture, summary, TASK_AI_ROOT

STATE_PY = str(TASK_AI_ROOT / 'core' / 'state.py')

# --- Test 1: stage-done in VALID_STATUSES ---
# Import the module to check the constant directly
sys.path.insert(0, str(TASK_AI_ROOT / 'core'))
from state import VALID_STATUSES

if 'stage-done' in VALID_STATUSES:
    emit_pass('stage-done is in VALID_STATUSES')
else:
    emit_fail('stage-done is NOT in VALID_STATUSES')

# --- Test 2: stage-done is NOT terminal ---
expected = load_fixture('expected-states.json')
terminal = set(expected.get('terminal', []))

if 'stage-done' not in terminal:
    emit_pass('stage-done is not a terminal state in expected-states.json')
else:
    emit_fail('stage-done should not be terminal')

# --- Test 3: set status=stage-done succeeds ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.index.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "executing", "phase": "",
            "completed_steps": 3, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'set', index_path, 'status', 'stage-done'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        with open(index_path) as f:
            data = json.load(f)
        if data['status'] == 'stage-done':
            emit_pass('set status=stage-done succeeds')
        else:
            emit_fail(f'set status=stage-done: status is {data["status"]}')
    else:
        emit_fail(f'set status=stage-done failed: {result.stderr.strip()}')

# --- Test 4: transition --status stage-done succeeds ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.index.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "executing", "phase": "",
            "completed_steps": 5, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'transition', index_path, '--status', 'stage-done'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        with open(index_path) as f:
            data = json.load(f)
        if data['status'] == 'stage-done':
            emit_pass('transition --status stage-done succeeds')
        else:
            emit_fail(f'transition --status stage-done: status is {data["status"]}')
    else:
        emit_fail(f'transition --status stage-done failed: {result.stderr.strip()}')

# --- Test 5: stage-done -> planning transition succeeds ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.index.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "stage-done", "phase": "",
            "completed_steps": 0, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'transition', index_path, '--status', 'planning'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        with open(index_path) as f:
            data = json.load(f)
        if data['status'] == 'planning':
            emit_pass('stage-done -> planning transition succeeds')
        else:
            emit_fail(f'stage-done -> planning: status is {data["status"]}')
    else:
        emit_fail(f'stage-done -> planning failed: {result.stderr.strip()}')

sys.exit(summary())
