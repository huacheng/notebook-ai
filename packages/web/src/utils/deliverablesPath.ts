/**
 * Compute the deliverables initialPath relative to project root.
 * - Project level (no notebook open): `.deliverables`
 * - Notebook level (worktree active):  `.worktrees/task-xxx/.deliverables`
 */
export function getDeliverablesPath(
  workspaceDir: string | null,
  activeProjectPath: string | null,
): string {
  if (!workspaceDir) {
    return '.deliverables';
  }

  // Primary: use activeProjectPath if available and matching
  if (activeProjectPath && workspaceDir.startsWith(activeProjectPath + '/')) {
    return workspaceDir.slice(activeProjectPath.length + 1) + '/.deliverables';
  }

  // Fallback: detect .worktrees/task-xxx pattern in workspaceDir
  // Handles both absolute paths (/project/.worktrees/task-xxx) and relative paths (.worktrees/task-xxx)
  const worktreeMatch = workspaceDir.match(/(?:^|[/\\])\.worktrees[/\\](task-[^/\\]+)$/);
  if (worktreeMatch) {
    return `.worktrees/${worktreeMatch[1]}/.deliverables`;
  }

  return '.deliverables';
}
