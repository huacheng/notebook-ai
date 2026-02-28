import type { Notebook } from '@notebook-ai/shared';
import type { NotebookStore } from './types';

/**
 * Route a notebook mutation to the correct openNotebooks entry by sessionId.
 * If the target is the active tab, also updates state.notebook.
 * Returns a partial state update to spread into set().
 */
export function applyToSession(
  state: Pick<NotebookStore, 'openNotebooks' | 'activeNotebookTabId' | 'notebook'>,
  sessionId: string,
  mutate: (nb: Notebook) => Notebook,
): Partial<Pick<NotebookStore, 'openNotebooks' | 'notebook'>> {
  const newOpen = { ...state.openNotebooks };
  const result: Partial<Pick<NotebookStore, 'openNotebooks' | 'notebook'>> = {};
  let found = false;

  for (const [nbId, entry] of Object.entries(newOpen)) {
    if (entry.sessionId === sessionId) {
      const updated = mutate(entry.notebook);
      newOpen[nbId] = { ...entry, notebook: updated };
      if (nbId === state.activeNotebookTabId) {
        result.notebook = updated;
      }
      found = true;
      break;
    }
  }

  result.openNotebooks = found ? newOpen : state.openNotebooks;
  return result;
}
