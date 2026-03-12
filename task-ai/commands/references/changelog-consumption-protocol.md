# Changelog Consumption Protocol

Sub-commands that load library context at startup (plan, research, exec, check, verify) MUST follow this protocol:

```
1. Read   <project>/.worktrees/task-<notebook>/.working/.library-state.json
          → last_library_read  (ISO 8601 timestamp)
          → changelog_offset   (byte offset into .changelog)

2. open($NB_WORKSPACES_LIBRARY/.changelog)
          → seek(changelog_offset)
          → read lines from offset to EOF

3. Score each new line using per-directory relevance scoring (same as library search):
          Lines scoring ≥ threshold → load the referenced library file

4. Write  <project>/.worktrees/task-<notebook>/.working/.library-state.json  (atomic: .tmp → rename)
          → last_library_read  = now
          → changelog_offset   = new EOF byte position
```

## Three-Tier Degradation Path

| Condition | Action |
|-----------|--------|
| `changelog_offset` valid and ≤ file size | Seek directly — O(1) |
| `changelog_offset` > file size (post-compact) OR `last_library_read` is empty | Read `.master-index.md` full-text match; reset offset to EOF after |
| `.master-index.md` missing (library not yet initialised) | Log warning; continue without library context — do not block task |

## `.library-state.json` Schema

```json
{ "last_library_read": "2026-02-21T14:00:00Z", "changelog_offset": 1247 }
```

Parse failure recovery: reset to `{ "last_library_read": "", "changelog_offset": 0 }` and trigger degradation tier 2.

## Context Window Budget

Default 4000 tokens per sub-command library load. Per-notebook override: add `"library_context_budget": <tokens>` to `.library-state.json`.
