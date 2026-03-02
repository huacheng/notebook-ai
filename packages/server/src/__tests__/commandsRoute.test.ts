// packages/server/src/__tests__/commandsRoute.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('/api/commands route', () => {
  it('commands.ts should export router with GET handler', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../routes/commands.ts'),
      'utf-8',
    );
    expect(src).toMatch(/router\.get\(['"]\/['"]/);
    expect(src).toMatch(/task-ai:target/);
    expect(src).toMatch(/task-ai:research/);
    expect(src).toMatch(/task-ai:read/);
    expect(src).toMatch(/task-ai:library/);
  });

  it('index.ts should register /api/commands route', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8',
    );
    expect(src).toMatch(/\/api\/commands/);
  });
});
