# Type Field

The `type` field in `.status.json` identifies the task's domain. It is **auto-discovered** by `research` during the first `plan` phase — `init` does not accept a `--type` argument. All subsequent sub-commands (`check`, `exec`) read this field to adapt their behavior.

## Format

Single type (`software`) or pipe-separated hybrid (`data-pipeline|ml`). Parsing: `type.split('|')` → `[0]` is primary, `[1:]` are secondary domains.

## Seed Types

Predefined types are maintained in `init/references/seed-types/` directory (one file per type, with `.summary.md` index, ordered by scope broadest→most specialized) and used to initialize `$NB_WORKSPACES_LIBRARY/.type-registry.md` on first `init`. Each per-type file contains Phase Intelligence (plan/verify/check/exec methodology). The registry is auto-expanded by `research` when new domains are discovered. See `init/references/seed-types/.summary.md` for the full index (14 seed files covering 19 types: software, science:*, documentation, data-pipeline, infrastructure, ml, ai-skill, image-processing, video-production, dsp, literary, screenwriting, mechatronics, chip-design).

Scientific research types follow [arXiv taxonomy](https://arxiv.org/category_taxonomy) — use `science:<domain>` for unlisted fields (e.g., `science:astro`, `science:neuro`, `science:materials`).

## Auto-Discovery

Type is determined automatically by `research` during the first `plan` phase (see `plan/references/type-profiling.md`). Research analyzes `.target.md` + web search to identify the domain, detects hybrid indicators, and writes the type to `.status.json`. No user input is needed — `init` creates tasks with `type: ""`, which `research` fills in.

## Auto-Expanding Registry

`$NB_WORKSPACES_LIBRARY/.type-registry.md` holds all known types (seed + dynamically discovered). When `research` identifies a domain not in the registry, it appends a new row automatically. The predefined table above is a **seed**, not a ceiling — new domains are registered on demand.

## Hybrid Types

Tasks spanning multiple domains use pipe-separated format (e.g., `data-pipeline|ml`). The first segment is primary (drives architecture), subsequent segments are secondary (add domain-specific verification and implementation concerns). All phases read experience files and apply methodology for **all** segments.

## Type Profile

Every task module gets a `.type-profile.md` during planning. This file is the **authoritative** domain methodology source for the task — all phases (verify, check, exec) read it first, before falling back to static reference tables. The profile is updated progressively as research/verify/check/exec discover new domain information.

## Validation

Each pipe-separated segment must match `[a-zA-Z0-9_:-]+`. Full type field regex: `[a-zA-Z0-9_:|-]+`. `plan` MUST validate before writing to `.status.json`. `report` MUST validate before using as `.experiences/<type>/` directory name to prevent path traversal.

## Directory-Safe Transform

When using a type segment as a directory name (e.g., `.experiences/<segment>/`, `.type-profiles/<segment>.md`), replace `:` with `-` (e.g., `science:astro` → `science-astro`). The original type value in `.status.json` is unchanged. **Collision note**: avoid registering types whose names differ only by `:` vs `-` (e.g., `science-astro` and `science:astro` both map to `science-astro/`). The type registry should treat these as the same type.

## Unknown Type Handling

When `check` or `exec` encounters a `type` value not matching any known domain in the reference tables, it reads `.type-profile.md` for task-specific methodology. If `.type-profile.md` also doesn't exist (legacy task), it falls back to `software` methodology and records a warning in `.analysis/` (check) or `.notes/` (exec).
