import { describe, it, expect } from 'vitest';
import type { Notebook, CellOutput } from '@notebook-ai/shared';
import {
  appendOutputToNotebook,
  setCellStatusInNotebook,
  updateToolResultInNotebook,
  setCellGitDiffInNotebook,
} from '../store/notebookMutations';

const makeNotebook = (...cells: any[]): Notebook => ({
  cells,
  metadata: { title: 'test', created: '', git_repo: false, agent: 'claude' as const },
  version: 1,
  slice: { generated: false, sections: [] },
  annotations: [],
  assets: { intermediate_files: [] },
} as Notebook);

const promptCell = (id: string, outputs: CellOutput[] = []) => ({
  id,
  type: 'prompt' as const,
  source: '',
  outputs,
  execution_count: 0,
  status: 'idle' as const,
});

describe('appendOutputToNotebook', () => {
  it('appends output to matching cell', () => {
    const nb = makeNotebook(promptCell('c1'));
    const output: CellOutput = { type: 'text', content: 'hello' };
    const result = appendOutputToNotebook(nb, 'c1', output);
    const cell = result.cells[0];
    expect(cell.type === 'prompt' && cell.outputs).toEqual([output]);
  });

  it('returns notebook unchanged if cell not found', () => {
    const nb = makeNotebook(promptCell('c1'));
    const output: CellOutput = { type: 'text', content: 'hello' };
    const result = appendOutputToNotebook(nb, 'unknown', output);
    expect(result).toBe(nb);
  });
});

describe('setCellStatusInNotebook', () => {
  it('updates status of matching cell', () => {
    const nb = makeNotebook(promptCell('c1'));
    const result = setCellStatusInNotebook(nb, 'c1', 'running');
    expect(result.cells[0].status).toBe('running');
  });

  it('returns notebook unchanged if cell not found', () => {
    const nb = makeNotebook(promptCell('c1'));
    const result = setCellStatusInNotebook(nb, 'unknown', 'running');
    expect(result).toBe(nb);
  });
});

describe('updateToolResultInNotebook', () => {
  it('sets result and is_error on matching tool', () => {
    const toolOutput: CellOutput = {
      type: 'tool_use',
      tool_use_id: 't1',
      name: 'bash',
      input: {},
    };
    const nb = makeNotebook(promptCell('c1', [toolOutput]));
    const result = updateToolResultInNotebook(nb, 'c1', 't1', 'output text', false);
    const cell = result.cells[0];
    if (cell.type === 'prompt') {
      const tool = cell.outputs[0];
      expect(tool.type === 'tool_use' && tool.result).toBe('output text');
      expect(tool.type === 'tool_use' && tool.is_error).toBe(false);
    }
  });
});

describe('setCellGitDiffInNotebook', () => {
  it('sets git_diff on matching prompt cell', () => {
    const nb = makeNotebook(promptCell('c1'));
    const result = setCellGitDiffInNotebook(nb, 'c1', 'diff --git ...');
    const cell = result.cells[0];
    expect(cell.type === 'prompt' && (cell as any).git_diff).toBe('diff --git ...');
  });

  it('returns notebook unchanged if cell not found', () => {
    const nb = makeNotebook(promptCell('c1'));
    const result = setCellGitDiffInNotebook(nb, 'unknown', 'diff');
    expect(result).toBe(nb);
  });
});
