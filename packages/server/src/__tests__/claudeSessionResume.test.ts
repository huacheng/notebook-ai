import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotebookDb } from '../db.js';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── DB Tests ─────────────────────────────────────────────────────────────────

describe('claude_session_id persistence (DB)', () => {
  let db: NotebookDb;

  beforeEach(() => {
    db = new NotebookDb(':memory:');
    // Seed a notebook so FK constraint is satisfied
    db.createNotebook({
      id: 'nb-1',
      user_id: 'u1',
      title: 'Test',
      slug: 'test',
      workspace_dir: '/tmp/ws',
      notebook_path: '/tmp/ws/test.notebook.json',
      project_id: null,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  it('createSessionRecord stores claude_session_id', () => {
    const row = db.createSessionRecord({
      id: 'sess-1',
      notebook_id: 'nb-1',
      tmux_session: 'sess-1',
      jsonl_path: null,
      cwd: '/tmp/ws',
      status: 'active',
      claude_session_id: 'claude-abc-123',
      created_at: new Date().toISOString(),
    });

    expect(row.claude_session_id).toBe('claude-abc-123');
  });

  it('createSessionRecord stores null claude_session_id', () => {
    const row = db.createSessionRecord({
      id: 'sess-2',
      notebook_id: 'nb-1',
      tmux_session: 'sess-2',
      jsonl_path: null,
      cwd: '/tmp/ws',
      status: 'active',
      claude_session_id: null,
      created_at: new Date().toISOString(),
    });

    expect(row.claude_session_id).toBeNull();
  });

  it('updateClaudeSessionId writes session ID to existing record', () => {
    db.createSessionRecord({
      id: 'sess-3',
      notebook_id: 'nb-1',
      tmux_session: 'sess-3',
      jsonl_path: null,
      cwd: '/tmp/ws',
      status: 'active',
      claude_session_id: null,
      created_at: new Date().toISOString(),
    });

    db.updateClaudeSessionId('sess-3', 'claude-xyz-456');

    const session = db.getActiveSession('nb-1');
    expect(session?.claude_session_id).toBe('claude-xyz-456');
  });

  it('getActiveSession returns claude_session_id for resume', () => {
    db.createSessionRecord({
      id: 'sess-4',
      notebook_id: 'nb-1',
      tmux_session: 'sess-4',
      jsonl_path: null,
      cwd: '/tmp/ws',
      status: 'active',
      claude_session_id: 'claude-resume-id',
      created_at: new Date().toISOString(),
    });

    const active = db.getActiveSession('nb-1');
    expect(active).toBeDefined();
    expect(active!.claude_session_id).toBe('claude-resume-id');
  });

  it('getActiveSessionByName returns claude_session_id', () => {
    db.createSessionRecord({
      id: 'sess-5',
      notebook_id: 'nb-1',
      tmux_session: 'nb-abcdef',
      jsonl_path: null,
      cwd: '/tmp/ws',
      status: 'active',
      claude_session_id: 'claude-byname-id',
      created_at: new Date().toISOString(),
    });

    const row = db.getActiveSessionByName('nb-abcdef');
    expect(row).toBeDefined();
    expect(row!.claude_session_id).toBe('claude-byname-id');
  });
});

// ── Session Tests ────────────────────────────────────────────────────────────

describe('claude_session_id in SessionManager', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
  });

  it('createSession passes resumeSessionId to agentProcess.start()', async () => {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    // Create without resume
    const session1 = await sm.createSession(nbPath, tempDir);
    expect(startSpy).toHaveBeenCalledTimes(1);
    // Third arg (resumeSessionId) should be undefined
    expect(startSpy.mock.calls[0][2]).toBeUndefined();

    // Close and create new session with resume (different path to avoid idempotent)
    await sm.closeSession(session1.id);

    const nbPath2 = path.join(tempDir, 'test2.notebook.json');
    await ns.save(nbPath2, ns.createNew('Test2', tempDir));
    await sm.createSession(nbPath2, tempDir, undefined, 'resume-abc-123');
    expect(startSpy).toHaveBeenCalledTimes(2);
    // Third arg should be the resumeSessionId
    expect(startSpy.mock.calls[1][2]).toBe('resume-abc-123');
  });

  it('onClaudeSessionId callback fires when system.init is received', async () => {
    const nbPath = path.join(tempDir, 'cb-test.notebook.json');
    await ns.save(nbPath, ns.createNew('CB Test', tempDir));

    // Capture the onMessage handler passed to start()
    let capturedOnMessage: ((msg: unknown) => void) | null = null;
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      capturedOnMessage = onMsg;
    });

    const callbackCalls: { sessionId: string; claudeSessionId: string }[] = [];
    sm.onClaudeSessionId = (sessionId, claudeSessionId) => {
      callbackCalls.push({ sessionId, claudeSessionId });
    };

    const session = await sm.createSession(nbPath, tempDir);

    // Simulate system.init with session_id
    expect(capturedOnMessage).not.toBeNull();
    capturedOnMessage!({
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-xyz',
    });

    expect(callbackCalls).toHaveLength(1);
    expect(callbackCalls[0].sessionId).toBe(session.id);
    expect(callbackCalls[0].claudeSessionId).toBe('claude-session-xyz');
  });

  it('onClaudeSessionId fires on hook_started, not duplicated on init', async () => {
    const nbPath = path.join(tempDir, 'hook-test.notebook.json');
    await ns.save(nbPath, ns.createNew('Hook Test', tempDir));

    let capturedOnMessage: ((msg: unknown) => void) | null = null;
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      capturedOnMessage = onMsg;
    });

    const callbackCalls: string[] = [];
    sm.onClaudeSessionId = (_sid, claudeSessionId) => {
      callbackCalls.push(claudeSessionId);
    };

    await sm.createSession(nbPath, tempDir);

    // hook_started comes first
    capturedOnMessage!({
      type: 'system',
      subtype: 'hook_started',
      session_id: 'hook-session-abc',
    });

    // init with same session_id should NOT fire again
    capturedOnMessage!({
      type: 'system',
      subtype: 'init',
      session_id: 'hook-session-abc',
    });

    expect(callbackCalls).toHaveLength(1);
    expect(callbackCalls[0]).toBe('hook-session-abc');
  });

  it('reconnectSession passes resumeSessionId through to createSession', async () => {
    const nbPath = path.join(tempDir, 'reconnect.notebook.json');
    const nb = ns.createNew('Reconnect', tempDir);
    await ns.save(nbPath, nb);

    const result = await sm.reconnectSession(
      'nb-fakehash', nbPath, tempDir, nb,
      null, 'nb-db-id', undefined, 'resume-reconnect-id',
    );

    expect(result.reconnected).toBe(false);
    // The last start call should have received the resumeSessionId
    const lastCall = startSpy.mock.calls[startSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('resume-reconnect-id');
  });
});
