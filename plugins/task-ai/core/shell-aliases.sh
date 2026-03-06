#!/usr/bin/env bash
# task-ai Shell Aliases
# Source this file in your ~/.bashrc or ~/.zshrc:
#   source /path/to/task-ai/core/shell-aliases.sh

# Resolve task-ai root
TASK_AI_ROOT="${TASK_AI_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Default library path
export NB_WORKSPACES_LIBRARY="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-$HOME}/.library}"

#######################################
# task-ai-dev: Launch Claude Code with skill hot-reload
#
# This alias enables live change detection for workspace skills.
# Any changes to $NB_WORKSPACES_LIBRARY/skills/ are picked up
# automatically on the next agent turn without restart.
#
# Usage:
#   task-ai-dev                    # Launch with hot-reload
#   task-ai-dev --resume           # Resume with hot-reload
#   task-ai-dev -p "my prompt"     # Launch with prompt
#######################################
task-ai-dev() {
    local skills_dir="$NB_WORKSPACES_LIBRARY/skills"

    # Initialize if needed
    if [[ ! -d "$skills_dir" ]]; then
        bash "$TASK_AI_ROOT/core/skill-hotreload.sh" init
    fi

    echo "╭─────────────────────────────────────────────────────╮"
    echo "│  task-ai dev mode (skill hot-reload enabled)        │"
    echo "│  Edit SKILL.md → changes apply on next turn         │"
    echo "├─────────────────────────────────────────────────────┤"
    echo "│  Hot-reload: $skills_dir"
    echo "╰─────────────────────────────────────────────────────╯"
    echo ""

    claude --add-dir "$skills_dir" "$@"
}

#######################################
# task-ai-skill: Workspace skill management
#
# Usage:
#   task-ai-skill list             # List workspace skills
#   task-ai-skill create <name>    # Create new skill
#   task-ai-skill promote <name>   # Promote candidate
#######################################
task-ai-skill() {
    bash "$TASK_AI_ROOT/core/skill-hotreload.sh" "$@"
}

#######################################
# /reload skill for manual refresh
# Creates a skill that sends SIGHUP to restart Claude Code
# while preserving session context
#######################################
install_reload_skill() {
    local skills_dir="$NB_WORKSPACES_LIBRARY/skills"
    local reload_dir="$skills_dir/reload"

    mkdir -p "$reload_dir"

    cat > "$reload_dir/SKILL.md" <<'EOF'
---
name: reload
description: Reload Claude Code to pick up configuration and skill changes immediately
disable-model-invocation: true
user-invocable: true
---

!`kill -HUP $PPID`
EOF

    echo "[task-ai] Installed /reload skill at $reload_dir"
    echo "Use /reload to restart Claude Code and pick up all changes immediately."
}

# Export functions for subshells
export -f task-ai-dev 2>/dev/null || true
export -f task-ai-skill 2>/dev/null || true
