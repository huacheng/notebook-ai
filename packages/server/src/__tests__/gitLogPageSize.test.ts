/**
 * @file gitLogPageSize.test.ts
 * Regression test: Git log default page size should be 20 commits per batch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Git log page size', () => {
  it('backend REST default limit should be 20', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../routes/git.ts'),
      'utf-8'
    );
    // The default limit should be 20, not 5
    expect(src).toContain('|| 20)');
    expect(src).not.toContain('|| 5)');
  });

  it('backend WS default limit should be 20', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../ws-handler.ts'),
      'utf-8'
    );
    // The DEFAULT_GIT_LOG_LIMIT constant should be 20
    expect(src).toContain('DEFAULT_GIT_LOG_LIMIT = 20');
    expect(src).not.toContain('DEFAULT_GIT_LOG_LIMIT = 5');
  });

  it('frontend WS request should use limit 20', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../../../packages/web/src/components/GitHistoryPanel.tsx'),
      'utf-8'
    );
    // The WS request should specify limit: 20
    expect(src).toContain('limit: 20');
    expect(src).not.toMatch(/limit:\s*5[,\s}]/);
  });
});
