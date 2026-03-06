/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that the cell start time (started_at) is stored on the cell
 * when status changes to 'running', so the RunningStatus timer survives
 * component unmount/remount (tab switches).
 *
 * Bug: RunningStatus used useRef(Date.now()) which resets on remount.
 */

import { setCellStatusInNotebook } from '../store/notebookMutations';

function makeNotebook(cells: any[]) {
  return {
    cells,
    metadata: { title: 'test', created: '', git_repo: false, agent: 'claude' as const },
    version: 1,
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

function makeCell(id: string, status: string) {
  return {
    id,
    type: 'prompt' as const,
    source: 'hello',
    outputs: [],
    status,
    execution_count: 1,
  };
}

describe('Cell started_at timestamp', () => {
  it('sets started_at when cell status changes to running', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const nb = makeNotebook([makeCell('c1', 'pending')]);
    const updated = setCellStatusInNotebook(nb, 'c1', 'running');

    const cell = updated.cells.find((c: any) => c.id === 'c1') as any;
    expect(cell.status).toBe('running');
    expect(cell.started_at).toBe(now);

    vi.useRealTimers();
  });

  it('preserves started_at when status changes from running to something else', () => {
    const startTime = 1000000;
    const nb = makeNotebook([{ ...makeCell('c1', 'running'), started_at: startTime }]);

    vi.setSystemTime(startTime + 5000);
    const updated = setCellStatusInNotebook(nb, 'c1', 'completed');

    const cell = updated.cells.find((c: any) => c.id === 'c1') as any;
    expect(cell.status).toBe('completed');
    // started_at should be preserved (not overwritten or deleted)
    expect(cell.started_at).toBe(startTime);

    vi.useRealTimers();
  });

  it('does not set started_at for non-running statuses', () => {
    const nb = makeNotebook([makeCell('c1', 'pending')]);
    const updated = setCellStatusInNotebook(nb, 'c1', 'completed');

    const cell = updated.cells.find((c: any) => c.id === 'c1') as any;
    expect(cell.started_at).toBeUndefined();
  });

  it('overwrites started_at on re-run (running again)', () => {
    const oldStart = 1000000;
    const newStart = 2000000;
    const nb = makeNotebook([{ ...makeCell('c1', 'completed'), started_at: oldStart }]);

    vi.setSystemTime(newStart);
    const updated = setCellStatusInNotebook(nb, 'c1', 'running');

    const cell = updated.cells.find((c: any) => c.id === 'c1') as any;
    expect(cell.started_at).toBe(newStart);

    vi.useRealTimers();
  });
});
