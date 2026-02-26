---
name: light
description: "Lightweight inline operation on current branch. For quick manual interventions during task execution — no branch creation, no init, single commit delivery."
model_tier: light
auto_delegatable: true
arguments:
  - name: description
    description: "What to do (e.g., 'fix typo in README', 'add missing import')"
    required: true
---

# /task-ai:light — Lightweight Inline Operation

A quick-action mode for small, self-contained modifications on the **current branch**. No branch creation, no lifecycle tracking, no state transitions — just edit files and commit.

## Usage

```
/task-ai:light "<description>"
```

The agent reads this skill, performs the described change directly on the current branch, then commits using the helper script.

### Commit Helper

```bash
light.sh --commit "<description>"
```

The script auto-detects scope from notebook context or git root and creates a commit with the format:

```
task-ai(<scope>):light <description>
```

- **scope** = notebook slug (if in a notebook context) or project directory name (fallback)

## Context Discovery

1. Walk up from CWD looking for `.working/.index.json` → notebook context (scope = notebook name)
2. If no notebook found, use the git repository root directory name as scope

## Execution Steps

1. **Context discovery**: Determine scope automatically (notebook or project root).
2. **Modify files**: The agent edits files directly based on the description.
3. **Stage and commit**: Run `light.sh --commit "<description>"` to create the commit.

## Complexity Guidance

If the change touches more than **3 files**, consider using a full task (`/task-ai:exec`) instead. This is a recommendation, not a hard limit.

## State Transitions

None. `light` does not modify `.index.json` status. It operates orthogonally to the task lifecycle.

## Git

| Action | Commit Format |
| :--- | :--- |
| `--commit` | `task-ai(<scope>):light <description>` |

## Notes

- No branch creation or deletion — works on whatever branch is currently checked out.
- No `.auto-signal` written — `light` is not part of the automation loop.
- Designed for human-initiated quick fixes during or outside task execution.
