# Library Write Protocol

**Every sub-command that writes to `$NB_WORKSPACES_LIBRARY/` MUST follow this six-step protocol:**

```
1. mkdir -p   target sub-directory (idempotent)
2. Acquire    directory-level .lock  (O_CREAT|O_EXCL atomic create)
              Stale-lock recovery: rename .lock → .lock.stale.<pid>, then re-acquire;
              clean up all .lock.stale.* after successful acquisition
3. Write file — overwrite mode: write to <file>.tmp → rename to <file>  (POSIX atomic)
             — append mode:    O_APPEND to existing file               (POSIX atomic)
             — append separator: prepend --- before each appended record (frontmatter included)
4. Acquire    .changelog.lock (same O_CREAT|O_EXCL protocol, very brief hold)
              → append one ASCII line to .changelog
              → release .changelog.lock
5. Update     directory .index.md: append row for new files; overwrite matching row for updates
              (while still holding directory .lock from step 2)
6. Release    directory-level .lock
```

**Changelog line format** (ASCII only — no multi-byte characters):

```
2026-02-21T14:32Z | experience  | .memory/.experiences/software/auth-refactor-complete.md | quality_status:verified
2026-02-21T15:10Z | reference   | .memory/.references/jwt-auth-v3.md                      | topic:jwt-auth,staleness-refresh
2026-02-21T16:00Z | referenced  | .memory/.references/jwt-auth-v3.md                      | caller:plan,notebook:auth-refactor
```

Supported entry types: `experience`, `reference`, `type-profile`, `pattern`, `referenced`

**Append vs overwrite per file category:**

| Mode | File types |
|------|-----------|
| Append (`---` separator + O_APPEND index) | `.memory/.thinking/raw/<nb>-<step>-<date>.md`; `<nb>-impl.md`; `<nb>-verify.md`; `<nb>-eval.md` |
| Overwrite (`.tmp → rename`) | `<nb>-complete.md`; `.memory/.thinking/patterns/*.md`; `.memory/.type-profiles/*.md`; all `.summary.md`; all `.index.md` |

**Note on `.summary.md` staleness**: `exec`, `verify`, and `check` update `.index.md` when writing partial experience files, but do NOT rebuild `.memory/.experiences/<type>/.summary.md` (prose index). That summary is rebuilt by `highlight` (scope=complete, steps 4f-4g). Until `report` runs, the prose summary may not reflect the latest partial entries. Use `library maintain --rebuild-index` to refresh all summaries on demand.

**Lock ordering**: All library locks follow the global lock ordering convention documented in `commands/task-ai.md` (Lock Ordering Convention section). `.changelog.lock` is always the innermost lock (acquired last, released first).

> See `library/references/write-protocol.md` for per-directory lock table, hold duration, and stale-lock recovery procedure.
