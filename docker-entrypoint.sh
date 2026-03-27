#!/bin/bash
set -e

# Start cron service (as root)
service cron start

# Configure git for node user if not already done
if [ ! -f /home/node/.gitconfig ]; then
    su node -c 'git config --global user.email "notebook@docker" && git config --global user.name "Notebook User" && git config --global init.defaultBranch master'
fi

# Setup Claude plugins configuration
# Only credential files are mounted from host; plugin config is created here
CLAUDE_DIR="/home/node/.claude"
PLUGINS_DIR="$CLAUDE_DIR/plugins"

# Create installed_plugins.json with container paths for task-ai (if not already done)
TASK_AI_PATH=$(ls -d "$PLUGINS_DIR/cache/moonview/task-ai"/*/ 2>/dev/null | sort -V | tail -1)
TASK_AI_VERSION=$(basename "$TASK_AI_PATH" 2>/dev/null)
if [ -n "$TASK_AI_VERSION" ] && [ ! -f "$PLUGINS_DIR/.docker-configured" ]; then
    cat > "$PLUGINS_DIR/installed_plugins.json" << EOF
{
  "version": 2,
  "plugins": {
    "task-ai@moonview": [
      {
        "scope": "user",
        "installPath": "$PLUGINS_DIR/cache/moonview/task-ai/$TASK_AI_VERSION",
        "version": "$TASK_AI_VERSION",
        "installedAt": "$(date -Iseconds)",
        "lastUpdated": "$(date -Iseconds)"
      }
    ]
  }
}
EOF
    # Create settings.json to enable the plugin
    # Use CLAUDE_MODEL env var if set, otherwise default to sonnet
    CLAUDE_MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"
    cat > "$CLAUDE_DIR/settings.json" << EOF
{
  "model": "$CLAUDE_MODEL",
  "enabledPlugins": {
    "task-ai@moonview": true
  },
  "skipDangerousModePermissionPrompt": true
}
EOF
    touch "$PLUGINS_DIR/.docker-configured"
    # chown only writable files (skip read-only mounted credentials)
    chown node:node "$PLUGINS_DIR/installed_plugins.json" "$CLAUDE_DIR/settings.json" "$PLUGINS_DIR/.docker-configured" 2>/dev/null || true
    echo "[entrypoint] Configured task-ai@$TASK_AI_VERSION plugin"
fi

# Install task-ai cron if plugin exists and cron not configured
MAINTAIN_SH="/home/node/.claude/plugins/cache/moonview/task-ai/*/skills/library/scripts/maintain.sh"
MAINTAIN_PATH=$(ls -d $MAINTAIN_SH 2>/dev/null | sort -V | tail -1)

if [ -n "$MAINTAIN_PATH" ] && [ -f "$MAINTAIN_PATH" ]; then
    # Check if cron already configured for node user
    if ! su node -c 'crontab -l 2>/dev/null' | grep -q 'task-ai:scheduled'; then
        echo "Installing task-ai maintenance cron..."
        export NB_WORKSPACES_ROOT="${NB_WORKSPACES_ROOT:-/data/workspaces}"
        su node -c "NB_WORKSPACES_ROOT='$NB_WORKSPACES_ROOT' bash '$MAINTAIN_PATH' --install-cron" || echo "Warning: Failed to install cron"
    fi
fi

# Ensure data directory ownership
chown -R node:node /data 2>/dev/null || true

# Run the main command as node user
exec gosu node "$@"
