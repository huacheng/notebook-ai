import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotebookStore } from '../notebook-store.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

describe('NotebookStore.list performance - D4', () => {
  const tmpDir = path.join(os.tmpdir(), `nb-list-perf-test-${Date.now()}`);

  beforeAll(async () => {
    // Setup: create 20 notebook files (reasonable for performance test)
    await mkdir(tmpDir, { recursive: true });

    for (let i = 0; i < 20; i++) {
      const nb = {
        version: 1,
        metadata: {
          title: `Test Notebook ${i}`,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          cwd: '/',
          git_repo: false,
          agent: 'claude',
        },
        cells: Array(10).fill(null).map((_, j) => ({
          id: `cell-${i}-${j}`,
          type: 'prompt',
          source: 'x'.repeat(500), // Some content
          outputs: [],
          execution_count: 0,
          status: 'idle',
        })),
        slide: { generated: false, sections: [] },
        annotations: [],
        assets: { intermediate_files: [] },
      };
      await writeFile(
        path.join(tmpDir, `notebook-${i}.notebook.json`),
        JSON.stringify(nb),
      );
    }
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should list 20 notebooks efficiently', async () => {
    const store = new NotebookStore();
    const start = Date.now();
    const results = await store.list(tmpDir);
    const elapsed = Date.now() - start;

    expect(results.length).toBe(20);
    // Should complete in under 1 second (generous for CI)
    expect(elapsed).toBeLessThan(1000);
  });

  it('should extract title from each notebook', async () => {
    const store = new NotebookStore();
    const results = await store.list(tmpDir);

    // All results should have titles
    for (const result of results) {
      expect(result.title).toMatch(/^Test Notebook \d+$/);
    }
  });
});
