/**
 * WS reconnect race condition test.
 *
 * Bug: When a WebSocket disconnects and reconnects before the server
 * processes the old connection's close event, the server sees the old
 * owner and sends `session_already_open`, which nukes the client's
 * notebook state (sets notebook: null).
 *
 * Fix: Check old owner's readyState before rejecting — if not OPEN,
 * allow the new connection to take over.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { setupWebSocket } from '../ws-handler.js';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock WebSocket with controllable readyState
function createMockWs(readyState = 1 /* OPEN */) {
  const sent: any[] = [];
  const ws = new EventEmitter() as any;
  ws.readyState = readyState;
  ws.OPEN = 1;
  ws.send = (data: string) => sent.push(JSON.parse(data));
  ws.close = () => { ws.readyState = 3; };
  return { ws, sent };
}

// Mock WebSocketServer
function createMockWss() {
  const wss = new EventEmitter() as any;
  return wss;
}

// Mock DB with minimal interface needed by ws-handler
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
  } as any;
}

describe('WS subscribe race condition on reconnect', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-race-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows new WS to take over when old owner is no longer OPEN', async () => {
    // Setup
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    const wss = createMockWss();
    const db = createMockDb();
    setupWebSocket(wss, db, sm, ns);

    // WS1 connects and subscribes
    const { ws: ws1, sent: sent1 } = createMockWs(1);
    const req1 = { url: '/' };
    wss.emit('connection', ws1, req1);
    ws1.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));

    // Wait for async handler
    await new Promise(r => setTimeout(r, 50));

    // WS1 goes into CLOSING state (simulating disconnect in progress)
    ws1.readyState = 2; // CLOSING

    // WS2 connects and tries to subscribe to the same session
    const { ws: ws2, sent: sent2 } = createMockWs(1);
    const req2 = { url: '/' };
    wss.emit('connection', ws2, req2);
    ws2.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));

    // Wait for async handler
    await new Promise(r => setTimeout(r, 50));

    // WS2 should NOT receive session_already_open
    const alreadyOpen = sent2.find((m: any) => m.type === 'session_already_open');
    expect(alreadyOpen).toBeUndefined();
  });

  it('still blocks truly concurrent connections from different tabs', async () => {
    // Setup
    const nbPath = path.join(tempDir, 'test2.notebook.json');
    await ns.save(nbPath, ns.createNew('Test2', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    const wss = createMockWss();
    const db = createMockDb();
    setupWebSocket(wss, db, sm, ns);

    // WS1 connects and subscribes (stays OPEN)
    const { ws: ws1 } = createMockWs(1);
    wss.emit('connection', ws1, { url: '/' });
    ws1.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 50));

    // WS2 from another tab tries to subscribe (WS1 is still OPEN)
    const { ws: ws2, sent: sent2 } = createMockWs(1);
    wss.emit('connection', ws2, { url: '/' });
    ws2.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 50));

    // WS2 SHOULD receive session_already_open
    const alreadyOpen = sent2.find((m: any) => m.type === 'session_already_open');
    expect(alreadyOpen).toBeDefined();
  });

  it('allows takeover when old owner readyState is CLOSED (3)', async () => {
    // Setup
    const nbPath = path.join(tempDir, 'test3.notebook.json');
    await ns.save(nbPath, ns.createNew('Test3', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    const wss = createMockWss();
    const db = createMockDb();
    setupWebSocket(wss, db, sm, ns);

    // WS1 connects and subscribes
    const { ws: ws1 } = createMockWs(1);
    wss.emit('connection', ws1, { url: '/' });
    ws1.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 50));

    // WS1 is now CLOSED
    ws1.readyState = 3; // CLOSED

    // WS2 should be allowed to subscribe
    const { ws: ws2, sent: sent2 } = createMockWs(1);
    wss.emit('connection', ws2, { url: '/' });
    ws2.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
    await new Promise(r => setTimeout(r, 50));

    const alreadyOpen = sent2.find((m: any) => m.type === 'session_already_open');
    expect(alreadyOpen).toBeUndefined();
  });
});
