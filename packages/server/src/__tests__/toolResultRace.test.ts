/**
 * Tool result race condition — TDD Red phase.
 *
 * Bug: When Claude CLI emits `result` before the last `tool_result`,
 * findRunningCellId() returns null (cell already completed) and the
 * tool_result is silently dropped, leaving tool spinners stuck.
 *
 * Fix: Track _currentCellId on the session so tool_result can still
 * find the correct cell after completion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('tool_result after result (race condition)', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let sendPromptSpy: ReturnType<typeof vi.spyOn>;
  let onMessage: (msg: unknown) => void;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-race-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
    sendPromptSpy = vi.spyOn(AgentProcess.prototype, 'sendPrompt').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
    sendPromptSpy.mockRestore();
  });

  async function createSessionWithToolUse() {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Simulate: cell starts running, assistant emits a tool_use block
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          id: 'c1',
          type: 'prompt' as const,
          source: 'read /etc/hostname',
          outputs: [
            {
              type: 'tool_use' as const,
              tool_use_id: 'tu-1',
              name: 'Read',
              input: { file_path: '/etc/hostname' },
            },
          ],
          execution_count: 1,
          status: 'running' as const,
        },
      ],
    };

    return session;
  }

  it('tool_result arriving after result still attaches to the cell', async () => {
    const session = await createSessionWithToolUse();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // Step 1: `result` arrives first → cell completes
    onMessage({ type: 'result', result: 'done reading', is_error: false });

    // Cell should now be completed
    expect(session.notebook.cells[0].status).toBe('completed');

    // Step 2: `tool_result` arrives AFTER completion
    onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'my-hostname',
        }],
      },
    });

    // The tool_use output should now have a result — NOT undefined
    const cell = session.notebook.cells[0];
    expect(cell.type).toBe('prompt');
    const toolOutput = (cell as any).outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBe('my-hostname');

    // A tool_result WS message should have been broadcast
    const toolResultMsg = messages.find((m: any) => m.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.tool_use_id).toBe('tu-1');
    expect(toolResultMsg.content).toBe('my-hostname');
  });

  it('tool_result still works normally when cell is running', async () => {
    const session = await createSessionWithToolUse();

    // tool_result arrives while cell is still running (normal case)
    onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'normal-result',
        }],
      },
    });

    const cell = session.notebook.cells[0] as any;
    const toolOutput = cell.outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBe('normal-result');
  });

  it('late tool_result routes to correct cell by tool_use_id, not running cell', async () => {
    const session = await createSessionWithToolUse();

    // Complete cell c1
    onMessage({ type: 'result', result: 'done', is_error: false });
    expect(session.notebook.cells[0].status).toBe('completed');

    // Start a new cell c2
    session.notebook = {
      ...session.notebook,
      cells: [
        ...session.notebook.cells,
        {
          id: 'c2',
          type: 'prompt' as const,
          source: 'next prompt',
          outputs: [
            {
              type: 'tool_use' as const,
              tool_use_id: 'tu-2',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
          execution_count: 1,
          status: 'running' as const,
        },
      ],
    };

    // A stale tool_result for tu-1 should NOT corrupt c2
    // (it should go to c1, not c2)
    onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'late-result-for-c1',
        }],
      },
    });

    // tu-1 result goes to c1 (matched by tool_use_id)
    const c1Tool = (session.notebook.cells[0] as any).outputs[0];
    expect(c1Tool.result).toBe('late-result-for-c1');

    // c2's tool should still be pending
    const c2Tool = (session.notebook.cells[1] as any).outputs[0];
    expect(c2Tool.result).toBeUndefined();
  });
});
