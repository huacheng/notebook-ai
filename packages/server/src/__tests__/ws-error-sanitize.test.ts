import { describe, it, expect } from 'vitest';

/**
 * D2-4: Error message sanitization
 *
 * sanitizeErrorForClient() should strip internal details
 * (file paths, stack traces, SQL errors) and return
 * a generic user-facing message.
 */

import { sanitizeErrorForClient } from '../ws-handler.js';

describe('sanitizeErrorForClient (D2-4)', () => {
  it('should return a generic message for Error objects', () => {
    const err = new Error('SQLITE_ERROR: no such table: sessions at /home/ubuntu/notebook-ai/packages/server/src/db.ts:42');
    const result = sanitizeErrorForClient(err);
    expect(result).not.toContain('/home/ubuntu');
    expect(result).not.toContain('SQLITE_ERROR');
    expect(result).not.toContain('db.ts');
    expect(result).toBe('An internal error occurred.');
  });

  it('should return a generic message for string errors with paths', () => {
    const err = 'Error: ENOENT: no such file /home/user/secret/file.txt';
    const result = sanitizeErrorForClient(err);
    expect(result).not.toContain('/home/user');
    expect(result).toBe('An internal error occurred.');
  });

  it('should pass through simple user-facing messages', () => {
    const err = new Error('Session "abc" not found');
    const result = sanitizeErrorForClient(err);
    expect(result).toBe('Session "abc" not found');
  });

  it('should pass through "not found" messages', () => {
    const err = new Error('Notebook not found.');
    const result = sanitizeErrorForClient(err);
    expect(result).toBe('Notebook not found.');
  });

  it('should pass through workspace path messages', () => {
    const err = new Error('Save path is outside the workspace.');
    const result = sanitizeErrorForClient(err);
    expect(result).toBe('Save path is outside the workspace.');
  });

  it('should strip stack traces from error strings', () => {
    const err = 'Error: something\n    at Object.<anonymous> (/home/ubuntu/notebook-ai/src/foo.ts:10:5)';
    const result = sanitizeErrorForClient(err);
    expect(result).not.toContain('at Object');
    expect(result).not.toContain('/home/ubuntu');
  });

  it('should handle non-string, non-Error inputs', () => {
    expect(sanitizeErrorForClient(null)).toBe('An internal error occurred.');
    expect(sanitizeErrorForClient(undefined)).toBe('An internal error occurred.');
    expect(sanitizeErrorForClient(42)).toBe('An internal error occurred.');
  });

  it('should strip ENOENT/EACCES error details', () => {
    const err = new Error("EACCES: permission denied, open '/etc/shadow'");
    const result = sanitizeErrorForClient(err);
    expect(result).not.toContain('/etc/shadow');
    expect(result).not.toContain('EACCES');
  });
});
