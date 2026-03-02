# Library Repository Protocol

The shared knowledge library (`$NB_WORKSPACES_LIBRARY`) operates as an **independent git repository**, separate from any project repository. This ensures library knowledge persists across projects, avoids branch conflicts, and maintains cross-task visibility.

## Repository Detection

On any library write operation, check repository status:

```
1. Does $NB_WORKSPACES_LIBRARY/.git exist?
   → Yes: library repo ready, proceed
   → No:  Does $NB_WORKSPACES_LIBRARY/ directory exist?
          → Yes (dir exists, no .git): git init + commit existing files
          → No  (nothing exists):      mkdir -p + git init + create skeleton + initial commit
```

`init` performs this check at step 2. Other skills (`highlight`, `research`, `exec`, `maintain`) assume the library repo exists — if it doesn't, they emit a warning and skip library writes.

## Library Commit Helper

All skills writing to the library use this standardised commit sequence:

```bash
# library_commit — commit library changes to the library's own repo
cd "$NB_WORKSPACES_LIBRARY"
git add <specific changed files>       # NOT git add -A (avoid unintended files)
git commit -m "task-ai(<module>):<type> <description>"
cd -                                    # return to previous directory
```

**Key rules:**
- Always `cd` into library repo before `git` commands — project repo HEAD must not be affected
- Use specific file paths in `git add`, not `-A` or `.`
- Return to previous directory after commit
- If no files changed (empty diff): skip commit silently

## Commit Scope by Skill

| Skill | Commit Type | Scope | When |
|-------|-------------|-------|------|
| `init` | `init` | Skeleton files (`.changelog`, `.master-index.md`, `.type-registry.md`) | First library setup |
| `research` | `research` | `.memory/.references/<topic>.md` + `.index.md` + `.summary.md` | After reference write |
| `highlight` | `highlight` | `.memory/.experiences/`, `.memory/.type-profiles/`, `.memory/.thinking/patterns/` | After each distillation batch |
| `exec` | `exec` | `.memory/.experiences/<type>/<notebook>-impl.md` + `.index.md` | After partial experience write |
| `verify` | `verify` | `.memory/.experiences/<type>/<notebook>-verify.md` + `.index.md` | After verification experience write |
| `check` | `check` | `.memory/.experiences/<type>/<notebook>-eval.md` + `.index.md` | After evaluation experience write |
| `maintain` | `maintain` | All `.index.md`, `.master-index.md`, `.relations.jsonl` | After rebuild/compact |

## Commit Message Examples

```
task-ai(auth-refactor):research collect jwt-auth reference
task-ai(auth-refactor):highlight distill experiences + patterns
task-ai(auth-refactor):exec write partial experience
task-ai(library):maintain rebuild index
task-ai(library):maintain rebuild relations
task-ai(library):init initialize library repository
```

## Project Repo .gitignore

The project repository should ignore the library directory entirely:

```gitignore
# Library is an independent repo
.library/
```

This replaces the previous per-file gitignore entries for `.library/.changelog`, `.library/.ioc.md`, etc. — the entire `.library/` is now excluded from the project repo.

## Dual-Repo Workflow

A typical task execution involves commits to **both** repos:

```
Project repo (task branch):                Library repo (always main):
  task-ai(nb):init initialize notebook       task-ai(nb):init initialize library repository (if first time)
  task-ai(nb):plan generate plan             task-ai(nb):research collect references
  task-ai(nb):exec step 1/5 done            task-ai(nb):exec write partial experience
  task-ai(nb):feat add auth middleware
  task-ai(nb):exec step 2/5 done
  ...
  task-ai(nb):report generate report         task-ai(nb):highlight distill experiences + patterns
```

Library commits happen **on main** (no branching) — the library is append-mostly and uses file-level locking for concurrency, not branch isolation.

## Migration from Embedded Library

If an existing project has `.library/` tracked in the project repo:

1. `cd $NB_WORKSPACES_ROOT`
2. `git rm -r --cached .library/` (remove from project index, keep files)
3. Add `.library/` to project `.gitignore`
4. `git commit -m "chore: extract library to independent repo"`
5. `cd .library/ && git init && git add -A && git commit -m "task-ai(library):init migrate to independent repo"`
