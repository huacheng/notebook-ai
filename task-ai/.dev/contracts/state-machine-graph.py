#!/usr/bin/env python3
"""L3: Graph analysis of state machine — reachability, terminal states, no deadlocks"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    load_fixture, emit_pass, emit_fail, emit_warn, summary
)
from collections import defaultdict, deque

expected = load_fixture('expected-states.json')
states = set(expected['states'])
terminal = set(expected['terminal'])
transitions = expected['transitions']

# Build adjacency list
graph: dict[str, set[str]] = defaultdict(set)
for t in transitions:
    graph[t['from']].add(t['to'])

# 1. Reachability from 'draft' (initial state)
initial = 'draft'
reachable: set[str] = set()
queue = deque([initial])
while queue:
    node = queue.popleft()
    if node in reachable:
        continue
    reachable.add(node)
    for neighbor in graph.get(node, set()):
        if neighbor not in reachable:
            queue.append(neighbor)

for state in states:
    if state in reachable:
        emit_pass(f'reachability: "{state}" is reachable from "{initial}"')
    else:
        emit_fail(f'reachability: "{state}" is NOT reachable from "{initial}"')

# 2. Terminal states have no outgoing edges (self-loops allowed for report)
for state in terminal:
    non_self = graph.get(state, set()) - {state}
    if non_self:
        emit_fail(f'terminal: "{state}" has outgoing edges to other states: {non_self}')
    else:
        emit_pass(f'terminal: "{state}" has no outgoing edges to other states')

# 3. Non-terminal states must have at least one outgoing edge (no deadlock)
for state in states:
    if state in terminal:
        continue
    if not graph.get(state):
        emit_fail(f'deadlock: "{state}" is non-terminal but has no outgoing edges')
    else:
        emit_pass(f'deadlock: "{state}" has {len(graph[state])} outgoing edge(s)')

# 4. Every non-terminal state can reach a terminal state
for state in states:
    if state in terminal:
        continue
    # BFS from this state to see if any terminal is reachable
    visited: set[str] = set()
    q = deque([state])
    can_terminate = False
    while q:
        node = q.popleft()
        if node in visited:
            continue
        visited.add(node)
        if node in terminal:
            can_terminate = True
            break
        for neighbor in graph.get(node, set()):
            if neighbor not in visited:
                q.append(neighbor)

    if can_terminate:
        emit_pass(f'termination: "{state}" can reach a terminal state')
    else:
        emit_fail(f'termination: "{state}" CANNOT reach any terminal state')

# 5. Verify no unexpected states in transitions
transition_states = set()
for t in transitions:
    transition_states.add(t['from'])
    transition_states.add(t['to'])

for state in transition_states:
    if state in states:
        emit_pass(f'states: "{state}" in transitions is a known state')
    else:
        emit_fail(f'states: "{state}" in transitions is NOT a known state')

sys.exit(summary())
