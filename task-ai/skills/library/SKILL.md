---
name: library
description: "Cross-task knowledge library management — search, list, audit, maintain, and evolve the shared .library/ knowledge base. Includes security rules evolution loop (separate from task auto loop)."
model_tier: light
auto_delegatable: true
triggers:
  keywords:
    zh: [知识库, 图书馆, 搜索参考, 查经验, 知识管理, 参考文献, 规则进化, 安全扫描]
    en: [library, knowledge base, search references, find experience, knowledge management, rule evolution, security scan]
  phrases:
    zh: [搜索知识库, 查查经验, 有没有参考, 知识库里有什么, 维护知识库, 知识库状态, 检查安全规则, 进化规则, 安全更新]
    en: [search the library, find related references, what's in the knowledge base, library status, maintain library, check security rules, evolve rules, security update]
  disambiguate: >
    Core intent: query or maintain the shared cross-task knowledge library (.library/).
    User wants to SEARCH existing knowledge → library search.
    User wants to COLLECT NEW knowledge via web research → research. User wants to INGEST a local file → read.
arguments:
  - name: operation
    description: "Operation: search, list, status, maintain, or evolve"
    required: true
  - name: query
    description: "Search query string (for search)"
    required: false
  - name: type
    description: "Filter by task type, e.g. software or data-pipeline (for search and list)"
    required: false
  - name: topic
    description: "Filter by reference topic (for search and list)"
    required: false
  - name: notebook
    description: "Filter experiences by source notebook name, matched against frontmatter sources.notebook (for search)"
    required: false
  - name: rebuild-index
    description: "Rebuild all .index.md files from actual file contents (for maintain)"
    required: false
  - name: compact
    description: "Archive .changelog entries older than 90 days and write compaction marker (for maintain)"
    required: false
  - name: check-staleness
    description: "Report references and experiences past staleness threshold without auto-triggering research (for maintain)"
    required: false
  - name: all
    description: "Run rebuild-index → compact → check-staleness in sequence (for maintain)"
    required: false
---

# /task-ai:library — Knowledge Library Management

The shared knowledge library at `$NB_WORKSPACES_ROOT/.library/` aggregates cross-task experiences, external references, domain type profiles, and Thinking CoT patterns. This sub-command provides five operations: `search`, `list`, `status`, `maintain`, and `evolve`.

`library` is a **pure utility sub-command**: no task status changes, no participation in the automation loop.

`$NB_WORKSPACES_LIBRARY` = `$NB_WORKSPACES_ROOT/.library` (same path, shorter alias used throughout).

## Usage

```
/task-ai:library search "<query>" [--type <type>] [--limit N] [--no-recommend]
/task-ai:library list [--type <type>]
/task-ai:library status
/task-ai:library maintain [--mode quick|audit] [--rebuild-index] [--rebuild-relations] [--compact] [--check-staleness] [--all] [--scheduled [--force]] [--install-cron] [--uninstall-cron]
/task-ai:library write <path> [--content <content>] [--content-file <file>] [--notebook <name>] [--no-commit]
```

## Library Directory Structure

The library lives at `$NB_WORKSPACES_ROOT/.library/` with sub-directories for `.memory/` (references, experiences, type-profiles, thinking), `.skills/` (candidate/draft/active promotion pipeline), and user-imported content. Each directory level has `.index.md` (structured lookup) and `.summary.md` (prose overview).

> See `references/directory-structure.md` for the full filesystem tree and `.index.md` vs `.summary.md` distinction.

---

## Execution Steps

The sub-command executes one of the following operations based on the provided argument:

1. **search**: Find relevant library files matching query text.
2. **list**: List library contents by category.
3. **status**: Audit library health across six dimensions.
4. **maintain**: Maintenance operations including index rebuild and changelog compaction.
5. **evolve**: Security rules evolution loop (discover → review → integrate).
6. **write**: Atomic write with full 8-step protocol (concurrency-safe).

## Operation Details

### search "<query>"

Find relevant library files using **graph-enhanced search** with multi-factor scoring.

> **Best Practice**: All sub-commands that retrieve knowledge from library (research, plan, check, exec, verify) SHOULD use `library search` rather than direct file reads. Search provides multi-factor scoring, graph-based recommendations, and token budget control. Unlike `library write` (which is mandatory for data integrity), direct reads are safe but miss optimization benefits.

```bash
/task-ai:library search "<query>" [--type <type>] [--limit 10] [--no-recommend]
```

#### Scoring Model

Search uses a composite scoring formula that balances three factors:

```
final_score = base × (0.5 + 0.3 × used_by_norm + 0.2 × freshness)
```

| Factor | Weight | Description |
|--------|--------|-------------|
| **base** | 0.5 | Keyword match quality (topic exact=1.0, contains=0.8, keywords=0.6) |
| **used_by** | 0.3 | Reference count from `.relations.jsonl` (normalized, cap=5) |
| **freshness** | 0.2 | File age bonus: `max(0, 1 - days_old/30)` |

This balances **proven value** (used_by) with **discovery opportunity** (freshness) — new files get a 30-day window to be found before freshness decays.

#### Graph Traversal (Multi-hop Recommendations)

After direct keyword matches, search performs **BFS graph traversal** on `.relations.jsonl` to find related content:

```
Direct hit: jwt-auth (score 0.69)
    ├── H1: session-management (score 0.35) ← related-to jwt-auth
    │       └── H2: rate-limiting (score 0.09) ← related-to session-management
    └── H1: oauth-flow (score 0.27) ← related-to jwt-auth
```

| Parameter | Value | Description |
|-----------|-------|-------------|
| `MAX_GRAPH_HOPS` | 2 | Maximum traversal depth |
| `RECOMMEND_SCORE_FACTOR` | 0.5 | Score decay per hop (H2 = 0.25×) |
| `MAX_GRAPH_EXPAND` | 20 | Max nodes to expand |

Use `--no-recommend` to disable graph expansion (keyword-only search).

#### Output Format

```
Score    Hop   Topic                   Used   Fresh  Path
─────────────────────────────────────────────────────────────────
0.693    -     jwt-auth                3      0.93   .memory/.references/jwt-auth.md
0.347    H1    session-management      1      0.33   ... ← jwt-auth
0.087    H2    rate-limiting           0      0.97   ... ← session-management
```

#### Progressive Disclosure

Results support three-tier loading to minimize token cost:
- **Layer 1** (~50 tokens): Scored table above
- **Layer 2** (~200 tokens): `.summary.md` snippets for selected entries
- **Layer 3** (~500-1000 tokens): Full file content on explicit request

### `list [--type <type>]`

List library contents by category.

**Detailed Steps:**

1.  **Read** `.memory/.references/.index.md` — list all topics, version count, marked version, staleness flag
2.  **Read** `.memory/.experiences/.index.md` — list all types and semantic-name entry counts
3.  **Read** `.memory/.type-profiles/.index.md` — list all shared profiles with last-updated date
4.  **Read** `.memory/.thinking/patterns/.index.md` — list all patterns with lifecycle state (draft/active/validated/deprecated)
5.  **Read** `.memory/.thinking/raw/.index.md` — count entries by semantic name and quality tier (H/M/L)
6.  **If `--type` specified**: filter all tables to matching type or pipe-separated segments
7.  **Print formatted summary tables**

### `status`

Audit library health across six dimensions.

**Detailed Steps:**

1.  **Consistency check**: for each `.index.md` entry, verify the referenced file exists; append any missing file to `.inconsistency.log` (format: `timestamp | missing-file | <path>`)
2.  **Staleness check**: for each `.memory/.references/<topic>-v*.md`, compute `now − last_verified_at`; flag entries where result exceeds `staleness_threshold_days`
3.  **Effectiveness candidates**: scan `.changelog` `referenced` lines; compute `usage_count` (total `referenced` lines for each file) and `failure_rate` (count of `referenced` lines for the file that were followed by a REPLAN within 24 hours in the same notebook session, divided by `usage_count`, expressed as percentage); list files meeting `usage_count ≥ 3 && failure_rate < 20%` as `effectiveness_mark` suggestions for human review
4.  **IOC summary**: read `.ioc.md`, summarise domain convergence warnings; flag any domain appearing in ≥ 3 reference files
5.  **Pattern lifecycle**: read `.memory/.thinking/patterns/.index.md`; count by state; flag `deprecated` patterns needing review
6.  **Changelog size**: count lines and bytes; warn if approaching 2000-line compact threshold
7.  **Print structured health report** — do **not** modify any files

### `maintain`

Maintenance operations.

#### `--mode quick` (default when called from research)

Lightweight incremental maintenance — processes only new changelog entries since last run.

**Triggered automatically** by `research` after writing to library. No manual invocation needed.

**Detailed Steps:**

1.  **Read** `.last-maintained` timestamp (default 0 if missing)
2.  **Scan** `.changelog` for entries with `ts > .last-maintained`
3.  **For each new entry**: validate file exists, check for duplicates against existing content
4.  **Update** `.last-maintained` to current timestamp
5.  **No git commit** (files already committed by research)

**Files:**
- `.last-maintained` — timestamp of last quick maintenance run (epoch ms)

#### `--mode audit`

Alias for `--full`. Kept for backward compatibility.

#### `--rebuild-index`

Rebuild all `.index.md` files and `.master-index.md` from actual filesystem state.

**Detailed Steps:**

1.  **For each library sub-directory**: glob all `.md` files, read their frontmatter
2.  **Rebuild each `.index.md`** from ground truth — file frontmatter wins over stale index entries
3.  **Acquire directory-level `.lock`** before writing each `.index.md`; release after
4.  **Rebuild `.master-index.md`**: scan all files across `.memory/.experiences/`, `.memory/.references/`, `.memory/.type-profiles/`, `.memory/.thinking/patterns/`, `.skills/.candidates/`, `.skills/.drafts/`, and `.skills/.active/`; also scan all user-imported folders (non-dot-prefixed names in `$NB_WORKSPACES_LIBRARY/`); overwrite `.master-index.md` with complete flat index (topic, type, keywords, file path, source, and for `.skills/` entries: trust_tier T1–T4). This restores the cold-start fallback for the three-tier Changelog Consumption Protocol degradation path
5.  **IOC scan**: extract all outbound URLs from `.memory/.references/` files; tally domain counts; write/overwrite `.ioc.md` if any domain appears in ≥ 3 documents; format: `| domain | doc_count | first_seen | last_seen | risk | note |`
6.  **Fix `effectiveness_mark` uniqueness violations**: if multiple files in same topic scope or same semantic-name-type scope share `effectiveness_mark: true`, keep the one with latest `last_verified_at`, clear others (acquire lock before clearing)
7.  **Clear `.inconsistency.log`** (all issues resolved by rebuild)
8.  **Git commit**: `task-ai(library):maintain rebuild index`

#### `--compact`

Archive `.changelog` entries older than 90 days.

**Detailed Steps:**

1.  **Read** `.changelog`; identify entries with timestamp < (now − 90 days)
2.  **Group aged entries** by month; write/append to `.changelog-archive/YYYY-MM.md`
3.  **Write compaction marker** as first non-comment line of remaining `.changelog`:
   ```
   # COMPACT 2026-02-21: archived 847 lines -> .changelog-archive/2026-01.md
   ```
4.  **Remove aged entries** from `.changelog` (retain marker + recent entries)
5.  **Git add** `.changelog-archive/YYYY-MM.md` + commit: `task-ai(library):maintain archive YYYY-MM`
6.  **Offset invalidation**: notebooks whose saved `changelog_offset` now exceeds file size will automatically degrade to cold-start path on next read (reads `.master-index.md` full match then resets offset) — no per-notebook file update required

#### `--check-staleness`

Report stale knowledge without auto-triggering `research`.

**Detailed Steps:**

1.  **For each** `.memory/.references/<topic>-v*.md`: compute `now − last_verified_at`; flag if result > `staleness_threshold_days`
2.  **For each** `.memory/.experiences/<type>/<semantic>-*.md`: flag `quality_status: provisional` entries older than 90 days (check frontmatter `quality_status`) with no corresponding `verified` sibling file
3.  **Print staleness report** per file: path, days stale, suggested action (`research --scope gap` or `maintain --rebuild-index`)
4.  **Do not auto-trigger research**; remediation is the user's decision

#### `--all`

Alias for `--full`. Kept for backward compatibility.

#### `--full`

Full library maintenance — stale lock sweep + rebuild-index + rebuild-relations + compact + check-staleness + git commit.

**Detailed Steps:**

1.  **Stale lock sweep**: for each `.lock` file in library, read its `pid`; if `kill -0 <pid>` fails → remove stale lock and log cleanup
2.  **Rebuild index**: run `--rebuild-index` (rebuild all `.index.md` and `.master-index.md`)
3.  **Rebuild relations**: run `--rebuild-relations` (rebuild cross-references between library entries)
4.  **Compact**: run `--compact` (archive changelog entries >90 days old)
5.  **Check staleness**: run `--check-staleness` (report stale knowledge)
6.  **Git commit**: `cd $NB_WORKSPACES_LIBRARY && git add -A && git commit -m "library(full): full maintenance <date>"`

#### `--scheduled [--force]`

Periodic maintenance — timestamp-gated (24h interval), suitable for cron or auto loop post-report hook.

**Runs seven steps:**

1. **Staleness check** — scan `.memory/.references/` for files older than 30 days, report stale count
2. **T3→T4 production validation** — scan all `.skills/.active/` T3 skills, promote to T4 if `usage_count >= 3` and zero REPLAN failures (same logic as `--promote-skill`)
3. **Security rules evolution** — invoke `core-rule-auto.sh cron-job` (Core: 7d / Extended: 1d, own timestamp gating)
4. **Changelog auto-compact** — run `--compact` if last compact was ≥30 days ago (archives entries >90 days old)
5. **Rebuild index** — run `--rebuild-index` (daily consistency repair)
6. **Rebuild relations** — run `--rebuild-relations` (daily `.relations.jsonl` rebuild from changelog + cross-references)
7. **Git commit** — commit all maintenance changes: `library(scheduled): daily maintenance <date>`

**Timestamp gating:**
- Reads `.last-scheduled` (epoch seconds); skips if last run < 24h ago
- Reads `.last-compact` (epoch seconds); runs compact if last run ≥ 30 days ago
- `--force` bypasses the timestamp check
- On completion, writes current epoch to `.last-scheduled`

**Cron setup** (auto-configured, daily at 03:00):
```bash
maintain.sh --install-cron    # idempotent, version-independent path, output → .scheduled.log
maintain.sh --uninstall-cron  # safe removal, preserves other crontab entries
```

**Auto loop integration**: auto calls `maintain.sh --scheduled` after report's `(stop)` signal — runs only if 24h have elapsed, zero overhead otherwise.

### `evolve`

Security rules evolution loop — discovers new threats and evolves Core/Extended rules.

**This is a separate loop from `auto`** — does not participate in task execution.

#### Sub-commands

| Command | Description |
|---------|-------------|
| `evolve --status` | Show last scan time, pending proposals, rule counts |
| `evolve --discover` | Search external intel for new threats (LLM-driven) |
| `evolve --full` | Run full pipeline: discover → elaborate → review → integrate |

#### Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. DISCOVER — search CVE/OWASP/GitHub advisories           │
│  2. PROPOSE  — generate .core-rule-proposals/CORE-XXX.md    │
│  3. ELABORATE — LLM fills rationale + test cases            │
│  4. VALIDATE — pattern syntax + historical backtest         │
│  5. REVIEW   — six-dimension review (composite ≥ 0.95)      │
│  6. INTEGRATE — modify security.sh (if thresholds met)      │
└─────────────────────────────────────────────────────────────┘
```

#### Trigger Frequency

| Rule Layer | Recommended Interval | Trigger |
|------------|---------------------|---------|
| Core Rules | Weekly | User runs `evolve --discover` or `evolve --full` |
| Extended Rules | Daily | Hot-reload from `.evolving-rules/security/active/` |

#### State Files

- `.library/.core-rule-proposals/.last-scan-core` — Unix timestamp of last Core Rules scan
- `.library/.core-rule-proposals/.last-scan-extended` — Unix timestamp of last Extended Rules sync
- `.library/.core-rule-proposals/.audit.log` — JSON Lines audit trail

**User triggers evolution manually** — task-ai does not run background daemons.

### `write <path>`

Atomic write with full 8-step protocol — **the only correct way to write to library**.

```bash
/task-ai:library write <path> [--content <content>] [--content-file <file>] [--notebook <name>] [--no-commit]
```

| Parameter | Description |
|-----------|-------------|
| `<path>` | Destination path relative to `$NB_WORKSPACES_LIBRARY` (e.g., `.memory/.experiences/software/auth-impl.md`) |
| `--content` | Content to write (for short content) |
| `--content-file` | Path to file containing content (for longer content) |
| `--notebook` | Source notebook name (recorded in changelog and relations) |
| `--no-commit` | Skip git commit step (use when batching multiple writes) |

If neither `--content` nor `--content-file` is provided, content is read from stdin.

**Why use this instead of direct Write tool:**

1. **Concurrency protection**: Acquires directory-level `.lock` before writing, preventing race conditions when multiple Claude processes write simultaneously
2. **Changelog consistency**: Appends standardized changelog entry (action, category, topic, path, notebook)
3. **Index integrity**: Updates both directory `.index.md` and `.master-index.md`
4. **Relation tracking**: Updates `.relations.jsonl` via `append-relations.py`
5. **Atomic writes**: Uses `.tmp` + rename pattern for crash safety

**8-Step Protocol (executed by `library-write.sh`):**

```
1. mkdir -p     → ensure target directory exists
2. acquire lock → mkdir $DIR/.lock (O_CREAT|O_EXCL semantics)
3. write file   → atomic: write .tmp then mv
4. changelog    → append timestamped entry to .changelog
5. index        → update directory .index.md + .master-index.md
6. relations    → update .relations.jsonl via append-relations.py
7. release lock → rm -rf $DIR/.lock
8. git commit   → task-ai(library): <action> <topic>
```

**Stale lock detection**: If lock exists but holding PID is dead (`kill -0` fails), the lock is reclaimed automatically.

**MANDATORY FOR ALL LIBRARY WRITES**: All sub-commands that write to library (research, highlight, check, exec, verify, report, read) MUST use `library write` instead of direct Write tool. Direct Write bypasses concurrency protection and will cause data corruption under concurrent access.

---

## Library Write Protocol

> **See `skills/library/references/write-protocol.md`** for the full eight-step write protocol (mkdir → acquire lock → write file → changelog append → update index → update relations → release lock → git commit), changelog line format, append vs overwrite rules, and `.summary.md` staleness notes.

---

## Knowledge Quality Model

### Experience File Classification

| Source file | Writer | Completeness | `quality_status` on write |
|-------------|--------|--------------|--------------------------|
| `<semantic>-complete.md` | `highlight` | complete | `verified` (automatic) |
| `<semantic>-impl.md` | `exec` | partial | `provisional` |
| `<semantic>-verify.md` | `verify` | partial | `provisional` |
| `<semantic>-eval.md` | `check` | partial | `provisional` |

### Pattern Lifecycle (`.memory/.thinking/patterns/`)

```
draft      written by report distillation from raw/
  ↓
active     referenced by ≥ 1 subsequent task (tracked via changelog "referenced" lines)
  ↓
validated  referenced by ≥ 3 tasks, each reaching check post-exec ACCEPT verdict
  ↓
deprecated failure_count ≥ 2  (plan cited this pattern → task triggered REPLAN)
           OR superseded by a newer pattern covering the same problem-type
```

---

## Injection Protection

External content is sanitised using 10 injection protection categories before storage. See `references/injection-rules.md` for the full category list.

---

## State Transitions

| Current Status | After Library | Condition |
|----------------|---------------|-----------|
| Any | (unchanged) | Pure utility sub-command |

## Git

| Operation | Commit message |
|-----------|---------------|
| `write` | `task-ai(library):<category> <action> <topic>` |
| `maintain --compact` | `task-ai(library):maintain archive YYYY-MM` |
| `maintain --rebuild-index` | `task-ai(library):maintain rebuild index` |
| `maintain --scheduled` | `library(scheduled): daily maintenance <date>` |
| `maintain --install-cron` / `--uninstall-cron` | No commit (modifies system crontab only) |
| `search`, `list`, `status`, `--check-staleness` | No commit |

