import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';

export interface ProjectListItem {
  id: string;
  title: string;
  slug: string;
  status: 'active' | 'archived';
  notebook_count: number;
  path: string;
  created_at: string;
  updated_at: string;
}

export const createProjectSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'projects' | 'projectsLoading' | 'activeProjectId' | 'activeProjectPath'
  | 'sidebarLevel' | 'fileBrowserPath'
  | 'fetchProjects' | 'createProject' | 'deleteProject' | 'importProject'
  | 'deleteProjectNotebook' | 'importProjectNotebook'
  | 'setActiveProject' | 'goBackToProjectList'
  | 'navigateFileBrowser' | 'createNotebook'
>> = (set, get) => ({
  projects: [],
  projectsLoading: false,
  activeProjectId: null,
  activeProjectPath: null,
  sidebarLevel: 'L1' as const,
  fileBrowserPath: '',

  fetchProjects: async () => {
    set({ projectsLoading: true });
    try {
      const token = get().authToken;
      const res = await fetch('/api/projects', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const projects = await res.json();
      const updates: Record<string, unknown> = { projects, projectsLoading: false };
      // Sync activeProjectPath if the active project was renamed (path changed)
      const activeId = get().activeProjectId;
      if (activeId) {
        const active = (projects as ProjectListItem[]).find(p => p.id === activeId);
        if (active && active.path !== get().activeProjectPath) {
          updates.activeProjectPath = active.path;
        }
      }
      set(updates);
    } catch {
      set({ projectsLoading: false });
    }
  },

  createProject: async (title: string) => {
    const token = get().authToken;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Create failed' }));
      throw new Error(body.error || `Create failed (${res.status})`);
    }
    // State refresh (fetchProjects) is intentionally NOT done here —
    // the caller must show the success phase first, then refresh explicitly.
  },

  deleteProject: async (projectId: string) => {
    const token = get().authToken;
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(body.error || `Delete failed (${res.status})`);
    }
    // State cleanup (goBackToProjectList, fetchProjects) is intentionally
    // NOT done here — the caller (ConfirmDeleteModal) must show the success
    // phase first, then call cleanup explicitly after the user sees it.
  },

  importProject: async (file: File) => {
    const token = get().authToken;
    const form = new FormData();
    form.append('archive', file);
    const res = await fetch('/api/projects/import', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (res.ok) await get().fetchProjects();
  },

  deleteProjectNotebook: async (projectId: string, notebookRelPath: string, merge = false) => {
    const token = get().authToken;
    const mergeParam = merge ? '&merge=true' : '';
    const res = await fetch(
      `/api/projects/${projectId}/notebooks/by-path?path=${encodeURIComponent(notebookRelPath)}${mergeParam}`,
      {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(body.error || `Delete failed (${res.status})`);
    }
    // Decrement notebook_count for the project
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, notebook_count: Math.max(0, p.notebook_count - 1) }
          : p
      ),
    }));
    // File listing in FileSection will auto-refresh
  },

  importProjectNotebook: async (projectId: string, file: File) => {
    const token = get().authToken;
    const headers = (extra?: Record<string, string>) => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    });

    // Parse the file
    let notebook: any;
    try {
      if (file.name.endsWith('.zip')) {
        const form = new FormData();
        form.append('file', file);
        const extractRes = await fetch('/api/notebooks/extract-zip', {
          method: 'POST',
          headers: headers(),
          body: form,
        });
        if (!extractRes.ok) return;
        notebook = await extractRes.json();
      } else {
        notebook = JSON.parse(await file.text());
      }
    } catch { return; }

    const title = notebook?.metadata?.title || file.name.replace(/\.(notebook\.json|json|zip)$/i, '') || 'Imported';

    // Create notebook in project
    const createRes = await fetch(`/api/projects/${projectId}/notebooks`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title }),
    });
    if (!createRes.ok) return;

    const data = await createRes.json();

    // Import content
    await fetch(`/api/notebooks/${encodeURIComponent(data.notebookId)}/import-content`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ...notebook,
        metadata: { ...notebook.metadata, title, updated: new Date().toISOString() },
      }),
    });

    // Increment notebook_count for the project
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, notebook_count: p.notebook_count + 1 }
          : p
      ),
    }));
  },

  setActiveProject: (id: string, path: string) => {
    set({
      activeProjectId: id,
      activeProjectPath: path,
      sidebarLevel: 'L2' as const,
      fileBrowserPath: '',
    });
  },

  goBackToProjectList: () => {
    set({
      activeProjectId: null,
      activeProjectPath: null,
      sidebarLevel: 'L1' as const,
      fileBrowserPath: '',
    });
  },

  navigateFileBrowser: (subPath: string) => {
    set({ fileBrowserPath: subPath });
  },

  createNotebook: async (projectId: string, title: string) => {
    const token = get().authToken;
    const res = await fetch(`/api/projects/${projectId}/notebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Create failed' }));
      throw new Error(body.error || `Create failed (${res.status})`);
    }
    const data = await res.json();
    // Increment notebook_count for the project
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, notebook_count: p.notebook_count + 1 }
          : p
      ),
    }));
    return { sessionId: data.sessionId, notebookPath: data.notebookPath };
  },
});
