import { useEffect, useRef } from 'react';
import { useStore } from '../store';

/**
 * Mobile router hook for URL hash-based navigation.
 * Supports deep linking and browser history.
 *
 * URL patterns:
 * - #/projects                           → Projects list
 * - #/project/:projectId                 → Project notebooks
 * - #/project/:projectId/notebook/:nbId  → Notebook view
 * - #/project/:projectId/notebook/:nbId/file/:path → FileViewer open
 */
export function useMobileRouter() {
  const mobileView = useStore((s) => s.mobileView);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const mobileFileViewerPath = useStore((s) => s.mobileFileViewerPath);

  const setMobileView = useStore((s) => s.setMobileView);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const projects = useStore((s) => s.projects);

  const isInitialized = useRef(false);
  const skipHashUpdate = useRef(false);

  // Parse hash and restore state on mount
  useEffect(() => {
    if (isInitialized.current) return;

    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '#/projects') {
      // Default or explicit projects view - no need to wait for projects
      isInitialized.current = true;
      setMobileView('projects');
      return;
    }

    // For project-specific routes, wait for projects to load
    if (projects.length === 0) return;

    isInitialized.current = true;
    parseAndApplyHash(hash);
  }, [projects.length, setMobileView]);

  // Update hash when state changes
  useEffect(() => {
    if (skipHashUpdate.current) {
      skipHashUpdate.current = false;
      return;
    }

    const newHash = buildHash();
    if (window.location.hash !== newHash) {
      window.history.pushState(null, '', newHash);
    }
  }, [mobileView, activeProjectId, activeNotebookTabId, mobileFileViewerPath]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      skipHashUpdate.current = true;
      parseAndApplyHash(window.location.hash);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [projects]);

  function parseAndApplyHash(hash: string) {
    const path = hash.replace(/^#\/?/, '');
    const segments = path.split('/').filter(Boolean);

    if (segments.length === 0 || segments[0] === 'projects') {
      setMobileView('projects');
      return;
    }

    if (segments[0] === 'project' && segments[1]) {
      const projectId = segments[1];
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        setActiveProject(projectId, project.path);

        if (segments[2] === 'notebook' && segments[3]) {
          setMobileView('notebook');
          // Note: Actually opening the notebook requires additional API calls
          // which should be handled by MobileNotebookView
        } else {
          setMobileView('notebooks');
        }
      } else {
        // Project not found, go to projects list
        setMobileView('projects');
      }
      return;
    }

    // Unknown route, default to projects
    setMobileView('projects');
  }

  function buildHash(): string {
    if (mobileView === 'projects') {
      return '#/projects';
    }

    if (mobileView === 'notebooks' && activeProjectId) {
      return `#/project/${activeProjectId}`;
    }

    if (mobileView === 'notebook' && activeProjectId && activeNotebookTabId) {
      let hash = `#/project/${activeProjectId}/notebook/${activeNotebookTabId}`;
      if (mobileFileViewerPath) {
        hash += `/file/${encodeURIComponent(mobileFileViewerPath)}`;
      }
      return hash;
    }

    return '#/projects';
  }
}
