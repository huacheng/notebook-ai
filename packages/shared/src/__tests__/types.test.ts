import { describe, it, expect } from 'vitest';
import {
  NotebookSchema,
  CellSchema,
  CellOutputSchema,
  WSClientMessageSchema,
  WSServerMessageSchema,
  PromptCellSchema,
  MarkdownCellSchema,
  VisualizationCellSchema,
  TextOutputSchema,
  ToolUseOutputSchema,
  ErrorOutputSchema,
  ChartOutputSchema,
  ThinkingOutputSchema,
} from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function validNotebook() {
  return {
    version: 1,
    metadata: {
      title: 'Test Notebook',
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      cwd: '/tmp',
      git_repo: false,
    },
    cells: [],
    slice: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

function validPromptCell() {
  return {
    id: 'cell-1',
    type: 'prompt' as const,
    source: 'Do something',
    execution_count: 1,
    status: 'idle' as const,
    outputs: [],
  };
}

function validMarkdownCell() {
  return {
    id: 'cell-2',
    type: 'markdown' as const,
    source: '# Heading',
    execution_count: 0,
    status: 'idle' as const,
  };
}

function validVisualizationCell() {
  return {
    id: 'cell-3',
    type: 'visualization' as const,
    source: 'chart code',
    data: { x: [1, 2], y: [3, 4] },
    execution_count: 0,
    status: 'idle' as const,
  };
}

// ── NotebookSchema ───────────────────────────────────────────────────────────

describe('NotebookSchema', () => {
  it('parses a valid notebook', () => {
    const result = NotebookSchema.safeParse(validNotebook());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.title).toBe('Test Notebook');
      expect(result.data.version).toBe(1);
      expect(result.data.cells).toEqual([]);
    }
  });

  it('parses a notebook with cells', () => {
    const nb = validNotebook();
    (nb as any).cells = [validPromptCell(), validMarkdownCell()];
    const result = NotebookSchema.safeParse(nb);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cells).toHaveLength(2);
      expect(result.data.cells[0].type).toBe('prompt');
      expect(result.data.cells[1].type).toBe('markdown');
    }
  });

  it('rejects a notebook missing metadata', () => {
    const result = NotebookSchema.safeParse({ version: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects a notebook missing metadata.title', () => {
    const nb = validNotebook();
    delete (nb.metadata as any).title;
    const result = NotebookSchema.safeParse(nb);
    expect(result.success).toBe(false);
  });

  it('rejects a notebook missing metadata.created', () => {
    const nb = validNotebook();
    delete (nb.metadata as any).created;
    const result = NotebookSchema.safeParse(nb);
    expect(result.success).toBe(false);
  });

  it('applies default values for optional fields', () => {
    const minimal = {
      metadata: {
        title: 'Minimal',
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    const result = NotebookSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.cells).toEqual([]);
      expect(result.data.slice).toEqual({ generated: false, sections: [] });
      expect(result.data.annotations).toEqual([]);
      expect(result.data.assets).toEqual({ intermediate_files: [] });
      expect(result.data.metadata.git_repo).toBe(false);
    }
  });

  it('rejects completely invalid data', () => {
    expect(NotebookSchema.safeParse(null).success).toBe(false);
    expect(NotebookSchema.safeParse('string').success).toBe(false);
    expect(NotebookSchema.safeParse(42).success).toBe(false);
    expect(NotebookSchema.safeParse([]).success).toBe(false);
  });
});

// ── CellSchema discriminated union ───────────────────────────────────────────

describe('CellSchema', () => {
  it('parses a prompt cell', () => {
    const result = CellSchema.safeParse(validPromptCell());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('prompt');
      expect(result.data.id).toBe('cell-1');
    }
  });

  it('parses a markdown cell', () => {
    const result = CellSchema.safeParse(validMarkdownCell());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('markdown');
    }
  });

  it('parses a visualization cell', () => {
    const result = CellSchema.safeParse(validVisualizationCell());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('visualization');
    }
  });

  it('rejects unknown cell type', () => {
    const result = CellSchema.safeParse({
      id: 'x',
      type: 'unknown',
      source: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects cell without id', () => {
    const cell = { ...validPromptCell() };
    delete (cell as any).id;
    const result = CellSchema.safeParse(cell);
    expect(result.success).toBe(false);
  });

  it('rejects cell without source', () => {
    const cell = { ...validPromptCell() };
    delete (cell as any).source;
    const result = CellSchema.safeParse(cell);
    expect(result.success).toBe(false);
  });

  it('applies default execution_count and status', () => {
    const result = CellSchema.safeParse({
      id: 'cell-x',
      type: 'prompt',
      source: 'test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.execution_count).toBe(0);
      expect(result.data.status).toBe('idle');
    }
  });

  it('applies default outputs for prompt cell', () => {
    const result = PromptCellSchema.safeParse({
      id: 'cell-x',
      type: 'prompt',
      source: 'test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outputs).toEqual([]);
    }
  });
});

// ── CellOutputSchema discriminated union ─────────────────────────────────────

describe('CellOutputSchema', () => {
  it('parses text output', () => {
    const result = CellOutputSchema.safeParse({
      type: 'text',
      content: 'Hello world',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('text');
    }
  });

  it('parses tool_use output', () => {
    const result = CellOutputSchema.safeParse({
      type: 'tool_use',
      name: 'read_file',
      input: { path: '/tmp/test.txt' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('tool_use');
      if (result.data.type === 'tool_use') {
        expect(result.data.name).toBe('read_file');
      }
    }
  });

  it('parses tool_use output with result', () => {
    const result = CellOutputSchema.safeParse({
      type: 'tool_use',
      name: 'bash',
      input: { cmd: 'ls' },
      result: 'file1.txt\nfile2.txt',
    });
    expect(result.success).toBe(true);
  });

  it('parses error output', () => {
    const result = CellOutputSchema.safeParse({
      type: 'error',
      message: 'Something went wrong',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('error');
    }
  });

  it('parses chart output', () => {
    const result = CellOutputSchema.safeParse({
      type: 'chart',
      chart_type: 'bar',
      data: { labels: ['a', 'b'], values: [1, 2] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('chart');
    }
  });

  it('parses chart output with svg', () => {
    const result = CellOutputSchema.safeParse({
      type: 'chart',
      chart_type: 'line',
      data: {},
      svg: '<svg></svg>',
    });
    expect(result.success).toBe(true);
  });

  it('parses thinking output', () => {
    const result = CellOutputSchema.safeParse({
      type: 'thinking',
      content: 'Let me think about this...',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('thinking');
    }
  });

  it('rejects unknown output type', () => {
    const result = CellOutputSchema.safeParse({
      type: 'image',
      content: 'data:image/png;base64,...',
    });
    expect(result.success).toBe(false);
  });

  it('rejects text output missing content', () => {
    const result = CellOutputSchema.safeParse({ type: 'text' });
    expect(result.success).toBe(false);
  });

  it('rejects tool_use output missing name', () => {
    const result = CellOutputSchema.safeParse({
      type: 'tool_use',
      input: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects tool_use output missing input', () => {
    const result = CellOutputSchema.safeParse({
      type: 'tool_use',
      name: 'bash',
    });
    expect(result.success).toBe(false);
  });

  it('rejects error output missing message', () => {
    const result = CellOutputSchema.safeParse({ type: 'error' });
    expect(result.success).toBe(false);
  });

  it('accepts optional timestamp on all output types', () => {
    const ts = '2025-01-01T00:00:00.000Z';
    expect(TextOutputSchema.safeParse({ type: 'text', content: 'x', timestamp: ts }).success).toBe(true);
    expect(ToolUseOutputSchema.safeParse({ type: 'tool_use', name: 'a', input: {}, timestamp: ts }).success).toBe(true);
    expect(ErrorOutputSchema.safeParse({ type: 'error', message: 'e', timestamp: ts }).success).toBe(true);
    expect(ChartOutputSchema.safeParse({ type: 'chart', chart_type: 'bar', data: {}, timestamp: ts }).success).toBe(true);
    expect(ThinkingOutputSchema.safeParse({ type: 'thinking', content: 't', timestamp: ts }).success).toBe(true);
  });
});

// ── WSClientMessageSchema ────────────────────────────────────────────────────

describe('WSClientMessageSchema', () => {
  it('parses execute_request', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'execute_request',
      session_id: 'sess-1',
      cell_id: 'cell-1',
      source: 'Do something',
    });
    expect(result.success).toBe(true);
  });

  it('parses save_notebook', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'save_notebook',
      session_id: 'sess-1',
      path: '/tmp/test.notebook.json',
    });
    expect(result.success).toBe(true);
  });

  it('parses load_notebook', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'load_notebook',
      session_id: 'sess-1',
      path: '/tmp/test.notebook.json',
    });
    expect(result.success).toBe(true);
  });

  it('parses export_html', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'export_html',
      session_id: 'sess-1',
    });
    expect(result.success).toBe(true);
  });

  it('parses export_html with options', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'export_html',
      session_id: 'sess-1',
      options: {
        include_slice: false,
        include_replay: false,
        include_annotations: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses slice_update', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'slice_update',
      session_id: 'sess-1',
      sections: [
        {
          id: 'sec-1',
          title: 'Title',
          content: 'Content',
          cell_refs: [],
          order: 0,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown message type', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'unknown_type',
    });
    expect(result.success).toBe(false);
  });

  it('rejects execute_request missing cell_id', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'execute_request',
      source: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects execute_request missing source', () => {
    const result = WSClientMessageSchema.safeParse({
      type: 'execute_request',
      cell_id: 'cell-1',
    });
    expect(result.success).toBe(false);
  });
});

// ── WSServerMessageSchema ────────────────────────────────────────────────────

describe('WSServerMessageSchema', () => {
  it('parses cell_output', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'cell_output',
      session_id: 'sess-1',
      cell_id: 'cell-1',
      output: { type: 'text', content: 'result' },
    });
    expect(result.success).toBe(true);
  });

  it('parses execution_complete', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'execution_complete',
      session_id: 'sess-1',
      cell_id: 'cell-1',
      duration_ms: 1500,
    });
    expect(result.success).toBe(true);
  });

  it('parses execution_complete without duration_ms', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'execution_complete',
      session_id: 'sess-1',
      cell_id: 'cell-1',
    });
    expect(result.success).toBe(true);
  });

  it('parses git_diff', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'git_diff',
      session_id: 'sess-1',
      cell_id: 'cell-1',
      diff: '+added line\n-removed line',
    });
    expect(result.success).toBe(true);
  });

  it('parses git_diff with files_changed default', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'git_diff',
      session_id: 'sess-1',
      cell_id: 'cell-1',
      diff: 'diff content',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'git_diff') {
      expect(result.data.files_changed).toEqual([]);
    }
  });

  it('parses export_complete', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'export_complete',
      session_id: 'sess-1',
      html: '<html></html>',
    });
    expect(result.success).toBe(true);
  });

  it('parses error', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'error',
      message: 'Something went wrong',
    });
    expect(result.success).toBe(true);
  });

  it('parses error with optional cell_id', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'error',
      message: 'Cell execution failed',
      cell_id: 'cell-1',
    });
    expect(result.success).toBe(true);
  });

  it('parses slice_update', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'slice_update',
      session_id: 'sess-1',
      sections: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown message type', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'ping',
    });
    expect(result.success).toBe(false);
  });

  it('rejects cell_output missing output', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'cell_output',
      cell_id: 'cell-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects error missing message', () => {
    const result = WSServerMessageSchema.safeParse({
      type: 'error',
    });
    expect(result.success).toBe(false);
  });
});
