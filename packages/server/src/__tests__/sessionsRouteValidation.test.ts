import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../routes/sessions.ts'),
  'utf-8',
);

describe('POST /api/sessions path validation (P0-3)', () => {
  const handlerStart = src.indexOf("router.post('/'");
  const handlerEnd = src.indexOf('router.', handlerStart + 1);
  const block = src.slice(handlerStart, handlerEnd);

  it('should validate paths against workspace root before creating session', () => {
    expect(block).toContain('validateWorkspacePath');
  });

  it('should call validateWorkspacePath BEFORE sessionManager.createSession', () => {
    const validateIdx = block.indexOf('validateWorkspacePath');
    const createIdx = block.indexOf('sessionManager.createSession');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(createIdx);
  });
});
