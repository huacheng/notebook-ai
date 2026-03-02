/**
 * Multi-device collaboration tests.
 *
 * Tests the new multi-subscriber model:
 * - Same user can connect up to 5 devices to one session
 * - 6th device is rejected with device_limit_exceeded
 * - All subscribers receive broadcasts
 * - Any subscriber can execute (not just the first)
 * - Cross-user access is blocked
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { setupWebSocket } from '../ws-handler.js';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock auth module to control userId from ticket
vi.mock('../auth.js', () => ({
  authEnabled: true,
  consumeWsTicket: vi.fn(),
}));

import { consumeWsTicket } from '../auth.js';
const mockConsumeWsTicket = consumeWsTicket as ReturnType<typeof vi.fn>;

// Mock WebSocket with controllable readyState
function createMockWs(readyState = 1 /* OPEN */) {
  const sent: any[] = [];
  const ws = new EventEmitter() as any;
  ws.readyState = readyState;
  ws.OPEN = 1;
  ws.CLOSING = 2;
  ws.CLOSED = 3;
  ws.send = (data: string) => sent.push(JSON.parse(data));
  ws.close = vi.fn((code?: number, reason?: string) => {
    ws.readyState = 3;
    ws.closeCode = code;
    ws.closeReason = reason;
  });
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

// Helper to connect a client with a specific userId
async function connectClient(
  wss: any,
  userId: string,
  ticketId?: string
): Promise<{ ws: any; sent: any[] }> {
  const ticket = ticketId ?? `ticket-${userId}-${Date.now()}`;
  mockConsumeWsTicket.mockReturnValueOnce({ valid: true, userId });

  const { ws, sent } = createMockWs(1);
  const req = { url: `/?ticket=${ticket}` };
  wss.emit('connection', ws, req);

  // Wait for connection handler
  await new Promise(r => setTimeout(r, 10));

  return { ws, sent };
}

describe('Multi-device collaboration', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-device-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});

    mockConsumeWsTicket.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Device limit enforcement', () => {
    it('allows up to 5 devices to connect to the same session', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test.notebook.json');
      await ns.save(nbPath, ns.createNew('Test', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-alice';
      const clients: { ws: any; sent: any[] }[] = [];

      // Connect 5 devices as the same user
      for (let i = 0; i < 5; i++) {
        const client = await connectClient(wss, userId, `ticket-${i}`);
        client.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
        await new Promise(r => setTimeout(r, 20));
        clients.push(client);
      }

      // All 5 should NOT have received session_already_open or device_limit_exceeded
      for (let i = 0; i < 5; i++) {
        const alreadyOpen = clients[i].sent.find((m: any) => m.type === 'session_already_open');
        const limitExceeded = clients[i].sent.find((m: any) => m.type === 'device_limit_exceeded');
        expect(alreadyOpen, `Device ${i + 1} should not receive session_already_open`).toBeUndefined();
        expect(limitExceeded, `Device ${i + 1} should not receive device_limit_exceeded`).toBeUndefined();
      }
    });

    it('rejects 6th device with device_limit_exceeded and close code 4003', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test2.notebook.json');
      await ns.save(nbPath, ns.createNew('Test2', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-bob';

      // Connect 5 devices
      for (let i = 0; i < 5; i++) {
        const client = await connectClient(wss, userId, `ticket-${i}`);
        client.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
        await new Promise(r => setTimeout(r, 20));
      }

      // 6th device should be rejected
      const client6 = await connectClient(wss, userId, 'ticket-6');

      // The 6th connection should receive device_limit_exceeded and be closed with 4003
      const limitExceeded = client6.sent.find((m: any) => m.type === 'device_limit_exceeded');
      expect(limitExceeded).toBeDefined();
      expect(client6.ws.close).toHaveBeenCalledWith(4003, expect.any(String));
    });
  });

  describe('Broadcast to all subscribers', () => {
    it('all devices receive cell_output when any device executes', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test3.notebook.json');
      await ns.save(nbPath, ns.createNew('Test3', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-charlie';
      const clients: { ws: any; sent: any[] }[] = [];

      // Connect 3 devices
      for (let i = 0; i < 3; i++) {
        const client = await connectClient(wss, userId, `ticket-${i}`);
        client.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
        await new Promise(r => setTimeout(r, 20));
        clients.push(client);
      }

      // Clear sent arrays to isolate broadcast test
      clients.forEach(c => c.sent.length = 0);

      // Simulate session emitting a cell_output event
      const testOutput = {
        type: 'cell_output',
        cell_id: 'test-cell',
        output: { type: 'text', content: 'Hello from device 1' },
      };
      sm.broadcastToSession(session.id, testOutput);

      await new Promise(r => setTimeout(r, 20));

      // All 3 clients should have received the cell_output
      for (let i = 0; i < 3; i++) {
        const output = clients[i].sent.find((m: any) => m.type === 'cell_output');
        expect(output, `Device ${i + 1} should receive cell_output`).toBeDefined();
      }
    });
  });

  describe('Execution from any subscriber', () => {
    it('non-first subscriber can execute cells', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test4.notebook.json');
      await ns.save(nbPath, ns.createNew('Test4', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-dave';

      // Connect 2 devices
      const client1 = await connectClient(wss, userId, 'ticket-1');
      client1.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      const client2 = await connectClient(wss, userId, 'ticket-2');
      client2.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // Device 2 (not the first subscriber) tries to execute
      client2.ws.emit('message', JSON.stringify({
        type: 'execute_request',
        session_id: session.id,
        cell_id: 'cell-1',
        source: 'Test prompt',
      }));

      await new Promise(r => setTimeout(r, 50));

      // Device 2 should NOT receive "Not the session owner" error
      const ownerError = client2.sent.find(
        (m: any) => m.type === 'error' && m.message?.includes('owner')
      );
      expect(ownerError, 'Non-first subscriber should be allowed to execute').toBeUndefined();
    });
  });

  describe('Connection lifecycle', () => {
    it('connection count decrements on disconnect, allowing new device', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test5.notebook.json');
      await ns.save(nbPath, ns.createNew('Test5', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-eve';
      const clients: { ws: any; sent: any[] }[] = [];

      // Connect 5 devices
      for (let i = 0; i < 5; i++) {
        const client = await connectClient(wss, userId, `ticket-${i}`);
        client.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
        await new Promise(r => setTimeout(r, 20));
        clients.push(client);
      }

      // Disconnect device 3
      clients[2].ws.emit('close');
      await new Promise(r => setTimeout(r, 20));

      // Now device 6 should be allowed to connect
      const client6 = await connectClient(wss, userId, 'ticket-6');
      client6.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      const limitExceeded = client6.sent.find((m: any) => m.type === 'device_limit_exceeded');
      expect(limitExceeded, 'After disconnect, new device should be allowed').toBeUndefined();
    });

    it('session survives when original subscriber disconnects', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test6.notebook.json');
      await ns.save(nbPath, ns.createNew('Test6', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-frank';

      // Connect 2 devices
      const client1 = await connectClient(wss, userId, 'ticket-1');
      client1.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      const client2 = await connectClient(wss, userId, 'ticket-2');
      client2.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // Disconnect device 1 (original subscriber)
      client1.ws.emit('close');
      await new Promise(r => setTimeout(r, 20));

      // Clear client2's sent array
      client2.sent.length = 0;

      // Emit an event - device 2 should still receive it
      const testOutput = {
        type: 'cell_output',
        session_id: session.id,
        cell_id: 'test-cell',
        output: { type: 'text', content: 'Still working!' },
      };
      sm.broadcastToSession(session.id, testOutput);

      await new Promise(r => setTimeout(r, 20));

      const output = client2.sent.find((m: any) => m.type === 'cell_output');
      expect(output, 'Remaining subscriber should still receive broadcasts').toBeDefined();
    });
  });

  describe('Cross-user protection', () => {
    it('blocks different user from subscribing to session', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test7.notebook.json');
      await ns.save(nbPath, ns.createNew('Test7', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      // User A subscribes first
      const clientA = await connectClient(wss, 'user-alice', 'ticket-alice');
      clientA.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // User B tries to subscribe to the same session
      const clientB = await connectClient(wss, 'user-bob', 'ticket-bob');
      clientB.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // User B should receive an error (not allowed to access another user's session)
      const accessDenied = clientB.sent.find(
        (m: any) => m.type === 'error' && (
          m.message?.includes('permission') ||
          m.message?.includes('access') ||
          m.message?.includes('denied') ||
          m.message?.includes('owner')
        )
      );
      expect(accessDenied, 'Different user should be blocked from session').toBeDefined();
    });
  });

  describe('Device connection notifications', () => {
    it('broadcasts device_connected when new device joins', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test8.notebook.json');
      await ns.save(nbPath, ns.createNew('Test8', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-grace';

      // Connect device 1
      const client1 = await connectClient(wss, userId, 'ticket-1');
      client1.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // Clear sent array
      client1.sent.length = 0;

      // Connect device 2
      const client2 = await connectClient(wss, userId, 'ticket-2');
      client2.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // Device 1 should have received device_connected notification
      const connected = client1.sent.find((m: any) => m.type === 'device_connected');
      expect(connected, 'Existing subscribers should receive device_connected').toBeDefined();
    });

    it('broadcasts device_disconnected when device leaves', async () => {
      // Setup
      const nbPath = path.join(tempDir, 'test9.notebook.json');
      await ns.save(nbPath, ns.createNew('Test9', tempDir));
      const session = await sm.createSession(nbPath, tempDir);

      const wss = createMockWss();
      const db = createMockDb();
      setupWebSocket(wss, db, sm, ns);

      const userId = 'user-henry';

      // Connect 2 devices
      const client1 = await connectClient(wss, userId, 'ticket-1');
      client1.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      const client2 = await connectClient(wss, userId, 'ticket-2');
      client2.ws.emit('message', JSON.stringify({ type: 'subscribe', session_id: session.id }));
      await new Promise(r => setTimeout(r, 20));

      // Clear sent arrays
      client1.sent.length = 0;

      // Device 2 disconnects
      client2.ws.emit('close');
      await new Promise(r => setTimeout(r, 20));

      // Device 1 should have received device_disconnected notification
      const disconnected = client1.sent.find((m: any) => m.type === 'device_disconnected');
      expect(disconnected, 'Remaining subscribers should receive device_disconnected').toBeDefined();
    });
  });
});
