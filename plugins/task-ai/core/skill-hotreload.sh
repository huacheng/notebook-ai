#!/usr/bin/env bash
# task-ai Skill Hot-Reload Support
set -euo pipefail
#
# Usage: source this file or use the launcher functions
#
# This module enables hot-reload for workspace skills using Claude Code's
# native --add-dir live change detection mechanism.
#
# Directory Structure:
#   $NB_WORKSPACES_LIBRARY/skills/     # Workspace skills (hot-reloadable)
#   $NB_WORKSPACES_LIBRARY/skills/<name>/SKILL.md
#
# Priority (highest to lowest):
#   1. Enterprise skills (managed settings)
#   2. Personal skills (~/.claude/skills/)
#   3. Project skills (.claude/skills/)
#   4. Plugin skills (where plugin enabled)
#   5. Workspace skills ($NB_WORKSPACES_LIBRARY/skills/) via --add-dir

# Resolve library path
NB_WORKSPACES_LIBRARY="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

#######################################
# Initialize workspace skills directory
# Creates the directory structure for workspace skills
#######################################
init_workspace_skills() {
    local skills_dir="$NB_WORKSPACES_LIBRARY/skills"

    if [[ ! -d "$skills_dir" ]]; then
        mkdir -p "$skills_dir"
        echo "[SKILL-HOTRELOAD] Created workspace skills directory: $skills_dir"

        # Create .gitignore for draft skills
        cat > "$skills_dir/.gitignore" <<'EOF'
# Ignore draft/candidate skills until promoted
.drafts/
.candidates/
EOF

        # Create README
        cat > "$skills_dir/README.md" <<'EOF'
# Workspace Skills

This directory contains workspace-level skills that are:
- **Hot-reloadable** via Claude Code's `--add-dir` mechanism
- **Shared** across all notebooks in this workspace
- **Lower priority** than personal/project skills (same-name skills are overridden)

## Usage

Launch Claude Code with this directory:

```bash
claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"
```

Or use the task-ai launcher:

```bash
task-ai-dev
```

## Directory Structure

```
skills/
├── <skill-name>/
│   ├── SKILL.md          # Main skill file (required)
│   ├── references/       # Supporting documentation
│   └── scripts/          # Executable scripts
├── .candidates/          # T1: Promotion candidates (gitignored)
├── .drafts/              # T2: Passed L2 skill-review (gitignored)
└── .active/              # T3/T4: Passed L3 skill-deep-review (gitignored)
```

## Hot-Reload Behavior

When you edit a SKILL.md file in this directory:
1. Claude Code detects the change automatically
2. The updated skill is available on the next agent turn
3. No restart required

## Skill Promotion Flow

```
Experience (.memory/.experiences/)
    ↓ highlight scope=promote
Candidate (.candidates/<slug>/)
    ↓ check --skill (six-dimension audit)
Draft (.drafts/<slug>/)
    ↓ check --skill-deep-review (L3 deep semantic audit)
Active (.active/<slug>/)
```
EOF
        echo "[SKILL-HOTRELOAD] Initialized workspace skills with README"
    fi

    # Ensure subdirectories exist
    mkdir -p "$skills_dir/.candidates"
    mkdir -p "$skills_dir/.drafts"
    mkdir -p "$skills_dir/.active"

    echo "$skills_dir"
}

#######################################
# Get the --add-dir argument for Claude Code
# Returns the argument string to add workspace skills
#######################################
get_adddir_arg() {
    local skills_dir
    skills_dir=$(init_workspace_skills)
    echo "--add-dir \"$skills_dir\""
}

#######################################
# Launch Claude Code with workspace skills hot-reload
# Wraps the claude command with --add-dir
#######################################
launch_with_hotreload() {
    local skills_dir
    skills_dir=$(init_workspace_skills)

    echo "[SKILL-HOTRELOAD] Launching Claude Code with workspace skills"
    echo "[SKILL-HOTRELOAD] Hot-reload directory: $skills_dir"
    echo ""

    # Pass through all arguments to claude
    claude --add-dir "$skills_dir" "$@"
}

#######################################
# List workspace skills
#######################################
list_workspace_skills() {
    local skills_dir="$NB_WORKSPACES_LIBRARY/skills"

    if [[ ! -d "$skills_dir" ]]; then
        echo "No workspace skills directory found."
        return 1
    fi

    echo "=== Workspace Skills ==="
    echo "Directory: $skills_dir"
    echo ""

    local count=0
    for skill_dir in "$skills_dir"/*/; do
        if [[ -f "$skill_dir/SKILL.md" ]]; then
            local name=$(basename "$skill_dir")
            local desc=$(grep -E '^description:' "$skill_dir/SKILL.md" 2>/dev/null | head -1 | sed 's/^description:[[:space:]]*//' || echo "(no description)")
            echo "  /$name — $desc"
            ((count++)) || true
        fi
    done

    if [[ $count -eq 0 ]]; then
        echo "  (no skills found)"
    fi

    echo ""
    echo "Candidates (T1): $(ls -1 "$skills_dir/.candidates" 2>/dev/null | wc -l | tr -d ' ')"
    echo "Drafts (T2): $(ls -1 "$skills_dir/.drafts" 2>/dev/null | wc -l | tr -d ' ')"
    echo "Active (T3/T4): $(ls -1 "$skills_dir/.active" 2>/dev/null | wc -l | tr -d ' ')"
}

#######################################
# Create a new workspace skill from template
#######################################
create_workspace_skill() {
    local name="${1:-}"
    local desc="${2:-A workspace skill}"

    if [[ -z "$name" ]]; then
        echo "Usage: create_workspace_skill <name> [description]" >&2
        return 1
    fi

    # D2: Validate skill name to prevent path traversal and injection
    if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "[ERROR] Invalid skill name: '$name'. Use only letters, digits, hyphens, underscores." >&2
        return 1
    fi

    local skills_dir="$NB_WORKSPACES_LIBRARY/skills"
    local skill_dir="$skills_dir/$name"

    if [[ -d "$skill_dir" ]]; then
        echo "Skill '$name' already exists at $skill_dir" >&2
        return 1
    fi

    mkdir -p "$skill_dir"

    cat > "$skill_dir/SKILL.md" <<EOF
---
name: $name
description: $desc
disable-model-invocation: false
user-invocable: true
---

# /$name

## Overview

[Describe what this skill does]

## Steps

1. [First step]
2. [Second step]
3. [Third step]

## Examples

\`\`\`
/$name example-argument
\`\`\`

## Notes

- [Important considerations]
EOF

    echo "[SKILL-HOTRELOAD] Created workspace skill: $skill_dir/SKILL.md"
    echo ""
    echo "Edit the skill file and it will be hot-reloaded automatically."
}

#######################################
# Promote a candidate skill to workspace
#######################################
promote_skill() {
    local candidate_name="${1:-}"

    if [[ -z "$candidate_name" ]]; then
        echo "Usage: promote_skill <candidate-name>" >&2
        return 1
    fi

    # D2: Validate candidate name to prevent path traversal
    if [[ ! "$candidate_name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "[ERROR] Invalid candidate name: '$candidate_name'. Use only letters, digits, hyphens, underscores." >&2
        return 1
    fi

    local skills_dir="$NB_WORKSPACES_LIBRARY/skills"
    local candidate_dir="$skills_dir/.candidates/$candidate_name"
    local target_dir="$skills_dir/$candidate_name"

    if [[ ! -d "$candidate_dir" ]]; then
        echo "Candidate '$candidate_name' not found at $candidate_dir" >&2
        return 1
    fi

    if [[ -d "$target_dir" ]]; then
        echo "Skill '$candidate_name' already exists. Use a different name or remove existing." >&2
        return 1
    fi

    mv "$candidate_dir" "$target_dir"
    echo "[SKILL-HOTRELOAD] Promoted: $candidate_name"
    echo "Skill is now active at: $target_dir"
}

#######################################
# Main: if run directly, show help or execute command
#######################################
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-help}" in
        init)
            init_workspace_skills
            ;;
        launch)
            shift
            launch_with_hotreload "$@"
            ;;
        list)
            list_workspace_skills
            ;;
        create)
            shift
            create_workspace_skill "$@"
            ;;
        promote)
            shift
            promote_skill "$@"
            ;;
        adddir)
            get_adddir_arg
            ;;
        *)
            cat <<EOF
task-ai Skill Hot-Reload

Usage:
  $(basename "$0") init              Initialize workspace skills directory
  $(basename "$0") launch [args...]  Launch Claude Code with hot-reload
  $(basename "$0") list              List workspace skills
  $(basename "$0") create <name>     Create a new skill from template
  $(basename "$0") promote <name>    Promote candidate to workspace skill
  $(basename "$0") adddir            Print --add-dir argument

Environment:
  NB_WORKSPACES_LIBRARY   Library path (default: \$NB_WORKSPACES_ROOT/.library)

Examples:
  # Initialize and launch
  $(basename "$0") init
  $(basename "$0") launch

  # Create a new skill
  $(basename "$0") create my-workflow "Automates my workflow"

  # List current skills
  $(basename "$0") list

  # Or source this file and use functions directly:
  source $(basename "$0")
  launch_with_hotreload
EOF
            ;;
    esac
fi
