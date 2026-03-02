import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * D2-8: watch_subscribe must validate dir_path against project root.
 * D2-9: by-path delete must validate relPath.
 */
describe('D2-8/D2-9: path traversal prevention', () => {
  describe('ws-handler watch_subscribe', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../ws-handler.ts'),
      'utf-8',
    );

    it('should validate dir_path before constructing watchPath', () => {
      // Must use validateWorkspacePath or path.resolve + startsWith check
      // near the watch_subscribe case
      const watchSection = src.slice(
        src.indexOf("case 'watch_subscribe'"),
        src.indexOf("case 'watch_unsubscribe'"),
      );
      const hasValidation =
        watchSection.includes('validateWorkspacePath') ||
        watchSection.includes('startsWith');
      expect(hasValidation).toBe(true);
    });
  });

  describe('projects by-path delete', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../routes/projects.ts'),
      'utf-8',
    );

    it('should validate relPath in by-path delete endpoint', () => {
      // Find the by-path delete section
      const byPathSection = src.slice(
        src.indexOf('notebooks/by-path'),
        src.indexOf('notebooks/by-path') + 800,
      );
      const hasValidation =
        byPathSection.includes('validateWorkspacePath') ||
        byPathSection.includes('startsWith') ||
        byPathSection.includes('Path outside');
      expect(hasValidation).toBe(true);
    });
  });
});
