import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * D2-1: Verify notebooks.ts does NOT use exec() (shell mode).
 * All child_process usage must be execFile() or spawn() (no shell).
 */
describe('D2-1: no shell-based exec() in notebooks route', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../routes/notebooks.ts'),
    'utf-8',
  );

  it('should not import exec from child_process', () => {
    // Should not have: import { exec } or import { exec, ... }
    // Should allow: import { execFile } or import { spawn }
    const hasExecImport = /import\s*\{[^}]*\bexec\b[^F][^}]*\}\s*from\s*['"]child_process['"]/.test(src);
    expect(hasExecImport).toBe(false);
  });

  it('should not use promisify(exec)', () => {
    expect(src).not.toMatch(/promisify\(\s*exec\s*\)/);
  });

  it('should not use template-literal shell commands', () => {
    // No backtick-interpolated command strings passed to execAsync/exec
    const shellPatterns = /execAsync\s*\(\s*`/g;
    expect(src.match(shellPatterns)).toBeNull();
  });
});
