import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../db.ts'),
  'utf-8',
);

/**
 * P1-9: deleteProject and deleteNotebook perform multiple DELETEs and must
 * be wrapped in a database transaction to avoid partial deletes on error.
 */
describe('Cascading deletes use transactions (P1-9)', () => {
  it('deleteNotebook should use db.transaction', () => {
    const start = src.indexOf('deleteNotebook(');
    const end = src.indexOf('\n  }', start);
    const block = src.slice(start, end);
    expect(block).toContain('transaction');
  });

  it('deleteProject should use db.transaction', () => {
    const start = src.indexOf('deleteProject(');
    const end = src.indexOf('\n  }', start);
    const block = src.slice(start, end);
    expect(block).toContain('transaction');
  });
});
