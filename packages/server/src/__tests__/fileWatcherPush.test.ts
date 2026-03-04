/**
 * FileViewer live update — tests that file changes on disk push to clients.
 *
 * TDD Red phase: Test that when a file is modified on the backend,
 * the server pushes file-changed-* messages to clients that have the file open.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import { setupWebSocket } from '../ws-handler.js';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import { FileWatcher } from '../watcher.js';

// Mock auth module
vi.mock('../auth.js', () => ({
  authEnabled: false,
  consumeWsTicket: vi.fn(),
}));

// Mock WebSocket
function createMockWs(readyState = 1) {
  const sent: any[] = [];
  const ws = new EventEmitter() as any;
  ws.readyState = readyState;
  ws.OPEN = 1;
  ws.CLOSING = 2;
  ws.CLOSED = 3;
  ws.send = (data: string) => {
    try {
      sent.push(JSON.parse(data));
    } catch {
      sent.push(data);
    }
  };
  ws.close = vi.fn(() => { ws.readyState = 3; });
  return { ws, sent };
}

function createMockWss() {
  return new EventEmitter() as any;
}

function createMockDb() {
  return {
    cleanupOldFileAnnotations: vi.fn(),
    getActiveSessionByName: vi.fn().mockReturnValue(null),
    getProject: vi.fn().mockReturnValue(null),
    getFileAnnotations: vi.fn().mockReturnValue(null),
    upsertFileAnnotations: vi.fn(),
    listNotebooks: vi.fn().mockReturnValue([]),
    updateNotebook: vi.fn(),
    closeSessionRecord: vi.fn(),
    createSessionRecord: vi.fn(),
    deleteFileAnnotations: vi.fn(),
  } as any;
}

let tempDir: string;
let fileWatcher: FileWatcher;
let sm: SessionManager;
let ns: NotebookStore;

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'file-watcher-push-test-'));
  fileWatcher = new FileWatcher(50); // 50ms debounce for faster tests
  sm = new SessionManager();
  ns = new NotebookStore();

  // Mock AgentProcess
  const { AgentProcess } = await import('../agent-process.js');
  vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
    onMsg({ type: 'system', subtype: 'hook_started' });
  });
  vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fileWatcher.destroy();
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('FileWatcher push updates', () => {
  it('pushes file-changed-meta when a watched file is modified', async () => {
    // Create initial file
    const testFile = path.join(tempDir, 'test.txt');
    writeFileSync(testFile, 'initial content', 'utf-8');

    // Create notebook and session
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    // Setup WebSocket server with fileWatcher
    const wss = createMockWss();
    const db = createMockDb();
    setupWebSocket(wss, db, sm, ns, undefined, fileWatcher);

    // Connect client
    const { ws, sent } = createMockWs(1);
    const req = { url: '/' };
    wss.emit('connection', ws, req);
    await new Promise(r => setTimeout(r, 20));

    // Subscribe to session
    ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 20));

    // Open file (use relative path from cwd)
    ws.emit('message', JSON.stringify({
      type: 'file-open',
      session_id: session.id,
      path: 'test.txt',
      source: 'workspace',
    }));

    // Wait for file-open-end
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for file-open-end')), 3000);
      const check = () => {
        if (sent.some(m => m.type === 'file-open-end')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Clear sent messages to focus on the update
    sent.length = 0;

    // Modify the file
    writeFileSync(testFile, 'updated content', 'utf-8');

    // Wait for file-changed-meta (debounce + pushFileUpdate)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('Sent messages:', sent);
        reject(new Error('Timeout waiting for file-changed-meta'));
      }, 2000);
      const check = () => {
        if (sent.some(m => m.type === 'file-changed-meta')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    const meta = sent.find(m => m.type === 'file-changed-meta');
    expect(meta).toBeDefined();
    expect(meta.format).toBe('text');
    // BUG: path should be the RELATIVE path that client sent, not absolute path
    // Frontend compares: changedPath !== filePath where filePath is what it sent
    expect(meta.path).toBe('test.txt'); // This will FAIL - currently sends absolute path
  }, 10000);

  it('pushes file-changed-end with updated content', async () => {
    // Create initial file
    const testFile = path.join(tempDir, 'test2.txt');
    writeFileSync(testFile, 'original', 'utf-8');

    // Create notebook and session
    const nbPath = path.join(tempDir, 'test2.notebook.json');
    await ns.save(nbPath, ns.createNew('Test2', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    // Setup WebSocket server with fileWatcher
    const wss = createMockWss();
    const db = createMockDb();
    setupWebSocket(wss, db, sm, ns, undefined, fileWatcher);

    // Connect client
    const { ws, sent } = createMockWs(1);
    const req = { url: '/' };
    wss.emit('connection', ws, req);
    await new Promise(r => setTimeout(r, 20));

    // Subscribe to session
    ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 20));

    // Open file
    ws.emit('message', JSON.stringify({
      type: 'file-open',
      session_id: session.id,
      path: 'test2.txt',
      source: 'workspace',
    }));

    // Wait for file-open-end
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for file-open-end')), 3000);
      const check = () => {
        if (sent.some(m => m.type === 'file-open-end')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Clear sent messages
    sent.length = 0;

    // Modify the file
    writeFileSync(testFile, 'modified content', 'utf-8');

    // Wait for file-changed-end
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('Sent messages:', sent);
        reject(new Error('Timeout waiting for file-changed-end'));
      }, 2000);
      const check = () => {
        if (sent.some(m => m.type === 'file-changed-end')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Verify we got the sequence
    const meta = sent.find(m => m.type === 'file-changed-meta');
    const chunk = sent.find(m => m.type === 'file-changed-chunk' || m.type === 'file-changed-chunk-compressed');
    const end = sent.find(m => m.type === 'file-changed-end');

    expect(meta).toBeDefined();
    expect(chunk).toBeDefined();
    expect(end).toBeDefined();

    // Verify the content in the chunk
    if (chunk?.type === 'file-changed-chunk') {
      expect(chunk.data).toBe('modified content');
    }
  }, 10000);

  it('pushes file-deleted when a watched file is removed', async () => {
    // Create initial file
    const testFile = path.join(tempDir, 'to-delete.txt');
    writeFileSync(testFile, 'will be deleted', 'utf-8');

    // Create notebook and session
    const nbPath = path.join(tempDir, 'test3.notebook.json');
    await ns.save(nbPath, ns.createNew('Test3', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    // Setup WebSocket server with fileWatcher
    const wss = createMockWss();
    const db = createMockDb();
    setupWebSocket(wss, db, sm, ns, undefined, fileWatcher);

    // Connect client
    const { ws, sent } = createMockWs(1);
    const req = { url: '/' };
    wss.emit('connection', ws, req);
    await new Promise(r => setTimeout(r, 20));

    // Subscribe to session
    ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 20));

    // Open file
    ws.emit('message', JSON.stringify({
      type: 'file-open',
      session_id: session.id,
      path: 'to-delete.txt',
      source: 'workspace',
    }));

    // Wait for file-open-end
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for file-open-end')), 3000);
      const check = () => {
        if (sent.some(m => m.type === 'file-open-end')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Clear sent messages
    sent.length = 0;

    // Delete the file
    rmSync(testFile);

    // Wait for file-deleted
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('Sent messages:', sent);
        reject(new Error('Timeout waiting for file-deleted'));
      }, 2000);
      const check = () => {
        if (sent.some(m => m.type === 'file-deleted')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    const deleted = sent.find(m => m.type === 'file-deleted');
    expect(deleted).toBeDefined();
  }, 10000);
});
