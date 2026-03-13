#!/usr/bin/env bash
# L1: Verify .auto-signal result/next/checkpoint values are in the whitelist
source "$(dirname "$0")/lib.sh"

# Load whitelists from fixture
SIGNALS_FILE="$FIXTURES/expected-signals.json"
if [[ ! -f "$SIGNALS_FILE" ]]; then
  emit_fail "expected-signals.json fixture missing"
  summary; exit $?
fi

JSON_GET="$TASK_AI_ROOT/.dev/contracts/json_get.py"
result_whitelist=$(python3 "$JSON_GET" "$SIGNALS_FILE" result_whitelist --join)
next_whitelist=$(python3 "$JSON_GET" "$SIGNALS_FILE" next_whitelist --join)
checkpoint_whitelist=$(python3 "$JSON_GET" "$SIGNALS_FILE" checkpoint_whitelist --join)

# Scan all SKILL.md files for .auto-signal sections
while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")

  # Extract .auto-signal section
  signal_section=$(extract_section "$skill_file" "## .auto-signal")
  [[ -z "$signal_section" ]] && continue

  # Strip code blocks to get the actual signal documentation
  stripped=$(echo "$signal_section" | strip_code_blocks)

  # Look for result values in table rows or JSON examples
  # Parse table rows with | result | value |
  while IFS= read -r line; do
    [[ "$line" =~ ^\| ]] || continue
    [[ "$line" =~ ^-+$ ]] && continue
    [[ "$line" =~ ^\|[[:space:]]*-+ ]] && continue

    # Extract result field from signal documentation tables
    # Common patterns: | `(done)` | or | result | `(done)` |
    while [[ "$line" =~ \`([^\`]+)\` ]]; do
      val="${BASH_REMATCH[1]}"
      line="${line#*"${BASH_REMATCH[0]}"}"

      # Check if this looks like a result value
      if echo "$result_whitelist" | grep -qxF "$val"; then
        emit_pass "$skill_name: signal result '$val' in whitelist"
      elif echo "$next_whitelist" | grep -qxF "$val"; then
        emit_pass "$skill_name: signal next '$val' in whitelist"
      elif echo "$checkpoint_whitelist" | grep -qxF "$val"; then
        emit_pass "$skill_name: signal checkpoint '$val' in whitelist"
      elif [[ "$val" =~ ^step-[0-9]+$ ]]; then
        # step-N pattern (matches step-N in whitelist)
        emit_pass "$skill_name: signal '$val' matches step-N pattern"
      elif [[ "$val" == "result" || "$val" == "next" || "$val" == "checkpoint" || "$val" == "step" || "$val" == "iteration" || "$val" == "timestamp" || "$val" == "compaction_count" || "$val" == "tdd_cycles_completed" || "$val" == "vfp_cycles_completed" ]]; then
        # Field names, not values — skip
        :
      fi
    done
  done <<< "$signal_section"

  # Also check JSON examples in signal section
  while IFS= read -r line; do
    # Match "result": "value" patterns
    if [[ "$line" =~ \"result\":[[:space:]]*\"([^\"]+)\" ]]; then
      val="${BASH_REMATCH[1]}"
      if echo "$result_whitelist" | grep -qxF "$val"; then
        emit_pass "$skill_name: signal result '$val' in whitelist"
      else
        emit_fail "$skill_name: signal result '$val' NOT in whitelist"
      fi
    fi
    if [[ "$line" =~ \"next\":[[:space:]]*\"([^\"]+)\" ]]; then
      val="${BASH_REMATCH[1]}"
      if echo "$next_whitelist" | grep -qxF "$val"; then
        emit_pass "$skill_name: signal next '$val' in whitelist"
      else
        emit_fail "$skill_name: signal next '$val' NOT in whitelist"
      fi
    fi
  done <<< "$signal_section"
done < <(find_skills)

# Also check auto routing table
auto_skill="$TASK_AI_ROOT/skills/auto/SKILL.md"
if [[ -f "$auto_skill" ]]; then
  routing_section=$(extract_section "$auto_skill" "### Result-Based Routing")
  [[ -z "$routing_section" ]] && routing_section=$(extract_section "$auto_skill" "## Result-Based Routing")

  if [[ -n "$routing_section" ]]; then
    while IFS= read -r line; do
      [[ "$line" =~ ^\| ]] || continue
      [[ "$line" =~ ^\|[[:space:]]*-+ ]] && continue

      # Extract values from routing table columns
      IFS='|' read -ra cols <<< "$line"
      for col in "${cols[@]}"; do
        col=$(echo "$col" | xargs)
        [[ -z "$col" ]] && continue
        # Strip backticks
        col="${col//\`/}"

        if echo "$result_whitelist" | grep -qxF "$col"; then
          : # valid result value
        elif echo "$next_whitelist" | grep -qxF "$col"; then
          : # valid next value
        fi
      done
    done <<< "$routing_section"
  fi
fi

summary
