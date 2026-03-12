# Inline Protocol Scopes (§3.1–§3.4)

Referenced from `highlight/SKILL.md` §Scope Definitions.

These scopes are **inline protocols** executed by calling skills, not independent executions.

---

## §3.1 scope=impl — Implementation Experience

**Caller**: exec (inline, after all plan steps complete)
**Independent execution**: No

### Trigger

exec completes all plan steps.

### Content Extraction

From exec's current context:
- Key implementation decisions and rationale
- Tool/framework patterns used
- Workarounds and pitfalls discovered
- Deviations from plan and reasons

### Write Spec

Target: `.memory/.experiences/<type>/<semantic>-impl.md` | Mode: O_APPEND | Lock: `.memory/.experiences/.lock` | quality_status: `provisional`

> See [scope-impl-spec.md](scope-impl-spec.md) for full write spec table, frontmatter template, content structure, and write steps.

### Fault Isolation

> Inline call failure should not block the caller's main flow — highlight is an enhancement step, not a gating requirement.

---

## §3.2 scope=verify — Verification Experience

**Caller**: verify (inline, step 12)
**Independent execution**: No

### Trigger

verify checkpoint completes AND checkpoint != quick.

### Content Extraction

From verify's current context (type-adaptive, not limited to software):
- Test results summary (pass/fail/partial)
- Domain verification patterns (what verification methods work for this type)
- Threshold discoveries (reasonable metric ranges)
- Type-specific verification patterns:
  - software: VFP cycles (test framework effectiveness, VH stub techniques, common VH→HS failure reasons, refactoring patterns)
  - data-pipeline: schema validation strategies, data quality thresholds, sampling methods
  - image/video: SSIM/PSNR thresholds, visual comparison methods
  - audio/dsp: SNR thresholds, spectral analysis methods
  - document: structural integrity checks, content validation methods
  - other types: extract from `.type-profile.md` "Verification Standards"

### Write Spec

Target: `.memory/.experiences/<type>/<semantic>-verify.md` | Mode: O_APPEND | Lock: `.memory/.experiences/.lock` | quality_status: `provisional`

> See [scope-verify-spec.md](scope-verify-spec.md) for full write spec table, frontmatter template, content structure, and write steps.

### Fault Isolation

> **Fault isolation**: Same principle as §3.1 — inline call failure does not block the caller's main flow.

---

## §3.3 scope=thinking-raw — Raw Thinking Capture

**Callers (9 commands, two tiers)**:

| Tier | Command | Call Point | Notes |
|------|---------|------------|-------|
| **High-value** | target | During objective analysis | Goal decomposition and constraint reasoning |
| **High-value** | research | After research completes | Technology selection and feasibility reasoning |
| **High-value** | plan | step 24 | Design and trade-off reasoning |
| **High-value** | exec | After step execution | Implementation decisions and problem-solving reasoning |
| **High-value** | check | step 16 | Quality judgment and ACCEPT/REPLAN decision reasoning |
| **High-value** | verify | After verification completes | Verification strategy selection and result analysis reasoning |
| **Low-value** | merge | After deliverables copy | Deliverables selection reasoning (only when non-trivial) |
| **Medium-value** | security | During security audit | Threat model and risk assessment reasoning |
| **Medium-value** | annotate | During annotation processing | Cross-impact assessment reasoning |

**Independent execution**: No

### Trigger

Caller's execution involves complex reasoning or novel domain judgment (optional, encouraged). High-value commands should actively capture; medium-value commands capture only when reasoning complexity is clearly above routine.

### Write Spec

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.thinking/raw/<notebook>-<caller>-<YYYY-MM-DD>.md` |
| Write mode | O_APPEND (no lock — filename is unique, no conflict) |
| Index | O_APPEND `.memory/.thinking/raw/.index.md` |

### Frontmatter

```yaml
---
source: highlight-<caller>
notebook: <notebook-name>
created_at: <ISO-8601>
quality:
  thinking: <H|M|L>
  justification: "<1-sentence reason>"
---
```

### Content Structure

Follow `$NB_WORKSPACES_LIBRARY/references/quality-rubric.md` H/M/L self-assessment standards.

```markdown
## CoT Capture — <caller> phase (<date>)

### Problem
<what was being reasoned about>

### Reasoning Chain
<key reasoning steps>

### Conclusion
<what was decided>

### Quality Self-Assessment
<H/M/L with justification>
```

### Write Steps

1. O_APPEND write to `<notebook>-<caller>-<YYYY-MM-DD>.md`
2. O_APPEND append one row to `.memory/.thinking/raw/.index.md`
3. No lock needed (filename contains notebook + caller + date, naturally unique per day). Note: multiple calls within the same day append to the same file — O_APPEND ensures atomicity of individual writes

### Fault Isolation

> **Fault isolation**: Same principle as §3.1 — inline call failure does not block the caller's main flow.

---

## §3.4 scope=quality-update — Quality Status Change

**Caller**: check (inline, step 12)
**Independent execution**: No

### Trigger

| check verdict | Action |
|--------------|--------|
| ACCEPT (post-exec) | Same notebook's `provisional` experience files → `quality_status: verified` |
| REPLAN | Misleading experience files → `quality_status: invalidated` |

### Write Spec

| Field | Value |
|-------|-------|
| Target files | `.memory/.experiences/` existing `-impl.md` or `-verify.md` |
| Write mode | Frontmatter field overwrite (atomic: read → modify → .tmp → rename) |
| Lock | `.memory/.experiences/.lock` |

### Write Steps (status upgrade to verified)

1. acquire `.memory/.experiences/.lock`
2. read target file frontmatter
3. modify `quality_status: provisional → verified`
4. atomic write (.tmp → rename)
5. acquire `.changelog.lock` → append: `<ts> | experience | <path> | quality_status:verified | promoted-by:check` → release
6. release `.memory/.experiences/.lock`

### Write Steps (invalidation)

Same as status upgrade steps above, but `quality_status: provisional → invalidated`, changelog marks `invalidated-by:check`.

### Related Operation — failure_count Update

check REPLAN may also need to update `.memory/.references/` `failure_count`. This operation **does NOT belong to highlight protocol** — `.references/` is managed by research/read. check operates directly via Library Write Protocol:

1. acquire `.memory/.references/.lock`
2. read frontmatter → `failure_count++`
3. atomic write
4. append changelog: `<ts> | reference | <path> | failure_count:<n>`
5. release `.memory/.references/.lock`
