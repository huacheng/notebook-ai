---
name: highlight
description: "Distill and persist reusable experience, lessons learned, and thinking patterns into the knowledge library. Supports comprehensive task distillation, ad-hoc experience capture from conversation, and experience-to-skill promotion. Use when the user says 'what did we learn', 'capture this insight', 'distill experience', or wants to save lessons for future tasks."
model_tier: medium
auto_delegatable: true
triggers:
  keywords:
    zh: [经验, 提炼, 总结经验, 学到了, 记住, 教训, 心得]
    en: [experience, distill, lessons learned, takeaway, remember this, insight]
  phrases:
    zh: [总结一下经验, 提炼经验, 记住这个经验, 学到了什么, 沉淀一下, 这次有什么教训]
    en: [distill the experience, what did we learn, capture this insight, save this lesson, extract takeaways]
  disambiguate: >
    Core intent: distill and persist reusable experience/thinking into the library.
    User wants to capture lessons or insights → highlight.
    User wants a formal task REPORT → report. User wants to refresh .summary.md → summarize.
arguments:
  - name: description
    description: "Natural language description for ad-hoc experience capture (e.g., 'summarize the successful practices above')"
    required: false
---

# /task-ai:highlight — Experience Distillation Engine

Unified protocol for experience and thinking library writes. Defines 7 scopes covering all experience/thinking write operations across the task lifecycle. Also serves as an independent skill for comprehensive distillation (complete), ad-hoc experience capture (adhoc), and experience-to-skill promotion (promote).

## Usage

```
/task-ai:highlight                    # scope=complete — comprehensive distillation (notebook auto-detected)
/task-ai:highlight "<description>"    # scope=adhoc — conversation experience capture
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

**Parameter routing:**
- No arguments → scope=complete (auto-detect notebook from CWD or task branch; error if not in notebook context)
- `highlight "<description>"` → scope=adhoc (conversation experience capture)

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 0: Library Write Protocol                              │
│  (commands/references/library-write-protocol.md)              │
│  lock · changelog · atomic write · index update               │
├──────────────────────────┬───────────────────────────────────┤
│  Layer 1a: highlight     │  Layer 1b: other skills            │
│  experience + thinking   │  external knowledge + security     │
│                          │                                    │
│  Manages:                │  Manages:                          │
│  · .memory/.experiences/ │  · .memory/.references/ (research) │
│  · .memory/.thinking/    │  · .type-registry.md (research)    │
│  · .memory/.type-profiles│  · quarantine (security)           │
│    (complete sync only)  │                                    │
│  · quality_status        │                                    │
│  · .skills/.candidates/  │                                    │
│    .drafts/ .active/     │                                    │
│    (promote scope)       │                                    │
└──────────────────────────┴───────────────────────────────────┘
```

**Dependency direction (single direction, downward):**
- target/research/plan/exec/check/verify/merge/security/annotate → highlight protocol (reference)
- highlight → Library Write Protocol (call)
- No circular dependencies

## Experience File Naming — Semantic Names

Experience files use **semantic names** (`<semantic>`) that describe the **knowledge domain**, not the source notebook instance. This enables cross-notebook knowledge accumulation: multiple notebooks contributing to the same domain append to the same experience file.

### Semantic Name Resolution (Three-Level Matching)

When writing to an experience file, determine the filename through the following process:

1. LLM extracts core knowledge domain keywords from the experience content, combining them into a kebab-case name
2. **Exact match**: Check if a file with the same name exists under `.experiences/<type>/` → if found, append (O_APPEND)
3. **Index match**: Read `.experiences/<type>/.naming-index.md`, search for semantically equivalent entries in semantic_name or aliases columns → if found, use the canonical name and append
4. **No match** → Create new file, and append an entry to `.naming-index.md` (with 2-3 LLM-generated aliases)

Names should describe the **knowledge domain**, not task instances:
- Good: jwt-sliding-window-auth, react-virtual-scroll, sqlite-wal-concurrency
- Bad: proj-a-auth, ticket-1234-fix, sprint-3-task

### .naming-index.md Maintenance

After each experience write, update `.experiences/<type>/.naming-index.md`:

| semantic_name | aliases | file |
|---------------|---------|------|
| <name> | <alias1>, <alias2> | <name>-impl.md |

- Append entry when creating new files (with 2-3 LLM-generated aliases)
- Index enables deterministic matching for subsequent writes, preventing the same knowledge domain from being scattered across multiple files

---

## Scope Definitions

highlight defines 7 scopes. Scopes §3.1–§3.4 are **inline protocols** (executed by calling skills). Scopes §3.5–§3.7 are **independent executions** (run as standalone skill invocations).

### Inline Protocol Scopes (§3.1–§3.4)

> **See `references/inline-scopes.md`** for detailed specifications of inline protocol scopes: §3.1 scope=impl (implementation experience), §3.2 scope=verify (verification experience), §3.3 scope=thinking-raw (raw thinking capture), §3.4 scope=quality-update (quality status change).

**Key principle**: Inline scopes are executed by calling skills (exec, verify, check) in their own context. Fault isolation guarantees: inline call failure never blocks the caller's main flow.

---

### §3.5 scope=complete — Comprehensive Distillation

**Caller**: None (not inline)
**Independent execution**: **Yes** — auto loop step after post-exec ACCEPT; manual invocation

> **See `references/scope-complete.md`** for the full specification including trigger modes, input files, output A-D (experience distillation, thinking patterns, type-profiles sync, adoption tracking), and complete execution steps.

---

### §3.6 scope=adhoc — Conversation Experience Capture

**Caller**: None
**Independent execution**: **Yes** — purely manual trigger, outside auto lifecycle

#### Usage

```
/task-ai:highlight "<natural language instruction>"
```

Examples:
- `/task-ai:highlight "summarize the successful practices above"`
- `/task-ai:highlight "the WebSocket debugging method worked well, save it"`
- `/task-ai:highlight "record the approach to solving this CSS layout issue"`

#### Execution Protocol

9-step procedure: understand instruction → determine type → extract experience from conversation → structure content → generate frontmatter → generate filename slug → write with locks → git commit → user feedback.

> See [references/scope-adhoc-steps.md](references/scope-adhoc-steps.md) for the full step-by-step execution protocol (Steps 1-9 with all sub-steps).

---

## State Transitions

highlight **does not change notebook status**. Regardless of scope, `.status.json` status is unaffected.

| scope | Status impact |
|-------|-------------|
| impl | None (exec manages status) |
| verify | None (verify manages status) |
| thinking-raw | None (callers manage their own status) |
| quality-update | None (check manages status) |
| complete | None (auto manages status; user sets satisfied via --satisfy) |
| adhoc | None (no notebook lifecycle) |
| promote | None (batch operation, no notebook lifecycle) |

## Git

| Action | Commit Message |
|--------|---------------|
| complete distillation | `task-ai(<notebook>):highlight complete distillation` |
| adhoc capture | `task-ai(<scope>):highlight adhoc experience captured` |
| promote | No independent commit (changelog update only; candidates are committed by subsequent skill-review) |

> Inline calls (impl/verify/thinking-raw/quality-update) do not produce independent commits. Their changelog updates are included in the caller's git commit (e.g., exec's commit includes impl experience write changelog changes).

---

### §3.7 scope=promote — Experience to Skill Promotion

**Caller**: None (batch operation)
**Independent execution**: **Yes** — manual or scheduled invocation

#### Trigger Conditions

All three must be met:
1. `quality_status: verified` in experience frontmatter
2. `usage_count >= 3` (counted from `.changelog` entries with `| referenced |` type only — excludes initial write entries)
3. Contains structural patterns: `## Patterns` or `## Steps` headers

#### Usage

```bash
# Scan all experiences and promote eligible ones
bash skills/highlight/scripts/promote.sh

# Dry-run to see what would be promoted
bash skills/highlight/scripts/promote.sh --dry-run

# Promote specific experience file
bash skills/highlight/scripts/promote.sh --target <experience-file.md>
```

#### Output

| File | Location | Content |
|------|----------|---------|
| SKILL.md | `.skills/.candidates/<slug>/SKILL.md` | Generated skill definition |
| trust-report.md | `.skills/.candidates/<slug>/trust-report.md` | Promotion criteria and trust assessment |

#### Pipeline

```
1. Static scan of .memory/.experiences/
2. Filter: quality_status=verified
3. Filter: usage_count >= 3 (from changelog)
4. Filter: has structural patterns
5. D2 Security static analysis + D1/D3/D5 Semantic review (pre-promotion score >= 0.5)
6. Generate SKILL.md (trust_tier: T1)
7. Generate trust-report.md (includes pre-promotion scores)
8. Write to .skills/.candidates/<slug>/
9. Acquire .changelog.lock → append: `<ts> | skill-candidate | .skills/.candidates/<slug> | source:promote | from:<experience-file>` → release
```

> **Note**: The `skill-candidate` changelog type is specific to promote operations and extends the standard types (`experience`, `reference`, `type-profile`, `pattern`, `referenced`) defined in `commands/references/library-write-protocol.md`.

#### Next Steps After Promotion

1. `check --checkpoint skill-review --target SKILL.md` → L2 six-dimension audit, score ≥ 0.70 → move to `.skills/.drafts/` (T2)
2. `check --checkpoint skill-deep-review --target SKILL.md` → L3 deep semantic review, score ≥ 0.85 → move to `.skills/.active/<name>/` (T3)
3. Production validation (usage_count ≥ 3 post-activation, zero failures) → T4 (fully verified)

## Notes

- **Protocol, not runtime**: Inline scopes (§3.1–§3.4) define write format and steps. Calling skills execute these steps in their own context — highlight is not invoked as a separate skill for inline scopes
- **Fault isolation is universal**: All inline caller commands (the 9 commands listed in §3.3, plus check's additional §3.4 quality-update role) have the same guarantee — highlight protocol failure never blocks the caller's main flow
- **No state mutations**: highlight is transparent to the state machine. This is consistent with the former `light` behavior
- **.type-profiles/ dual ownership**: research creates/updates profiles (knowledge acquisition); highlight syncs during complete (experience write-back). Both use Library Write Protocol locks for concurrency safety
- **Concurrency**: Independent executions (complete, adhoc) acquire `.lock` before proceeding and release on completion (see Concurrency Protection in `commands/task-ai.md`). promote does NOT acquire `.lock` — it operates on library-level paths (`.skills/.candidates/`, `.changelog`) with its own `.changelog.lock`
