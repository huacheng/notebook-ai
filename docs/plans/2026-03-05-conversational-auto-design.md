# Conversational Auto — Dialog-Driven Task Lifecycle

## One-Line Summary

After frontend creates a notebook via `init`, all subsequent task lifecycle steps are driven by natural conversation — Claude reads state files to know the current phase, user dialog directly acts on that phase.

## Core Principle

**There is no "auto mode" to activate.** A notebook's existence IS the context. Claude reads `.index.json` + `.auto-signal` + `.target.md` on every conversation turn to understand the current phase, then uses semantic understanding of the user's message to act accordingly.

```
Frontend UI: init (create notebook) → .index.json status=draft
     │
     ▼
User says anything in chat
     │
     ▼
Claude reads state files → knows current phase
     │
     ▼
Semantic understanding of user message → execute phase-appropriate action
```

## Phase Flow

```
Phase 1: Target Definition (status=draft)
  - Auto reads .target.md
  - If empty: dialog guides user to describe objective
  - User conversation directly refines .target.md
  - When ready → research → plan → Phase 2

Phase 2: Planning (status=planning)
  - Auto executes plan → verify → check(post-plan)
  - User can intervene: "step 3 is unnecessary" → modify .plan.md, re-check
  - No intervention → auto-advance to Phase 3

Phase 3: Execution (status=executing)
  - Auto executes exec, verify → check per step
  - User can intervene: "this error?" → explain + fix, resume
  - No intervention → auto-advance to Phase 4

Phase 4: Finalization (status=complete/stage-done)
  - merge → highlight → report → done
```

## Dialog Behavior Per Phase

### Dialog-as-Action (no routing layer)

There is no intent classifier or rule-based router. Claude reads the current phase's SKILL.md + user message and acts through semantic understanding — same as a human pair programmer understanding what you say in context.

Examples during Phase 1 (Target):

| User says | Claude does |
|-----------|------------|
| "I want WebSocket auth with token refresh" | Writes/updates .target.md with these requirements |
| "Also need backward compatibility" | Appends requirement to .target.md |
| "OK that's enough" | Transitions: research → plan |
| (silence / "continue") | Auto-advances: research → plan |

Examples during Phase 3 (Execution):

| User says | Claude does |
|-----------|------------|
| "Skip the migration step" | Adjusts execution, marks step skipped |
| "What's this error about?" | Explains, fixes, resumes |
| "Run tests again" | Triggers verify |
| (silence / "continue") | Continues next exec step |

### Explicit Intervention (Sub-command Override)

User can intervene via two equivalent methods:
- **Chat input**: type `/task-ai:check` in dialog
- **Frontend toolbar button**: click [check] in command toolbar

Both are semantically identical — an explicit override of auto's current phase.

Behavior:
1. Auto yields control
2. Sub-command executes independently (full standalone flow)
3. Sub-command writes its own .auto-signal / updates .index.json
4. Auto reads updated state files → re-routes based on new state
5. Auto resumes from the new state

Frontend toolbar buttons are NOT "driving auto" — they are user interventions, same as typing a command in chat.

## Session Recovery

When user returns after interruption and says "continue":

1. Read `.auto-signal` → iteration, step, next
2. Read `.index.json` → status, phase
3. Read `.summary.md` → context summary
4. Resume from interruption point

```
User: "continue"
Claude: "Last session was at exec step 3. Resuming..."
```

## Frontend Status Bar

### Signal Extension

`.auto-signal` gains two fields:

```json
{
  "step": "exec",
  "result": "(step-3)",
  "next": "verify",
  "phase": "execution",
  "phase_progress": 0.45,
  "iteration": 3,
  "timestamp": "..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `phase` | string | `target`, `planning`, `execution`, `finalization` |
| `phase_progress` | float 0-1 | Progress within current phase |

### UI Rendering

```
[target ✓] → [plan ✓] → [exec ●━━━━━45%] → [merge] → [report]
```

- Backend daemon watches `.auto-signal` via `fs.watch`
- Pushes updates to frontend via existing WebSocket
- Frontend renders a phase progress bar

## What Changes

| Component | Change |
|-----------|--------|
| **auto SKILL.md** | Rewrite: remove activation concept, add dialog-driven phase logic |
| **.auto-signal schema** | Add `phase` + `phase_progress` fields |
| **Frontend** | New: status bar component reading WebSocket phase updates |
| **Backend API** | Minor: expose phase/progress to frontend via existing WebSocket |
| **Signal validation** | Extend whitelist for new fields |

## What Does NOT Change

| Component | Status |
|-----------|--------|
| 18 sub-command SKILL.md files | Unchanged, still independently callable |
| .index.json state model | Unchanged |
| state.py transitions | Unchanged |
| Shell scripts (merge.sh, etc.) | Unchanged |
| Backend daemon core (fs.watch, stall detection) | Unchanged |
| init (frontend-driven) | Unchanged |

## Out of Scope (v1)

- Multi-task queue/switching (single active task only)
- Real-time dialog stream visualization in frontend
- Auto-delegatable subagent execution
- Frontend "auto" button (not needed — dialog IS the interface)
