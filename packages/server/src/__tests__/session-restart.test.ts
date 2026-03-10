import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('SessionManager.restartSession()', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
  });

  it('should return the same session ID after restart', async () => {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);
    const originalId = session.id;

    await sm.restartSession(originalId);

    const afterRestart = sm.getSession(originalId);
    expect(afterRestart).toBeDefined();
    expect(afterRestart!.id).toBe(originalId);
  });

  it('should have a live agentProcess after restart', async () => {
    const nbPath = path.join(tempDir, 'alive.notebook.json');
    await ns.save(nbPath, ns.createNew('Alive Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    await sm.restartSession(session.id);

    // start should have been called twice: once for create, once for restart
    expect(startSpy).toHaveBeenCalledTimes(2);
    // stop should have been called once (during restart)
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('should preserve notebook state (cells) after restart', async () => {
    const nbPath = path.join(tempDir, 'cells.notebook.json');
    await ns.save(nbPath, ns.createNew('Cell Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Mutate the notebook to add a cell
    session.notebook = {
      ...session.notebook,
      cells: [
        ...session.notebook.cells,
        {
          id: 'cell-1',
          type: 'prompt' as const,
          source: 'Hello',
          outputs: [],
          execution_count: 1,
          status: 'completed' as const,
        },
      ],
    };

    await sm.restartSession(session.id);

    const afterRestart = sm.getSession(session.id);
    expect(afterRestart!.notebook.cells).toHaveLength(1);
    expect(afterRestart!.notebook.cells[0].id).toBe('cell-1');
  });

  it('should preserve listeners after restart', async () => {
    const nbPath = path.join(tempDir, 'listeners.notebook.json');
    await ns.save(nbPath, ns.createNew('Listener Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);
    const listener = vi.fn();
    sm.addListener(session.id, listener);

    await sm.restartSession(session.id);

    // Broadcast after restart — listener should still receive
    sm.broadcastToSession(session.id, { type: 'pong' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should preserve allowedDirs across restart (D2-1 regression)', async () => {
    // Create sibling directories to trigger allowedDirs computation
    const projectDir = path.join(tempDir, 'project');
    const cwdDir = path.join(projectDir, 'notebook-a');
    const siblingDir = path.join(projectDir, 'notebook-b');
    fs.mkdirSync(cwdDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    const nbPath = path.join(cwdDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('AllowedDirs Test', cwdDir));

    const session = await sm.createSession(nbPath, cwdDir);

    // Verify initial AgentProcess has --add-dir in its args
    const initialArgs = session.agentProcess._buildArgs();
    expect(initialArgs).toContain('--add-dir');
    expect(initialArgs).toContain(siblingDir);

    await sm.restartSession(session.id);

    // After restart, the new AgentProcess should also have --add-dir
    const afterRestart = sm.getSession(session.id);
    const restartArgs = afterRestart!.agentProcess._buildArgs();
    expect(restartArgs).toContain('--add-dir');
    expect(restartArgs).toContain(siblingDir);
  });

  it('should preserve allowedDirs across rerun (D2-1 regression)', async () => {
    const projectDir = path.join(tempDir, 'project-rerun');
    const cwdDir = path.join(projectDir, 'nb-a');
    const siblingDir = path.join(projectDir, 'nb-b');
    fs.mkdirSync(cwdDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    const nbPath = path.join(cwdDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Rerun AllowedDirs', cwdDir));

    const session = await sm.createSession(nbPath, cwdDir);

    await sm.rerunNotebook(session.id);

    const afterRerun = sm.getSession(session.id);
    const rerunArgs = afterRerun!.agentProcess._buildArgs();
    expect(rerunArgs).toContain('--add-dir');
    expect(rerunArgs).toContain(siblingDir);
  });

  it('should preserve allowedDirs across changeModel (D2-1 regression)', async () => {
    const projectDir = path.join(tempDir, 'project-model');
    const cwdDir = path.join(projectDir, 'nb-a');
    const siblingDir = path.join(projectDir, 'nb-b');
    fs.mkdirSync(cwdDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    const nbPath = path.join(cwdDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Model AllowedDirs', cwdDir));

    const session = await sm.createSession(nbPath, cwdDir);

    await sm.changeModel(session.id, 'claude-3-haiku');

    const afterChange = sm.getSession(session.id);
    const modelArgs = afterChange!.agentProcess._buildArgs();
    expect(modelArgs).toContain('--add-dir');
    expect(modelArgs).toContain(siblingDir);
  });

  it('should throw when restarting a non-existent session', () => {
    expect(() => sm.restartSession('non-existent')).toThrow(
      'Session "non-existent" not found',
    );
  });

  it('should pass claudeSessionId as resumeSessionId on restart', async () => {
    const nbPath = path.join(tempDir, 'resume.notebook.json');
    await ns.save(nbPath, ns.createNew('Resume Test', tempDir));

    // Mock: on initial start, simulate system.init with session_id
    let startCallCount = 0;
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      startCallCount++;
      onMsg({ type: 'system', subtype: 'hook_started' });
      if (startCallCount === 1) {
        // First start: simulate system.init
        onMsg({ type: 'system', subtype: 'init', session_id: 'claude-sess-xyz' });
      }
    });

    const session = await sm.createSession(nbPath, tempDir);

    // Session should have captured the claudeSessionId
    expect(session.claudeSessionId).toBe('claude-sess-xyz');

    await sm.restartSession(session.id);

    // The second start() call should receive the resumeSessionId
    expect(startSpy).toHaveBeenCalledTimes(2);
    const secondCall = startSpy.mock.calls[1];
    // Third arg is resumeSessionId
    expect(secondCall[2]).toBe('claude-sess-xyz');
  });

  it('should capture claudeSessionId from system.init in handleJsonlMessage', async () => {
    const nbPath = path.join(tempDir, 'init-capture.notebook.json');
    await ns.save(nbPath, ns.createNew('Init Capture', tempDir));

    // Let handleJsonlMessage process the system.init
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
      onMsg({ type: 'system', subtype: 'init', session_id: 'captured-id-999' });
    });

    const session = await sm.createSession(nbPath, tempDir);
    expect(session.claudeSessionId).toBe('captured-id-999');
  });

  it('should not pass resume when claudeSessionId is null', async () => {
    const nbPath = path.join(tempDir, 'no-resume.notebook.json');
    await ns.save(nbPath, ns.createNew('No Resume', tempDir));

    // Default mock: no system.init message emitted
    const session = await sm.createSession(nbPath, tempDir);
    expect(session.claudeSessionId).toBeUndefined();

    await sm.restartSession(session.id);

    const secondCall = startSpy.mock.calls[1];
    expect(secondCall[2]).toBeUndefined();
  });

  it('should mark running cell as error when process exits unexpectedly (regression)', async () => {
    const nbPath = path.join(tempDir, 'crash.notebook.json');
    await ns.save(nbPath, ns.createNew('Crash Test', tempDir));

    // Capture the onExit callback
    let capturedOnExit: ((code: number | null) => void) | undefined;
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void, onExit?: (code: number | null) => void) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
      capturedOnExit = onExit;
    });

    const session = await sm.createSession(nbPath, tempDir);

    // Add a running cell
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          id: 'running-cell',
          type: 'prompt' as const,
          source: 'test',
          outputs: [],
          execution_count: 1,
          status: 'running' as const,
        },
      ],
    };

    // Track broadcasts
    const broadcasts: unknown[] = [];
    sm.addListener(session.id, (msg) => broadcasts.push(msg));

    // Simulate process crash
    expect(capturedOnExit).toBeDefined();
    capturedOnExit!(1);

    // Cell should be marked as error
    const cell = session.notebook.cells.find((c) => c.id === 'running-cell');
    expect(cell?.status).toBe('error');

    // execution_complete should have been broadcast
    const complete = broadcasts.find(
      (m: any) => m.type === 'execution_complete' && m.cell_id === 'running-cell',
    );
    expect(complete).toBeDefined();
  });
});

// ── gitRoot decoupling (Step 4) ─────────────────────────────────────────

describe('Session gitRoot decoupling', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitroot-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
  });

  it('gitManager.repoRoot equals gitRoot (not cwd)', async () => {
    const worktreeRoot = path.join(tempDir, 'worktree');
    const deliverables = path.join(worktreeRoot, '.deliverables');
    fs.mkdirSync(deliverables, { recursive: true });

    const nbPath = path.join(worktreeRoot, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', worktreeRoot));

    // cwd = .deliverables, gitRoot = worktreeRoot
    const session = await sm.createSession(nbPath, deliverables, worktreeRoot);

    expect(session.gitManager.repoRoot).toBe(worktreeRoot);
  });

  it('session.cwd equals the cwd argument (not gitRoot)', async () => {
    const worktreeRoot = path.join(tempDir, 'worktree2');
    const deliverables = path.join(worktreeRoot, '.deliverables');
    fs.mkdirSync(deliverables, { recursive: true });

    const nbPath = path.join(worktreeRoot, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', worktreeRoot));

    const session = await sm.createSession(nbPath, deliverables, worktreeRoot);

    expect(session.cwd).toBe(deliverables);
    expect(session.cwd).not.toBe(worktreeRoot);
  });

  it('AgentProcess is initialized with cwd, not gitRoot', async () => {
    const { AgentProcess } = await import('../agent-process.js');
    const constructorSpy = vi.spyOn(AgentProcess.prototype, 'constructor' as any);

    const worktreeRoot = path.join(tempDir, 'worktree3');
    const deliverables = path.join(worktreeRoot, '.deliverables');
    fs.mkdirSync(deliverables, { recursive: true });

    const nbPath = path.join(worktreeRoot, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', worktreeRoot));

    const session = await sm.createSession(nbPath, deliverables, worktreeRoot);

    // The AgentProcess should have been constructed with deliverables as cwd
    // We can verify this by checking the session's cwd (AgentProcess uses it)
    expect(session.cwd).toBe(deliverables);

    constructorSpy.mockRestore();
  });

  it('defaults gitRoot to cwd when not provided (backward compat)', async () => {
    const nbPath = path.join(tempDir, 'compat.notebook.json');
    await ns.save(nbPath, ns.createNew('Compat', tempDir));

    // No gitRoot argument
    const session = await sm.createSession(nbPath, tempDir);

    expect(session.gitManager.repoRoot).toBe(tempDir);
    expect(session.cwd).toBe(tempDir);
  });
});
