# Skill Hot-Reload Reference

Hot-reload mechanism for workspace skills, based on Claude Code's native `--add-dir` support.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code Native Live Change Detection                        │
│                                                                  │
│  claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"               │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ File Watcher    │───▶│ Session Snapshot │                    │
│  │ (inotify/kqueue)│    │ Refresh          │                    │
│  └─────────────────┘    └─────────────────┘                     │
│           │                      │                               │
│           ▼                      ▼                               │
│  SKILL.md changed        Next agent turn                        │
│                          picks up changes                       │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
$NB_WORKSPACES_LIBRARY/
└── skills/                       # Workspace skills (hot-reloadable)
    ├── README.md                 # Usage documentation
    ├── .gitignore                # Ignore drafts/candidates
    ├── .drafts/                  # Work-in-progress (gitignored)
    ├── .candidates/              # Promotion candidates (gitignored)
    └── <skill-name>/
        ├── SKILL.md              # Main skill file (required)
        ├── references/           # Supporting documentation
        └── scripts/              # Executable scripts
```

## Priority Order

When multiple skills share the same name, higher priority wins:

| Priority | Location | Scope |
|----------|----------|-------|
| 1 (highest) | Enterprise managed settings | Organization-wide |
| 2 | `~/.claude/skills/` | Personal (all projects) |
| 3 | `.claude/skills/` | Project-specific |
| 4 | Plugin skills | Where plugin enabled |
| 5 (lowest) | `--add-dir` directories | Workspace skills |

**Note**: Workspace skills have lowest priority. If a personal or project skill has the same name, the workspace skill is shadowed.

## Usage

### Quick Start

```bash
# Source the aliases
source task-ai/core/shell-aliases.sh

# Launch with hot-reload
task-ai-dev

# Or directly:
claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"
```

### Skill Management

```bash
# Initialize workspace skills directory
task-ai-skill init

# List current skills
task-ai-skill list

# Create a new skill
task-ai-skill create my-workflow "Automates my daily workflow"

# Promote a candidate skill
task-ai-skill promote my-candidate
```

### Install /reload Command

```bash
# Install the /reload skill for manual refresh
source task-ai/core/shell-aliases.sh
install_reload_skill

# Now in Claude Code:
# /reload    → Immediately restart and pick up all changes
```

## Hot-Reload Behavior

| Event | Detection | Effect |
|-------|-----------|--------|
| SKILL.md modified | Automatic (live detection) | Available on next agent turn |
| New skill directory | Automatic | Available on next agent turn |
| Skill deleted | Automatic | Removed on next agent turn |
| references/* changed | Automatic | Available when skill loads references |
| scripts/* changed | Automatic | Available when skill executes scripts |

### Limitations

- Changes take effect on the **next agent turn**, not immediately mid-response
- The session snapshot is rebuilt, but conversation context is preserved
- **No restart required** for skill changes
- CLAUDE.md from `--add-dir` directories requires `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`

## Skill Promotion Flow

```
Experience (highlight promote)
    │
    ▼
.candidates/<slug>/  (T1)
    │
    ├── check --checkpoint skill-review (L2, ≥0.70)
    │
    ▼
.drafts/<slug>/  (T2)
    │
    ├── check --checkpoint skill-deep-review (L3, ≥0.85)
    │
    ▼
.active/<slug>/  (T3)
    │
    ├── production validation (usage ≥3, zero failures)
    │
    ▼
.active/<slug>/  (T4 — trust_tier upgraded)
    │
    ▼
[Hot-Reload Active]
```

## SKILL.md Template

```yaml
---
name: skill-name
description: What this skill does and when to use it
disable-model-invocation: false  # Allow Claude to invoke automatically
user-invocable: true             # Show in / menu
allowed-tools: Read, Grep, Glob  # Tools allowed without permission
# context: fork                  # Run in subagent (optional)
# agent: Explore                 # Subagent type (optional)
---

# /skill-name

## Overview

[What this skill accomplishes]

## Steps

1. [First step]
2. [Second step]
3. [Third step]

## Arguments

`$ARGUMENTS` - All arguments passed to the skill
`$0`, `$1`, `$2` - Individual positional arguments

## Examples

```
/skill-name argument1 argument2
```

## Notes

- [Important considerations]
- [Edge cases]
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NB_WORKSPACES_LIBRARY` | Library path | `$NB_WORKSPACES_ROOT/.library` |
| `NB_WORKSPACES_ROOT` | Workspaces root | `.` |
| `TASK_AI_ROOT` | task-ai installation | Auto-detected |

## Troubleshooting

### Skill not appearing

1. Check skill directory exists: `ls $NB_WORKSPACES_LIBRARY/skills/`
2. Verify SKILL.md has valid frontmatter with `name` and `description`
3. Ensure Claude Code was launched with `--add-dir`
4. Ask Claude: "What skills are available?"

### Changes not picked up

1. Wait for next agent turn (changes don't apply mid-response)
2. Use `/reload` to force immediate refresh
3. Check for syntax errors in SKILL.md frontmatter

### Skill shadowed by higher priority

1. Check for same-name skill in `~/.claude/skills/` or `.claude/skills/`
2. Rename the workspace skill to avoid conflict
3. Or remove the higher-priority skill if workspace version is preferred

## See Also

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- `task-ai/core/skill-hotreload.sh` — Implementation
- `task-ai/core/shell-aliases.sh` — Shell integration
