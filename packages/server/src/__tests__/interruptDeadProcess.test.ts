/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Tests that interruptCell() force-completes a running cell synchronously,
 * stops the old process, and pre-spawns a new one.
 */
describe('interruptCell with dead/alive process', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interrupt-dead-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
    vi.spyOn(AgentProcess.prototype, 'sendPrompt').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createSessionWithRunningCell() {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));
    const session = await sm.createSession(nbPath, tempDir);
    session.notebook = {
      ...session.notebook,
      cells: [
        { id: 'c1', type: 'prompt' as const, source: 'hello', outputs: [], execution_count: 1, status: 'running' as const },
      ],
    };
    return session;
  }

  it('should force-complete running cell when agent process is dead', async () => {
    const session = await createSessionWithRunningCell();
    vi.spyOn(session.agentProcess, 'isAlive').mockReturnValue(false);

    const broadcasts: any[] = [];
    session.listeners.add((msg: any) => broadcasts.push(msg));

    await sm.interruptCell(session.id);

    // Cell should be synchronously completed as 'interrupted'
    expect(session.notebook.cells[0].status).toBe('interrupted');

    // execution_complete should have been broadcast
    const completeMsg = broadcasts.find((m: any) => m.type === 'execution_complete');
    expect(completeMsg).toBeDefined();
    expect(completeMsg.cell_id).toBe('c1');
    expect(completeMsg.status).toBe('interrupted');
  });

  it('should stop process and pre-spawn new one when alive', async () => {
    const session = await createSessionWithRunningCell();

    await sm.interruptCell(session.id);

    // Cell should be force-completed synchronously
    expect(session.notebook.cells[0].status).toBe('interrupted');
    // Old process should be stopped
    expect(stopSpy).toHaveBeenCalled();
    // New process should be spawned (start called twice: createSession + respawn)
    expect(startSpy).toHaveBeenCalledTimes(2);
  });
});
