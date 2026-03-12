# Library Write Protocol — Reference

All sub-commands that write to `$NB_WORKSPACES_LIBRARY/` MUST follow the eight-step protocol. This file provides the per-directory lock table, hold duration guidance, and stale-lock recovery procedure.

## Eight-Step Protocol

All library writers MUST execute these steps in order:

1. **mkdir -p** — ensure target directory exists (idempotent)
2. **Acquire lock** — create `<dir>/.lock` with `O_CREAT|O_EXCL`; write `{ "pid", "session", "timestamp" }`
3. **Write file** — write content via `.tmp` + atomic `rename` (overwrite) or `O_APPEND` (append)
4. **Changelog append** — append one line to `.changelog` via `.changelog.lock` (see format below)
5. **Update index** — append/update row in directory `.index.md` and `.master-index.md`
6. **Update relations** — extract `related_references` from frontmatter, append to `.relations.jsonl` (O_APPEND)
   - Run: `python3 append-relations.py <file_path> [--notebook <name>]`
   - Enables immediate graph search discovery of new file's associations
7. **Release lock** — close fd and remove `<dir>/.lock`
8. **Git commit** — `cd $NB_WORKSPACES_LIBRARY && git add -A && git commit -m "library(<category>): <action> <topic>"`
   - `<category>`: `reference` | `experience` | `type-profile` | `pattern`
   - Example: `library(reference): add jwt-auth-v2`

## Per-Directory Lock Table

| Directory | Lock file | Writers | Typical hold |
|-----------|-----------|---------|-------------|
| `.memory/.references/` | `.memory/.references/.lock` | `read`, `research`, `exec`, `check`, `maintain` | Medium (web fetch + write) |
| `.memory/.experiences/` | `.memory/.experiences/.lock` | `report`, `exec`, `verify`, `check` | Short (write + index append) |
| `.memory/.type-profiles/` | `.memory/.type-profiles/.lock` | `research`, `report` | Short (profile write) |
| `.memory/.thinking/patterns/` | `.memory/.thinking/patterns/.lock` | `report` | Long (read raw/ + distil + write) |
| `.changelog` | `.changelog.lock` | All library writers (step 4) | Very short (single O_APPEND) |

`raw/` has **no lock file**: filenames are unique by design (`<notebook>-<step>-<date>.md`); index appends use O_APPEND (POSIX atomic). Do not add a lock to `.memory/.thinking/raw/`.

## Stale-Lock Recovery Procedure

Use `rename`-based recovery instead of delete+create to avoid TOCTOU races:

```
1. open .lock  → read { pid, session, timestamp }
2. kill -0 <pid>  → if alive: REJECT with error ("lock held by session <session>")
3. if dead (stale):
   a. rename .lock → .lock.stale.<pid>          # atomic; fails if another process already recovered
   b. if rename fails → goto step 1             # another process recovered first, retry from top
   c. create new .lock with O_CREAT|O_EXCL      # acquire fresh lock
4. After successful acquisition: remove all .lock.stale.* in same directory
```

Lock file content (JSON):

```json
{ "pid": 12345, "session": "my-session-id", "timestamp": "2026-02-21T14:32:00Z" }
```

## .changelog Line Format

All fields ASCII only. Line format:

```
<ISO8601Z> | <type> | <subpath> | <tags>
```

| Field | Values | Example |
|-------|--------|---------|
| `type` | `experience`, `reference`, `type-profile`, `pattern`, `referenced` | `reference` |
| `subpath` | Path relative to `$NB_WORKSPACES_LIBRARY/` | `.memory/.references/jwt-auth-v3.md` |
| `tags` | Key:value pairs, space-separated | `topic:jwt-auth quality_status:verified` |

**`referenced` lines** (written by reader sub-commands when loading a file):

```
2026-02-21T16:00Z | referenced | .memory/.references/jwt-auth-v3.md | caller:plan notebook:auth-refactor
```

Used by `maintain` to count usage for `effectiveness_mark` candidate detection.

## .index.md Row Formats

### `.memory/.references/.index.md`

```markdown
| topic | versions | marked_version | source_domain | last_verified | stale | injection_risk |
|-------|---------|----------------|---------------|---------------|-------|----------------|
| jwt-auth | v1,v2,v3 | v2 | auth0.com | 2026-01-10 | no | none |
| redis-session | v1 | — | redis.io | 2025-06-01 | yes(!) | low |
```

### `.memory/.experiences/<type>/.index.md`

```markdown
| notebook | sources | quality_status | effectiveness_mark | updated |
|----------|---------|----------------|--------------------|---------|
| auth-refactor | complete,impl | verified | ✓ | 2026-02-01 |
| api-design | impl,eval | provisional | — | 2026-01-15 |
```

### `.memory/.type-profiles/.index.md`

```markdown
| type | file | task_count | last_updated |
|------|------|------------|--------------|
| software | software.md | 12 | 2026-02-10 |
| data-pipeline | data-pipeline.md | 3 | 2026-01-20 |
```

### `.memory/.thinking/patterns/.index.md`

```markdown
| problem-type | file | state | failure_count | validated_uses | last_updated |
|-------------|------|-------|---------------|----------------|--------------|
| replan-loop | replan-loop.md | validated | 0 | 4 | 2026-02-15 |
| type-mismatch | type-mismatch.md | deprecated | 2 | 1 | 2026-01-05 |
```

### `.memory/.thinking/raw/.index.md` (append-log format)

```markdown
| timestamp | notebook | step | quality_prompt | quality_thinking | quality_output | file |
|-----------|----------|------|----------------|-----------------|----------------|------|
| 2026-02-21T14:32Z | auth-refactor | plan | H | M | H | auth-refactor-plan-2026-02-21.md |
```

Rows are appended (O_APPEND, no lock); duplicates removed by `maintain --rebuild-index`.

## .master-index.md Format

Flat index of all library files — used for cold-start full-match when `changelog_offset` is invalid:

```markdown
# Library Master Index
<!-- Updated by: init (skeleton), all writers (append), maintain --rebuild-index (rebuild) -->

| Topic | Type | Keywords | File Path | Source |
|-------|------|----------|-----------|--------|
| jwt-auth | reference | jwt, auth, session | .memory/.references/jwt-auth-v3.md | system |
| software | experience | auth, refactor | .memory/.experiences/software/auth-refactor-complete.md | system |
| software | type-profile | methodology | .memory/.type-profiles/software.md | system |
| replan-loop | pattern | replan, loop | .memory/.thinking/patterns/replan-loop.md | system |
| api-spec | user-import | | company-docs/api-spec.md | user-import |
```

Writers append one row after each write (step 5 extended for master index). `maintain --rebuild-index` rebuilds it from ground truth.

## Append vs Overwrite Decision Table

| File | Mode | Rationale |
|------|------|-----------|
| `.memory/.thinking/raw/<nb>-<step>-<date>.md` | Append | Same-day re-runs in auto mode |
| `<nb>-impl.md` | Append | exec produces incremental notes across steps |
| `<nb>-verify.md` | Append | verify may run multiple passes |
| `<nb>-eval.md` | Append | check may run at multiple checkpoints |
| `<nb>-complete.md` | Overwrite | Authoritative final record; one per notebook |
| `.memory/.thinking/patterns/<problem-type>.md` | Overwrite | Single canonical pattern per problem type |
| `.memory/.type-profiles/<type>.md` | Overwrite | Single authoritative profile; append to refinement-log section |
| `.summary.md` (all) | Overwrite | Always reflects current state of directory |
| `.index.md` (all except raw) | Overwrite row / append row | Update existing row in-place OR append new row |
| `.memory/.thinking/raw/.index.md` | Append (O_APPEND) | Log-style; no lock; maintain deduplicates |
| `.master-index.md` | Append row / rebuild | Append on write; full rebuild on maintain |
| `.changelog` | Append (O_APPEND via .changelog.lock) | Immutable history |

## Atomicity Guarantees

| Operation | Atomic mechanism |
|-----------|-----------------|
| Overwrite file | `.tmp → rename` (POSIX `rename(2)` is atomic within same filesystem) |
| Append to file | `O_APPEND` flag (POSIX: single write ≤ PIPE_BUF bytes is atomic) |
| Lock acquisition | `O_CREAT \| O_EXCL` (POSIX: atomic create-if-not-exists) |
| `.status.json` (task module) | `.tmp → rename` (same convention as library files) |

Keep individual O_APPEND writes under 4096 bytes (PIPE_BUF on Linux) to guarantee atomicity.
