#!/usr/bin/env bash
# L1: Verify published plugin directory matches development source
source "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$TASK_AI_ROOT" && git rev-parse --show-toplevel)"
PLUGIN_DIR="$REPO_ROOT/plugins/task-ai"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  emit_warn "plugins/task-ai/ directory not found — skipping publish sync check"
  summary; exit $?
fi

# Publishable files: skills/*/SKILL.md, skills/*/references/*.md, skills/*/scripts/*,
# commands/*.md, commands/references/*.md, REFERENCE-INDEX.md, plugin.json
DIFFS_FOUND=0

# Compare all SKILL.md files
while IFS= read -r dev_file; do
  rel=$(realpath --relative-to="$TASK_AI_ROOT" "$dev_file")
  pub_file="$PLUGIN_DIR/$rel"
  if [[ ! -f "$pub_file" ]]; then
    emit_fail "publish-sync: '$rel' missing from plugins/task-ai/"
    DIFFS_FOUND=1
  elif ! diff -q "$dev_file" "$pub_file" > /dev/null 2>&1; then
    emit_fail "publish-sync: '$rel' differs between dev and publish"
    DIFFS_FOUND=1
  fi
done < <(find "$TASK_AI_ROOT/skills" -name "SKILL.md" -o -name "*.md" -path "*/references/*" | sort)

# Compare commands
while IFS= read -r dev_file; do
  rel=$(realpath --relative-to="$TASK_AI_ROOT" "$dev_file")
  pub_file="$PLUGIN_DIR/$rel"
  if [[ ! -f "$pub_file" ]]; then
    emit_fail "publish-sync: '$rel' missing from plugins/task-ai/"
    DIFFS_FOUND=1
  elif ! diff -q "$dev_file" "$pub_file" > /dev/null 2>&1; then
    emit_fail "publish-sync: '$rel' differs between dev and publish"
    DIFFS_FOUND=1
  fi
done < <(find "$TASK_AI_ROOT/commands" -name "*.md" | sort)

# Compare scripts
while IFS= read -r dev_file; do
  rel=$(realpath --relative-to="$TASK_AI_ROOT" "$dev_file")
  pub_file="$PLUGIN_DIR/$rel"
  if [[ ! -f "$pub_file" ]]; then
    emit_fail "publish-sync: '$rel' missing from plugins/task-ai/"
    DIFFS_FOUND=1
  elif ! diff -q "$dev_file" "$pub_file" > /dev/null 2>&1; then
    emit_fail "publish-sync: '$rel' differs between dev and publish"
    DIFFS_FOUND=1
  fi
done < <(find "$TASK_AI_ROOT/skills" -name "*.sh" -o -name "*.py" | sort)

# Compare core/
if [[ -d "$TASK_AI_ROOT/core" ]]; then
  while IFS= read -r dev_file; do
    rel=$(realpath --relative-to="$TASK_AI_ROOT" "$dev_file")
    pub_file="$PLUGIN_DIR/$rel"
    if [[ ! -f "$pub_file" ]]; then
      emit_fail "publish-sync: '$rel' missing from plugins/task-ai/"
      DIFFS_FOUND=1
    elif ! diff -q "$dev_file" "$pub_file" > /dev/null 2>&1; then
      emit_fail "publish-sync: '$rel' differs between dev and publish"
      DIFFS_FOUND=1
    fi
  done < <(find "$TASK_AI_ROOT/core" -type f -name "*.py" | sort)
fi

# Compare root files
for root_file in REFERENCE-INDEX.md plugin.json; do
  dev="$TASK_AI_ROOT/$root_file"
  pub="$PLUGIN_DIR/$root_file"
  [[ ! -f "$dev" ]] && continue
  if [[ ! -f "$pub" ]]; then
    emit_fail "publish-sync: '$root_file' missing from plugins/task-ai/"
    DIFFS_FOUND=1
  elif ! diff -q "$dev" "$pub" > /dev/null 2>&1; then
    emit_fail "publish-sync: '$root_file' differs"
    DIFFS_FOUND=1
  fi
done

if [[ $DIFFS_FOUND -eq 0 ]]; then
  emit_pass "publish-sync: all publishable files in sync"
fi

summary
