import { describe, it, expect } from 'vitest';
import { exportToHtml } from '../export.js';
import { NotebookSchema } from '@notebook-ai/shared';
import type { Notebook } from '@notebook-ai/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNotebook(overrides: Partial<Notebook> = {}): Notebook {
  return NotebookSchema.parse({
    version: 1,
    metadata: {
      title: 'Export Test Notebook',
      created: '2025-01-15T10:30:00.000Z',
      updated: '2025-01-15T11:00:00.000Z',
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

// ── Basic HTML structure ─────────────────────────────────────────────────────

describe('exportToHtml basic structure', () => {
  it('returns valid HTML with doctype', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('contains notebook title in <title> tag', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('<title>Export Test Notebook</title>');
  });

  it('contains notebook title in toolbar', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('Export Test Notebook');
    expect(html).toContain('toolbar-title');
  });

  it('is self-contained with <style> tag', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    // Verify actual CSS is present
    expect(html).toContain('box-sizing');
    expect(html).toContain('font-family');
  });

  it('is self-contained with <script> tag', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('<script>');
    expect(html).toContain('</script>');
    // Verify actual JS is present
    expect(html).toContain('Tab switching');
  });

  it('contains created and updated timestamps', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('2025-01-15T10:30:00.000Z');
    expect(html).toContain('2025-01-15T11:00:00.000Z');
  });
});

// ── Cell content ─────────────────────────────────────────────────────────────

describe('exportToHtml with cells', () => {
  it('renders prompt cell source', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-1',
          type: 'prompt',
          source: 'Explain how promises work',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'text', content: 'Promises represent async operations.' },
          ],
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('Explain how promises work');
    expect(html).toContain('Promises represent async operations.');
    expect(html).toContain('cell-prompt');
    expect(html).toContain('data-cell-id="cell-1"');
  });

  it('renders markdown cell source', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'md-1',
          type: 'markdown',
          source: '# Architecture Notes\n\nSome important info.',
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('# Architecture Notes');
    expect(html).toContain('Some important info.');
    expect(html).toContain('cell-markdown');
  });

  it('renders visualization cell', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'viz-1',
          type: 'visualization',
          source: 'chart code here',
          data: { series: [1, 2, 3] },
          execution_count: 0,
          status: 'idle',
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('chart code here');
    expect(html).toContain('cell-visualization');
  });

  it('renders tool_use output', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-t',
          type: 'prompt',
          source: 'Use a tool',
          execution_count: 1,
          status: 'completed',
          outputs: [
            {
              type: 'tool_use',
              name: 'read_file',
              input: { path: '/tmp/test.txt' },
              result: 'file contents here',
            },
          ],
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('read_file');
    expect(html).toContain('output-tool-use');
    expect(html).toContain('file contents here');
  });

  it('renders error output', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-e',
          type: 'prompt',
          source: 'Fail',
          execution_count: 1,
          status: 'error',
          outputs: [
            { type: 'error', message: 'Command failed with exit code 127' },
          ],
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('output-error');
    expect(html).toContain('Command failed with exit code 127');
  });

  it('renders thinking output', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-th',
          type: 'prompt',
          source: 'Think about it',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'thinking', content: 'Let me consider the options...' },
          ],
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('output-thinking');
    expect(html).toContain('Let me consider the options...');
  });

  it('renders chart output', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-ch',
          type: 'prompt',
          source: 'Make a chart',
          execution_count: 1,
          status: 'completed',
          outputs: [
            { type: 'chart', chart_type: 'bar', data: { x: [1, 2] } },
          ],
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('bar');
    expect(html).toContain('chart');
  });

  it('renders git diff when present', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-gd',
          type: 'prompt',
          source: 'Fix the bug',
          execution_count: 1,
          status: 'completed',
          outputs: [{ type: 'text', content: 'Fixed!' }],
          git_diff: '+added line\n-removed line',
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('cell-git-diff');
    expect(html).toContain('diff-added');
    expect(html).toContain('diff-removed');
  });

  it('escapes HTML entities in cell content', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'cell-esc',
          type: 'prompt',
          source: 'Show <script>alert("xss")</script>',
          execution_count: 0,
          status: 'idle',
          outputs: [],
        },
      ],
    });

    const html = await exportToHtml(nb);

    // The cell source in the rendered HTML should have escaped entities
    expect(html).toContain('&lt;script&gt;alert');
    // The cell-source pre block should contain escaped content
    expect(html).toContain('Show &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
});

// ── Slide options ────────────────────────────────────────────────────────────

describe('exportToHtml include_slide option', () => {
  it('includes slide view by default', async () => {
    const nb = makeNotebook({
      slide: {
        generated: true,
        sections: [
          {
            id: 'sec-1',
            title: 'Introduction',
            content: 'This is the intro.',
            cell_refs: [],
            order: 0,
          },
        ],
      },
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('slide-view');
    expect(html).toContain('Introduction');
    expect(html).toContain('This is the intro.');
    expect(html).toContain('Slide');
  });

  it('shows "No slide sections" when generated is false', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('No slide sections generated yet');
  });

  it('excludes slide view element when include_slide is false', async () => {
    const nb = makeNotebook({
      slide: {
        generated: true,
        sections: [
          {
            id: 'sec-1',
            title: 'Hidden Section',
            content: 'Should not appear',
            cell_refs: [],
            order: 0,
          },
        ],
      },
    });

    const html = await exportToHtml(nb, { include_slide: false });

    // The slide-view div element should not be present
    expect(html).not.toContain('id="slide-view"');
    // Slide tab button should not be present
    expect(html).not.toContain('data-target="slide"');
    // The rendered slice section content should not appear in the HTML structure
    expect(html).not.toMatch(/<div class="slide-sections">/);
  });
});

// ── Replay options ───────────────────────────────────────────────────────────

describe('exportToHtml include_replay option', () => {
  it('includes replay panel by default', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('replay-panel');
    expect(html).toContain('replay-btn');
    expect(html).toContain('Replay engine');
  });

  it('excludes replay panel when include_replay is false', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb, { include_replay: false });

    // The replay panel HTML element should not be present
    expect(html).not.toContain('id="replay-panel"');
    expect(html).not.toContain('id="replay-btn"');
    // The replay engine JS should not be included
    expect(html).not.toContain('Replay engine');
  });
});

// ── Annotations ──────────────────────────────────────────────────────────────

describe('exportToHtml include_annotations option', () => {
  const nbWithAnnotations = () =>
    makeNotebook({
      cells: [
        {
          id: 'cell-ann',
          type: 'prompt',
          source: 'Do something',
          execution_count: 1,
          status: 'completed',
          outputs: [{ type: 'text', content: 'Done.' }],
        },
      ],
      annotations: [
        {
          id: 'ann-1',
          type: 'comment',
          target_cell: 'cell-ann',
          output_indices: [0],
          selected_text: 'Done.',
          comment: 'Great work!',
          author: 'user',
          timestamp: '2025-01-15T12:00:00.000Z',
        },
      ],
    });

  it('includes annotations by default', async () => {
    const nb = nbWithAnnotations();
    const html = await exportToHtml(nb);

    expect(html).toContain('cell-annotations');
    expect(html).toContain('Great work!');
  });

  it('excludes annotations when include_annotations is false', async () => {
    const nb = nbWithAnnotations();
    const html = await exportToHtml(nb, { include_annotations: false });

    // The rendered annotation HTML elements should not be present in cell markup.
    // Note: The CSS and embedded JSON may still reference annotation class names,
    // so we check for the specific annotation content not appearing in the rendered cells.
    expect(html).not.toMatch(/<div class="cell-annotations">/);
    expect(html).not.toMatch(/<p class="annotation-body">Great work!<\/p>/);
  });
});

// ── Self-contained check ─────────────────────────────────────────────────────

describe('exportToHtml self-contained output', () => {
  it('does not contain external stylesheet links', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
  });

  it('does not contain external script sources', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    // The only <script> tags should be inline (no src attribute)
    const scriptTags = html.match(/<script[^>]*>/g) || [];
    for (const tag of scriptTags) {
      if (tag.includes('type="application/json"')) continue; // data script is fine
      expect(tag).not.toContain('src=');
    }
  });

  it('embeds notebook data as JSON for replay', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('id="notebook-data"');
    expect(html).toContain('type="application/json"');
    // The JSON should contain the notebook title
    expect(html).toContain('"Export Test Notebook"');
  });
});

// ── Multiple cells ───────────────────────────────────────────────────────────

describe('exportToHtml with multiple cells', () => {
  it('renders all cells in order', async () => {
    const nb = makeNotebook({
      cells: [
        {
          id: 'c1',
          type: 'prompt',
          source: 'First prompt',
          execution_count: 1,
          status: 'completed',
          outputs: [{ type: 'text', content: 'First output' }],
        },
        {
          id: 'c2',
          type: 'markdown',
          source: '# Middle note',
          execution_count: 0,
          status: 'idle',
        },
        {
          id: 'c3',
          type: 'prompt',
          source: 'Second prompt',
          execution_count: 1,
          status: 'completed',
          outputs: [{ type: 'text', content: 'Second output' }],
        },
      ],
    });

    const html = await exportToHtml(nb);

    expect(html).toContain('First prompt');
    expect(html).toContain('First output');
    expect(html).toContain('# Middle note');
    expect(html).toContain('Second prompt');
    expect(html).toContain('Second output');

    // Verify ordering: c1 appears before c2 which appears before c3
    const c1Pos = html.indexOf('data-cell-id="c1"');
    const c2Pos = html.indexOf('data-cell-id="c2"');
    const c3Pos = html.indexOf('data-cell-id="c3"');
    expect(c1Pos).toBeLessThan(c2Pos);
    expect(c2Pos).toBeLessThan(c3Pos);
  });
});

// ── Empty notebook ───────────────────────────────────────────────────────────

describe('exportToHtml with empty notebook', () => {
  it('shows "No cells" message', async () => {
    const nb = makeNotebook();
    const html = await exportToHtml(nb);

    expect(html).toContain('No cells');
  });
});
