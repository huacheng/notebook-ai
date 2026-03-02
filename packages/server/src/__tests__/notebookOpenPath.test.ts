import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const notebooksSrc = readFileSync(
  path.resolve(__dirname, '../routes/notebooks.ts'),
  'utf-8',
);

describe('notebook_open path validation (P0-2)', () => {
  it('openNotebookByPath should use validateWorkspacePath for symlink-safe check', () => {
    // Extract the openNotebookByPath function body
    const fnStart = notebooksSrc.indexOf('async function openNotebookByPath');
    expect(fnStart).toBeGreaterThan(-1);

    const fnBody = notebooksSrc.slice(fnStart, fnStart + 800);

    // Must use validateWorkspacePath (realpath-based, not just path.resolve + startsWith)
    expect(fnBody).toContain('validateWorkspacePath');
  });

  it('should validate path BEFORE loading notebook', () => {
    const fnStart = notebooksSrc.indexOf('async function openNotebookByPath');
    const fnBody = notebooksSrc.slice(fnStart, fnStart + 800);

    const validateIdx = fnBody.indexOf('validateWorkspacePath');
    const loadIdx = fnBody.indexOf('notebookStore.load');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(loadIdx);
  });
});
