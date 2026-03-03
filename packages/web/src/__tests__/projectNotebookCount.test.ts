/**
 * @file projectNotebookCount.test.ts
 * Regression test: notebook_count should decrement after deleting a notebook
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProjectSlice, type ProjectListItem } from '../store/projectSlice';

function createTestStore() {
  const state: any = {
    authToken: 'test-token',
    projects: [] as ProjectListItem[],
  };

  const get = () => state;
  const set = (partial: any) => {
    if (typeof partial === 'function') {
      Object.assign(state, partial(state));
    } else {
      Object.assign(state, partial);
    }
  };

  const slice = createProjectSlice(set, get, {} as any);
  Object.assign(state, slice);

  return { state, get, set };
}

describe('Project notebook_count after deletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should decrement notebook_count when a notebook is deleted', async () => {
    const { state } = createTestStore();

    // Set up initial projects with notebook_count = 3
    state.projects = [
      {
        id: 'proj-1',
        title: 'Test Project',
        slug: 'test-project',
        status: 'active' as const,
        notebook_count: 3,
        path: '/home/user/test-project',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
    ];

    // Mock successful delete
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    // Delete a notebook
    await state.deleteProjectNotebook('proj-1', 'my-notebook');

    // notebook_count should now be 2
    const project = state.projects.find((p: ProjectListItem) => p.id === 'proj-1');
    expect(project).toBeDefined();
    expect(project!.notebook_count).toBe(2);
  });

  it('should not decrement below 0', async () => {
    const { state } = createTestStore();

    state.projects = [
      {
        id: 'proj-1',
        title: 'Test Project',
        slug: 'test-project',
        status: 'active' as const,
        notebook_count: 0,
        path: '/home/user/test-project',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    await state.deleteProjectNotebook('proj-1', 'my-notebook');

    const project = state.projects.find((p: ProjectListItem) => p.id === 'proj-1');
    expect(project!.notebook_count).toBe(0);
  });

  it('should not change count if project not found', async () => {
    const { state } = createTestStore();

    state.projects = [
      {
        id: 'proj-1',
        title: 'Test Project',
        slug: 'test-project',
        status: 'active' as const,
        notebook_count: 3,
        path: '/home/user/test-project',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    // Delete from a different project
    await state.deleteProjectNotebook('proj-999', 'my-notebook');

    const project = state.projects.find((p: ProjectListItem) => p.id === 'proj-1');
    expect(project!.notebook_count).toBe(3);
  });
});

describe('Project notebook_count after creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should increment notebook_count when a notebook is created', async () => {
    const { state } = createTestStore();

    state.projects = [
      {
        id: 'proj-1',
        title: 'Test Project',
        slug: 'test-project',
        status: 'active' as const,
        notebook_count: 2,
        path: '/home/user/test-project',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionId: 's-1', notebookPath: '/path/to/nb' }),
    } as Response);

    await state.createNotebook('proj-1', 'New Notebook');

    const project = state.projects.find((p: ProjectListItem) => p.id === 'proj-1');
    expect(project!.notebook_count).toBe(3);
  });
});
