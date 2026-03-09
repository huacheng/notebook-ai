---
name: security
description: "Runtime Guardian — audits plans and intercepts high-risk shell commands before execution to prevent latent attacks. Invoked automatically by exec and plan as a pre-hook, or manually via 'security audit-plan' or 'security verify-cmd'. Use when reviewing command safety or scanning skills for injection risks."
model_tier: heavy
auto_delegatable: false
triggers:
  keywords:
    zh: [安全, 安全审计, 风险, 安全检查, 危险命令]
    en: [security, security audit, risk, safety check, dangerous command]
  phrases:
    zh: [安全审计一下, 这个命令安全吗, 检查安全风险, 审计计划安全性]
    en: [audit for security, is this command safe, check for security risks, review plan security]
  disambiguate: >
    Core intent: audit plans for security risks or intercept dangerous shell commands.
    User asks about security of a plan or command → security.
    User asks to EVALUATE plan feasibility (broader than security) → check.
    Normally invoked automatically as a pre-hook by check and exec — rarely called manually.
arguments:
  - name: action
    description: "Action to perform: audit-plan, verify-cmd, or scan-skill"
    required: true
  - name: payload
    description: "Command string (required for verify-cmd) or file path (required for scan-skill). Must not be empty for these actions."
    required: false
---

# /task-ai:security — Runtime Guardian

Acts as the mandatory pre-hook for existing sub-commands (`check` and `exec`), ensuring system integrity by blocking destructive or obfuscated instructions.

## Usage

```bash
/task-ai:security audit-plan                    # Notebook auto-detected
/task-ai:security verify-cmd "<command>"         # Notebook auto-detected
/task-ai:security scan-skill "<path/to/SKILL.md>"
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

## Execution Steps

### verify-cmd (Used by `exec`)
1. Reject empty command strings immediately.
2. **Dynamic Rules** (Tier 1): Check against evolving rules from `.evolving-rules/security/active/`. Stops on first match.
3. **Core Pattern Check** (Tier 2, 13 rules): Scan for destructive ops (`rm -rf`), VFP injection (`--eval`, `--require`), two-stage payloads (`curl | bash`), download-then-execute, environment manipulation (`LD_PRELOAD`, `NODE_OPTIONS`, etc.), path traversal (`../`), sensitive path access (`~/.ssh`, `~/.config/claude`, `/etc/passwd`), secret exfiltration, command obfuscation (`base64 -d | bash`, `${IFS}`), config file tampering (`.claude/`, `.mcp.json`), DNS tunneling, SSRF to internal networks, and reverse shell patterns.
4. **Verdict**: If safe, return `[SECURITY] PASS: Command looks safe`. If dangerous, return `[SECURITY] REJECT: <reason>`.

### audit-plan (Used by `check`)
5. Read `.plan.md`. If absent or empty, PASS.
6. **Dynamic Rules** (Tier 1): Check against evolving rules from `.evolving-rules/security/active/`.
7. **Core Pattern Scan** (Tier 2): Check for destructive commands, VFP injection, two-stage payloads, download-then-execute, environment manipulation, path traversal, injection/obfuscation, config file tampering, sensitive path access, secret exfiltration, DNS tunneling, SSRF to internal networks, and reverse shell patterns.
8. **Verdict**: Return `[SECURITY] PASS: Plan looks safe` or `[SECURITY] BLOCKED: High risk operations detected in plan` with findings list.
9. (Optional) Execute highlight protocol scope=thinking-raw (see `highlight/SKILL.md` section 3.3). Not implemented in `security.sh`; intended for agent-level callers. Inline call failure should not block security's main flow — highlight is enhancement, not gating.

### scan-skill (L1 static analysis)
10. Validate skill file exists and is non-empty.
11. **Extended Rules**: Apply dynamic rules from `.evolving-rules/security/active/`.
12. **Core Rules (CORE-001 to CORE-012)**: Hardcoded security floor covering destructive commands, VFP injection, two-stage loading, env manipulation, prompt injection, MCP/hooks config abuse, auth token theft, secret exfiltration, env var leaking, DNS tunneling, SSRF to internal networks, and reverse shell detection.
13. **Verdict**: Return `[SECURITY] PASS: Skill static analysis passed` or `[SECURITY] REJECT: Skill contains high-risk patterns` with findings list.

## Incident Response
If a command is `REJECT`ed during `exec`:
1. The execution step is aborted (signal: `(mid-exec)`, state: `NEEDS_FIX`).
2. **Lineage Tracing**: Agent should trace which `.references/` or `.experiences/` file proposed the command — this lineage enables targeted quarantine if a reference file is later found to contain malicious patterns.
3. **Quarantine**: Update the source file's frontmatter to `injection_risk: high` and `status: invalidated`.

## State Transitions

| Current Status | After Security | Condition |
|----------------|----------------|-----------|
| Any | (unchanged) | pre-hook utility |
