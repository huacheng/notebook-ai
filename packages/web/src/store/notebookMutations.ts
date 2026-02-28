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
    let matched = false;
    const outputs = c.outputs.map((out) => {
      if (matched || out.type !== 'tool_use') return out;
      const byId = out.tool_use_id === toolUseId;
      const unresolved = !byId && out.result === undefined;
      if (byId || unresolved) {
        matched = true;
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
