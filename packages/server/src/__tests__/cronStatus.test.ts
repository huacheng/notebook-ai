import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * /api/system/preflight — unified system health check.
 * Returns an array of alerts for things needing user attention:
 * - task-ai plugin not installed
 * - cron job not configured
 * Each alert has: { id, severity, message, action }
 */

describe('System preflight API — routes', () => {
  const ROUTES_SRC = readFileSync(
    path.resolve(__dirname, '../routes/system.ts'),
    'utf-8',
  );

  it('should export createSystemRouter', () => {
    expect(ROUTES_SRC).toContain('export function createSystemRouter');
  });

  it('should register GET /preflight route', () => {
    expect(ROUTES_SRC).toContain("'/preflight'");
  });

  it('should register POST /install-cron route', () => {
    expect(ROUTES_SRC).toContain("'/install-cron'");
  });

  it('should check crontab for task-ai:scheduled tag', () => {
    expect(ROUTES_SRC).toContain('task-ai:scheduled');
  });

  it('should check for task-ai plugin installation', () => {
    expect(ROUTES_SRC).toContain('task-ai');
    expect(ROUTES_SRC).toContain('installed_plugins');
  });
});

describe('System routes mounted in index', () => {
  const INDEX_SRC = readFileSync(
    path.resolve(__dirname, '../index.ts'),
    'utf-8',
  );

  it('should mount /api/system routes', () => {
    expect(INDEX_SRC).toContain("'/api/system'");
    expect(INDEX_SRC).toContain('createSystemRouter');
  });
});
