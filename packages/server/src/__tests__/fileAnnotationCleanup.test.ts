import { describe, it, expect, beforeEach } from 'vitest';
import { NotebookDb } from '../db.js';

describe('file annotation cleanup on file delete', () => {
  let db: NotebookDb;

  beforeEach(() => {
    db = new NotebookDb(':memory:');
  });

  it('should have deleteFileAnnotations method in Database', () => {
    expect(typeof db.deleteFileAnnotations).toBe('function');
  });

  it('should delete annotations for specific session+file', () => {
    // Setup: create annotations for two files
    db.upsertFileAnnotations('session1', 'file-a.ts', '{"items":[]}', Date.now());
    db.upsertFileAnnotations('session1', 'file-b.ts', '{"items":[]}', Date.now());

    // Act: delete annotations for file-a only
    db.deleteFileAnnotations('session1', 'file-a.ts');

    // Assert: file-a annotations gone, file-b annotations remain
    expect(db.getFileAnnotations('session1', 'file-a.ts')).toBeNull();
    expect(db.getFileAnnotations('session1', 'file-b.ts')).not.toBeNull();
  });

  it('should not affect annotations from other sessions', () => {
    // Setup: same file path in different sessions
    db.upsertFileAnnotations('session1', 'shared.ts', '{"items":["s1"]}', Date.now());
    db.upsertFileAnnotations('session2', 'shared.ts', '{"items":["s2"]}', Date.now());

    // Act: delete from session1 only
    db.deleteFileAnnotations('session1', 'shared.ts');

    // Assert: session2's annotations remain
    expect(db.getFileAnnotations('session1', 'shared.ts')).toBeNull();
    expect(db.getFileAnnotations('session2', 'shared.ts')).not.toBeNull();
  });
});
