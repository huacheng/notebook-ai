/**
 * notebook_count accuracy — must reflect actual notebook rows, not a stale counter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NotebookDb } from '../db.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('project notebook_count', () => {
  let db: NotebookDb;
  const now = new Date().toISOString();

  beforeEach(() => {
    db = new NotebookDb(':memory:');
  });

  function createProject(id: string) {
    return db.createProject({
      id,
      title: `Project ${id}`,
      slug: `project-${id}`,
      path: `/tmp/projects/${id}`,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  function createNotebook(id: string, projectId: string) {
    db.createNotebook({
      id,
      user_id: null,
      title: `Notebook ${id}`,
      slug: `nb-${id}`,
      workspace_dir: `/tmp/ws/${id}`,
      notebook_path: `/tmp/ws/${id}/nb.json`,
      project_id: projectId,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  it('returns 0 when project has no notebooks', () => {
    createProject('p1');
    const projects = db.listProjects();
    expect(projects[0].notebook_count).toBe(0);
  });

  it('returns correct count after adding notebooks', () => {
    createProject('p1');
    createNotebook('nb1', 'p1');
    createNotebook('nb2', 'p1');
    const projects = db.listProjects();
    expect(projects[0].notebook_count).toBe(2);
  });

  it('count decreases after deleting a notebook', () => {
    createProject('p1');
    createNotebook('nb1', 'p1');
    createNotebook('nb2', 'p1');
    db.deleteNotebook('nb1');
    const projects = db.listProjects();
    expect(projects[0].notebook_count).toBe(1);
  });

  it('does not count notebooks from other projects', () => {
    createProject('p1');
    createProject('p2');
    createNotebook('nb1', 'p1');
    createNotebook('nb2', 'p2');
    createNotebook('nb3', 'p2');
    const projects = db.listProjects();
    const p1 = projects.find(p => p.id === 'p1')!;
    const p2 = projects.find(p => p.id === 'p2')!;
    expect(p1.notebook_count).toBe(1);
    expect(p2.notebook_count).toBe(2);
  });

  it('getProject also returns correct count', () => {
    createProject('p1');
    createNotebook('nb1', 'p1');
    createNotebook('nb2', 'p1');
    const project = db.getProject('p1');
    expect(project!.notebook_count).toBe(2);
  });

  it('createNotebook defaults agent to claude when omitted', () => {
    createProject('p1');
    db.createNotebook({
      id: 'nb-agent-default',
      user_id: null,
      title: 'Agent Default Test',
      slug: 'agent-default',
      workspace_dir: '/tmp/ws/agent-default',
      notebook_path: '/tmp/ws/agent-default/nb.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const row = db.getNotebook('nb-agent-default');
    expect(row!.agent).toBe('claude');
  });

  it('createNotebook stores project_id correctly', () => {
    createProject('p1');
    db.createNotebook({
      id: 'nb-pid',
      user_id: null,
      title: 'PID Test',
      slug: 'pid-test',
      workspace_dir: '/tmp/ws/pid',
      notebook_path: '/tmp/ws/pid/nb.json',
      project_id: 'p1',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const nbs = db.listProjectNotebooks('p1');
    expect(nbs).toHaveLength(1);
    expect(nbs[0].id).toBe('nb-pid');
  });
});

describe('pruneOrphanedNotebooks', () => {
  let db: NotebookDb;
  let tmpDir: string;
  const now = new Date().toISOString();

  beforeEach(async () => {
    db = new NotebookDb(':memory:');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-prune-'));
  });

  function createProject(id: string) {
    return db.createProject({
      id, title: `Project ${id}`, slug: `project-${id}`,
      path: path.join(tmpDir, id), status: 'active',
      created_at: now, updated_at: now,
    });
  }

  function createNotebook(id: string, projectId: string, nbPath: string) {
    db.createNotebook({
      id, user_id: null, title: `Notebook ${id}`, slug: `nb-${id}`,
      workspace_dir: path.dirname(nbPath), notebook_path: nbPath,
      project_id: projectId, status: 'active',
      created_at: now, updated_at: now,
    });
  }

  it('removes notebook records whose notebook_path does not exist on disk', async () => {
    createProject('p1');
    // nb1 — file exists
    const nb1Path = path.join(tmpDir, 'nb1', 'nb1.notebook.json');
    await fs.mkdir(path.dirname(nb1Path), { recursive: true });
    await fs.writeFile(nb1Path, '{}');
    createNotebook('nb1', 'p1', nb1Path);

    // nb2 — file does NOT exist
    const nb2Path = path.join(tmpDir, 'nb2', 'nb2.notebook.json');
    createNotebook('nb2', 'p1', nb2Path);

    const pruned = await db.pruneOrphanedNotebooks();
    expect(pruned).toBe(1);

    const projects = db.listProjects();
    expect(projects[0].notebook_count).toBe(1);
  });

  it('returns 0 when all notebooks exist on disk', async () => {
    createProject('p1');
    const nb1Path = path.join(tmpDir, 'nb1', 'nb1.notebook.json');
    await fs.mkdir(path.dirname(nb1Path), { recursive: true });
    await fs.writeFile(nb1Path, '{}');
    createNotebook('nb1', 'p1', nb1Path);

    const pruned = await db.pruneOrphanedNotebooks();
    expect(pruned).toBe(0);
  });

  it('does not affect notebooks without a project_id', async () => {
    // Standalone notebook with non-existent path — should still be pruned
    db.createNotebook({
      id: 'standalone', user_id: null, title: 'Standalone', slug: 'standalone',
      workspace_dir: '/nonexistent', notebook_path: '/nonexistent/nb.json',
      status: 'active', created_at: now, updated_at: now,
    });

    const pruned = await db.pruneOrphanedNotebooks();
    expect(pruned).toBe(1);

    const all = db.listNotebooks();
    expect(all).toHaveLength(0);
  });
});
