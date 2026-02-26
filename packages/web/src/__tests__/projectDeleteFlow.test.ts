/**
 * Project & Notebook delete flow — regression tests
 *
 * Key invariants:
 * 1. deleteProject must NOT call goBackToProjectList / fetchProjects internally
 *    — the caller (ConfirmDeleteModal) must show success first, then trigger cleanup.
 * 2. ConfirmDeleteModal must separate Cancel (onCancel) from success cleanup (onDone).
 *    onCancel fires on user cancel / error dismiss. onDone fires only after a
 *    successful delete + 800ms success display.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProjectSlice } from '../store/projectSlice';

function createTestSlice() {
  let state: Record<string, any> = {};

  const set = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(state, update(state));
    } else {
      Object.assign(state, update);
    }
  };

  const get = () => state as any;

  const slice = createProjectSlice(set as any, get, {} as any);
  Object.assign(state, slice);

  return { state, set, get };
}

// ── deleteProject store action ──────────────────────────────────────────────

describe('deleteProject', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    await expect(state.deleteProject('p1')).rejects.toThrow('server error');
  });

  it('does NOT call goBackToProjectList during the async call', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    state.activeProjectId = 'p1';
    const goBackSpy = vi.fn();
    state.goBackToProjectList = goBackSpy;

    await state.deleteProject('p1');
    expect(goBackSpy).not.toHaveBeenCalled();
  });

  it('does NOT call fetchProjects during the async call', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    state.activeProjectId = 'other';
    const fetchProjectsSpy = vi.fn();
    state.fetchProjects = fetchProjectsSpy;

    await state.deleteProject('p1');
    expect(fetchProjectsSpy).not.toHaveBeenCalled();
  });
});

// ── deleteProjectNotebook store action ──────────────────────────────────────

describe('deleteProjectNotebook', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'notebook not found' }),
    });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    await expect(state.deleteProjectNotebook('p1', 'nb-dir')).rejects.toThrow('notebook not found');
  });

  it('resolves without error on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    await expect(state.deleteProjectNotebook('p1', 'nb-dir')).resolves.toBeUndefined();
  });
});

// ── createProject store action ───────────────────────────────────────────────

describe('createProject', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'project already exists' }),
    });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    await expect(state.createProject('My Project')).rejects.toThrow('project already exists');
  });

  it('does NOT call fetchProjects internally on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'p1' }) });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    const fetchProjectsSpy = vi.fn();
    state.fetchProjects = fetchProjectsSpy;

    await state.createProject('My Project');
    expect(fetchProjectsSpy).not.toHaveBeenCalled();
  });

  it('resolves without error on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'p1' }) });
    const { state } = createTestSlice();
    state.authToken = 'tok';
    await expect(state.createProject('My Project')).resolves.toBeUndefined();
  });
});

// ── ConfirmDeleteModal callback contract ────────────────────────────────────
// Core logic (runDeleteFlow) is tested in deleteFlow.test.ts via proper
// Red/Green TDD against the actual extracted function.
