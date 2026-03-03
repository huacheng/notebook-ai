import { describe, it, expect } from 'vitest';
import { updateToolResultInNotebook } from '../store/notebookMutations';
import type { Notebook, PromptCell, CellOutput } from '@notebook-ai/shared';

function makeNotebook(outputs: CellOutput[]): Notebook {
  return {
    version: 1,
    metadata: { title: 'Test', created: '', updated: '', cwd: '/', git_repo: false, agent: 'claude' },
    cells: [{
      id: 'cell-1',
      type: 'prompt',
      source: 'test',
      outputs,
      execution_count: 0,
      status: 'running',
    }],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

describe('updateToolResultInNotebook - D1 precision matching', () => {
  it('should NOT match wrong tool_use when multiple are pending', () => {
    // Two pending tool_use outputs
    const nb = makeNotebook([
      { type: 'tool_use', tool_use_id: 'tool-A', name: 'Read', input: {}, timestamp: '' },
      { type: 'tool_use', tool_use_id: 'tool-B', name: 'Write', input: {}, timestamp: '' },
    ]);

    // Update tool-B specifically
    const updated = updateToolResultInNotebook(nb, 'cell-1', 'tool-B', 'result-B', false);
    const cell = updated.cells[0] as PromptCell;

    // tool-A should NOT be updated (was being incorrectly matched by unresolved logic)
    expect(cell.outputs[0]).not.toHaveProperty('result');
    // tool-B should be updated
    expect(cell.outputs[1]).toHaveProperty('result', 'result-B');
  });

  it('should return unchanged notebook when tool_use_id not found', () => {
    const nb = makeNotebook([
      { type: 'tool_use', tool_use_id: 'tool-A', name: 'Read', input: {}, timestamp: '' },
    ]);

    const updated = updateToolResultInNotebook(nb, 'cell-1', 'nonexistent', 'result', false);
    // Reference should be unchanged when no match
    expect(updated).toBe(nb);
  });

  it('should correctly update first tool_use when explicitly targeted', () => {
    const nb = makeNotebook([
      { type: 'tool_use', tool_use_id: 'tool-A', name: 'Read', input: {}, timestamp: '' },
      { type: 'tool_use', tool_use_id: 'tool-B', name: 'Write', input: {}, timestamp: '' },
    ]);

    const updated = updateToolResultInNotebook(nb, 'cell-1', 'tool-A', 'result-A', false);
    const cell = updated.cells[0] as PromptCell;

    expect(cell.outputs[0]).toHaveProperty('result', 'result-A');
    expect(cell.outputs[1]).not.toHaveProperty('result');
  });

  it('should set is_error flag correctly', () => {
    const nb = makeNotebook([
      { type: 'tool_use', tool_use_id: 'tool-A', name: 'Bash', input: {}, timestamp: '' },
    ]);

    const updated = updateToolResultInNotebook(nb, 'cell-1', 'tool-A', 'command failed', true);
    const cell = updated.cells[0] as PromptCell;

    expect(cell.outputs[0]).toHaveProperty('result', 'command failed');
    expect(cell.outputs[0]).toHaveProperty('is_error', true);
  });

  it('should not modify other cell types', () => {
    const nb: Notebook = {
      version: 1,
      metadata: { title: 'Test', created: '', updated: '', cwd: '/', git_repo: false, agent: 'claude' },
      cells: [{
        id: 'cell-1',
        type: 'markdown',
        source: '# Hello',
        execution_count: 0,
        status: 'idle',
      }],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };

    const updated = updateToolResultInNotebook(nb, 'cell-1', 'tool-A', 'result', false);
    expect(updated).toBe(nb);
  });
});
