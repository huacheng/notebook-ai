# CLAUDE.md — notebook-ai

## Rules

- Playwright: only launch when the user explicitly requests it. Never start Playwright proactively for testing.
- notebook-ai uses ports **3000** (Vite frontend) and **3002** (backend API). Restart only needs to handle these two ports. Use `./restart.sh` to restart.
- When the user says "continue" or "继续", resume the previous session's implementation plan from where it left off. Do NOT start unrelated tasks.
- When asked to initialize, set up, or run a known skill/command, execute it directly. Do NOT spend time exploring the environment first.

## Testing

- Always run the full test suite (`npx vitest run`) after changes and report the pass count (e.g., "879 tests passing, zero regressions").
- Test runner: vitest. Test directory: `packages/server/src/__tests__/`, `packages/web/src/__tests__/`.

## Git Workflow

- Only stage files directly related to the current change. Verify with `git diff --cached --stat` before committing. Do NOT bundle unrelated files.
- For releases: update version in all relevant package.json files, create git tag (`git tag vX.Y.Z`), and push with `--tags`.

## UI/CSS

- Confirm exact layout requirements before implementing UI changes. Pay attention to pixel-level details (heights, spacing, margins) — mismatches like 34px vs 32px will be caught.
- When proposing architecture for a feature, prefer server-driven approaches (pagination, data processing) over client-only solutions, unless explicitly told otherwise.

