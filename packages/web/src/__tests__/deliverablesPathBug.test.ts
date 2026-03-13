/**
 * Bug reproduction: Deliverables shows "NB Deliverables" label but points to project root.
 *
 * User report:
 * - Click notebook to enter workspace directory
 * - Tab shows "NB Deliverables" (correct label)
 * - But actual path is project root's .deliverables (wrong path)
 */
import { describe, it, expect } from 'vitest';
import { getDeliverablesPath } from '../utils/deliverablesPath';

describe('Deliverables path bug reproduction', () => {
  it('label shows "NB Deliverables" when workspaceDir is set, but path might be wrong', () => {
    // Scenario: label uses `workspaceDir ? "NB" : "Project"` logic
    // Path uses getDeliverablesPath(workspaceDir, activeProjectPath)

    const workspaceDir = '/home/ubuntu/my-project/.worktrees/task-my-notebook';
    const activeProjectPath = '/home/ubuntu/my-project';

    // Label logic: workspaceDir is truthy → shows "NB Deliverables"
    const showNbLabel = !!workspaceDir;
    expect(showNbLabel).toBe(true);

    // Path logic
    const path = getDeliverablesPath(workspaceDir, activeProjectPath);
    expect(path).toBe('.worktrees/task-my-notebook/.deliverables');
  });

  it('FIX: activeProjectPath is null but workspaceDir contains .worktrees pattern', () => {
    // This was the bug scenario - now fixed!
    // workspaceDir is set (from opening notebook) but activeProjectPath is null
    // The fix: extract relative path from workspaceDir by detecting .worktrees/ pattern

    const workspaceDir = '/home/ubuntu/my-project/.worktrees/task-my-notebook';
    const activeProjectPath = null;  // activeProjectPath is null

    // Label logic: workspaceDir is truthy → shows "NB Deliverables"
    const showNbLabel = !!workspaceDir;
    expect(showNbLabel).toBe(true);  // Label is correct

    // Path logic: should detect .worktrees/ pattern and return notebook-level path
    const path = getDeliverablesPath(workspaceDir, activeProjectPath);
    expect(path).toBe('.worktrees/task-my-notebook/.deliverables');  // FIXED!
  });

  it('FIX: workspaceDir does not start with activeProjectPath but has .worktrees pattern', () => {
    // Scenario: path mismatch but .worktrees pattern is detected

    const workspaceDir = '/home/ubuntu/my-project/.worktrees/task-my-notebook';
    const activeProjectPath = '/home/ubuntu/different-project';  // Different project

    const showNbLabel = !!workspaceDir;
    expect(showNbLabel).toBe(true);  // Label shows "NB Deliverables"

    // Fallback: detect .worktrees/task-xxx pattern in workspaceDir
    const path = getDeliverablesPath(workspaceDir, activeProjectPath);
    expect(path).toBe('.worktrees/task-my-notebook/.deliverables');
  });

  it('correct scenario: both values are properly aligned', () => {
    const workspaceDir = '/home/ubuntu/my-project/.worktrees/task-my-notebook';
    const activeProjectPath = '/home/ubuntu/my-project';

    const showNbLabel = !!workspaceDir;
    expect(showNbLabel).toBe(true);

    const path = getDeliverablesPath(workspaceDir, activeProjectPath);
    expect(path).toBe('.worktrees/task-my-notebook/.deliverables');
    expect(path).not.toBe('.deliverables');  // Should NOT be project-level
  });
});
