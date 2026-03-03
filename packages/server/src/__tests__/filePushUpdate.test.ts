import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * FileViewer live update push — when a file is modified on the backend,
 * the server should push the updated content to all clients that have
 * that file open. Clients receive:
 * - file-changed-meta: mtime + format
 * - file-changed-chunk or file-changed-chunk-compressed: file content
 * - file-changed-end: completion marker
 * - file-deleted: when file is removed
 */
describe('file-open live update push', () => {
  it('should track clients that have files open via fileOpenSubscriptions', () => {
    expect(src).toContain('fileOpenSubscriptions');
    expect(src).toContain('new Map<string, Map<string, FileOpenClient>>()');
  });

  it('should have pushFileUpdate function that sends file-changed-meta', () => {
    expect(src).toContain('async function pushFileUpdate(filePath: string)');
    expect(src).toContain("type: 'file-changed-meta'");
  });

  it('should send file-changed-chunk or file-changed-chunk-compressed for content', () => {
    expect(src).toContain("type: 'file-changed-chunk'");
    expect(src).toContain("type: 'file-changed-chunk-compressed'");
  });

  it('should send file-changed-end when push is complete', () => {
    expect(src).toContain("type: 'file-changed-end'");
  });

  it('should send file-deleted when file is removed', () => {
    expect(src).toContain("type: 'file-deleted'");
  });

  it('should register file watcher subscription after file-open succeeds', () => {
    const fileOpenCase = src.indexOf("case 'file-open'");
    const nextCase = src.indexOf("\n        case '", fileOpenCase + 1);
    const block = src.slice(fileOpenCase, nextCase > 0 ? nextCase : fileOpenCase + 5000);

    // Should subscribe to file watcher
    expect(block).toContain('fileWatcher.subscribe');
    // Should register client in fileOpenSubscriptions
    expect(block).toContain('fileOpenSubscriptions');
    expect(block).toContain('clients.set(clientId');
  });

  it('should clean up file subscriptions when client disconnects', () => {
    // Look for cleanup logic
    expect(src).toContain('fileOpenSubscriptions.delete(filePath)');
    expect(src).toContain('fileWatcherUnsubscribers');
  });

  it('should use LZ4 compression for large files (>100KB)', () => {
    // pushFileUpdate uses lz4.compress when file size >= COMPRESS_THRESHOLD
    expect(src).toContain('COMPRESS_THRESHOLD = 100 * 1024');
    // Check that lz4.compress is imported and used
    expect(src).toContain("import * as lz4 from 'lz4js'");
    expect(src).toContain('lz4.compress');
  });

  it('should skip push for files larger than 50MB', () => {
    // D6: MAX_WS_FILE_SIZE is now exported at module level
    expect(src).toContain('export const MAX_WS_FILE_SIZE = 50 * 1024 * 1024');
    // pushFileUpdate should use the exported constant
    const pushFn = src.indexOf('async function pushFileUpdate');
    const pushEnd = src.indexOf('\n  async function', pushFn + 1);
    const block = src.slice(pushFn, pushEnd > 0 ? pushEnd : pushFn + 2000);
    expect(block).toContain('MAX_WS_FILE_SIZE');
  });
});
