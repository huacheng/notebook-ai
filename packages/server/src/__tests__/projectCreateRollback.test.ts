/**
 * Project creation rollback test.
 *
 * Bug: If DB insert fails after directory creation, orphan directory remains.
 * Fix: Rollback (delete directory) on any failure after directory creation.
 *
 * Since slugs are now random (proj-{8hex}), we scan tmpDir for any proj-*
 * directories to verify none remain after rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Project creation rollback on DB failure', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-rollback-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should delete project directory if DB insert throws', async () => {
    const { createProjectsRouter } = await import('../routes/projects.js');

    let dirExistedBeforeDbCall = false;

    const mockDb = {
      listProjects: vi.fn().mockReturnValue([]),
      pruneOrphanedNotebooks: vi.fn(),
      createProject: vi.fn().mockImplementation(() => {
        // Check if any proj-* directory exists at the moment DB is called
        const entries = fs.readdirSync(tempDir);
        dirExistedBeforeDbCall = entries.some((e) =>
          e.startsWith('proj-') && fs.statSync(path.join(tempDir, e)).isDirectory()
        );
        throw new Error('DB insert failed');
      }),
      getProject: vi.fn(),
    };

    const mockSessionManager = {} as any;
    const mockNotebookStore = {} as any;

    const router = createProjectsRouter(mockDb as any, mockSessionManager, mockNotebookStore, tempDir);

    const mockReq = {
      body: { title: 'TestProject' },
      params: {},
    } as any;

    const mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    } as any;

    const postHandler = router.stack.find(
      (layer: any) => layer.route?.path === '/' && layer.route?.methods?.post
    )?.route?.stack?.[0]?.handle;

    expect(postHandler).toBeDefined();
    await postHandler!(mockReq, mockRes, () => {});

    // Verify directory WAS created before DB call (confirms test setup is correct)
    expect(dirExistedBeforeDbCall).toBe(true);

    // Should return 500
    expect(mockRes.status).toHaveBeenCalledWith(500);

    // No proj-* directories should remain after error (rolled back)
    const remaining = fs.readdirSync(tempDir).filter((e) =>
      e.startsWith('proj-') && fs.statSync(path.join(tempDir, e)).isDirectory()
    );
    expect(remaining).toHaveLength(0);
  });
});
