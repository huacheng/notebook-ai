#!/bin/bash
set -e

# Start cron service (as root)
service cron start

# Configure git for node user if not already done
if [ ! -f /home/node/.gitconfig ]; then
    su node -c 'git config --global user.email "notebook@docker" && git config --global user.name "Notebook User" && git config --global init.defaultBranch master'
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
