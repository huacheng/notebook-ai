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
/task-ai:library search "<query>" [--type <type>] [--topic <topic>]
/task-ai:library list [--type <type>]
/task-ai:library status
/task-ai:library maintain [--mode quick|audit] [--rebuild-index] [--rebuild-relations] [--compact] [--check-staleness] [--all] [--scheduled [--force]] [--install-cron] [--uninstall-cron]
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

## Operation Details

### search "<query>"

Find relevant library files matching query text, with optional type or topic filter.

Search follows a three-tier progressive disclosure model to minimise token cost:
- **Layer 1** (~50 tokens): `.index.md` lookup — returns file IDs, titles, scores, and match rationale
- **Layer 2** (~200 tokens): `.summary.md` snippets — for selected IDs, load prose summaries
- **Layer 3** (~500-1000 tokens): full file content — only for user-selected high-value results

By default, `search` returns Layer 1 results and their Layer 2 summaries. Full content (Layer 3) is loaded only when the user or sub-command explicitly requests a specific file.

**Detailed Steps:**

1.  **Read** `.memory/.references/.summary.md` — keyword match against query
2.  **Read** `.memory/.experiences/.summary.md` — match by type or notebook keyword
3.  **Read** `.memory/.thinking/patterns/.index.md` — match by problem-type keyword
4.  **Read** `.memory/.type-profiles/.index.md` — match by type name
5.  **Score each candidate** using directory-appropriate scoring:
   - `.memory/.experiences/<type>/`: type exact match 10pts / shared segment 5pts / keyword 2pts each, threshold ≥ 8
   - `.memory/.references/`: topic exact match 10pts / topic keyword overlap 3pts each / type keyword 2pts each, threshold ≥ 8
   - `.memory/.thinking/patterns/`: problem-type keyword 3pts each / task type relevance 2pts, threshold ≥ 6
   - `.memory/.type-profiles/`: type exact match → always include (no threshold)
6.  **Sort results** by score DESC; apply **4000-token context budget** — load files until budget exhausted; always include top-scored result regardless of budget
7.  **Print scored results** table with file path, score, and match rationale

### `list [--type <type>]`

List library contents by category.

**Detailed Steps:**

1.  **Read** `.memory/.references/.index.md` — list all topics, version count, marked version, staleness flag
2.  **Read** `.memory/.experiences/.index.md` — list all types and notebook entry counts
3.  **Read** `.memory/.type-profiles/.index.md` — list all shared profiles with last-updated date
4.  **Read** `.memory/.thinking/patterns/.index.md` — list all patterns with lifecycle state (draft/active/validated/deprecated)
5.  **Read** `.memory/.thinking/raw/.index.md` — count entries by notebook and quality tier (H/M/L)
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

Full library audit — equivalent to `--all`. Use for scheduled maintenance.

```bash
/task-ai:library maintain --mode audit
# Equivalent to: maintain --rebuild-index --compact --check-staleness
```

#### `--rebuild-index`

Rebuild all `.index.md` files and `.master-index.md` from actual filesystem state.

**Detailed Steps:**

1.  **For each library sub-directory**: glob all `.md` files, read their frontmatter
2.  **Rebuild each `.index.md`** from ground truth — file frontmatter wins over stale index entries
3.  **Acquire directory-level `.lock`** before writing each `.index.md`; release after
4.  **Rebuild `.master-index.md`**: scan all files across `.memory/.experiences/`, `.memory/.references/`, `.memory/.type-profiles/`, `.memory/.thinking/patterns/`, `.skills/.candidates/`, `.skills/.drafts/`, and `.skills/.active/`; also scan all user-imported folders (non-dot-prefixed names in `$NB_WORKSPACES_LIBRARY/`); overwrite `.master-index.md` with complete flat index (topic, type, keywords, file path, source, and for `.skills/` entries: trust_tier T1–T4). This restores the cold-start fallback for the three-tier Changelog Consumption Protocol degradation path
5.  **IOC scan**: extract all outbound URLs from `.memory/.references/` files; tally domain counts; write/overwrite `.ioc.md` if any domain appears in ≥ 3 documents; format: `| domain | doc_count | first_seen | last_seen | risk | note |`
6.  **Fix `effectiveness_mark` uniqueness violations**: if multiple files in same topic scope or same notebook-type scope share `effectiveness_mark: true`, keep the one with latest `last_verified_at`, clear others (acquire lock before clearing)
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
2.  **For each** `.memory/.experiences/<type>/<notebook>-*.md`: flag `quality_status: provisional` entries older than 90 days with no corresponding `verified` sibling file
3.  **Print staleness report** per file: path, days stale, suggested action (`research --scope gap` or `maintain --rebuild-index`)
4.  **Do not auto-trigger research**; remediation is the user's decision

#### `--all`

Run `--rebuild-index` → `--compact` → `--check-staleness` in sequence. Also sweep for stale `.lock` files: for each `.lock` file in library, read its `pid`; if `kill -0 <pid>` fails → remove stale lock and log cleanup.

#### `--scheduled [--force]`

Lightweight periodic maintenance — timestamp-gated (24h interval), suitable for cron or auto loop post-report hook.

**Runs four checks:**

1. **Staleness check** — scan `.memory/.references/` for files older than 30 days, report stale count
2. **T3→T4 production validation** — scan all `.skills/.active/` T3 skills, promote to T4 if `usage_count >= 3` and zero REPLAN failures (same logic as `--promote-skill`)
3. **Security rules evolution** — invoke `core-rule-auto.sh cron-job` (Core: 7d / Extended: 1d, own timestamp gating)
4. **Changelog size check** — warn if `.changelog` exceeds 2000-line threshold

**Timestamp gating:**
- Reads `.last-scheduled` (epoch seconds); skips if last run < 24h ago
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

---

## Library Write Protocol

> **See `skills/library/references/write-protocol.md`** for the full six-step write protocol (mkdir → acquire lock → write file → changelog append → update index → release lock), changelog line format, append vs overwrite rules, and `.summary.md` staleness notes.

---

## Knowledge Quality Model

### Experience File Classification

| Source file | Writer | Completeness | `quality_status` on write |
|-------------|--------|--------------|--------------------------|
| `<nb>-complete.md` | `highlight` | complete | `verified` (automatic) |
| `<nb>-impl.md` | `exec` | partial | `provisional` |
| `<nb>-verify.md` | `verify` | partial | `provisional` |
| `<nb>-eval.md` | `check` | partial | `provisional` |

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
| `maintain --compact` | `task-ai(library):maintain archive YYYY-MM` |
| `maintain --rebuild-index` | `task-ai(library):maintain rebuild index` |
| `maintain --scheduled` | No commit (T3→T4 changes are uncommitted; caller should commit if needed) |
| `maintain --install-cron` / `--uninstall-cron` | No commit (modifies system crontab only) |
| `search`, `list`, `status`, `--check-staleness` | No commit |

