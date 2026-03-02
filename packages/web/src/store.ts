import { create } from 'zustand';
import { createAuthSlice } from './store/authSlice';
import { createSidebarSlice } from './store/sidebarSlice';
import { createNotebookSlice } from './store/notebookSlice';
import { createProjectSlice } from './store/projectSlice';
import { createUiSlice } from './store/uiSlice';
import { createWsSlice } from './store/wsSlice';
import { createMobileSlice } from './store/mobileSlice';
import { _persistNotebook } from './store/cacheHelpers';

export type { NotebookStore } from './store/types';

export const useStore = create<import('./store/types').NotebookStore>()((...a) => ({
  ...createAuthSlice(...a),
  ...createSidebarSlice(...a),
  ...createNotebookSlice(...a),
  ...createProjectSlice(...a),
  ...createUiSlice(...a),
  ...createWsSlice(...a),
  ...createMobileSlice(...a),
}));

// Auto-persist notebook to localStorage whenever it changes
useStore.subscribe((state, prevState) => {
  if (
    state.notebook !== prevState.notebook &&
    state.notebook !== null &&
    state.activeNotebookId !== null
  ) {
    _persistNotebook(state.activeNotebookId, state.notebook);
  }
});

// Sync state.notebook → openNotebooks[activeTabId] when user mutates notebook directly
useStore.subscribe((state, prev) => {
  if (state.notebook && state.notebook !== prev.notebook && state.activeNotebookTabId) {
    const tab = state.openNotebooks[state.activeNotebookTabId];
    if (tab && tab.notebook !== state.notebook) {
      useStore.setState((s) => ({
        openNotebooks: {
          ...s.openNotebooks,
          [s.activeNotebookTabId!]: {
            ...s.openNotebooks[s.activeNotebookTabId!],
            notebook: state.notebook!,
          },
        },
      }));
    }
  }
});
