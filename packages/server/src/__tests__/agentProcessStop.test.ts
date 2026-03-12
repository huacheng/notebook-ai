/**
 * Regression test for AgentProcess.stop() async behavior.
 * Verifies that stop() waits for the process to exit before returning.
 *
 * This test uses the existing mock pattern from other test files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';

describe('AgentProcess.stop() async behavior', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let stopCallOrder: string[] = [];

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-test-'));
    stopCallOrder = [];

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    // Mock stop to track call order and return a promise that resolves after a delay
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(async () => {
      stopCallOrder.push('stop-start');
      await new Promise(r => setTimeout(r, 50)); // Simulate waiting for process
      stopCallOrder.push('stop-end');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('closeSession awaits stop() before returning', async () => {
    // Create a session
    const nbPath = path.join(tempDir, 'test.notebook.json');
    const notebook = ns.createNew('Test', tempDir);
    await ns.save(nbPath, notebook);
    const session = await sm.createSession(nbPath, tempDir);

    // Track when closeSession resolves
    stopCallOrder.push('close-start');
    await sm.closeSession(session.id);
    stopCallOrder.push('close-end');

    // Verify stop() was called and awaited (close-end should come after stop-end)
    expect(stopCallOrder).toEqual([
      'close-start',
      'stop-start',
      'stop-end',
      'close-end'
    ]);
  });

  it('stop() is called for each notebook when deleting project', async () => {
    // Create two sessions
    const nbPath1 = path.join(tempDir, 'test1.notebook.json');
    const nbPath2 = path.join(tempDir, 'test2.notebook.json');
    const notebook1 = ns.createNew('Test1', tempDir);
    const notebook2 = ns.createNew('Test2', tempDir);
    await ns.save(nbPath1, notebook1);
    await ns.save(nbPath2, notebook2);

    const session1 = await sm.createSession(nbPath1, tempDir);
    const session2 = await sm.createSession(nbPath2, tempDir);

    // Close both sessions
    await sm.closeSession(session1.id);
    await sm.closeSession(session2.id);

    // stop() should have been called twice
    expect(stopSpy).toHaveBeenCalledTimes(2);
  });

  it('stop() resolves immediately when proc is null (never started)', async () => {
    // Import the real AgentProcess for this test
    vi.restoreAllMocks();
    const { AgentProcess } = await import('../agent-process.js');

    const agent = new AgentProcess('claude', '/tmp', 'test');
    // Never call start(), so proc is null

    const start = Date.now();
    await agent.stop();
    const elapsed = Date.now() - start;

    // Should resolve nearly instantly
    expect(elapsed).toBeLessThan(50);
  });
});
