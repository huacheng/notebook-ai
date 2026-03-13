#!/usr/bin/env python3
import os
import json
from pathlib import Path

def emit_pass(msg): print(f"[PASS] {msg}")
def emit_fail(msg): print(f"[FAIL] {msg}")

def emit_warn(msg): print(f"[WARN] {msg}")

def test_relation_routing():
    lib_path = Path(os.getenv('NB_WORKSPACES_LIBRARY', os.getenv('NB_WORKSPACES_ROOT', '.') + '/.library'))

    if not lib_path.exists():
        emit_warn("library path not found (NB_WORKSPACES_LIBRARY/NB_WORKSPACES_ROOT not set) — skipping")
        return

    relations_path = lib_path / '.relations.jsonl'

    if not relations_path.exists():
        emit_fail("relations.jsonl missing")
        return

    try:
        with open(relations_path, 'r') as f:
            lines = f.readlines()
            
        if not lines:
            emit_fail("relations.jsonl is empty")
            return
            
        emit_pass(f"relations.jsonl found with {len(lines)} entries")
        
        # Validate JSONL structure
        valid_count = 0
        for i, line in enumerate(lines):
            try:
                data = json.loads(line)
                required = {"s", "p", "o", "w"}
                if all(k in data for k in required):
                    valid_count += 1
                else:
                    emit_fail(f"Line {i+1}: Missing required fields {required - data.keys()}")
            except json.JSONDecodeError:
                emit_fail(f"Line {i+1}: Invalid JSON")
        
        if valid_count == len(lines):
            emit_pass("All relation entries follow schema {s, p, o, w}")
            
    except Exception as e:
        emit_fail(f"Error during validation: {e}")

if __name__ == "__main__":
    test_relation_routing()
    print("---")
    print("TOTAL: 1 tests run")
