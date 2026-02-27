# Library Refactoring: Independent Repo + Relation Index

**Date**: 2026-02-24
**Status**: In Progress

## Motivation

1. **Branch conflict**: Task A/B on separate branches both write `.library/` files → merge conflicts on `.experiences/.index.md` etc.
2. **Knowledge isolation**: Task branch A can't see references written by task B → shared library loses its "shared" property
3. **Lifecycle coupling**: Deleting project repo deletes accumulated cross-task knowledge
4. **Relation queries**: No explicit edges between references, experiences, type-profiles → multi-hop discovery impossible

## Design Decisions

### A. Library Repository Independence

**Strategy**: `$NB_WORKSPACES_LIBRARY` is always an **independent git repo** (has its own `.git/`).

**Detection**: `init` checks if `$NB_WORKSPACES_LIBRARY/.git` exists.
- **No**: `git init $NB_WORKSPACES_LIBRARY` + initial commit
- **Yes**: proceed normally

**Commit protocol change**: All library writes use a `library_commit` helper:
```
# In library repo (not project repo):
cd $NB_WORKSPACES_LIBRARY
git add <changed files>
git commit -m "task-ai(<module>):<type> <description>"
```

**Affected skills** (library write → library_commit):

| Skill | Steps | Current | After |
|-------|-------|---------|-------|
| `init` | step 2 | Creates `.library/` skeleton, commits in project repo | `git init` library repo if needed, initial commit in library repo |
| `report` | steps 13-15 | Distills experiences/patterns/profiles, commits in project repo | `library_commit` after each distill batch |
| `research` | step 14 | Writes `.references/`, commits in project repo | `library_commit` after reference write |
| `exec` | step 105+ | Writes partial experience, commits in project repo | `library_commit` after experience write |
| `maintain` | all ops | Already commits as `task-ai(library):maintain ...` | Target library repo (already correct intent) |

**Project repo .gitignore**: Add `.library/` (entire directory) since it's now a separate repo.

### B. Relation Index (`.relations.jsonl`)

**Location**: `$NB_WORKSPACES_LIBRARY/.relations.jsonl` (library root, git tracked)

**Edge schema**:
```jsonl
{"s":"<source_path>","r":"<relation_type>","t":"<target_path>","w":<weight>,"outcome":"<accept|replan|blocked|null>","ts":"<ISO8601>"}
```

Paths are relative to `.library/` root (e.g., `.memory/.references/jwt-auth-v3.md`).

**Six relation types**:

| Type | From → To | Built from |
|------|-----------|------------|
| `used-by` | reference → experience | changelog `referenced` + `experience` lines for same notebook |
| `covers` | type-profile → reference | topic keyword overlap between profile and reference |
| `derived-from` | experience → type-profile | report distillation (step 15 sync) |
| `supersedes` | reference-vN → reference-v(N-1) | version history in `.references/.index.md` |
| `inspired` | pattern → raw CoT entry | report distillation (step 14) source tracking |
| `co-occurs` | reference → reference | co-referenced by same task within 24h window |

**Build**: `maintain --rebuild-relations` computes from changelog + frontmatter + index files.
**Incremental**: `report` appends new `used-by`, `derived-from`, `inspired` edges after distillation.
**Query**: the agent uses Grep tool on the JSONL file — no Python query layer.

### C. Search Integration

`library search` gains a **Tier 1.5** step between index lookup and summary loading:

```
Tier 1:   .index.md lookup (existing)
Tier 1.5: .relations.jsonl grep → follow edges for related files
Tier 2:   .summary.md snippets (existing)
Tier 3:   full file content (existing)
```

### D. Init Auto-Detection

On `init` step 2 (library setup):
1. Check `$NB_WORKSPACES_LIBRARY` path exists
2. Check `$NB_WORKSPACES_LIBRARY/.git` exists
3. If neither: `mkdir -p` + `git init` + create skeleton + initial commit
4. If dir exists but no `.git`: `git init` + commit existing files
5. If both exist: proceed (library already initialized)

Future: Service startup hook can call the same check logic.

## Files to Modify

### New reference
- `commands/references/library-repo-protocol.md` — Library repo commit protocol

### Modified files
1. `skills/library/SKILL.md` — Add `maintain --rebuild-relations`, `.relations.jsonl` schema, search Tier 1.5, repo-aware commits
2. `skills/init/SKILL.md` — Library repo auto-init
3. `skills/report/SKILL.md` — `library_commit` for distillation
4. `skills/research/SKILL.md` — `library_commit` for references
5. `skills/exec/SKILL.md` — `library_commit` for partial experience
6. `commands/references/git-details.md` — Library repo conventions
7. `commands/references/directory-convention.md` — `.relations.jsonl` in tree, repo independence note
8. `commands/references/library-write-protocol.md` — Step 4b: library_commit after changelog
9. `REFERENCE-INDEX.md` — New reference entry

### New contracts
- `.dev/contracts/library-relations-schema.sh` — L2: validate `.relations.jsonl` edge schema
- `.dev/contracts/library-repo-protocol.sh` — L2: verify library commit references use correct protocol
