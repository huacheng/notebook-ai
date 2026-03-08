# depends_on Format

Supports two formats — simple string (require `satisfied`) and object (custom minimum status):

```json
{
  "depends_on": [
    "auth-refactor",
    { "module": "api-design", "min_status": "review" }
  ]
}
```

Simple string `"auth-refactor"` → notebook `auth-refactor`, requires status `satisfied`.

Extended object `{ "module", "min_status" }` → requires the dependency to be at **or past** `min_status` in the state machine progression: `draft` < `planning` < `review` < `executing` < `evolving` < `satisfied`. Status `blocked`, `re-planning`, `cancelled` do not satisfy any `min_status`.

**Dependency enforcement**: `exec` and `merge` MUST validate that all `depends_on` modules meet their required status before proceeding. If any dependency is not met, the sub-command rejects with a clear error listing the blocking dependencies and their current statuses. `check` also flags unmet dependencies as a blocking issue.
