import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../routes/notebooks.ts'),
  'utf-8',
);

describe('GET /api/notebooks?dir= path validation (P0-1)', () => {
  // Extract the GET / handler block
  const handlerStart = src.indexOf("router.get('/'");
  const handlerEnd = src.indexOf('router.', handlerStart + 1);
  const block = src.slice(handlerStart, handlerEnd);

  it('should validate dir against workspace root before listing', () => {
    expect(block).toContain('validateWorkspacePath');
  });

  it('should call validateWorkspacePath BEFORE notebookStore.list', () => {
    const validateIdx = block.indexOf('validateWorkspacePath');
    const listIdx = block.indexOf('notebookStore.list');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(listIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(listIdx);
  });
});

describe('POST /api/notebooks path validation (P0-2)', () => {
  // Extract the POST / handler block (not open-by-path)
  const postStart = src.indexOf("router.post('/'");
  const postEnd = src.indexOf('router.', postStart + 1);
  const block = src.slice(postStart, postEnd);

  it('should validate paths against workspace root before saving', () => {
    expect(block).toContain('validateWorkspacePath');
  });

  it('should call validateWorkspacePath BEFORE notebookStore.save', () => {
    const validateIdx = block.indexOf('validateWorkspacePath');
    const saveIdx = block.indexOf('notebookStore.save');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(saveIdx);
  });
});
