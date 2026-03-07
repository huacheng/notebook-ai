#!/usr/bin/env python3
"""L2: Verify state.py supports evolving/satisfied statuses (progressive evolution).

Tests:
  1. evolving IS in VALID_STATUSES
  2. satisfied IS in VALID_STATUSES
  3. stage-done is NOT in VALID_STATUSES
  4. complete is NOT in VALID_STATUSES
  5. set status=evolving succeeds
  6. set status=satisfied succeeds
  7. set status=stage-done fails
  8. set status=complete fails
"""
import sys
import os
import json
import tempfile
import subprocess

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, load_fixture, summary, TASK_AI_ROOT

STATE_PY = str(TASK_AI_ROOT / 'core' / 'state.py')

# --- Test 1: evolving in VALID_STATUSES ---
sys.path.insert(0, str(TASK_AI_ROOT / 'core'))
from state import VALID_STATUSES

if 'evolving' in VALID_STATUSES:
    emit_pass('evolving is in VALID_STATUSES')
else:
    emit_fail('evolving is NOT in VALID_STATUSES')

# --- Test 2: satisfied in VALID_STATUSES ---
if 'satisfied' in VALID_STATUSES:
    emit_pass('satisfied is in VALID_STATUSES')
else:
    emit_fail('satisfied is NOT in VALID_STATUSES')

# --- Test 3: stage-done is NOT in VALID_STATUSES ---
if 'stage-done' not in VALID_STATUSES:
    emit_pass('stage-done is NOT in VALID_STATUSES')
else:
    emit_fail('stage-done should NOT be in VALID_STATUSES')

# --- Test 4: complete is NOT in VALID_STATUSES ---
if 'complete' not in VALID_STATUSES:
    emit_pass('complete is NOT in VALID_STATUSES')
else:
    emit_fail('complete should NOT be in VALID_STATUSES')

# --- Test 5: set status=evolving succeeds ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.status.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "executing", "phase": "",
            "completed_steps": 3, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'set', index_path, 'status', 'evolving'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        with open(index_path) as f:
            data = json.load(f)
        if data['status'] == 'evolving':
            emit_pass('set status=evolving succeeds')
        else:
            emit_fail(f'set status=evolving: status is {data["status"]}')
    else:
        emit_fail(f'set status=evolving failed: {result.stderr.strip()}')

# --- Test 6: set status=satisfied succeeds ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.status.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "executing", "phase": "",
            "completed_steps": 5, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'set', index_path, 'status', 'satisfied'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        with open(index_path) as f:
            data = json.load(f)
        if data['status'] == 'satisfied':
            emit_pass('set status=satisfied succeeds')
        else:
            emit_fail(f'set status=satisfied: status is {data["status"]}')
    else:
        emit_fail(f'set status=satisfied failed: {result.stderr.strip()}')

# --- Test 7: set status=stage-done fails ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.status.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "executing", "phase": "",
            "completed_steps": 0, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'set', index_path, 'status', 'stage-done'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        emit_pass('set status=stage-done fails (rejected)')
    else:
        emit_fail('set status=stage-done should fail but succeeded')

# --- Test 8: set status=complete fails ---
with tempfile.TemporaryDirectory() as tmpdir:
    index_path = os.path.join(tmpdir, '.status.json')
    with open(index_path, 'w') as f:
        json.dump({
            "title": "test", "status": "executing", "phase": "",
            "completed_steps": 0, "updated": "2026-01-01T00:00:00Z"
        }, f)

    result = subprocess.run(
        [sys.executable, STATE_PY, 'set', index_path, 'status', 'complete'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        emit_pass('set status=complete fails (rejected)')
    else:
        emit_fail('set status=complete should fail but succeeded')

sys.exit(summary())
