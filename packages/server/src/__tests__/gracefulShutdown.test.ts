import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * D3-1: Server must handle SIGTERM/SIGINT for graceful shutdown.
 */
describe('D3-1: graceful shutdown handler', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../index.ts'),
    'utf-8',
  );

  it('should register SIGTERM handler', () => {
    expect(src).toMatch(/process\.on\(\s*['"]SIGTERM['"]/);
  });

  it('should register SIGINT handler', () => {
    expect(src).toMatch(/process\.on\(\s*['"]SIGINT['"]/);
  });

  it('should close the HTTP server in shutdown', () => {
    expect(src).toMatch(/server\.close/);
  });

  it('should close the database in shutdown', () => {
    expect(src).toMatch(/db\.close/);
  });
});
