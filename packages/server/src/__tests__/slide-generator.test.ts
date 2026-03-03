import { describe, it, expect } from 'vitest';
import { generateSlide } from '../slide-generator.js';
import { NotebookSchema } from '@notebook-ai/shared';
import type { Notebook } from '@notebook-ai/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNotebook(overrides: Partial<Notebook> = {}): Notebook {
  return NotebookSchema.parse({
    version: 1,
    metadata: {
      title: 'Test Notebook',
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      cwd: '/home/user/project',
      git_repo: false,
    },
    cells: [],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
    ...overrides,
  });
}

// ── Empty notebook ───────────────────────────────────────────────────────────

describe('generateSlide with empty notebook', () => {
  it('returns only the title section', () => {
    const nb = makeNotebook();
    const sections = generateSlide(nb);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Test Notebook');
    expect(sections[0].order).toBe(0);
    expect(sections[0].cell_refs).toEqual([]);
  });

  it('includes created date in title section content', () => {
    const nb = makeNotebook();
    const sections = generateSlide(nb);

    expect(sections[0].content).toContain('2025-01-01T00:00:00.000Z');
  });

  it('includes working directory in title section content', () => {
    const nb = makeNotebook();
    const sections = generateSlide(nb);

    expect(sections[0].content).toContain('/home/user/project');
  });

  it('title section has a UUID id', () => {
    const nb = makeNotebook();
    const sections = generateSlide(nb);

    expect(sections[0].id).toBeDefined();
    expect(sections[0].id.length).toBeGreaterThan(0);
  });
});

// ── Prompt cells ─────────────────────────────────────────────────────────────

describe('generateSlide with prompt cells', () => {
  it('generates a section for each prompt cell', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-1',
          type: 'prompt',
          source: 'Explain TypeScript generics',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'text', content: 'TypeScript generics allow you to write reusable code.' },
          ],
        },
        {
          id: 'cell-2',
          type: 'prompt',
          source: 'Write a function to sort an array',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'text', content: 'function sort(arr) { return arr.sort(); }' },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    // title section + 2 prompt sections
    expect(sections).toHaveLength(3);
    expect(sections[1].title).toBe('Explain TypeScript generics');
    expect(sections[2].title).toBe('Write a function to sort an array');
  });

  it('includes cell_refs pointing to the cell id', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'abc-123',
          type: 'prompt',
          source: 'Do something',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].cell_refs).toEqual(['abc-123']);
  });

  it('summarises text output (short text kept as-is)', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Short output test',
          execution_count: 1,
          status: 'completed',
          outputs: [{ type: 'text', content: 'Short answer.' }],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).toBe('Short answer.');
  });

  it('truncates long text output with ellipsis', () => {
    const longText = 'A'.repeat(300);
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Long output test',
          execution_count: 1,
          status: 'completed',
          outputs: [{ type: 'text', content: longText }],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content.length).toBeLessThan(300);
    expect(sections[1].content).toMatch(/\.\.\.$/);
  });

  it('summarises tool_use output with tool name', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Use a tool',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'tool_use', name: 'read_file', input: { path: '/tmp/test' } },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).toContain('[Tool: read_file]');
  });

  it('summarises tool_use output with result', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Tool with result',
          execution_count: 1,
          status: 'completed',
          outputs: [
            {
              type: 'tool_use',
              name: 'bash',
              input: { cmd: 'ls' },
              result: 'file1.txt',
            },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).toContain('[Tool: bash]');
    expect(sections[1].content).toContain('file1.txt');
  });

  it('summarises error output', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Error test',
          execution_count: 1,
          status: 'error',
          outputs: [
            { type: 'error', message: 'Command failed with exit code 1' },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).toContain('[Error]');
    expect(sections[1].content).toContain('Command failed');
  });

  it('summarises chart output with chart type', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Chart test',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'chart', chart_type: 'bar', data: {} },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).toContain('[Chart: bar]');
  });

  it('omits thinking output from summaries', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Thinking test',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'thinking', content: 'Let me think...' },
            { type: 'text', content: 'The answer is 42.' },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).not.toContain('Let me think');
    expect(sections[1].content).toContain('The answer is 42.');
  });

  it('shows "(no output yet)" when outputs are empty', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'No output cell',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].content).toBe('(no output yet)');
  });
});

// ── Markdown cells ───────────────────────────────────────────────────────────

describe('generateSlide with markdown cells', () => {
  it('uses markdown source as content', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'md-1',
          type: 'markdown',
          source: '# Architecture Overview\n\nThis is a description.',
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections).toHaveLength(2);
    expect(sections[1].content).toBe(
      '# Architecture Overview\n\nThis is a description.',
    );
    expect(sections[1].cell_refs).toEqual(['md-1']);
  });

  it('extracts heading from markdown source as title', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'md-1',
          type: 'markdown',
          source: '## Design Decisions\n\nWe chose X because...',
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].title).toBe('Design Decisions');
  });

  it('uses first line as title when no heading is present', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'md-1',
          type: 'markdown',
          source: 'Some plain text\nMore lines here',
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].title).toBe('Some plain text');
  });

  it('skips empty markdown cells', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'md-empty',
          type: 'markdown',
          source: '   ',
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const sections = generateSlide(nb);
    // Only title section, empty markdown skipped
    expect(sections).toHaveLength(1);
  });
});

// ── Section ordering ─────────────────────────────────────────────────────────

describe('section ordering', () => {
  it('assigns sequential order values starting from 0', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'First',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
        {
          id: 'c2',
          type: 'markdown',
          source: '# Second',
          execution_count: 0,
          status: 'idle',
        },
        {
          id: 'c3',
          type: 'prompt',
          source: 'Third',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections).toHaveLength(4); // title + 3 cells
    expect(sections[0].order).toBe(0);
    expect(sections[1].order).toBe(1);
    expect(sections[2].order).toBe(2);
    expect(sections[3].order).toBe(3);
  });

  it('skips visualization cells but continues ordering', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Before viz',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
        {
          id: 'c2',
          type: 'visualization',
          source: 'chart',
          data: {},
          execution_count: 0,
          status: 'idle',
        },
        {
          id: 'c3',
          type: 'prompt',
          source: 'After viz',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
      ],
    });

    const sections = generateSlide(nb);
    // title + 2 prompt sections (visualization is skipped)
    expect(sections).toHaveLength(3);
    expect(sections[0].order).toBe(0); // title
    expect(sections[1].order).toBe(1); // first prompt
    expect(sections[2].order).toBe(2); // second prompt (after skipped viz)
  });
});

// ── Cell refs ────────────────────────────────────────────────────────────────

describe('cell_refs', () => {
  it('title section has empty cell_refs', () => {
    const nb = makeNotebook();
    const sections = generateSlide(nb);
    expect(sections[0].cell_refs).toEqual([]);
  });

  it('prompt section cell_refs contain the cell id', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'unique-id-123',
          type: 'prompt',
          source: 'test',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].cell_refs).toEqual(['unique-id-123']);
  });

  it('markdown section cell_refs contain the cell id', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'md-unique-456',
          type: 'markdown',
          source: 'Some notes',
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const sections = generateSlide(nb);
    expect(sections[1].cell_refs).toEqual(['md-unique-456']);
  });
});

// ── Multiple output summarization ────────────────────────────────────────────

describe('output summarization', () => {
  it('joins multiple output summaries with double newlines', () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'Multi-output',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'text', content: 'First output' },
            { type: 'tool_use', name: 'bash', input: { cmd: 'ls' } },
            { type: 'text', content: 'Second output' },
          ],
        },
      ],
    });

    const sections = generateSlide(nb);
    const content = sections[1].content;
    expect(content).toContain('First output');
    expect(content).toContain('[Tool: bash]');
    expect(content).toContain('Second output');
    // Check they are separated by double newlines
    const parts = content.split('\n\n');
    expect(parts).toHaveLength(3);
  });
});
