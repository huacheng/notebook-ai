import type { Notebook, CellOutput, CellStatus } from '@notebook-ai/shared';

/**
 * Pure notebook transformation functions.
 * These operate on Notebook values without store dependencies,
 * enabling session-aware routing in wsSlice.
 */

export function appendOutputToNotebook(nb: Notebook, cellId: string, output: CellOutput): Notebook {
  let changed = false;
  const cells = nb.cells.map((c) => {
    if (c.id !== cellId || c.type !== 'prompt') return c;
    changed = true;
    return { ...c, outputs: [...c.outputs, output] };
  });
  return changed ? { ...nb, cells } : nb;
}

export function setCellStatusInNotebook(nb: Notebook, cellId: string, status: CellStatus): Notebook {
  let changed = false;
  const cells = nb.cells.map((c) => {
    if (c.id !== cellId) return c;
    changed = true;
    // Set started_at when cell begins running (used by RunningStatus timer)
    if (status === 'running') {
      return { ...c, status, started_at: Date.now() };
    }
    return { ...c, status };
  });
  return changed ? { ...nb, cells } : nb;
}

export function updateToolResultInNotebook(
  nb: Notebook,
  cellId: string,
  toolUseId: string,
  content: string,
  isError: boolean,
): Notebook {
  let changed = false;
  const cells = nb.cells.map((c) => {
    if (c.id !== cellId || c.type !== 'prompt') return c;
    const outputs = c.outputs.map((out) => {
      if (out.type !== 'tool_use') return out;
      // D1-fix: Precise matching by tool_use_id only — removed unresolved fallback
      // that could incorrectly match the first pending tool_use
      if (out.tool_use_id === toolUseId) {
        changed = true;
        return { ...out, result: content, is_error: isError };
      }
      return out;
    });
    return { ...c, outputs };
  });
  return changed ? { ...nb, cells } : nb;
}

export function setCellGitDiffInNotebook(nb: Notebook, cellId: string, diff: string): Notebook {
  let changed = false;
  const cells = nb.cells.map((c) => {
    if (c.id !== cellId || c.type !== 'prompt') return c;
    changed = true;
    return { ...c, git_diff: diff };
  });
  return changed ? { ...nb, cells } : nb;
}
