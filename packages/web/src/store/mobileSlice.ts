import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';

export const createMobileSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'mobileView' | 'leftDrawerOpen' | 'rightDrawerOpen'
  | 'mobileFileViewerOpen' | 'mobileFileViewerPath' | 'mobileFileViewerSource'
  | 'setMobileView' | 'toggleLeftDrawer' | 'toggleRightDrawer' | 'closeDrawers'
  | 'openMobileFileViewer' | 'closeMobileFileViewer'
>> = (set) => ({
  // ── State ──────────────────────────────────────────────────────────────
  mobileView: 'projects',
  leftDrawerOpen: false,
  rightDrawerOpen: false,
  mobileFileViewerOpen: false,
  mobileFileViewerPath: null,
  mobileFileViewerSource: null,

  // ── Actions ────────────────────────────────────────────────────────────
  setMobileView(view) {
    set({ mobileView: view, leftDrawerOpen: false, rightDrawerOpen: false });
  },

  toggleLeftDrawer() {
    set((s) => ({
      leftDrawerOpen: !s.leftDrawerOpen,
      rightDrawerOpen: false, // Mutually exclusive
    }));
  },

  toggleRightDrawer() {
    set((s) => ({
      rightDrawerOpen: !s.rightDrawerOpen,
      leftDrawerOpen: false, // Mutually exclusive
    }));
  },

  closeDrawers() {
    set({ leftDrawerOpen: false, rightDrawerOpen: false });
  },

  openMobileFileViewer(path, source) {
    set({
      mobileFileViewerOpen: true,
      mobileFileViewerPath: path,
      mobileFileViewerSource: source,
      leftDrawerOpen: false,
      rightDrawerOpen: false,
    });
  },

  closeMobileFileViewer() {
    set({
      mobileFileViewerOpen: false,
      mobileFileViewerPath: null,
      mobileFileViewerSource: null,
    });
  },
});
