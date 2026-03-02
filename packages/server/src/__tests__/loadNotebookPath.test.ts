import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const wsHandlerSrc = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

describe('load_notebook path validation (P0-1)', () => {
  it('should validate path before loading notebook', () => {
    // Extract the load_notebook case block
    const caseStart = wsHandlerSrc.indexOf("case 'load_notebook'");
    const nextCase = wsHandlerSrc.indexOf('case ', caseStart + 1);
    const block = wsHandlerSrc.slice(caseStart, nextCase);

    // Must call validateWorkspacePath before notebookStore.load
    expect(block).toMatch(/validateWorkspacePath/);

    // The path validation must happen BEFORE notebookStore.load
    const validateIdx = block.indexOf('validateWorkspacePath');
    const loadIdx = block.indexOf('notebookStore.load');
    expect(validateIdx).toBeLessThan(loadIdx);
  });

  it('should use session cwd as base for path validation', () => {
    const caseStart = wsHandlerSrc.indexOf("case 'load_notebook'");
    const nextCase = wsHandlerSrc.indexOf('case ', caseStart + 1);
    const block = wsHandlerSrc.slice(caseStart, nextCase);

    // Must reference session.cwd in the validation call
    expect(block).toMatch(/validateWorkspacePath\(.*session\.cwd/s);
  });
});
