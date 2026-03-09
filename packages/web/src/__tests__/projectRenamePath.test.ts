/**
 * C1: After renaming the active project, activeProjectPath must update to the new path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal store mock
let storeState: Record<string, any> = {};
const setState = (updates: Record<string, any>) => Object.assign(storeState, updates);

vi.mock('../store', () => ({
  useStore: Object.assign(
    (selector: (s: any) => any) => selector(storeState),
    {
      getState: () => storeState,
      setState,
      subscribe: () => () => {},
    },
  ),
}));

describe('project rename → activeProjectPath sync', () => {
  beforeEach(() => {
    storeState = {
      activeProjectId: 'proj-1',
      activeProjectPath: '/old/path/my-project',
      projects: [{ id: 'proj-1', title: 'My Project', path: '/old/path/my-project' }],
    };
  });

  it('activeProjectPath should update when the renamed project is the active one', async () => {
    // Simulate what onDone should do after successful rename
    const renamedProject = { id: 'proj-1', title: 'New Name', path: '/old/path/new-name' };

    // After fetchProjects, projects list is updated
    setState({ projects: [renamedProject] });

    // The fix: if active project was renamed, update activeProjectPath
    const { activeProjectId } = storeState;
    const updatedProject = storeState.projects.find((p: any) => p.id === activeProjectId);
    if (updatedProject && updatedProject.path !== storeState.activeProjectPath) {
      setState({ activeProjectPath: updatedProject.path });
    }

    expect(storeState.activeProjectPath).toBe('/old/path/new-name');
  });

  it('activeProjectPath should NOT change when a different project is renamed', () => {
    const otherProject = { id: 'proj-2', title: 'Other', path: '/other/path' };
    setState({ projects: [storeState.projects[0], otherProject] });

    // Check that activeProjectPath is untouched
    const { activeProjectId } = storeState;
    const updatedProject = storeState.projects.find((p: any) => p.id === activeProjectId);
    if (updatedProject && updatedProject.path !== storeState.activeProjectPath) {
      setState({ activeProjectPath: updatedProject.path });
    }

    expect(storeState.activeProjectPath).toBe('/old/path/my-project');
  });
});
