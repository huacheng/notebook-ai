import type { Notebook, CellOutput } from '@notebook-ai/shared';

// ── Notebook mutation helpers (pure functions) ───────────────────────────────

export function updateCellStatus(
  notebook: Notebook,
  cellId: string,
  status: 'idle' | 'running' | 'completed' | 'error' | 'interrupted',
): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) =>
      cell.id === cellId ? { ...cell, status } : cell,
    ),
  };
}

export function updateCellDuration(
  notebook: Notebook,
  cellId: string,
  duration_ms: number,
): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) =>
      cell.id === cellId && cell.type === 'prompt'
        ? { ...cell, duration_ms }
        : cell,
    ),
  };
}

export function updateCellGitDiff(
  notebook: Notebook,
  cellId: string,
  git_diff: string,
): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) =>
      cell.id === cellId && cell.type === 'prompt'
        ? { ...cell, git_diff }
        : cell,
    ),
  };
}

export function appendCellOutput(
  notebook: Notebook,
  cellId: string,
  output: CellOutput,
): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) => {
      if (cell.id !== cellId || cell.type !== 'prompt') return cell;
      return {
        ...cell,
        outputs: [...cell.outputs, output],
      };
    }),
  };
}

/**
 * Attaches a tool result to the matching tool_use output block in a cell.
 * Matches by tool_use_id; falls back to the first unresolved tool_use block.
 */
export function attachToolResult(
  notebook: Notebook,
  cellId: string,
  toolUseId: string,
  content: string,
  isError: boolean,
): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) => {
      if (cell.id !== cellId || cell.type !== 'prompt') return cell;
      let matched = false;
      const outputs = cell.outputs.map((out) => {
        if (matched || out.type !== 'tool_use') return out;
        // Match by stored tool_use_id (preferred), fall back to first unresolved.
        const byId = out.tool_use_id === toolUseId;
        const unresolved = !byId && out.result === undefined;
        if (byId || unresolved) {
          matched = true;
          // Set isActive: false when answer is received (AskUserQuestion)
          return { ...out, result: content, is_error: isError, isActive: false };
        }
        return out;
      });
      return { ...cell, outputs };
    }),
  };
}

/** Returns the cell ID of the first cell that is currently 'running'. */
export function findRunningCellId(notebook: Notebook): string | null {
  const running = notebook.cells.find((c) => c.status === 'running');
  return running ? running.id : null;
}

/** Returns the cell ID containing a tool_use output with the given tool_use_id. */
export function findCellByToolUseId(notebook: Notebook, toolUseId: string): string | null {
  for (const cell of notebook.cells) {
    if (cell.type !== 'prompt') continue;
    for (const out of cell.outputs) {
      if (out.type === 'tool_use' && out.tool_use_id === toolUseId) {
        return cell.id;
      }
    }
  }
  return null;
}
