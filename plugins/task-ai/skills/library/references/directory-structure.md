# Library Directory Structure

> Extracted from `library/SKILL.md` — full filesystem tree of `$NB_WORKSPACES_LIBRARY`.

```
$NB_WORKSPACES_ROOT/
└── .library/                              # $NB_WORKSPACES_LIBRARY
    ├── .changelog                         # Append-only write log (gitignore)
    ├── .changelog-archive/                # Monthly archived entries (git tracked)
    │   └── YYYY-MM.md
    ├── .master-index.md                   # Flat index of all library files (git tracked)
    ├── .type-registry.md                  # Known type registry (git tracked)
    ├── .ioc.md                            # Domain convergence IOC log (gitignore)
    ├── .inconsistency.log                 # Index–file mismatch log (gitignore)
    ├── .last-scheduled                     # Epoch timestamp of last --scheduled run (gitignore)
    ├── .scheduled.log                      # Cron output log for --scheduled (gitignore)
    ├── .plugin-registry.md                # Plugin capability cache (lazily created, gitignore)
    ├── .memory/                           # System-managed knowledge base
    │   ├── .references/
    │   │   ├── .lock                      # Directory write lock (gitignore)
    │   │   ├── .index.md                  # topic → file lookup table
    │   │   ├── .summary.md                # References overview (prose, for sub-command context loading)
    │   │   ├── <topic>.md                 # Initial reference file (unversioned, created by research/exec)
    │   │   └── <topic>-v<N>-<date>.md     # Versioned file (created on staleness refresh when content changes)
    │   ├── .experiences/
    │   │   ├── .lock                      # Directory write lock (gitignore)
    │   │   ├── .index.md                  # type → sub-directory pointer table
    │   │   ├── .summary.md                # Experiences overview (prose)
    │   │   └── <type>/
    │   │       ├── .index.md              # notebook → file lookup table
    │   │       ├── .summary.md            # Per-type experience overview (prose)
    │   │       └── <notebook>-<source>.md # source: complete | impl | verify | eval
    │   ├── .type-profiles/
    │   │   ├── .lock                      # Directory write lock (gitignore)
    │   │   ├── .index.md                  # type → file pointer table
    │   │   └── <type>.md                  # Shared domain methodology profile
    │   └── .thinking/
    │       ├── .index.md                  # raw vs patterns navigation
    │       ├── raw/                       # L0: raw CoT + quality scores (gitignore)
    │       │   ├── .index.md              # Append-log index (O_APPEND, no lock)
    │       │   └── <notebook>-<step>-<date>.md
    │       └── patterns/                  # L1: distilled reasoning patterns (git tracked)
    │           ├── .lock                  # Directory write lock (gitignore)
    │           ├── .index.md              # problem-type → file lookup table
    │           └── <problem-type>.md
    ├── .skills/                              # Experience-to-skill promotion pipeline
    │   ├── .candidates/                      # T1: auto-promoted candidates (from highlight promote)
    │   │   └── <slug>/
    │   │       ├── SKILL.md
    │   │       └── trust-report.md
    │   ├── .drafts/                          # T2: passed check skill-review (score ≥ 0.70)
    │   │   └── <slug>/
    │   │       ├── SKILL.md
    │   │       └── trust-report.md
    │   └── .active/                          # T3: LLM deep-reviewed / T4: production-validated
    │       └── <name>/
    │           ├── SKILL.md
    │           └── trust-report.md
    └── <user-imported>/                   # User-imported files/folders (non-dot-prefixed)
        └── ...                            # Any structure; indexed by maintain --rebuild-index

<project>/.worktrees/task-<notebook>/.working/
└── .library-state.json                    # Per-notebook library read cursor (gitignore)
```

### .index.md vs .summary.md

| File | Form | Reader | Purpose |
|------|------|--------|---------|
| `.index.md` | Structured lookup table | `library` (routing & search) | "Which file contains this?" |
| `.summary.md` | Prose overview | Sub-commands (context loading) | "What is available here?" |

Both files exist at each directory level. Sub-commands read `.summary.md` for quick orientation; `library search` reads `.index.md` for precise routing.
