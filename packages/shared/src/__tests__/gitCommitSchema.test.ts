import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../types.ts'),
  'utf-8',
);

describe('Git commit hash schema format (P1-6)', () => {
  it('GitCommitFilesRequestSchema.commit should have regex constraint', () => {
    const start = src.indexOf('GitCommitFilesRequestSchema = z.object');
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/commit: z\.string\(\)\.regex\(/);
  });

  it('GitDiffRequestSchema.commit should have regex constraint', () => {
    const start = src.indexOf('GitDiffRequestSchema = z.object');
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/commit: z\.string\(\)\.regex\(/);
  });
});
