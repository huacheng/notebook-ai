# Thinking Quality Rubric — H / M / L

Shared quality evaluation standard for sub-commands that optionally write to `.memory/.thinking/raw/`. Self-assessed by the executing sub-command on completion; written into the `quality:` frontmatter block of the raw entry.

**Writers**: `plan` (step 23), `check` (step 16). Other sub-commands (`exec`, `verify`, `research`) may also write when reasoning is complex or novel. Writing is optional — only document reasoning that provides reusable insight. Routine execution following established plans does not warrant a raw entry.

**Write format**: `O_APPEND` to `.memory/.thinking/raw/<notebook>-<step>-<YYYY-MM-DD>.md` (no lock needed — filename is unique per notebook+step+date). After first creation, append one row to `.memory/.thinking/raw/.index.md` (O_APPEND, no lock). See `skills/library/SKILL.md` `.memory/.thinking/raw/` Entry Format section for the full YAML frontmatter structure.

## Three Dimensions

Quality is evaluated across three independent dimensions. Each dimension receives one of three grades: **H** (High), **M** (Medium), or **L** (Low).

---

### Dimension 1: Prompt Quality

Evaluates how well the input context and question were specified before reasoning began.

| Grade | Criteria |
|-------|---------|
| **H** | Objective is unambiguous; all relevant context provided; constraints are explicit and quantified; examples or acceptance criteria present |
| **M** | Objective present but partially underspecified; some relevant context missing; constraints stated but not quantified |
| **L** | Objective unclear or missing; critical context absent; no constraints or acceptance criteria; the prompt could not reliably guide correct reasoning |

**Self-assessment guidance**: Assess the prompt as-received, not after inferred improvements. If you had to assume major missing details, the prompt is at most M.

---

### Dimension 2: Thinking Quality

Evaluates the reasoning process itself — structure, coverage, and rigour.

| Grade | Criteria |
|-------|---------|
| **H** | Systematic analysis; multiple approaches considered with explicit trade-offs; risks and edge cases identified; conclusions follow directly from evidence; no logical leaps |
| **M** | Some analytical structure present; limited alternative exploration; key risks partially addressed; conclusions are plausible but not fully supported |
| **L** | Disorganised or stream-of-consciousness; jumps directly to conclusion without analysis; misses obvious risks or alternatives; contains logical errors or contradictions |

**Self-assessment guidance**: A single-path analysis that reaches a correct result is still M if no alternatives were considered. Do not conflate correct output with good thinking.

---

### Dimension 3: Output Quality

Evaluates the result produced — completeness, actionability, and verifiability.

| Grade | Criteria |
|-------|---------|
| **H** | Directly addresses the objective; complete and actionable; verifiable against stated acceptance criteria; no significant gaps |
| **M** | Partially addresses the objective; mostly actionable but has identifiable gaps or assumptions; not fully verifiable |
| **L** | Misses the objective or addresses the wrong question; incomplete to the point of being unusable; not verifiable |

**Self-assessment guidance**: If the output required the next step to correct or complete it, the output is at most M.

---

## Grading Examples

### Example 1: `plan` step on a well-specified task

```yaml
quality:
  prompt: H      # Clear objective, complete requirements, constraints quantified
  thinking: M    # Considered two approaches but skipped edge case analysis
  output: H      # Plan covers all requirements, each step is concrete and testable
```

### Example 2: `exec` step hitting an unexpected API

```yaml
quality:
  prompt: M      # Plan step was clear but didn't specify the API version constraint
  thinking: H    # Discovered the version conflict, evaluated three workarounds, chose with rationale
  output: H      # Implementation handles the constraint correctly
```

### Example 3: `check` with incomplete evaluation

```yaml
quality:
  prompt: H      # Explicit checkpoint criteria, domain standards referenced
  thinking: L    # Jumped to PASS without verifying all six audit perspectives
  output: M      # Verdict present but missing supporting evidence for two perspectives
```

---

## Downstream Behaviour

| Condition | System response |
|-----------|----------------|
| Any single L grade | Flagged in `raw/.index.md` row; does not block execution |
| Two or more L grades in same step | Write warning note in `.working/.summary.md`: "Quality concern at <step>: multiple L grades" |
| Consecutive L grades across ≥ 2 steps | `report` notes pattern in lessons-learned section; does NOT distil these steps into `patterns/` |
| All H grades across a step | Eligible for distillation into `patterns/` by `report` |
| Pattern of L(thinking) + H(output) | Note in Quality Notes section: "Output quality may not be reproducible — reasoning was unstructured" |

---

## Quality Notes Section

The `## Quality Notes` section in each raw entry is free-form. Sub-commands should use it to:

- Explain grade rationale for any M or L grade
- Record what information was missing from the prompt
- Note reasoning paths that were considered and rejected
- Flag any output assumptions that future steps should verify

Example:

```markdown
## Quality Notes
- prompt M: plan step did not specify target Node.js version; assumed v20 LTS
- thinking H: evaluated both in-memory cache and Redis; chose Redis due to persistence requirement
- output H: implementation handles reconnect logic per plan step 3b
```

---

## Calibration Notes

- **H is achievable, not reserved for perfection**: If the thinking was genuinely systematic and the output is complete, grade H. Do not grade-inflate to M out of false modesty.
- **L is a real signal, not a punishment**: An L grade on thinking that leads to a correct output is still L — it means the result was not reproducible by reasoning alone.
- **Consistency over session**: Use the same rubric meaning throughout a task session. If you find yourself grading differently across steps, re-read this file.
- **Self-assessment bias**: There is a natural bias toward overgrading. When in doubt between H and M, choose M. When in doubt between M and L, ask: "Would another reader following the same prompt reach the same output by following this thinking?" If not, L is more honest.
