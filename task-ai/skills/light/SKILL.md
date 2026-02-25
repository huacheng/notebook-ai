---
name: light
description: "Shadow task execution for lightweight fixes and adjustments. Single commit delivery, automatic branch cleanup."
model_tier: light
auto_delegatable: true
arguments:
  - name: objective
    description: "The task objective or action to perform"
    required: true
---

# /moonview:light — Lightweight Shadow Task

A "fast-track" mode for small, self-contained tasks (e.g., typos, simple CSS tweaks, minor logs). This mode avoids the overhead of directory creation and heavy lifecycle tracking while maintaining project-level audit trails.

## Usage

- **Start**: `/moonview:light "Objective content..."` — Creates a shadow branch and records the task.
- **Finish**: `/moonview:light --finish` — Squash merges changes to master, deletes the branch, and clears the record.
- **Promote**: `/moonview:light --promote` — Converts the shadow task into a standard heavy-duty notebook (creates directory, etc.).

## Complexity Constraints

To maintain the "lightweight" nature of this mode, the following thresholds are enforced:

1.  **File Limit**: If more than **3 files** are modified, the agent MUST suggest `/moonview:light --promote`.
2.  **Attempt Limit**: If more than **3 verification attempts** fail during the `exec` phase, the agent MUST suggest `/moonview:light --promote`.
3.  **Scope Creep**: If the task objective evolves beyond a single self-contained fix, promote it.

## Execution Steps

1. **Context discovery**:
   - Locate the project root (where `.git/` exists).
2. **Start shadow session** (if `objective` provided):
   - **Registry**: Append task record to `.light-tasks.jsonl` in project root.
   - **Branch**: `git checkout -b light/<slug>-<timestamp>`.
   - **Verify**: Output a confirmation message. 
3. **Status & Monitoring**:
   - `/moonview:light --status` — Checks the number of modified files and displays the current objective.
4. **Execute change**:
   - The agent modifies files directly in the codebase.
   - **Check Complexity**: Periodically run `--status` or manually count changed files.
5. **Quick Verification**:
   - Run lightweight checks (e.g., `npm run lint`, `tsc`).
6. **Atomic Finish** (if `--finish` provided):
   - **Merge**: Squash merge the shadow branch into the main branch.
   - **Commit**: Single commit: `task-ai(<project>):light <objective>`.
   - **Cleanup**: Delete the shadow branch and the transient notebook directory.
7. **Promotion** (if `--promote` provided):
   - **Initialize**: Call `/moonview:init` to create a full notebook directory (maintains system architecture).
   - **Upgrade**: Convert the transient task into a standard task (remove `light` mode flag, set status to `planning`, rename branch to `task/`).


## State Transitions

| Current Status | Result | Next Status | Checkpoint | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| (none) | (started) | `light-exec` | `start` | Shadow task initiated. |
| `light-exec` | (success) | `complete` | `finish` | Changes merged and cleaned up. |
| `light-exec` | (complex) | `planning` | `promote` | Promoted to standard task. |

## Git

| Command | Type | Scope | Subject |
| :--- | :--- | :--- | :--- |
| `light --finish` | `light` | `feat/fix` | `<objective>` (Squash commit on master) |

## Notes

- **Complexity Limit**: If more than 3 files are modified or 3 verification attempts fail, the agent should proactively suggest `/moonview:light --promote`.
- **Registry Privacy**: `.light-tasks.jsonl` should be added to the project's `.gitignore` if permanence is not desired, though keeping it allows for simple project history.
