---
name: target
description: "Define, refine, and review task objectives and requirements in .target.md. Supports both conversational definition and file-based editing."
model_tier: heavy
auto_delegatable: true
arguments:
  - name: objective
    description: "The task goal, requirements, and constraints (optional — omit to read current target)"
    required: false
---

# /task-ai:target — Define and Review Task Objective

Define or review the core mission for a notebook. This command acts as the cognitive anchor for `plan` and `exec`. It provides a bidirectional bridge between the user's natural language and the physical `.target.md` file.

## Usage

- **Write Mode**: `/task-ai:target "Objective content..."` — Updates `.target.md` and commits the change.
- **Read Mode**: `/task-ai:target` — Reads and displays the current `.target.md` to ensure common understanding.

## Execution Steps

1. **Context discovery**:
   - Locate the current notebook via path-based discovery (`.working/` directory) or branch-based discovery (`task/<name>`).
   - If context cannot be identified, abort with error: "No active task context detected. Enter a notebook directory or switch to a task branch."
2. **If `objective` is provided (Write Mode)**:
   - **Format**: Transform the input text into a structured Markdown format (Objective, Requirements, Constraints). If the input is a single sentence, use it as the `## Objective`.
   - **Update**: Atomic write to `.working/.target.md`.
   - **Git Commit**: `git commit -m "task-ai($NB):target update objective"` to provide a Demand Traceability record.
3. **If `objective` is omitted (Read Mode)**:
   - **Read**: Read the content of `.working/.target.md`.
   - **Display**: Output the structured objective to the conversation window.
4. **Validation**: Confirm the target reflects the user's intent.

## State Transitions

| Current Status | Result | Next Status | Checkpoint | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `draft` | (updated) | `planning` | `post-target` | Target defined, ready for research or planning. |
| `planning` | (updated) | `planning` | `re-plan` | Objective refined during planning; requires plan regeneration. |
| `executing` | (updated) | `executing` | `mid-exec` | Goal adjustment mid-execution; requires impact analysis. |

## Git

| Command | Type | Scope | Subject |
| :--- | :--- | :--- | :--- |
| `target` | `target` | `state` | `target update objective` |

## Notes

- **Manual editing**: Users can directly edit `.target.md` in their IDE. The `target` command is a shortcut for conversational interaction and ensuring Git traceability.
- **Context Loading**: If the agent's context is compressed, `/task-ai:target` without arguments is the standard way to reload the task's mission into memory.
