/**
 * Notebook creation rollback test.
 *
 * Bug: If DB insert fails after worktree creation, orphan worktree remains.
 * Fix: Rollback (remove worktree + delete branch) on failure.
 *
 * Since slugs are now random (nb-{8hex}), we scan the .worktrees directory
 * to verify no worktree directories remain after rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Notebook creation rollback on failure', () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-rollback-'));
    projectPath = path.join(tempDir, 'test-project');

    // Create a minimal git repo to simulate project
    fs.mkdirSync(path.join(projectPath, '.worktrees'), { recursive: true });
    execSync('git init', { cwd: projectPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectPath, '.gitignore'), '');
    execSync('git add -A && git commit -m "init"', { cwd: projectPath, stdio: 'ignore' });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should remove worktree if DB insert throws', async () => {
    const { createProjectsRouter } = await import('../routes/projects.js');

    const worktreesDir = path.join(projectPath, '.worktrees');
    let worktreeExistedBeforeDbCall = false;

    const mockDb = {
      getProject: vi.fn().mockReturnValue({
        id: 'proj-123',
        path: projectPath,
      }),
      createNotebook: vi.fn().mockImplementation(() => {
        // Check if any worktree directory was created before DB call
        const entries = fs.readdirSync(worktreesDir);
        worktreeExistedBeforeDbCall = entries.some((e) =>
          fs.statSync(path.join(worktreesDir, e)).isDirectory()
        );
        throw new Error('DB insert failed');
      }),
      listProjects: vi.fn().mockReturnValue([]),
      pruneOrphanedNotebooks: vi.fn(),
    };

    const mockSessionManager = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-123' }),
      closeSession: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockNotebookStore = {
      createNew: vi.fn().mockReturnValue({
        metadata: {},
      }),
      save: vi.fn().mockResolvedValue(undefined),
    } as any;

    const router = createProjectsRouter(mockDb as any, mockSessionManager, mockNotebookStore, tempDir);

    const mockReq = {
      body: { title: 'TestNotebook' },
      params: { projectId: 'proj-123' },
    } as any;

    const mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    } as any;

    // Find POST /:projectId/notebooks handler
    const postHandler = router.stack.find(
      (layer: any) => layer.route?.path === '/:projectId/notebooks' && layer.route?.methods?.post
    )?.route?.stack?.[0]?.handle;

    expect(postHandler).toBeDefined();
    await postHandler!(mockReq, mockRes, () => {});

    // Verify worktree WAS created before DB call
    expect(worktreeExistedBeforeDbCall).toBe(true);

    // Should return 500
    expect(mockRes.status).toHaveBeenCalledWith(500);

    // No worktree directories should remain (all rolled back)
    const remaining = fs.readdirSync(worktreesDir).filter((e) =>
      fs.statSync(path.join(worktreesDir, e)).isDirectory()
    );
    expect(remaining).toHaveLength(0);
  });
});
