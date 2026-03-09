/**
 * Project rename — TDD tests
 *
 * When a project is renamed via PATCH /:projectId:
 * 1. The project directory on disk should be renamed
 * 2. DB project record (path, slug) should be updated
 * 3. DB notebook records (workspace_dir, notebook_path) should be updated
 * 4. .claude/settings.json in each notebook worktree should be regenerated
 *    with correct absolute paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Minimal mock db ──────────────────────────────────────────────────────

function createMockDb(project: { id: string; path: string; title: string; slug: string }) {
  let projectData = { ...project, status: 'active', notebook_count: 0 };
  const notebooks: any[] = [];
  return {
    getProject: (id: string) => (id === projectData.id ? { ...projectData } : null),
    listProjects: () => [projectData],
    createProject: (p: any) => p,
    deleteProject: () => {},
    updateProject: (id: string, updates: any) => {
      if (id !== projectData.id) return undefined;
      Object.assign(projectData, updates);
      return { ...projectData };
    },
    listProjectNotebooks: (projectId: string) =>
      notebooks.filter((n: any) => n.project_id === projectId)
        .map((n: any) => ({ id: n.id, workspace_dir: n.workspace_dir })),
    getActiveSession: () => null,
    createNotebook: (nb: any) => { notebooks.push(nb); return nb; },
    updateNotebook: (id: string, updates: any) => {
      const nb = notebooks.find((n: any) => n.id === id);
      if (nb) Object.assign(nb, updates);
      return nb;
    },
    getNotebookByPath: (p: string) => notebooks.find((n: any) => n.notebook_path === p) || null,
    deleteNotebook: () => {},
    pruneOrphanedNotebooks: async () => {},
    _notebooks: notebooks,
    _project: projectData,
  } as any;
}

const mockSessionManager = { restartSession: vi.fn() } as any;
const mockNotebookStore = {} as any;

// ── Test setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let app: ReturnType<typeof express>;
let db: ReturnType<typeof createMockDb>;
const PROJECT_ID = 'proj-rename-1';

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-proj-rename-'));
  projectDir = path.join(tmpDir, 'my-project');

  // Init a bare git repo to support worktree operations
  execSync(`git init --bare ${path.join(projectDir, '.git')}`, { stdio: 'ignore' });
  mkdirSync(projectDir, { recursive: true });

  db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'My Project', slug: 'my-project' });
  const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('PATCH /api/projects/:projectId (rename)', () => {
  it('renames the project directory on disk', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const newDir = path.join(tmpDir, 'renamed-project');
    expect(existsSync(newDir)).toBe(true);
    expect(existsSync(projectDir)).toBe(false);
  });

  it('updates db project path and slug', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const project = db.getProject(PROJECT_ID);
    expect(project.path).toBe(path.join(tmpDir, 'renamed-project'));
    expect(project.slug).toContain('renamed-project');
  });

  it('updates notebook db records with new paths', async () => {
    // Create a worktree directory with a notebook
    const worktreeDir = path.join(projectDir, '.worktrees', 'task-my-nb');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(path.join(worktreeDir, 'my-nb.notebook.json'), '{}');

    db._notebooks.push({
      id: 'nb-1',
      project_id: PROJECT_ID,
      workspace_dir: worktreeDir,
      notebook_path: path.join(worktreeDir, 'my-nb.notebook.json'),
    });

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const nb = db._notebooks[0];
    const newProjectDir = path.join(tmpDir, 'renamed-project');
    expect(nb.workspace_dir).toBe(path.join(newProjectDir, '.worktrees', 'task-my-nb'));
    expect(nb.notebook_path).toBe(path.join(newProjectDir, '.worktrees', 'task-my-nb', 'my-nb.notebook.json'));
  });

  it('regenerates .claude/settings.json with updated paths', async () => {
    // Create a worktree directory with .claude/settings.json
    const worktreeDir = path.join(projectDir, '.worktrees', 'task-my-nb');
    const claudeDir = path.join(worktreeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(worktreeDir, 'my-nb.notebook.json'), '{}');

    // Write old settings.json with old absolute path
    const oldSettings = JSON.stringify({
      hooks: {
        SessionStart: [{
          command: `cat "${path.join(worktreeDir, '.MEMORY.md')}" 2>/dev/null || echo '无记忆文件'`,
          description: '加载记忆文件',
        }],
      },
    }, null, 2);
    await writeFile(path.join(claudeDir, 'settings.json'), oldSettings);

    db._notebooks.push({
      id: 'nb-1',
      project_id: PROJECT_ID,
      workspace_dir: worktreeDir,
      notebook_path: path.join(worktreeDir, 'my-nb.notebook.json'),
    });

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const newProjectDir = path.join(tmpDir, 'renamed-project');
    const newWorktreeDir = path.join(newProjectDir, '.worktrees', 'task-my-nb');
    const newSettingsPath = path.join(newWorktreeDir, '.claude', 'settings.json');

    expect(existsSync(newSettingsPath)).toBe(true);
    const content = await readFile(newSettingsPath, 'utf-8');
    expect(content).toContain(newWorktreeDir);
    expect(content).not.toContain(projectDir);
  });

  it('handles slug conflict by appending suffix', async () => {
    // Create a conflicting directory
    const conflictDir = path.join(tmpDir, 'renamed-project');
    await mkdir(conflictDir, { recursive: true });

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    // Should have appended a suffix to avoid conflict
    const project = db.getProject(PROJECT_ID);
    expect(project.path).not.toBe(conflictDir);
    expect(existsSync(project.path)).toBe(true);
  });

  it('updates project-root .claude/settings.json with new paths', async () => {
    // Project root has its own .claude/settings.json with absolute paths
    const claudeDir = path.join(projectDir, '.claude');
    await mkdir(claudeDir, { recursive: true });

    const oldSettings = JSON.stringify({
      hooks: {
        SessionStart: [{
          command: `cat "${path.join(projectDir, '.worktrees', 'task-foo', '.MEMORY.md')}" 2>/dev/null || echo '无记忆文件'`,
          description: '加载记忆文件',
        }],
      },
    }, null, 2);
    await writeFile(path.join(claudeDir, 'settings.json'), oldSettings);

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const newProjectDir = path.join(tmpDir, 'renamed-project');
    const newSettingsPath = path.join(newProjectDir, '.claude', 'settings.json');

    expect(existsSync(newSettingsPath)).toBe(true);
    const content = await readFile(newSettingsPath, 'utf-8');
    expect(content).toContain(newProjectDir);
    expect(content).not.toContain(projectDir);
  });

  it('updates .MEMORY.md files with new absolute paths', async () => {
    // Create a worktree with .MEMORY.md containing old absolute paths
    const worktreeDir = path.join(projectDir, '.worktrees', 'task-my-nb');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(path.join(worktreeDir, 'my-nb.notebook.json'), '{}');
    await writeFile(path.join(worktreeDir, '.MEMORY.md'),
      `Absolute path: \`${path.join(worktreeDir, '.deliverables')}\`\n` +
      `Absolute path: \`${path.join(projectDir, '.deliverables')}\`\n`
    );

    db._notebooks.push({
      id: 'nb-1',
      project_id: PROJECT_ID,
      workspace_dir: worktreeDir,
      notebook_path: path.join(worktreeDir, 'my-nb.notebook.json'),
    });

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const newProjectDir = path.join(tmpDir, 'renamed-project');
    const newWorktreeDir = path.join(newProjectDir, '.worktrees', 'task-my-nb');
    const memoryContent = await readFile(path.join(newWorktreeDir, '.MEMORY.md'), 'utf-8');
    expect(memoryContent).toContain(newProjectDir);
    expect(memoryContent).not.toContain(projectDir);
  });

  it('returns 409 when both slug and slug+id paths exist', async () => {
    const conflictDir1 = path.join(tmpDir, 'renamed-project');
    const conflictDir2 = path.join(tmpDir, `renamed-project-${PROJECT_ID.slice(0, 6)}`);
    await mkdir(conflictDir1, { recursive: true });
    await mkdir(conflictDir2, { recursive: true });

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(409);

    // Original directory should still exist (no rename happened)
    expect(existsSync(projectDir)).toBe(true);
  });

  it('skips directory rename when title change produces same slug', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'My Project!' }) // slug still = 'my-project'
      .expect(200);

    // Directory should remain the same
    expect(existsSync(projectDir)).toBe(true);
  });
});
