#!/usr/bin/env python3
import json
import sys
import argparse
import os
from datetime import datetime

VALID_STATUSES = {"draft", "planning", "review", "executing", "re-planning", "stage-done", "complete", "blocked", "cancelled"}

def get_lock(index_path):
    lock_path = index_path + ".lock"
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        return fd, lock_path
    except FileExistsError:
        # Stale-lock recovery: check if the holding PID is still alive
        try:
            with open(lock_path, 'r') as lf:
                pid = int(lf.read().strip())
            os.kill(pid, 0)  # signal 0 = check if alive
        except (ValueError, ProcessLookupError, PermissionError, OSError):
            # PID is dead or lock file is corrupt — recover
            stale_path = f"{lock_path}.stale.{os.getpid()}"
            try:
                os.rename(lock_path, stale_path)
            except OSError:
                pass
            # Retry acquisition
            try:
                fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                return fd, lock_path
            except FileExistsError:
                pass  # Another process won the race
        print(f"[ERROR] Could not acquire lock for {index_path}. Is another process running?", file=sys.stderr)
        sys.exit(1)

def release_lock(fd, lock_path):
    os.close(fd)
    try:
        os.remove(lock_path)
    except OSError:
        pass

def read_state(index_path):
    if not os.path.exists(index_path):
        print(f"[ERROR] Index file missing: {index_path}", file=sys.stderr)
        sys.exit(1)
    with open(index_path, 'r', encoding='utf-8') as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as e:
            print(f"[ERROR] Malformed JSON in {index_path}: {e}", file=sys.stderr)
            sys.exit(1)

def write_state(index_path, state):
    state['updated'] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    tmp_path = index_path + ".tmp"
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=2)
    os.rename(tmp_path, index_path)

def cmd_get(args):
    state = read_state(args.file)
    val = state.get(args.key, '')
    print(val if val is not None else '')

def cmd_set(args):
    fd, lock_path = get_lock(args.file)
    try:
        state = read_state(args.file)
        
        # Validations
        if args.key == 'status' and args.value not in VALID_STATUSES:
            print(f"[ERROR] Invalid status: {args.value}", file=sys.stderr)
            sys.exit(1)
        if args.key == 'completed_steps':
            try:
                args.value = int(args.value)
            except ValueError:
                print(f"[ERROR] completed_steps must be an integer.", file=sys.stderr)
                sys.exit(1)

        state[args.key] = args.value
        write_state(args.file, state)
    finally:
        release_lock(fd, lock_path)

def cmd_transition(args):
    """Update multiple state fields atomically."""
    fd, lock_path = get_lock(args.file)
    try:
        state = read_state(args.file)
        
        if args.status:
            if args.status not in VALID_STATUSES:
                print(f"[ERROR] Invalid status: {args.status}", file=sys.stderr)
                sys.exit(1)
            state['status'] = args.status
        if args.phase is not None:
            state['phase'] = args.phase
        if args.completed_steps is not None:
            state['completed_steps'] = args.completed_steps
        if args.branch is not None:
            state['branch'] = args.branch
        if args.worktree is not None:
            state['worktree'] = args.worktree
        if args.stage_current is not None:
            stage = state.setdefault('stage', {})
            stage['current'] = args.stage_current
        if args.stage_completed is not None:
            stage = state.setdefault('stage', {})
            completed = stage.setdefault('completed', [])
            completed.append(args.stage_completed)

        write_state(args.file, state)
    finally:
        release_lock(fd, lock_path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Task State Machine CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_get = subparsers.add_parser("get")
    p_get.add_argument("file", help="Path to .index.json")
    p_get.add_argument("key", help="Key to read")

    p_set = subparsers.add_parser("set")
    p_set.add_argument("file", help="Path to .index.json")
    p_set.add_argument("key", help="Key to write")
    p_set.add_argument("value", help="Value to write")

    p_trans = subparsers.add_parser("transition")
    p_trans.add_argument("file", help="Path to .index.json")
    p_trans.add_argument("--status", help="New status")
    p_trans.add_argument("--phase", help="New phase")
    p_trans.add_argument("--completed-steps", type=int, help="Steps completed")
    p_trans.add_argument("--branch", help="Git branch")
    p_trans.add_argument("--worktree", help="Worktree path")
    p_trans.add_argument("--stage-current", type=int, help="Current stage number")
    p_trans.add_argument("--stage-completed", help="Stage name to append to stage.completed[]")

    args = parser.parse_args()
    if args.command == "get": cmd_get(args)
    elif args.command == "set": cmd_set(args)
    elif args.command == "transition": cmd_transition(args)
