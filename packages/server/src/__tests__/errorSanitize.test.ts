import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * D2-4/5/6/7: Verify route handlers never leak raw error details to clients.
 * No `String(err)` or `err.message` in JSON responses (except pre-validated safe messages).
 */
describe('D2-4/5/6/7: no error detail leakage in route handlers', () => {
  const routeFiles = [
    'routes/library.ts',
    'routes/sessions.ts',
    'routes/plugin.ts',
    'routes/projects.ts',
  ];

  for (const file of routeFiles) {
    describe(file, () => {
      const src = readFileSync(path.resolve(__dirname, '..', file), 'utf-8');

      it('should not use String(err) in JSON responses', () => {
        // Match: error: String(err)  or  { error: String(err) }
        const hasStringErr = /\.json\([^)]*String\(err\)/.test(src);
        expect(hasStringErr).toBe(false);
      });

      it('should not use err.message in 500 JSON responses', () => {
        // Match: res.status(500)...err.message  or  error: err instanceof Error ? err.message
        // This pattern leaks internal details. Only generic messages should be used for 500s.
        const has500ErrMessage = /status\(500\)[^;]*err\.message/.test(src) ||
          /status\(500\)[^;]*err\s+instanceof\s+Error\s*\?\s*err\.message/.test(src);
        expect(has500ErrMessage).toBe(false);
      });
    });
  }
});
