/**
 * Compute the deliverables initialPath relative to project root.
 * - Project level (no notebook open): `.deliverables`
 * - Notebook level (worktree active):  `.worktrees/task-xxx/.deliverables`
 */
export function getDeliverablesPath(
  workspaceDir: string | null,
  activeProjectPath: string | null,
): string {
  if (workspaceDir && activeProjectPath && workspaceDir.startsWith(activeProjectPath + '/')) {
    return workspaceDir.slice(activeProjectPath.length + 1) + '/.deliverables';
  }
  return '.deliverables';
}
